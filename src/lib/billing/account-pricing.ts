import { DEFAULT_QUOTA_PER_UNIT } from "../catalog/plaza-display";

type Rule = { billing_mode?: string; pricing_mode?: string; quota_type?: number; model_ratio?: number; completion_ratio?: number; model_price?: number; cache_ratio?: number; create_cache_ratio?: number; image_ratio?: number; audio_ratio?: number; audio_completion_ratio?: number; resolution_prices?: unknown; video_price?: unknown };
export type AccountPriceModel = Rule & { model_name: string; enable_groups?: string[]; group_pricing?: Record<string, Rule> };
export type AccountPrice = { model: string; status: "priced" | "dynamic" | "unavailable"; rates: Array<{ label: string; unit: string; min: number; max: number }> };
const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e12;

/** Units are workspace credits, not USD, FX conversions or a historical price reconstruction. */
export function accountModelPrices(models: AccountPriceModel[], groups: Record<string, number>, quotaPerUnit: number): AccountPrice[] {
  if (!valid(quotaPerUnit) || quotaPerUnit <= 0) throw new Error("Invalid quota unit");
  return models.map(model => {
    const grouped: Array<Array<{ label: string; unit: string; amount: number }>> = [];
    let dynamic = false, incomplete = false;
    const permitted = Object.entries(groups).filter(([group, ratio]) => valid(ratio) && (model.enable_groups?.includes("all") || model.enable_groups?.includes(group)));
    for (const [group, multiplier] of permitted) {
      const rule = { ...model, ...model.group_pricing?.[group] };
      const mode = rule.billing_mode || rule.pricing_mode || (rule.quota_type === 1 ? "per_call" : "ratio");
      if (mode === "tiered_expr" || rule.resolution_prices && Object.keys(rule.resolution_prices).length || rule.video_price && Object.keys(rule.video_price).length) { dynamic = true; continue; }
      const rates: Array<{ label: string; unit: string; amount: number }> = [];
      if (mode === "per_call" || mode === "fixed" || mode === "per_second") {
        if (valid(rule.model_price)) rates.push({ label: "调用", unit: mode === "per_second" ? "秒" : "次", amount: rule.model_price * quotaPerUnit / DEFAULT_QUOTA_PER_UNIT * multiplier });
      } else if (mode === "ratio" || mode === "per_token") {
        if (valid(rule.model_ratio) && valid(rule.completion_ratio)) {
          const base = rule.model_ratio * 1_000_000 / DEFAULT_QUOTA_PER_UNIT * multiplier;
          rates.push({ label: "输入", unit: "百万 Token", amount: base }, { label: "输出", unit: "百万 Token", amount: base * rule.completion_ratio });
          for (const [key, label] of [["cache_ratio", "缓存命中"], ["create_cache_ratio", "缓存写入"], ["image_ratio", "图片输入"], ["audio_ratio", "音频输入"], ["audio_completion_ratio", "音频输出"]] as const) {
            if (valid(rule[key])) rates.push({ label, unit: "百万 Token", amount: base * rule[key] });
          }
        }
      } else dynamic = true;
      if (rates.some(rate => !valid(rate.amount)) || !rates.length && ["ratio", "per_token", "per_call", "fixed", "per_second"].includes(mode)) incomplete = true;
      else grouped.push(rates);
    }
    if (incomplete) return { model: model.model_name, status: "unavailable" as const, rates: [] };
    if (dynamic) return { model: model.model_name, status: "dynamic" as const, rates: [] };
    if (!grouped.length) return { model: model.model_name, status: "unavailable" as const, rates: [] };
    const keys = grouped[0].map(rate => `${rate.label}/${rate.unit}`);
    if (grouped.some(rates => rates.length !== keys.length || rates.some((rate, index) => `${rate.label}/${rate.unit}` !== keys[index]))) return { model: model.model_name, status: "dynamic" as const, rates: [] };
    return { model: model.model_name, status: "priced" as const, rates: grouped[0].map((rate, index) => ({ label: rate.label, unit: rate.unit,
      min: Math.min(...grouped.map(rates => rates[index].amount)), max: Math.max(...grouped.map(rates => rates[index].amount)) })) };
  }).sort((a, b) => a.model.localeCompare(b.model));
}
