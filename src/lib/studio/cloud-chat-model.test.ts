import { afterEach, expect, it, vi } from "vitest";
import { getAvailableStudioChatModel } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("replaces an unavailable saved model with a live chat model", async () => {
  const fetch = vi.fn(async () => Response.json({
    models: ["gpt-image-2", "gpt-6.1-sol", "gpt-6.2-sol"],
    capabilities: [{ id: "chat", availability: "available" }],
  }));
  vi.stubGlobal("fetch", fetch);

  await expect(getAvailableStudioChatModel("gpt-4o-mini")).resolves.toBe("gpt-6.1-sol");
  await expect(getAvailableStudioChatModel("gpt-6.2-sol")).resolves.toBe("gpt-6.2-sol");
  expect(fetch).toHaveBeenCalledWith("/api/capabilities", expect.objectContaining({
    credentials: "same-origin",
    cache: "no-store",
  }));
});

it("reports a missing chat model instead of selecting an unavailable model", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    models: [],
    capabilities: [{ id: "chat", availability: "degraded", reason: "模型服务暂时不可用" }],
  })));

  await expect(getAvailableStudioChatModel("gpt-4o-mini")).rejects.toMatchObject({
    status: 503,
    message: "模型服务暂时不可用",
  });
});
