import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { kyrenCashierUrl, moneyMinor, verifyKyrenWebhook } from "./kyren";
import { REIZO_PLANS, quotaForAllowance, displayAllowance } from "../billing/plans";
it("verifies the original bytes and fresh millisecond header; rejects mutation, stale, future and malformed signatures", () => {
  const raw = Buffer.from('{"n":"中文"}'), now = 1800000000000, t = String(now), secret = "fixture-webhook-secret";
  const sign = "sha256=" + createHmac("sha256", secret).update(t + ".").update(raw).digest("hex");
  expect(verifyKyrenWebhook(raw, sign, t, secret, now)).toBe(true);
  expect(verifyKyrenWebhook(Buffer.from('{}'), sign, t, secret, now)).toBe(false);
  expect(verifyKyrenWebhook(raw, sign, t, secret, now + 300001)).toBe(false);
  expect(verifyKyrenWebhook(raw, sign, t, secret, now - 300001)).toBe(false);
  expect(verifyKyrenWebhook(raw, "sha256=wrong", t, secret, now)).toBe(false);
});
it("checks exact minor amounts and hosted checkout identity", () => {
  expect(moneyMinor("29")).toBe(moneyMinor("29.00"));
  expect(() => moneyMinor("29.001")).toThrow();
  expect(kyrenCashierUrl("https://payment.kyren.io/checkout/one-time/cs_test", "cs_test")).toContain("cs_test");
  for (const value of ["https://evil.example/checkout/one-time/cs_test", "https://payment.kyren.io/checkout/one-time/cs_other", "http://payment.kyren.io/checkout/one-time/cs_test"]) expect(() => kyrenCashierUrl(value, "cs_test")).toThrow();
});
it("uses confirmed quantities without changing gateway balance value or rounding away purchased allowance", () => {
  expect(REIZO_PLANS.map(p => p.allowance)).toEqual([10000,25000,45000,80000]);
  expect(displayAllowance(1)).toBe(300);
  for (const p of REIZO_PLANS) { expect(quotaForAllowance(p.allowance) * 300 / 500000).toBeGreaterThanOrEqual(p.allowance); expect(quotaForAllowance(p.allowance) * 300 / 500000 - p.allowance).toBeLessThan(0.001); }
});
