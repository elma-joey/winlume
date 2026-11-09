import { expect, it } from "vitest";
import { accountModelPrices } from "./account-pricing";

it("projects entitled group overrides as credit ranges without pretending a reference USD price is CNY", () => {
  const result = accountModelPrices([{ model_name: "model", model_ratio: 1, completion_ratio: 3, enable_groups: ["a", "b"], group_pricing: { b: { billing_mode: "per_token", model_ratio: 2, completion_ratio: 4 } } }], { a: 1, b: 0.5, forbidden: 0.01 }, 500000);
  expect(result[0]).toEqual({ model: "model", status: "priced", rates: [{ label: "输入", unit: "百万 Token", min: 2, max: 2 }, { label: "输出", unit: "百万 Token", min: 6, max: 8 }] });
  expect(JSON.stringify(result)).not.toMatch(/forbidden|USD/);
});
it("keeps explicit free prices but refuses missing or unsupported prices", () => {
  const models = accountModelPrices([
    { model_name: "free", billing_mode: "per_call", model_price: 0, enable_groups: ["a"] },
    { model_name: "missing", quota_type: 1, enable_groups: ["a"] },
    { model_name: "tiered", billing_mode: "tiered_expr", enable_groups: ["a"] },
    { model_name: "resolution", model_price: 1, resolution_prices: { "1080p": 2 }, enable_groups: ["a"] },
  ], { a: 1 }, 1000000);
  expect(models.find(row => row.model === "free")?.rates[0].min).toBe(0);
  expect(models.find(row => row.model === "missing")?.status).toBe("unavailable");
  expect(models.find(row => row.model === "tiered")?.rates).toEqual([]);
  expect(models.find(row => row.model === "resolution")?.status).toBe("dynamic");
});
it("uses actual quota units for fixed and per-second fees without changing the recharge credit unit", () => {
  const result = accountModelPrices([{ model_name: "video", billing_mode: "per_second", model_price: 0.5, enable_groups: ["a"] }], { a: 2 }, 1000000);
  expect(result[0].rates).toEqual([{ label: "调用", unit: "秒", min: 2, max: 2 }]);
});
