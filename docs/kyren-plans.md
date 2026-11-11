# Kyren monthly allowance plans

Confirmed 2026-11-11: ¥1 list price buys 300 allowance units. Existing gateway quota and database credit fields retain their legacy units (500,000 native quota per former credit); UI conversion is 300 allowance per former credit. Never multiply stored quota or recharge grants by 300.

| Plan | Price CNY | Allowance/month | Extra topup multiplier | Kyren product | Native plan |
| --- | ---: | ---: | ---: | --- | ---: |
| core | 29 | 10,000 | 0.975 | prod_9iIn2Z2RyMTbJ4DM | 6 |
| plus | 69 | 25,000 | 0.95 | prod_hvVVVVnK3kb1yQXC | 7 |
| pro | 129 | 45,000 | 0.925 | prod_FOV1dx3PcMIVXQUW | 8 |
| max | 229 | 80,000 | 0.9 | prod_T4BnkNmgi9vRPjHU | 9 |

Plans are ONE_TIME purchases with manual renewal after expiry. Native gateway subscriptions last one purchase month, do not reset or carry over allowance, consume subscription first and fall back to wallet. No concurrency perks or daily gifts. Discounts reduce topup payment money only; granted quota and model charges remain unchanged. Existing wallet quota is preserved.

## Configuration

Server-only: KYREN_API_KEY, REIZO_PAYHOOK_SECRET, KYREN_NATIVE_PLAN_IDS (JSON mapping), KYREN_PLANS_ENABLED=1. KYREN_WEBHOOK_SECRET is optional only for direct Kyren callbacks. Never put keys in NEXT_PUBLIC variables or desktop code.

Cloudflare Worker payhook-router source is services/payhook-router/worker.js. Preserve D1 DB and DELIVERIES queue and all existing business bindings. Add encrypted REIZO_DELIVERY_SECRET equal to the server's REIZO_PAYHOOK_SECRET. Do not rotate the existing KYREN_WEBHOOK_SECRET, BYYOURSIDE_DELIVERY_SECRET or V2DESIGN_DELIVERY_SECRET for this integration.

Kyren remains configured to https://payhook.v2api.top/kyren. New checkout metadata contains source=reizo, local_order_id=businessOrderId=RZP..., organizationId, userId and nativeReference. Worker persists original payload and retries independently signed delivery to https://reizo-ai.com/api/pay/kyren/notify using x-payhook-signature/timestamp/event-id. Reizo verifies raw HMAC, organization and user mapping, product/amount/currency, then retrieves the saved checkout directly from Kyren and requires COMPLETE plus matching order ID. Browser returns never grant allowance.

## Idempotency and reconciliation

A request UUID deterministically maps to one purchase. A partial unique index permits at most one creating/pending/uncertain order per organization. Kyren checkout creation has no documented idempotency support, so network uncertainty is persisted and never automatically creates another checkout. Investigate an uncertain order through merchant orders and the saved nativeReference before changing its status. Do not clear it merely because a request timed out.

Web and desktop generate different request UUIDs. A second request for the same workspace and exact plan offer resumes its existing pending checkout; it must not create another native or Kyren order. Other plans remain blocked until the current order is handled, and creating/uncertain records never become payable merely through a retry. The web plan card shows **继续付款** for a pending matching plan. Purchase errors persist across background catalog refreshes; fetching the catalog successfully does not mean a failed purchase succeeded.

Paid events lock the purchase row, deduplicate event ID and hash and settle the same native subscription order using the gateway's transactional idempotent completion. If delivery fails, return non-2xx for Worker retry. Refund events enter refund_review; allowance revocation is manual until a refund policy and native subscription linkage are implemented. Do not approve refunds assuming automatic revocation.

## Deployment

Apply migrations 0016/0017 after database backup. Gateway currency support must be deployed first: controller/subscription.go formerly forced USD on create and update; new currency helper preserves CNY and USD. Create separate native plans, preserve existing plan IDs, and verify price, currency, month duration, quota cap, never-reset, wallet overflow and no group upgrade before accepting payment.

Both web and Electron use existing cashier isolation; native Kyren checkouts use GET of a strict hosted checkout URL. No live payment or free entitlement grant is part of automated validation.

Official API: https://docs.kyrenpay.com/dashboard/products and https://docs.kyrenpay.com/webhooks/signatures
