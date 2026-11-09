import { createHash } from "node:crypto";
import { desktopWalletContext } from "./desktop-wallet";
import { ConsoleRequestError, getConsoleWalletDetails } from "../console/server";
import { decryptSecret } from "../newapi/crypto";
import { getUserLogs, type NewApiUserLog } from "../newapi/team-client";
import { DEFAULT_QUOTA_PER_UNIT } from "../catalog/plaza-display";
import { accountModelPrices, type AccountPriceModel } from "../billing/account-pricing";
import { INITIAL_BILLING_CONFIGURATION } from "../billing/model";

/** Missing settlement evidence stays unknown, including failed requests. Explicit zero is retained. */
export function desktopCharge(row: NewApiUserLog) {
  const credits = typeof row.quota === "number" && Number.isSafeInteger(row.quota) && row.quota >= 0 ? row.quota / DEFAULT_QUOTA_PER_UNIT : null;
  const counter = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
  return { id: createHash("sha256").update(JSON.stringify(row)).digest("hex"), model: row.model_name || "未知模型",
    createdAt: typeof row.created_at === "number" && row.created_at > 0 && row.created_at < 8.64e12 ? new Date(row.created_at * 1000).toISOString() : null,
    type: row.type === 2 ? "consume" as const : "error" as const, credits,
    promptTokens: counter(row.prompt_tokens), completionTokens: counter(row.completion_tokens),
    requestId: row.request_id?.slice(0, 512) || null, tokenName: row.token_name?.slice(0, 512) || "", funding: "unreported" as const };
}

async function accountPricing(pat: string) {
  const base = process.env.NEW_API_URL?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("Pricing unavailable");
  const [pricing, status] = await Promise.all(["pricing", "status"].map(async name => {
    const response = await fetch(`${base}/api/${name}`, { headers: name === "pricing" ? { Authorization: `Bearer ${pat}` } : {}, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("Pricing unavailable");
    return response.json();
  }));
  if (!pricing?.success || !Array.isArray(pricing.data) || !pricing.group_ratio || typeof pricing.group_ratio !== "object" || Array.isArray(pricing.group_ratio) || !status?.success) throw new Error("Pricing unavailable");
  const models = pricing.data.filter((model: AccountPriceModel) => model && typeof model.model_name === "string" && model.model_name.length <= 512).slice(0, 3000);
  return { status: "ready" as const, updatedAt: new Date().toISOString(), items: accountModelPrices(models, pricing.group_ratio, Number(status.data?.quota_per_unit)) };
}

export async function readDesktopBilling(request: Request) {
  const url = new URL(request.url), expectedOrg = url.searchParams.get("organizationId") || undefined;
  const ctx = await desktopWalletContext(request, expectedOrg);
  const page = Number(url.searchParams.get("page") || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new ConsoleRequestError("页码无效。", 400, "desktop_billing_error");
  const kind = url.searchParams.get("type") || "consume";
  if (!["consume", "error"].includes(kind)) throw new ConsoleRequestError("消费类型无效。", 400, "desktop_billing_error");
  const model = url.searchParams.get("model")?.trim();
  if (model && model.length > 512) throw new ConsoleRequestError("模型名称无效。", 400, "desktop_billing_error");
  const mapping = await ctx.context.repositories.teamNewApiMapping.findByOrganizationId(ctx.organization.id);
  const pat = mapping ? decryptSecret(mapping.newApiPatCiphertext) : null;
  const [walletResult, usageResult, pricingResult] = await Promise.allSettled([
    getConsoleWalletDetails(ctx.context, ctx.organization.id),
    pat ? getUserLogs(pat, { page, pageSize: 20, type: kind === "consume" ? 2 : 5, modelName: model || undefined }) : Promise.reject(new Error("No account")),
    pat ? accountPricing(pat) : Promise.reject(new Error("No account")),
  ]);
  const wallet = walletResult.status === "fulfilled" ? walletResult.value.wallet : null;
  const logs = usageResult.status === "fulfilled" ? usageResult.value : null;
  return {
    organization: { id: ctx.organization.id, name: ctx.organization.name },
    balance: { availableCredits: wallet?.syncStatus === "ready" ? wallet.availableCredits : null, usedCredits: wallet?.syncStatus === "ready" ? wallet.usedCredits : null },
    billing: { creditsPerCny: 1, plan: { status: "not_configured" as const }, allowBalanceFallback: INITIAL_BILLING_CONFIGURATION.allowBalanceFallback, settlementMode: INITIAL_BILLING_CONFIGURATION.settlementMode },
    usage: { status: logs ? "ready" as const : "unavailable" as const, page, pageSize: 20, total: logs?.total ?? null, items: (logs?.items ?? []).filter(row => row.type === (kind === "consume" ? 2 : 5)).map(desktopCharge) },
    pricing: pricingResult.status === "fulfilled" ? pricingResult.value : { status: "unavailable" as const, updatedAt: null, items: [] },
  };
}
