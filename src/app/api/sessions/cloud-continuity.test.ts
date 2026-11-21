import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Message } from "@/lib/agent/types";
import type { GatewayChatMessage, StreamGatewayChatParams } from "@/lib/agent/provider/gateway";

const fixture = vi.hoisted(() => ({
  userId: "cloud-owner",
  gatewayHistory: [] as GatewayChatMessage[][],
  gatewayModels: [] as string[],
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUserId: () => fixture.userId }));
vi.mock("@/lib/agent/provider/studio-token", () => ({ resolveStudioToken: async () => "fixture" }));
vi.mock("@/lib/agent/provider/ai-sdk", () => ({
  async *streamAiSdkGatewayChat({ messages, model }: StreamGatewayChatParams) {
    fixture.gatewayHistory.push(messages);
    fixture.gatewayModels.push(model);
    yield { kind: "text", text: "流式" };
    yield { kind: "text", text: "回复" };
  },
}));

const root = mkdtempSync(join(tmpdir(), "reizo-cloud-continuity-"));
vi.stubEnv("REIZO_DATA_DIR", root);
let sessions: typeof import("./route");
let detail: typeof import("./[id]/route");
let chat: typeof import("../chat/route");
beforeAll(async () => {
  sessions = await import("./route");
  detail = await import("./[id]/route");
  chat = await import("../chat/route");
}, 120_000);
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function request(path: string, body: object, method = "POST") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

it("opens and continues the same persisted cloud conversation through independent client requests", async () => {
  const created = await sessions.POST(request("/api/sessions", { model: "gpt-4o-mini" }));
  expect(created.status).toBe(201);
  const { id } = await created.json();
  const read = () => detail.GET(new NextRequest(`http://localhost/api/sessions/${id}`), { params: Promise.resolve({ id }) });
  const switchModel = (model: string) => detail.PATCH(request(`/api/sessions/${id}`, { model }, "PATCH"), { params: Promise.resolve({ id }) });
  const send = async (message: string) => {
    const response = await chat.POST(request("/api/chat", { sessionId: id, message, executionMode: "ai-sdk" }));
    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain('"delta":"流式"');
    expect(stream).toContain('"delta":"回复"');
  };

  await send("Windows 首条消息");
  const first = await (await read()).json();
  expect(first.messages.map((message: Message) => message.content)).toEqual(["Windows 首条消息", "流式回复"]);
  expect((await switchModel("gpt-6.2-sol")).status).toBe(200);
  expect((await (await read()).json()).session.model).toBe("gpt-6.2-sol");
  await send("鸿蒙手机追问");

  const resumed = await (await read()).json();
  expect(resumed.messages.map((message: Message) => message.content)).toEqual([
    "Windows 首条消息", "流式回复", "鸿蒙手机追问", "流式回复",
  ]);
  expect(fixture.gatewayHistory[1]).toContainEqual(expect.objectContaining({ role: "user", content: "Windows 首条消息" }));
  expect(fixture.gatewayHistory[1]).toContainEqual(expect.objectContaining({ role: "assistant", content: "流式回复" }));
  expect(fixture.gatewayModels).toEqual(["gpt-4o-mini", "gpt-6.2-sol"]);
  expect(resumed.activeRun).toBeNull();

  fixture.userId = "another-account";
  expect((await read()).status).toBe(404);
  expect((await switchModel("gpt-4o-mini")).status).toBe(404);
}, 30_000);
