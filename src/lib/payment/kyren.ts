import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const money = z.string().regex(/^\d{1,9}(?:\.\d{1,2})?$/);
export const KyrenProduct = z.object({ id, name: z.string().max(160), price: money, currency: z.literal("CNY"), status: z.enum(["ACTIVE", "ARCHIVED"]), productType: z.literal("ONE_TIME") });
export const KyrenCheckout = z.object({ id, productId: id, amount: money, currency: z.literal("CNY"), status: z.enum(["OPEN", "COMPLETE", "EXPIRED"]), url: z.string().url(), expiresAt: z.number().int().positive(), orderId: id.optional() });
export const KyrenEvent = z.object({ id, type: z.string().max(80), created_at: z.number().int(), data: z.object({
  order_id: id, product_id: id.optional(), amount: money, currency: z.string().length(3), paid_at: z.number().int().nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
}) });
export function verifyKyrenWebhook(raw: Uint8Array, signature: string | null, timestamp: string | null, secret: string, now = Date.now()) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature) || !timestamp || !/^\d{1,16}$/.test(timestamp)) return false;
  if (!Number.isSafeInteger(Number(timestamp)) || Math.abs(now - Number(timestamp)) > 300_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
export function kyrenCashierUrl(value: string, checkoutId: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
    !["payment.kyren.io", "payment.kyrenpay.com"].includes(url.hostname) || url.pathname !== `/checkout/one-time/${checkoutId}` || url.search) throw new Error("启润收银台地址无效。");
  return url.href;
}
export async function kyrenRequest(path: string, body?: unknown) {
  const key = process.env.KYREN_API_KEY?.trim();
  if (!key) throw new Error("启润套餐支付尚未配置。");
  const response = await fetch(`https://api.kyrenpay.com/v1${path}`, { method: body ? "POST" : "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
    headers: { "x-api-key": key, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`启润服务暂不可用（${response.status}）。`);
  const result = await response.json();
  if (result?.code !== 0 || !result.data) throw new Error("启润返回的数据无效。");
  return result.data as unknown;
}
export const moneyMinor = (value: string) => { if (!money.safeParse(value).success) throw new Error("Invalid money"); const [whole, fraction = ""] = value.split("."); return Number(whole) * 100 + Number(fraction.padEnd(2, "0")); };
