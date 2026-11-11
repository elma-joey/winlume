import { z } from "zod";
import { decryptSecret } from "../newapi/crypto";
import { REIZO_PLANS, quotaForAllowance } from "./plans";
import type { ConsoleRequestContext } from "../console/server";

export const NativeSubscription = z.object({ subscription: z.object({ id: z.number().int(), plan_id: z.number().int(), status: z.string(), start_time: z.number().int(), end_time: z.number().int(), amount_total: z.number().int().nonnegative(), amount_used: z.number().int().nonnegative() }) });
export function nativePlanIds(): Record<string, number> {
  const config = JSON.parse(process.env.KYREN_NATIVE_PLAN_IDS || "{}");
  return Object.fromEntries(REIZO_PLANS.map(p => [p.id, z.number().int().positive().parse(config[p.id])]));
}
export async function gatewayPlanRequest(path: string, pat: string, body?: unknown, method = "POST") {
  const base = process.env.NEW_API_URL?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("套餐网关尚未配置。");
  const response = await fetch(base + path, { method: body ? method : "GET", headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`套餐网关暂不可用（${response.status}）。`);
  const result = await response.json();
  if (result.success === false || !result.data) throw new Error("套餐网关返回无效数据。");
  return result;
}
export async function organizationPat(context: ConsoleRequestContext, organizationId: string) {
  const mapping = await context.repositories.teamNewApiMapping.findByOrganizationId(organizationId);
  if (!mapping) throw new Error("工作区尚未连接模型网关。");
  return decryptSecret(mapping.newApiPatCiphertext);
}
export async function currentPlan(pat: string) {
  if (process.env.KYREN_PLANS_ENABLED !== "1") return null;
  const ids = nativePlanIds(), result = await gatewayPlanRequest("/api/subscription/self", pat);
  const subscriptions = z.array(NativeSubscription).parse(result.data.subscriptions);
  const active = subscriptions.filter(s => s.subscription.status === "active" && s.subscription.end_time > Date.now()/1000)
    .flatMap(s => { const plan = REIZO_PLANS.find(p => ids[p.id] === s.subscription.plan_id); return plan ? [{ ...plan, native: s.subscription }] : []; })
    .sort((a,b) => a.discount-b.discount || b.native.end_time-a.native.end_time);
  return active[0] ?? null;
}
export async function verifyNativePlan(plan: typeof REIZO_PLANS[number], pat: string) {
  const planId = nativePlanIds()[plan.id], result = await gatewayPlanRequest("/api/subscription/plans", pat);
  const entry = result.data.find((p: { plan: { id: number } }) => p.plan?.id === planId)?.plan;
  if (!entry || !entry.enabled || entry.price_amount !== plan.price || entry.currency !== "CNY" || entry.duration_unit !== "month" || entry.duration_value !== 1 || entry.total_amount !== quotaForAllowance(plan.allowance) || entry.quota_reset_period !== "never" || entry.quota_cap_amount !== quotaForAllowance(plan.allowance) || !entry.allow_wallet_overflow || entry.upgrade_group) throw new Error("套餐权益配置不匹配，暂不能购买。");
  return planId;
}
