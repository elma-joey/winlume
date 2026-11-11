import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { DEFAULT_QUOTA_PER_UNIT } from "@/lib/catalog/plaza-display";
import { addNewApiUserQuota } from "@/lib/newapi/admin-client";
import { getPlatformDb } from "@/lib/platform";
import { epayOrders } from "@/lib/platform/db/schema";
import {
  buildEpayPurchase,
  EPAY_TRADE_SUCCESS,
  epayDeviceFromUserAgent,
  verifyEpayNotification,
  type EpayConfig,
} from "@/lib/payment/epay";
import {
  ConsoleRequestError,
  ensureOrganizationKeyManager,
  type ConsoleRequestContext,
} from "./server";
import { requireConsoleOrganization } from "./workspace";
import { membership } from "./plan-purchases";
import type {
  ConsolePaymentOrder,
  ConsoleTopupConfig,
  ConsoleTopupMethod,
} from "./types";

/**
 * ¥1 buys this many credits. Fixed 1:1 with v2api today (v2api `Price = 1`),
 * and 1 credit is worth {@link DEFAULT_QUOTA_PER_UNIT} new-api quota — so a
 * settled ¥N order grants `N * DEFAULT_QUOTA_PER_UNIT` quota to the mapped
 * new-api user, which the wallet then reads back as N credits.
 */
export const CREDITS_PER_CNY = 1;

/** Whole-yuan presets shown as quick-pick chips (mirrors v2api amount_options). */
export const EPAY_AMOUNT_OPTIONS = [5, 10, 20, 50, 100, 200, 500, 1000];

const KNOWN_METHODS: Record<string, string> = {
  alipay: "支付宝",
  wxpay: "微信支付",
  qqpay: "QQ 钱包",
  jkopay: "街口支付",
  usdt: "USDT",
};

const DEFAULT_METHODS = ["alipay", "wxpay"];

function absoluteBaseUrl(): string {
  const raw = process.env.EPAY_NOTIFY_BASE_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
  if (!raw) {
    throw new ConsoleRequestError(
      "在线充值未配置回调地址（EPAY_NOTIFY_BASE_URL / NEXTAUTH_URL）。",
      503,
      "topup_base_url_missing",
    );
  }
  return raw.replace(/\/+$/, "");
}

export function getEpayConfig(): EpayConfig | null {
  const baseUrl = process.env.EPAY_BASE_URL?.trim();
  const pid = process.env.EPAY_PID?.trim();
  const key = process.env.EPAY_KEY?.trim();
  if (!baseUrl || !pid || !key) return null;
  return { baseUrl, pid, key };
}

function configuredMethods(): ConsoleTopupMethod[] {
  const raw = process.env.EPAY_METHODS?.trim();
  const types = raw
    ? raw.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_METHODS;
  return types.map((type) => ({ type, name: KNOWN_METHODS[type] ?? type }));
}

function minTopup(): number {
  const parsed = Number(process.env.EPAY_MIN_TOPUP?.trim());
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

function maxTopup(): number {
  const parsed = Number(process.env.EPAY_MAX_TOPUP?.trim());
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 10_000;
}

export function getConsoleTopupConfig(): ConsoleTopupConfig {
  const config = getEpayConfig();
  const min = minTopup();
  return {
    enabled: config !== null,
    provider: "epay",
    currency: "CNY",
    creditsPerUnit: CREDITS_PER_CNY,
    minTopup: min,
    maxTopup: maxTopup(),
    amountOptions: EPAY_AMOUNT_OPTIONS.filter((value) => value >= min),
    methods: configuredMethods(),
  };
}

/** `RZ` + ms timestamp + 8 hex chars — distinct from new-api's `USR…` numbers. */
function newTradeNo(): string {
  return `RZ${Date.now()}${randomBytes(4).toString("hex")}`;
}

function mapEpayOrder(row: typeof epayOrders.$inferSelect): ConsolePaymentOrder {
  return {
    id: row.id,
    reference: row.tradeNo,
    status: row.status,
    amount: Number(row.payMoney),
    currency: row.currency,
    credits: row.amountCredits,
    provider: row.provider,
    paymentMethod: row.paymentMethod,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
  };
}

export async function listConsolePaymentOrders(
  organizationId: string,
  limit = 20,
): Promise<ConsolePaymentOrder[]> {
  const database = getPlatformDb();
  if (!database) return [];
  const rows = await database
    .select()
    .from(epayOrders)
    .where(eq(epayOrders.organizationId, organizationId))
    .orderBy(desc(epayOrders.createdAt))
    .limit(limit);
  return rows.map(mapEpayOrder);
}

export async function getConsolePaymentOrder(
  organizationId: string,
  tradeNo: string,
): Promise<ConsolePaymentOrder | null> {
  const database = getPlatformDb();
  if (!database) return null;
  const [row] = await database
    .select()
    .from(epayOrders)
    .where(and(eq(epayOrders.organizationId, organizationId), eq(epayOrders.tradeNo, tradeNo)))
    .limit(1);
  return row ? mapEpayOrder(row) : null;
}

export interface CreateTopupInput {
  organizationId: string;
  amount: number;
  paymentMethod: string;
  userAgent?: string | null;
  /** Server-issued scope plus caller request ID; retries reuse the same unpaid order. */
  idempotencyKey?: string;
  expectedPayMoney?: string;
}

export interface CreateTopupResult {
  tradeNo: string;
  /** POST `params` here as a form to reach the cashier */
  url: string;
  params: Record<string, string>;
}

export async function createConsoleTopupOrder(
  context: ConsoleRequestContext,
  input: CreateTopupInput,
): Promise<CreateTopupResult> {
  const config = getEpayConfig();
  if (!config) {
    throw new ConsoleRequestError("在线充值尚未配置。", 503, "topup_not_configured");
  }

  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount < minTopup() || amount > maxTopup()) {
    throw new ConsoleRequestError(
      `充值金额需为 ${minTopup()} 到 ${maxTopup()} 之间的整数。`,
      400,
      "invalid_topup_amount",
    );
  }

  const method = input.paymentMethod?.trim().toLowerCase() ?? "";
  if (!configuredMethods().some((entry) => entry.type === method)) {
    throw new ConsoleRequestError("不支持的支付方式。", 400, "invalid_payment_method");
  }

  const selected = await requireConsoleOrganization(context, input.organizationId);
  ensureOrganizationKeyManager(selected.membership.role);

  const mapping = await context.repositories.teamNewApiMapping.findByOrganizationId(input.organizationId);
  if (!mapping) {
    throw new ConsoleRequestError("工作区未关联额度账户。", 409, "team_mapping_missing");
  }

  const database = getPlatformDb();
  if (!database) {
    throw new ConsoleRequestError("平台数据库尚未配置。", 503, "platform_not_configured");
  }

  const tradeNo = input.idempotencyKey
    ? `RZD${createHash("sha256").update(JSON.stringify([input.organizationId, context.userId, input.idempotencyKey])).digest("hex").slice(0, 20)}`
    : newTradeNo();
  const credits = amount * CREDITS_PER_CNY;
  const discount = (await membership(context,input.organizationId))?.discount ?? 1;
  const payMoney = (Math.round(amount * 100 * discount)/100).toFixed(2);
  if (input.expectedPayMoney && input.expectedPayMoney !== payMoney) throw new ConsoleRequestError("会员折扣已变化，请刷新后核对付款金额。",409,"topup_quote_changed");
  const base = absoluteBaseUrl();

  const purchase = buildEpayPurchase(config, {
    type: method,
    outTradeNo: tradeNo,
    name: `Reizo 充值 ${credits * 300} 额度`,
    money: payMoney,
    device: epayDeviceFromUserAgent(input.userAgent),
    notifyUrl: `${base}/api/pay/epay/notify`,
    returnUrl: `${base}/account/wallet?order=${encodeURIComponent(tradeNo)}`,
  });

  const insert = database.insert(epayOrders).values({
    tradeNo,
    organizationId: input.organizationId,
    userId: context.userId,
    newApiUserId: mapping.newApiUserId,
    provider: "epay",
    paymentMethod: method,
    amountCredits: credits,
    payMoney,
    currency: "CNY",
    status: "pending",
  });
  if (input.idempotencyKey) {
    await insert.onConflictDoNothing({ target: epayOrders.tradeNo });
    const [saved] = await database.select().from(epayOrders).where(eq(epayOrders.tradeNo, tradeNo)).limit(1);
    if (!saved || saved.organizationId !== input.organizationId || saved.userId !== context.userId ||
      saved.paymentMethod !== method || saved.payMoney !== payMoney || saved.amountCredits !== credits) {
      throw new ConsoleRequestError("此充值请求编号已用于其他订单，请刷新后重试。", 409, "topup_identity_conflict");
    }
  } else await insert;

  return { tradeNo, url: purchase.url, params: purchase.params };
}

/** Rebuild the same signed cashier form for an existing unpaid order; never creates an order. */
export async function getConsoleTopupCashier(organizationId: string, tradeNo: string): Promise<CreateTopupResult> {
  const config = getEpayConfig();
  if (!config) throw new ConsoleRequestError("在线充值尚未配置。", 503, "topup_not_configured");
  const order = await getConsolePaymentOrder(organizationId, tradeNo);
  if (!order || order.status !== "pending") throw new ConsoleRequestError("此订单已结束或不属于当前工作区。", 409, "topup_not_pending");
  const base = absoluteBaseUrl();
  const purchase = buildEpayPurchase(config, { type: order.paymentMethod, outTradeNo: order.reference,
    name: `Reizo 充值 ${order.credits * 300} 额度`, money: order.amount.toFixed(2), device: "pc",
    notifyUrl: `${base}/api/pay/epay/notify`, returnUrl: `${base}/account/wallet?order=${encodeURIComponent(order.reference)}` });
  return { tradeNo, url: purchase.url, params: purchase.params };
}

export type EpayNotifyOutcome = "success" | "fail";

/**
 * Settle an async notify from the gateway. Public path — no session. Returns
 * the literal body the gateway expects (`success` / `fail`); anything but
 * `success` makes the gateway retry, which is exactly what we want while a
 * transient credit failure is being retried.
 */
export async function applyEpayNotification(
  params: Record<string, string>,
): Promise<{ body: EpayNotifyOutcome; log: string }> {
  const config = getEpayConfig();
  if (!config) return { body: "fail", log: "topup_not_configured" };

  const notification = verifyEpayNotification(params, config.key);
  if (!notification.verified) {
    return { body: "fail", log: `bad_signature out_trade_no=${notification.outTradeNo}` };
  }
  if (notification.tradeStatus !== EPAY_TRADE_SUCCESS) {
    return { body: "success", log: `ignored_status=${notification.tradeStatus} trade_no=${notification.outTradeNo}` };
  }

  const database = getPlatformDb();
  if (!database) return { body: "fail", log: "platform_db_missing" };

  const [order] = await database
    .select()
    .from(epayOrders)
    .where(eq(epayOrders.tradeNo, notification.outTradeNo))
    .limit(1);

  if (!order) {
    // Verified signature but no local order — likely a callback for a v2api
    // order mis-delivered here. Ack so the gateway stops retrying.
    return { body: "success", log: `unknown_order trade_no=${notification.outTradeNo}` };
  }
  if (order.provider !== "epay") {
    return { body: "success", log: `provider_mismatch trade_no=${order.tradeNo}` };
  }

  const paidMoney = Number(notification.money);
  const owedMoney = Number(order.payMoney);
  if (Number.isFinite(paidMoney) && Number.isFinite(owedMoney) && paidMoney + 0.01 < owedMoney) {
    await database
      .update(epayOrders)
      .set({ status: "failed", notifyPayload: params, updatedAt: new Date() })
      .where(and(eq(epayOrders.id, order.id), eq(epayOrders.status, "pending")));
    return { body: "success", log: `underpaid paid=${notification.money} owed=${order.payMoney} trade_no=${order.tradeNo}` };
  }

  // Atomically claim the pending order so concurrent callbacks can't double-credit.
  const claimed = await database
    .update(epayOrders)
    .set({ status: "crediting", epayTradeNo: notification.epayTradeNo, updatedAt: new Date() })
    .where(and(eq(epayOrders.id, order.id), eq(epayOrders.status, "pending")))
    .returning();

  if (claimed.length === 0) {
    // Already success / crediting / failed — idempotent ack.
    return { body: "success", log: `already_${order.status} trade_no=${order.tradeNo}` };
  }

  const quotaToAdd = order.amountCredits * DEFAULT_QUOTA_PER_UNIT;
  try {
    await addNewApiUserQuota(order.newApiUserId, quotaToAdd);
  } catch (error) {
    // Revert so a gateway retry re-attempts the credit.
    await database
      .update(epayOrders)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(eq(epayOrders.id, order.id), eq(epayOrders.status, "crediting")));
    const reason = error instanceof Error ? error.message : String(error);
    return { body: "fail", log: `credit_failed trade_no=${order.tradeNo} error=${JSON.stringify(reason)}` };
  }

  await database
    .update(epayOrders)
    .set({
      status: "success",
      paidAt: new Date(),
      quotaGranted: quotaToAdd,
      notifyPayload: params,
      updatedAt: new Date(),
    })
    .where(and(eq(epayOrders.id, order.id), eq(epayOrders.status, "crediting")));

  return {
    body: "success",
    log: `credited trade_no=${order.tradeNo} user_id=${order.newApiUserId} quota=${quotaToAdd} money=${order.payMoney}`,
  };
}
