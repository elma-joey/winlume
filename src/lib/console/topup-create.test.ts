import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), inserts: 0, membership:vi.fn() }));
vi.mock("./plan-purchases",()=>({membership:mocks.membership}));
vi.mock("@/lib/platform", () => ({ getPlatformDb: () => ({
  insert: () => ({ values: (values: Record<string, unknown>) => ({ onConflictDoNothing: async () => {
    const key = values.tradeNo as string;
    if (!mocks.rows.has(key)) { mocks.inserts++; mocks.rows.set(key, { ...values, id: key, createdAt: new Date(), paidAt: null }); }
  } }) }),
  select: () => ({ from: () => ({ where: (condition: SQL) => ({ limit: async () => {
    const params = new PgDialect().sqlToQuery(condition).params;
    return [...mocks.rows.values()].filter(row => params.includes(row.tradeNo));
  } }) }) }),
}) }));
vi.mock("@/lib/newapi/admin-client", () => ({ addNewApiUserQuota: vi.fn() }));
vi.mock("./server", () => ({ ConsoleRequestError: class extends Error {}, ensureOrganizationKeyManager: () => undefined }));
vi.mock("./workspace", () => ({ requireConsoleOrganization: async () => ({ membership: { role: "owner" } }) }));
import { createConsoleTopupOrder, getConsoleTopupCashier } from "./topup";

beforeEach(() => {
  mocks.rows.clear(); mocks.inserts = 0;
  mocks.membership.mockResolvedValue(null);
  vi.stubEnv("EPAY_BASE_URL", "https://cashier.example/epay"); vi.stubEnv("EPAY_PID", "test-merchant");
  vi.stubEnv("EPAY_KEY", "test-secret"); vi.stubEnv("EPAY_NOTIFY_BASE_URL", "https://reizo.example");
});
afterEach(() => vi.unstubAllEnvs());
const context = { userId: "user-1", repositories: { teamNewApiMapping: { findByOrganizationId: async () => ({ newApiUserId: 123 }) } } };
const input = { organizationId: "org-1", amount: 20, paymentMethod: "alipay", idempotencyKey: "desktop:request-one" };

it("reuses one saved order for concurrent and sequential retries with the same request identity", async () => {
  const results = await Promise.all([createConsoleTopupOrder(context as never, input), createConsoleTopupOrder(context as never, input)]);
  const replay = await createConsoleTopupOrder(context as never, input);
  expect(results[0].tradeNo).toBe(results[1].tradeNo); expect(replay.tradeNo).toBe(results[0].tradeNo);
  expect(mocks.inserts).toBe(1); expect(mocks.rows.size).toBe(1);
  expect(replay.params.out_trade_no).toBe(replay.tradeNo); expect(replay.params.money).toBe("20.00");
  await expect(createConsoleTopupOrder(context as never, { ...input, amount: 50 })).rejects.toThrow("请求编号");
});

it("reopens only the original pending order and never creates or charges another one", async () => {
  const created = await createConsoleTopupOrder(context as never, input);
  expect((await getConsoleTopupCashier("org-1", created.tradeNo)).params.out_trade_no).toBe(created.tradeNo);
  expect(mocks.inserts).toBe(1);
  const saved = mocks.rows.get(created.tradeNo);
  if (!saved) throw new Error("Missing saved order");
  saved.status = "success";
  await expect(getConsoleTopupCashier("org-1", created.tradeNo)).rejects.toThrow("已结束");
  expect(mocks.inserts).toBe(1);
});

it("discounts only the purchase money, preserving the purchased quota and rejecting stale quotes",async()=>{
  mocks.membership.mockResolvedValue({discount:0.975});
  const result=await createConsoleTopupOrder(context as never,{...input,expectedPayMoney:"19.50"});
  expect(result.params.money).toBe("19.50");
  expect(mocks.rows.get(result.tradeNo)?.amountCredits).toBe(20);
  mocks.membership.mockResolvedValue(null);
  await expect(createConsoleTopupOrder(context as never,{...input,idempotencyKey:"other",expectedPayMoney:"19.50"})).rejects.toThrow("折扣已变化");
  expect(mocks.inserts).toBe(1);
});
