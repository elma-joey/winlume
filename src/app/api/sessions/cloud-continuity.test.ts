import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Message } from "@/lib/agent/types";
import type { GatewayChatMessage, GenerateImageParams, StreamGatewayChatParams } from "@/lib/agent/provider/gateway";

const fixture = vi.hoisted(() => ({
  userId: "cloud-owner",
  gatewayHistory: [] as GatewayChatMessage[][],
  gatewayModels: [] as string[],
  imageRequests: [] as GenerateImageParams[],
  png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jUuoAAAAASUVORK5CYII=",
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUserId: () => fixture.userId }));
vi.mock("@/lib/agent/provider/studio-token", () => ({ resolveStudioToken: async () => "fixture" }));
vi.mock("@/lib/studio/capabilities.server", () => ({ loadCapabilityCatalog: async () => ({ models: ["gpt-image-2"], capabilities: [] }) }));
vi.mock("@/lib/agent/provider/gateway", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/agent/provider/gateway")>(),
  async generateImage(params: GenerateImageParams) {
    fixture.imageRequests.push(params);
    return [{ bytes: Buffer.from(fixture.png, "base64"), mimeType: "image/png" }];
  },
}));
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

it("persists uploaded references and the generated image without replacing the chat model", async () => {
  fixture.userId = "image-owner";
  const uploadImage = await import("../artifacts/upload-image/route");
  const listArtifacts = await import("../artifacts/route");
  const rawArtifact = await import("../artifacts/[id]/raw/route");
  const created = await sessions.POST(request("/api/sessions", { model: "gpt-6.2-sol" }));
  const { id } = await created.json();
  const uploaded = await uploadImage.POST(request("/api/artifacts/upload-image", {
    sessionId: id, name: "参考图.png", dataUrl: `data:image/png;base64,${fixture.png}`,
  }));
  expect(uploaded.status).toBe(200);
  const { artifact } = await uploaded.json();
  const response = await chat.POST(request("/api/chat", {
    sessionId: id, executionMode: "ai-sdk", model: "gpt-6.1-sol", message: "根据参考图生成图片",
    referencedArtifactIds: [artifact.id],
    composerOptions: { mode: "image", directImage: true, imageModel: "gpt-image-2" },
  }));
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('"type":"data-artifact"');
  const read = await detail.GET(new NextRequest(`http://localhost/api/sessions/${id}`), { params: Promise.resolve({ id }) });
  const bundle = await read.json();
  expect(bundle.session.model).toBe("gpt-6.2-sol");
  expect(bundle.messages[0].attachmentIds).toEqual([artifact.id]);
  expect(fixture.imageRequests[0]).toMatchObject({ model: "gpt-image-2", sourceImages: [{ mimeType: "image/png" }] });
  await vi.waitFor(async () => {
    const response = await listArtifacts.GET(new NextRequest(`http://localhost/api/artifacts?sessionId=${id}`));
    const { artifacts } = await response.json();
    const generated = artifacts.find((entry: { messageId?: string }) => entry.messageId === bundle.messages[1].id);
    expect(generated?.status).toBe("ready");
    const image = await rawArtifact.GET(new NextRequest(`http://localhost/api/artifacts/${generated.id}/raw`), { params: Promise.resolve({ id: generated.id }) });
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer()).toString("base64")).toBe(fixture.png);
  });
}, 30_000);
