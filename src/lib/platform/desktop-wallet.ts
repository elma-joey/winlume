import { and, eq } from "drizzle-orm";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAuthMode } from "./auth";
import { getPlatformDb } from "./db/client";
import { desktopSessions, users } from "./db/schema";
import { getPlatformRepositories } from "./repositories";
import { desktopBearer, desktopUserIsValid, desktopWebOrigin, hashDesktopSecret } from "./desktop-auth";
import { consumeRateLimit } from "./rate-limit";
import { ConsoleRequestError, ensureOrganizationKeyManager, getConsoleWalletDetails } from "../console/server";
import { requireConsoleOrganization } from "../console/workspace";
import { createConsoleTopupOrder, getConsolePaymentOrder, getConsoleTopupCashier, getConsoleTopupConfig, getEpayConfig, listConsolePaymentOrders } from "../console/topup";
import { createPlanPurchase, getPlanOrder, listPlanOrders, membership, planCatalog, planCashier } from "../console/plan-purchases";

const fail = (message: string, status = 400) => { throw new ConsoleRequestError(message, status, "desktop_wallet_error"); };
const validOrder = (value: unknown): value is string => typeof value === "string" && /^RZ[A-Za-z0-9]{8,62}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

async function contextForSession(session: typeof desktopSessions.$inferSelect | undefined, expectedOrg?: string) {
  const db = getPlatformDb(); const repositories = getPlatformRepositories();
  if (!db || !repositories) return fail("账号服务暂不可用。", 503);
  if (!session?.userId) return fail("请先登录 Reizo。", 401);
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!desktopUserIsValid(session, user ?? null)) return fail("登录已失效，请重新登录。", 401);
  if (!user.currentOrganizationId) return fail("请先在网页选择工作区。", 403);
  if (expectedOrg && user.currentOrganizationId !== expectedOrg) return fail("当前工作区已变化，请刷新充值信息后重试。", 409);
  const context = { userId: user.id, repositories };
  const { organization, membership } = await requireConsoleOrganization(context, user.currentOrganizationId);
  return { context, session, organization, role: membership.role };
}

export async function desktopWalletContext(request: Request, expectedOrg?: string) {
  if (getAuthMode() !== "reizo") return fail("桌面充值需要 Reizo 账号服务。", 503);
  const token = desktopBearer(request); const db = getPlatformDb();
  if (!token) return fail("请先登录 Reizo。", 401);
  if (!db) return fail("账号服务暂不可用。", 503);
  const [session] = await db.select().from(desktopSessions).where(eq(desktopSessions.tokenHash, hashDesktopSecret(token))).limit(1);
  const result = await contextForSession(session, expectedOrg);
  if (!consumeRateLimit(`desktop-wallet:${request.method}:${result.session.id}`, request.method === "POST" ? 12 : 120, 60_000)) return fail("操作过于频繁，请稍后重试。", 429);
  return result;
}

type WalletContext = Awaited<ReturnType<typeof desktopWalletContext>>;
type CashierTicket = { sessionId: string; userId: string; organizationId: string; order: string; expires: number };
const ticketSignature = (payload: string, key: string) => createHmac("sha256", key).update(`reizo-desktop-cashier:v1:${payload}`).digest("base64url");

export function createCashierTicket(value: CashierTicket, key: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${ticketSignature(payload, key)}`;
}

export function parseCashierTicket(ticket: string, key: string, now = Date.now()): CashierTicket {
  if (ticket.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(ticket)) return fail("收银台链接无效。", 403);
  const [payload, signature] = ticket.split(".");
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(ticketSignature(payload, key)))) return fail("收银台链接无效。", 403);
  let value: CashierTicket;
  try { value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return fail("收银台链接无效。", 403); }
  if (!value || !uuid(value.sessionId) || !uuid(value.userId) || !uuid(value.organizationId) || !validOrder(value.order) ||
    !Number.isSafeInteger(value.expires) || value.expires <= now || value.expires > now + 10 * 60_000) return fail("收银台链接已过期，请在客户端重新打开。", 410);
  return value;
}

function cashierUrl(request: Request, ctx: WalletContext, order: string): string {
  const config = getEpayConfig();
  if (!config) return fail("在线充值尚未配置。", 503);
  const ticket = createCashierTicket({ sessionId: ctx.session.id, userId: ctx.context.userId, organizationId: ctx.organization.id,
    order, expires: Math.min(ctx.session.expiresAt.getTime(), Date.now() + 10 * 60_000) }, config.key);
  return `${desktopWebOrigin(request)}/api/desktop-auth/cashier?ticket=${ticket}`;
}

export async function readDesktopWallet(request: Request) {
  const url = new URL(request.url); const expectedOrg = url.searchParams.get("organizationId") ?? undefined;
  const ctx = await desktopWalletContext(request, expectedOrg);
  const reference = url.searchParams.get("order");
  if (reference && !validOrder(reference)) return fail("订单编号无效。");
  const [{ wallet }, orders, order, plan, plans, planOrders] = await Promise.all([getConsoleWalletDetails(ctx.context, ctx.organization.id), listConsolePaymentOrders(ctx.organization.id),
    reference ? reference.startsWith("RZP") ? getPlanOrder(ctx.organization.id,reference) : getConsolePaymentOrder(ctx.organization.id, reference) : null,
    membership(ctx.context,ctx.organization.id), planCatalog(), listPlanOrders(ctx.organization.id)]);
  if (reference && !order) return fail("当前工作区没有此订单。", 404);
  return { organization: { id: ctx.organization.id, name: ctx.organization.name }, balance: { availableCredits: wallet.availableCredits, currency: wallet.currency, syncStatus: wallet.syncStatus ?? "unavailable" },
    config: { ...getConsoleTopupConfig(), topupDiscount: plan?.discount ?? 1 },
    plans, membership: plan,
    canTopup: ctx.role === "owner" || ctx.role === "admin", orders: [...orders,...planOrders].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30), order,
    ...(order?.status === "pending" ? { cashierUrl: cashierUrl(request, ctx, order.reference) } : {}) };
}

export async function createDesktopTopup(request: Request) {
  const ctx = await desktopWalletContext(request);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return fail("请使用 JSON 提交充值请求。", 415);
  const body = await request.json().catch(() => null);
  if (body && typeof body.planId === "string") {
    if (body.organizationId!==ctx.organization.id) return fail("当前工作区已变化，请刷新。",409);
    const order=await createPlanPurchase(ctx.context,body);
    return {order,...(order.status==="pending"?{cashierUrl:cashierUrl(request,ctx,order.reference)}:{})};
  }
  if (!body || !uuid(body.organizationId) || !uuid(body.requestId) || !Number.isSafeInteger(body.amount) || body.amount < 1 || typeof body.paymentMethod !== "string") return fail("充值请求无效，请重新选择金额和支付方式。");
  if (body.organizationId !== ctx.organization.id) return fail("当前工作区已变化，请刷新充值信息后重试。", 409);
  if (ctx.role !== "owner" && ctx.role !== "admin") return fail("当前角色无工作区充值权限。", 403);
  const result = await createConsoleTopupOrder(ctx.context, { organizationId: ctx.organization.id, amount: body.amount, paymentMethod: body.paymentMethod,
    expectedPayMoney: typeof body.expectedPayMoney==="string"?body.expectedPayMoney:undefined,
    userAgent: request.headers.get("user-agent"), idempotencyKey: `${ctx.session.id}:${body.requestId.toLowerCase()}` });
  const order = await getConsolePaymentOrder(ctx.organization.id, result.tradeNo);
  if (!order) return fail("订单已提交，暂时无法读取状态，请刷新充值记录。", 503);
  return { order, ...(order.status === "pending" ? { cashierUrl: cashierUrl(request, ctx, order.reference) } : {}) };
}

const htmlEntities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (value: string) => value.replace(/[&<>"']/g, char => htmlEntities[char] ?? char);

export async function desktopCashier(request: Request): Promise<Response> {
  if (getAuthMode() !== "reizo") return fail("充值服务不可用。", 503);
  const config = getEpayConfig(); const db = getPlatformDb();
  if (!config || !db) return fail("充值服务暂不可用。", 503);
  const ticket = parseCashierTicket(new URL(request.url).searchParams.get("ticket") ?? "", config.key);
  if (!consumeRateLimit(`desktop-cashier:${ticket.sessionId}`, 60, 60_000)) return fail("操作过于频繁，请稍后重试。", 429);
  const [session] = await db.select().from(desktopSessions).where(and(eq(desktopSessions.id, ticket.sessionId), eq(desktopSessions.userId, ticket.userId))).limit(1);
  const ctx = await contextForSession(session, ticket.organizationId);
  ensureOrganizationKeyManager(ctx.role);
  if (ticket.order.startsWith("RZP")) {
    const hosted=await planCashier(ctx.organization.id,ticket.order);
    return Response.json(hosted,{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});
  }
  const purchase = await getConsoleTopupCashier(ctx.organization.id, ticket.order);
  const target = new URL(purchase.url);
  if (target.protocol !== "https:" || target.username || target.password || target.hash) return fail("收银台地址配置无效。", 503);
  if (request.headers.get("accept")?.split(",").some(value => value.trim() === "application/json")) {
    return Response.json({ url: purchase.url, params: purchase.params }, { headers: {
      "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", Vary: "Accept",
    } });
  }
  const nonce = randomBytes(18).toString("base64");
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reizo 充值收银台</title><body><h1>正在前往收银台</h1><p>到账工作区：${escape(ctx.organization.name)}</p><form id="cashier" method="POST" action="${escape(purchase.url)}">${Object.entries(purchase.params).map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`).join("")}<button type="submit">继续付款</button></form><script nonce="${nonce}">document.getElementById('cashier').requestSubmit();</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${target.origin}; base-uri 'none'; frame-ancestors 'none'` } });
}
