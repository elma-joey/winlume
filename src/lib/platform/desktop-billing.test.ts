import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), mapping: vi.fn(), wallet: vi.fn(), logs: vi.fn() }));
vi.mock("./desktop-wallet", () => ({ desktopWalletContext: mocks.context }));
vi.mock("../console/server", () => ({ getConsoleWalletDetails: mocks.wallet, ConsoleRequestError: class extends Error { constructor(message: string, public status: number, public code: string) { super(message); } } }));
vi.mock("../newapi/crypto", () => ({ decryptSecret: () => "private-pat" }));
vi.mock("../newapi/team-client", () => ({ getUserLogs: mocks.logs }));
import { desktopCharge, readDesktopBilling } from "./desktop-billing";
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("NEW_API_URL", "https://gateway.example");
  mocks.context.mockResolvedValue({ organization: { id: "org", name: "Workspace" }, context: { userId: "user", repositories: { teamNewApiMapping: { findByOrganizationId: mocks.mapping } } } });
  mocks.mapping.mockResolvedValue({ newApiPatCiphertext: "encrypted" });
  mocks.wallet.mockResolvedValue({ wallet: { syncStatus: "ready", availableCredits: 9, usedCredits: 1 } });
  mocks.logs.mockResolvedValue({ total: 1, page: 1, pageSize: 20, items: [{ type: 2, quota: 500000, created_at: 1800000000, model_name: "model", request_id: "request" }] });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("/pricing") ? { success: true, group_ratio: { a: 1 }, data: [{ model_name: "model", model_ratio: 1, completion_ratio: 3, enable_groups: ["a"] }] } : { success: true, data: { quota_per_unit: 500000 } })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("requires the same authorized workspace and never returns PAT, raw log content or invented funding splits", async () => {
  const request = new Request("https://reizo.example/api/desktop-auth/billing?organizationId=org&page=2");
  const result = await readDesktopBilling(request);
  expect(mocks.context).toHaveBeenCalledWith(request, "org"); expect(mocks.mapping).toHaveBeenCalledWith("org");
  expect(mocks.logs).toHaveBeenCalledWith("private-pat", { page: 2, pageSize: 20, type: 2, modelName: undefined });
  expect(result.usage.items[0]).toMatchObject({ credits: 1, funding: "unreported" });
  expect(result.billing).toMatchObject({ creditsPerCny: 1, plan: { status: "not_configured" }, allowBalanceFallback: true, settlementMode: "legacy_balance" });
  expect(JSON.stringify(result)).not.toMatch(/private-pat|encrypted/);
  mocks.context.mockRejectedValue(new Error("not authorized"));
  await expect(readDesktopBilling(request)).rejects.toThrow("not authorized");
});
it("preserves missing settlement as null and explicit zero, including a charged failed request", () => {
  expect(desktopCharge({ type: 2 }).credits).toBeNull();
  expect(desktopCharge({ type: 2, quota: 0 }).credits).toBe(0);
  expect(desktopCharge({ type: 5, quota: 25 })).toMatchObject({ credits: 0.00005, type: "error" });
});
it("allows partial results while refusing cross-workspace reads, invalid pages and unbounded filters", async () => {
  mocks.logs.mockRejectedValue(new Error("gateway unavailable"));
  const result = await readDesktopBilling(new Request("https://reizo.example/api/desktop-auth/billing"));
  expect(result.usage).toMatchObject({ status: "unavailable", total: null, items: [] }); expect(result.balance.availableCredits).toBe(9);
  await expect(readDesktopBilling(new Request("https://reizo.example/api/desktop-auth/billing?page=0"))).rejects.toMatchObject({ status: 400 });
});
