import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { planPurchases, kyrenEvents } from "../platform/db/schema";
import { requirePlatformDb } from "../platform/db/client";
import { REIZO_PLANS } from "../billing/plans";
import { gatewayPlanRequest, organizationPat, verifyNativePlan, currentPlan } from "../billing/gateway-plans";
import { KyrenCheckout, KyrenProduct, KyrenEvent, kyrenRequest, kyrenCashierUrl, moneyMinor, verifyKyrenWebhook } from "../payment/kyren";
import { epaySign } from "../payment/epay";
import { ConsoleRequestError, ensureOrganizationKeyManager, type ConsoleRequestContext } from "./server";
import { requireConsoleOrganization } from "./workspace";
import { getPlatformRepositories } from "../platform/repositories";
import { decryptSecret } from "../newapi/crypto";

const fail = (message: string, status = 409) => new ConsoleRequestError(message, status, "plan_purchase_error");
const orderView = (row: typeof planPurchases.$inferSelect) => ({ id: row.id, reference: row.id,
  status: row.status === "success" ? "success" as const : ["failed","expired","refund_review"].includes(row.status) ? "failed" as const : row.status === "pending" ? "pending" as const : "crediting" as const,
  amount: Number(row.amount), currency: "CNY", credits: 0, provider: "kyren", paymentMethod: "hosted", planName: REIZO_PLANS.find(p => p.id===row.planId)?.name,
  allowance: row.allowance, createdAt: row.createdAt.toISOString(), paidAt: row.paidAt?.toISOString() ?? null });
let catalogCache:{expires:number;value:Array<typeof REIZO_PLANS[number] & {period:'month'}>}|undefined;
let catalogPending:Promise<Array<typeof REIZO_PLANS[number] & {period:'month'}>>|undefined;
export async function planCatalog() {
  if (process.env.KYREN_PLANS_ENABLED !== "1") return [];
  if(catalogCache && catalogCache.expires>Date.now())return catalogCache.value;
  if(catalogPending)return catalogPending;
  catalogPending=Promise.all(REIZO_PLANS.map(async plan => {
    const product = KyrenProduct.parse(await kyrenRequest(`/products/${plan.productId}`));
    if (product.id !== plan.productId || product.status !== "ACTIVE" || moneyMinor(product.price) !== plan.price*100) throw fail("商品价格已变化，请稍后重试。");
    return { ...plan, period: "month" as const };
  }));
  try {const value=await catalogPending;catalogCache={expires:Date.now()+30000,value};return value;} finally {catalogPending=undefined;}
}
export async function membership(context: ConsoleRequestContext, organizationId: string) {
  if (process.env.KYREN_PLANS_ENABLED !== "1") return null;
  const plan = await currentPlan(await organizationPat(context, organizationId));
  return plan ? { id: plan.id, name: plan.name, discount: plan.discount, allowance: plan.allowance,
    remainingAllowance: Math.min(plan.allowance,Math.max(0,plan.native.amount_total-plan.native.amount_used)*300/500000), startsAt:new Date(plan.native.start_time*1000).toISOString(), expiresAt: new Date(plan.native.end_time*1000).toISOString() } : null;
}
export async function listPlanOrders(organizationId: string) {
  if (process.env.KYREN_PLANS_ENABLED !== "1") return [];
  const db=requirePlatformDb();
  const rows=await db.select().from(planPurchases).where(eq(planPurchases.organizationId, organizationId)).orderBy(desc(planPurchases.createdAt)).limit(20);
  for(const row of rows){
    if(row.status==='pending' && row.checkoutId && row.checkoutExpiresAt && row.checkoutExpiresAt.getTime()<=Date.now()){
      const checkout=KyrenCheckout.parse(await kyrenRequest(`/checkouts/${row.checkoutId}`));
      if(checkout.status==='EXPIRED'){
        const [saved]=await db.update(planPurchases).set({status:'expired',updatedAt:new Date()}).where(and(eq(planPurchases.id,row.id),eq(planPurchases.status,'pending'))).returning();
        if(saved)row.status=saved.status;
      }
    }
  }
  return rows.map(orderView);
}
export async function getPlanOrder(organizationId: string, id: string) {
  if (!id.startsWith("RZP")) return null;
  const [row] = await requirePlatformDb().select().from(planPurchases).where(and(eq(planPurchases.id,id),eq(planPurchases.organizationId,organizationId))).limit(1);
  return row ? orderView(row) : null;
}
export async function planCashier(organizationId: string, id: string) {
  const [row] = await requirePlatformDb().select().from(planPurchases).where(and(eq(planPurchases.id,id),eq(planPurchases.organizationId,organizationId))).limit(1);
  if (!row || row.status !== "pending" || !row.checkoutUrl || !row.checkoutId || !row.checkoutExpiresAt || row.checkoutExpiresAt.getTime() <= Date.now()) throw fail("套餐订单已结束或正在核对，请刷新。");
  return { mode: "hosted" as const, url: kyrenCashierUrl(row.checkoutUrl,row.checkoutId), checkoutId: row.checkoutId, reference: row.id, amount: row.amount, currency: "CNY" };
}
async function resumePlanPurchase(db: ReturnType<typeof requirePlatformDb>, organizationId: string, plan: typeof REIZO_PLANS[number]) {
  const [existing] = await db.select().from(planPurchases).where(and(
    eq(planPurchases.organizationId, organizationId),
    inArray(planPurchases.status, ["creating", "pending", "uncertain"]),
  )).limit(1);
  if (!existing) return null;
  if (existing.status !== "pending") throw fail("套餐订单正在创建或核对，请稍后刷新，请勿重复购买。");
  if (existing.planId !== plan.id || existing.productId !== plan.productId ||
      moneyMinor(existing.amount) !== plan.price * 100 || existing.allowance !== plan.allowance) {
    throw fail("已有未完成的套餐订单，请先在订单记录中继续付款。");
  }
  if (!existing.nativeReference || !existing.checkoutId || !existing.checkoutUrl ||
      !existing.checkoutExpiresAt || existing.checkoutExpiresAt.getTime() <= Date.now()) {
    throw fail("套餐订单状态待核对，请刷新或联系支持，请勿重复购买。");
  }
  kyrenCashierUrl(existing.checkoutUrl, existing.checkoutId);
  return orderView(existing);
}
export async function createPlanPurchase(context: ConsoleRequestContext, input: unknown) {
  const parsed = z.object({ organizationId:z.string().uuid(), planId:z.enum(["core","plus","pro","max"]), requestId:z.string().uuid() }).strict().safeParse(input);
  if (!parsed.success) throw fail("套餐购买参数无效。",400);
  if (process.env.KYREN_PLANS_ENABLED !== "1" || !(process.env.REIZO_PAYHOOK_SECRET || process.env.KYREN_WEBHOOK_SECRET)) throw fail("套餐购买暂未开放。");
  const { organizationId,planId,requestId } = parsed.data;
  const selected = await requireConsoleOrganization(context,organizationId); ensureOrganizationKeyManager(selected.membership.role);
  const plan = REIZO_PLANS.find(p=>p.id===planId)!;
  const id = "RZP"+createHash("sha256").update(JSON.stringify([organizationId,context.userId,requestId])).digest("hex").slice(0,28);
  const db = requirePlatformDb();
  const [old] = await db.select().from(planPurchases).where(eq(planPurchases.id,id)).limit(1);
  if (old) { if (old.planId!==plan.id || old.organizationId!==organizationId || old.userId!==context.userId) throw fail("请求编号已用于其他套餐。"); return orderView(old); }
  const pat = await organizationPat(context,organizationId);
  await listPlanOrders(organizationId);
  if (await currentPlan(pat)) throw fail("当前套餐尚未到期，请到期后续购。");
  const pending = await resumePlanPurchase(db, organizationId, plan);
  if (pending) return pending;
  const nativePlanId = await verifyNativePlan(plan,pat);
  await planCatalog();
  const [claimed] = await db.insert(planPurchases).values({ id,organizationId,userId:context.userId,planId,productId:plan.productId,nativePlanId,amount:plan.price.toFixed(2),allowance:plan.allowance,status:"creating" }).onConflictDoNothing().returning();
  if (!claimed) {
    const concurrent = await resumePlanPurchase(db, organizationId, plan);
    if (concurrent) return concurrent;
    throw fail("订单状态已变化，请刷新后重试。");
  }
  try {
    const native = await gatewayPlanRequest("/api/subscription/epay/pay",pat,{plan_id:nativePlanId,payment_method:"alipay"});
    const params = z.record(z.string(),z.string()).parse(native.data);
    const key=process.env.EPAY_KEY?.trim(), pid=process.env.EPAY_PID?.trim();
    if (!key || params.pid!==pid || !/^SUBUSR\d+NO[A-Za-z0-9]+$/.test(params.out_trade_no) || moneyMinor(params.money)!==plan.price*100 || params.sign!==epaySign(params,key)) throw fail("套餐网关订单校验失败。");
    await db.update(planPurchases).set({nativeReference:params.out_trade_no,updatedAt:new Date()}).where(eq(planPurchases.id,id));
    const origin=new URL(process.env.NEXTAUTH_URL!).origin;
    const checkout=KyrenCheckout.parse(await kyrenRequest("/checkouts",{productId:plan.productId,successUrl:`${origin}/account/pricing?order=${id}`,cancelUrl:`${origin}/account/pricing?order=${id}`,
      metadata:{source:"reizo",local_order_id:id,businessOrderId:id,organizationId,userId:context.userId,nativeReference:params.out_trade_no}}));
    if (checkout.productId!==plan.productId || moneyMinor(checkout.amount)!==plan.price*100 || checkout.status!=="OPEN") throw fail("套餐收银台订单不匹配。");
    const [saved] = await db.update(planPurchases).set({checkoutId:checkout.id,checkoutUrl:kyrenCashierUrl(checkout.url,checkout.id),checkoutExpiresAt:new Date(checkout.expiresAt),status:"pending",updatedAt:new Date()}).where(eq(planPurchases.id,id)).returning();
    return orderView(saved);
  } catch {
    // Neither native order creation nor Kyren checkout has an idempotency key.
    // Persist uncertainty; the same request must never trigger another creation.
    await db.update(planPurchases).set({status:"uncertain",updatedAt:new Date()}).where(eq(planPurchases.id,id));
    throw fail("订单创建状态待核对，请勿重复购买，请刷新或联系支持。",503);
  }
}

export async function handleKyrenWebhook(request: Request) {
  const length=Number(request.headers.get("content-length"));
  if (length>65536) return new Response("Too large",{status:413});
  const reader=request.body?.getReader(); if(!reader)return new Response("Missing body",{status:400});
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return new Response("Too large",{status:413});}chunks.push(value);}
  const raw=Buffer.concat(chunks);
  const relayed=request.headers.has("x-payhook-signature");
  const signature=request.headers.get(relayed?"x-payhook-signature":"x-kyren-signature");
  const timestamp=request.headers.get(relayed?"x-payhook-timestamp":"x-kyren-timestamp");
  const secret=relayed?process.env.REIZO_PAYHOOK_SECRET:process.env.KYREN_WEBHOOK_SECRET;
  if (raw.byteLength>65536 || !verifyKyrenWebhook(raw,signature,timestamp,secret||"")) return new Response("Invalid signature",{status:400});
  let decoded:unknown;try{decoded=JSON.parse(new TextDecoder().decode(raw));}catch{return new Response("Invalid JSON",{status:400});}
  const parsed=KyrenEvent.safeParse(decoded);
  if (!parsed.success) return new Response("Invalid event",{status:400});
  const event=parsed.data;
  if(relayed && (event.data.metadata?.source!=="reizo" || event.data.metadata?.local_order_id!==event.data.metadata?.businessOrderId))return new Response("Invalid route",{status:400});
  if (!["order.paid","order.refunded"].includes(event.type)) return new Response("Ignored");
  const id=event.data.metadata?.businessOrderId;
  if (!id || !/^RZP[a-f0-9]{28}$/.test(id)) return new Response("Not a Reizo order");
  const db=requirePlatformDb(), hash=createHash("sha256").update(raw).digest("hex");
  await db.transaction(async tx=>{
    const [row]=await tx.select().from(planPurchases).where(eq(planPurchases.id,id)).for("update");
    if (!row) throw fail("未知套餐订单。",503);
    if (event.data.metadata?.organizationId!==row.organizationId || event.data.metadata?.userId!==row.userId || event.data.metadata?.nativeReference!==row.nativeReference || event.data.currency!=="CNY") throw fail("套餐回调身份不匹配。");
    const [seen]=await tx.select().from(kyrenEvents).where(eq(kyrenEvents.id,event.id)).limit(1);
    if (seen) { if (seen.payloadHash!==hash) throw fail("回调事件内容冲突。"); return; }
    if (row.providerOrderId && row.providerOrderId!==event.data.order_id) throw fail("支付订单不匹配。");
    if (event.type==="order.refunded") {
      await tx.update(planPurchases).set({status:"refund_review",updatedAt:new Date()}).where(eq(planPurchases.id,id));
    } else if (row.status!=="success" && row.status!=="refund_review") {
      if (event.data.product_id!==row.productId || moneyMinor(event.data.amount)!==moneyMinor(row.amount) || !row.checkoutId || !row.nativeReference) throw fail("套餐回调金额或商品不匹配。");
      const checkout=KyrenCheckout.parse(await kyrenRequest(`/checkouts/${row.checkoutId}`));
      if (checkout.status!=="COMPLETE" || checkout.orderId!==event.data.order_id || checkout.productId!==row.productId || moneyMinor(checkout.amount)!==moneyMinor(row.amount)) throw fail("支付完成状态待核对。",503);
      const repositories=getPlatformRepositories();
      const mapping=await repositories?.teamNewApiMapping.findByOrganizationId(row.organizationId);
      if(!mapping)throw fail("套餐账户映射暂不可用。",503);
      const pat=decryptSecret(mapping.newApiPatCiphertext);
      const plan=REIZO_PLANS.find(p=>p.id===row.planId)!;
      await verifyNativePlan(plan,pat);
      await gatewayPlanRequest("/api/subscription/self/preference",pat,{billing_preference:"subscription_first"},"PUT");
      const params:Record<string,string>={pid:process.env.EPAY_PID||"",type:"alipay",out_trade_no:row.nativeReference,trade_no:event.data.order_id,money:row.amount,trade_status:"TRADE_SUCCESS",sign_type:"MD5"};
      if (!process.env.EPAY_KEY) throw fail("套餐结算适配尚未配置。",503);
      params.sign=epaySign(params,process.env.EPAY_KEY);
      const base=process.env.NEW_API_URL?.replace(/\/+$/,"");
      const response=await fetch(`${base}/api/subscription/epay/notify`,{method:"POST",redirect:"error",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params),signal:AbortSignal.timeout(15000)});
      if (!response.ok || (await response.text()).trim()!=="success") throw fail("套餐发放待重试。",503);
      await tx.update(planPurchases).set({status:"success",providerOrderId:event.data.order_id,paidAt:new Date(event.data.paid_at||Date.now()),updatedAt:new Date()}).where(eq(planPurchases.id,id));
    }
    await tx.insert(kyrenEvents).values({id:event.id,payloadHash:hash,type:event.type,purchaseId:id,status:event.type==="order.refunded"?"review":"done"});
  });
  return new Response("OK",{headers:{"Cache-Control":"no-store"}});
}
