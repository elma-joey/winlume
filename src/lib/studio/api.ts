/**
 * Browser-side Studio API helpers.
 * Authentication is supplied by the HttpOnly Auth.js session cookie.
 */

import type {
  Artifact,
  Message,
  Project,
  Session,
} from "@/lib/agent/types";
import { referenceVideoMimeType } from "@/lib/studio/video-upload";
import type { ComposerOptions } from "@/lib/studio/composer-options";
import type { CapabilityCatalog } from "@/lib/studio/capabilities";
import { classifyModel } from "@/lib/probe/classify";
import { isImageGenerationModel } from "@/lib/studio/image-model";

const PENDING_FIRST_MESSAGE_KEY = "reizo:pending-first-message";

export function withUserHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  if (!next.has("content-type")) next.set("content-type", "application/json");
  return next;
}

export class StudioApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "StudioApiError";
    this.status = status;
    this.code = code ?? defaultStudioApiErrorCode(status);
  }
}

type StudioApiErrorBody = {
  error?: unknown;
  code?: unknown;
};

function defaultStudioApiErrorCode(status: number): string | undefined {
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return undefined;
}

async function toStudioApiError(
  response: Response,
  fallback: string,
): Promise<StudioApiError> {
  let body: StudioApiErrorBody = {};
  try {
    const text = await response.text();
    if (text) body = JSON.parse(text) as StudioApiErrorBody;
  } catch {
    // Use the endpoint-specific fallback when an error body is absent or malformed.
  }
  return new StudioApiError(
    typeof body.error === "string" && body.error ? body.error : fallback,
    response.status,
    typeof body.code === "string" && body.code ? body.code : undefined,
  );
}

/**
 * `fetch` with a hard deadline. Without this, a gateway that accepts the TCP
 * connection and then goes silent leaves the caller's promise pending
 * forever — no error, nothing to catch, just a permanently stuck UI.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new StudioApiError(timeoutMessage, 408, "timeout");
    }
    throw err;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    throw new StudioApiError("服务没有返回内容", response.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new StudioApiError("服务返回了无法识别的数据", response.status);
  }
}

export async function listStudioComposerModels() {
  const response = await fetchWithTimeout("/api/capabilities", {
    credentials: "same-origin",
    cache: "no-store",
  }, 10_000, "模型服务响应超时，请重试。");
  if (!response.ok) throw await toStudioApiError(response, "无法加载对话模型，请重试。");

  const catalog = await parseJson<CapabilityCatalog>(response);
  const chat = catalog.capabilities.find((item) => item.id === "chat");
  const chatModels = catalog.models.filter((model) => {
    const { category } = classifyModel({ model_name: model });
    return (category === "text" || category === "unknown") && !/embedding|rerank/i.test(model);
  });
  return {
    chatModels: chat?.availability === "available" ? chatModels : [],
    imageModels: catalog.models.filter(isImageGenerationModel),
    chatError: chat?.reason ?? "暂无可用对话模型。",
  };
}

export async function listAvailableStudioChatModels(): Promise<string[]> {
  const { chatModels, chatError } = await listStudioComposerModels();
  if (!chatModels.length) throw new StudioApiError(chatError, 503);
  return chatModels;
}

export async function getAvailableStudioChatModel(preferred: string): Promise<string> {
  const models = await listAvailableStudioChatModels();
  return models.includes(preferred) ? preferred : models[0];
}

export async function listSessions(projectId?: string, archived = false): Promise<Session[]> {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (archived) params.set("archived", "true");
  const query = params.size ? `?${params}` : "";
  const response = await fetch(`/api/sessions${query}`, {
    headers: withUserHeaders(),
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) {
    throw new StudioApiError("请先登录", 401);
  }
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "加载会话列表失败",
      response.status,
    );
  }
  const data = await parseJson<{ sessions: Session[] }>(response);
  return data.sessions ?? [];
}

export async function createSession(input?: {
  model?: string;
  title?: string;
  projectId?: string;
  capabilityPresetId?: string;
}): Promise<Session> {
  const response = await fetchWithTimeout(
    "/api/sessions",
    {
      method: "POST",
      headers: withUserHeaders(),
      body: JSON.stringify(input ?? {}),
      credentials: "same-origin",
    },
    15_000,
    "创建会话超时，请检查网络后重试",
  );
  if (response.status === 401) {
    throw new StudioApiError("请先登录", 401);
  }
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "创建会话失败",
      response.status,
    );
  }
  return parseJson<Session>(response);
}

/* ── Projects ─────────────────────────────────────────────── */

export async function listProjects(): Promise<Project[]> {
  const response = await fetch("/api/projects", {
    headers: withUserHeaders(),
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) throw new StudioApiError("请先登录", 401);
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "加载项目列表失败",
      response.status,
    );
  }
  const data = await parseJson<{ projects?: Project[] }>(response);
  return Array.isArray(data.projects) ? data.projects : [];
}

export async function createProject(input: {
  name: string;
  description?: string;
  instructions?: string;
  pinnedSkillIds?: string[];
}): Promise<Project> {
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: withUserHeaders(),
    body: JSON.stringify(input),
    credentials: "same-origin",
  });
  if (response.status === 401) throw new StudioApiError("请先登录", 401);
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "创建项目失败",
      response.status,
    );
  }
  return parseJson<Project>(response);
}

export async function getProject(id: string): Promise<Project> {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    headers: withUserHeaders(),
    credentials: "same-origin",
  });
  if (response.status === 401) throw new StudioApiError("请先登录", 401);
  if (response.status === 404) throw new StudioApiError("项目不存在", 404);
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "加载项目失败",
      response.status,
    );
  }
  const data = await parseJson<{ project?: Project } | Project>(response);
  return "project" in data && data.project ? data.project : (data as Project);
}

export async function patchProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "description" | "instructions" | "pinnedSkillIds">>,
): Promise<Project> {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: withUserHeaders(),
    body: JSON.stringify(patch),
    credentials: "same-origin",
  });
  if (response.status === 401) throw new StudioApiError("请先登录", 401);
  if (response.status === 404) throw new StudioApiError("项目不存在", 404);
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "更新项目失败",
      response.status,
    );
  }
  return parseJson<Project>(response);
}

export async function deleteProject(id: string): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: withUserHeaders(),
    credentials: "same-origin",
  });
  if (response.status === 401) throw new StudioApiError("请先登录", 401);
  if (response.status === 404) throw new StudioApiError("项目不存在", 404);
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "删除项目失败",
      response.status,
    );
  }
}

export async function getSessionBundle(sessionId: string): Promise<{
  session: Session;
  messages: Message[];
  activeRun: { id: string; status: string; message: string } | null;
}> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    headers: withUserHeaders(),
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) {
    throw new StudioApiError("请先登录", 401);
  }
  if (response.status === 404) {
    throw new StudioApiError("会话不存在", 404);
  }
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "加载会话失败",
      response.status,
    );
  }
  return parseJson<{
    session: Session;
    messages: Message[];
    activeRun: { id: string; status: string; message: string } | null;
  }>(response);
}

/** PATCH /api/sessions/[id] — title, model, and/or pinnedSkillIds (replace entire pin list). */
export async function patchSession(
  id: string,
  patch: {
    archived?: boolean;
    title?: string;
    model?: string;
    projectId?: string | null;
    pinnedSkillIds?: string[];
    capabilityPresetId?: null;
  },
): Promise<Session> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: withUserHeaders(),
    body: JSON.stringify(patch),
    credentials: "same-origin",
  });
  if (response.status === 401) {
    throw new StudioApiError("请先登录", 401);
  }
  if (response.status === 404) {
    throw new StudioApiError("会话不存在", 404);
  }
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "更新会话失败",
      response.status,
    );
  }
  const session = await parseJson<Session>(response);
  if (patch.archived !== undefined) window.dispatchEvent(new Event("reizo:sessions-changed"));
  return session;
}

export async function deleteSession(id: string): Promise<void> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: withUserHeaders(),
    credentials: "same-origin",
  });
  if (response.status === 401) throw new StudioApiError("请先登录", 401);
  if (response.status === 404) throw new StudioApiError("会话不存在", 404);
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "删除会话失败",
      response.status,
    );
  }
}

export type ChatRequestBody = {
  sessionId?: string;
  projectId?: string;
  message?: string;
  model?: string;
  /** Session-bound, server-validated capability launch intent. */
  capabilityPresetId?: string;
  composerOptions?: ComposerOptions;
  executionMode?: "studio" | "ai-sdk" | "codex";
  skillIds?: string[];
  /** Image artifact ids the user @-referenced in the composer. */
  referencedArtifactIds?: string[];
  /** @deprecated Use referencedArtifactIds */
  referencedArtifactId?: string;
  /**
   * `sessionId` is a client-minted id the caller already navigated to —
   * create the session with that exact id instead of requiring it to
   * already exist. See `/api/chat`'s `ChatBody.bootstrap`.
   */
  bootstrap?: { title?: string };
};

/** Explicit server-side stop (disconnect alone does not cancel generation). */
export async function stopChatTurn(sessionId: string): Promise<void> {
  const response = await fetch("/api/chat/stop", {
    method: "POST",
    headers: withUserHeaders(),
    body: JSON.stringify({ sessionId }),
    credentials: "same-origin",
  });
  if (response.status === 401) {
    throw new StudioApiError("请先登录", 401);
  }
  // 404 / no active turn — still OK for idempotent stop
  if (!response.ok && response.status !== 404) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "停止失败",
      response.status,
    );
  }
}

export type UploadImageArtifactBody = {
  sessionId: string;
  name: string;
  dataUrl: string;
  visibility?: "hidden";
  purpose?: "annotation";
};

/** Persist an uploaded image as a ready Artifact. */
export async function uploadImageArtifact(
  body: UploadImageArtifactBody,
): Promise<Artifact> {
  const response = await fetchWithTimeout(
    "/api/artifacts/upload-image",
    {
      method: "POST",
      headers: withUserHeaders(),
      body: JSON.stringify(body),
      credentials: "same-origin",
    },
    30_000,
    "图片上传超时，请检查网络后重试",
  );

  if (response.status === 401) {
    throw new StudioApiError("请先登录", 401);
  }
  if (!response.ok) {
    const errBody = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (errBody as { error?: string }).error || "图片上传失败",
      response.status,
    );
  }

  const data = await parseJson<{ artifact: Artifact }>(response);
  return data.artifact;
}

/** Persist a marked image as an internal targeting reference for refinement. */
export async function uploadImageAnnotation(body: {
  sessionId: string;
  name: string;
  dataUrl: string;
}): Promise<Artifact> {
  return uploadImageArtifact({
    ...body,
    visibility: "hidden",
    purpose: "annotation",
  });
}

export async function uploadSheetArtifact(input: {
  sessionId: string;
  file: File;
}): Promise<Artifact> {
  const mime =
    input.file.type?.split(";", 1)[0]?.trim() ||
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const response = await fetchWithTimeout(
    "/api/artifacts/upload-sheet",
    {
      method: "POST",
      headers: {
        "content-type": mime,
        "x-reizo-session-id": input.sessionId,
        "x-reizo-artifact-name": encodeURIComponent(input.file.name || "workbook.xlsx"),
      },
      body: input.file,
      credentials: "same-origin",
    },
    60_000,
    "表格上传超时，请检查网络后重试",
  );
  if (response.status === 401) throw new StudioApiError("请先登录", 401);
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "表格导入失败",
      response.status,
    );
  }
  return (await parseJson<{ artifact: Artifact }>(response)).artifact;
}

export async function uploadVideoArtifact(input: {
  sessionId: string;
  file: File;
  authorized: boolean;
}): Promise<Artifact> {
  const response = await fetchWithTimeout(
    "/api/artifacts/upload-video",
    {
      method: "POST",
      headers: {
        "content-type": referenceVideoMimeType(input.file),
        "x-reizo-session-id": input.sessionId,
        "x-reizo-artifact-name": encodeURIComponent(input.file.name || "参考视频.mp4"),
        "x-reizo-video-authorized": String(input.authorized),
      },
      body: input.file,
      credentials: "same-origin",
    },
    120_000,
    "视频上传超时，请检查网络后重试",
  );
  if (response.status === 401) throw new StudioApiError("请先登录", 401);
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "视频上传失败",
      response.status,
    );
  }
  return (await parseJson<{ artifact: Artifact }>(response)).artifact;
}

export async function startVideoAnalysis(input: {
  sourceArtifactId: string;
  goal?: "script" | "storyboard" | "both";
}): Promise<{ artifact: Artifact }> {
  const response = await fetch("/api/video/analyses", {
    method: "POST",
    headers: withUserHeaders(),
    body: JSON.stringify(input),
    credentials: "same-origin",
  });
  if (response.status === 401) throw new StudioApiError("请先登录", 401);
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "视频拆解任务创建失败",
      response.status,
    );
  }
  return parseJson<{ artifact: Artifact }>(response);
}

export async function retryQueuedVideoAnalysis(
  analysisArtifactId: string,
): Promise<{ artifact: Artifact }> {
  const response = await fetch(
    `/api/video/analyses/${encodeURIComponent(analysisArtifactId)}/retry`,
    {
      method: "POST",
      headers: withUserHeaders(),
      credentials: "same-origin",
    },
  );
  if (response.status === 401) throw new StudioApiError("请先登录", 401);
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "重新派发视频拆解失败",
      response.status,
    );
  }
  return parseJson<{ artifact: Artifact }>(response);
}

/* ── Artifacts ─────────────────────────────────────────────── */

export async function listArtifacts(sessionId?: string): Promise<Artifact[]> {
  const qs = sessionId
    ? `?sessionId=${encodeURIComponent(sessionId)}`
    : "";
  const response = await fetch(`/api/artifacts${qs}`, {
    headers: withUserHeaders(),
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) {
    throw new StudioApiError("请先登录", 401);
  }
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "加载作品列表失败",
      response.status,
    );
  }
  const data = await parseJson<{ artifacts: Artifact[] }>(response);
  return data.artifacts ?? [];
}

export async function getArtifact(
  id: string,
): Promise<{ artifact: Artifact; content: string | null }> {
  const response = await fetch(`/api/artifacts/${encodeURIComponent(id)}`, {
    headers: withUserHeaders(),
    credentials: "same-origin",
  });
  if (response.status === 401) {
    throw new StudioApiError("请先登录", 401);
  }
  if (response.status === 404) {
    throw new StudioApiError("作品不存在", 404);
  }
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response).catch(() => ({}));
    throw new StudioApiError(
      (body as { error?: string }).error || "读取作品失败",
      response.status,
    );
  }
  return parseJson<{ artifact: Artifact; content: string | null }>(response);
}

/* ── First-message handoff (home → session page) ───────────── */

export type PendingFirstMessage = {
  sessionId: string;
  message: string;
  model?: string;
  capabilityPresetId?: string;
  composerOptions?: ComposerOptions;
  /** Per-message skill ids; injected into system prompt on send. */
  skillIds?: string[];
  /** Image artifact ids @-mentioned in the first message. */
  referencedArtifactIds?: string[];
  /**
   * Session snapshot from createSession — lets /studio/c/[id] paint chrome
   * on the first client frame without waiting for getSessionBundle.
   */
  session?: Session;
};

export function setPendingFirstMessage(payload: PendingFirstMessage): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    PENDING_FIRST_MESSAGE_KEY,
    JSON.stringify(payload),
  );
}

/**
 * Synchronous client bootstrap for the session route.
 * Safe to call from useState initializers (window-gated).
 */
export function readHandoffBootstrap(sessionId: string): {
  message: string;
  model?: string;
  capabilityPresetId?: string;
  skillIds?: string[];
  referencedArtifactIds?: string[];
  session: Session | null;
  userMessage: Message;
} | null {
  if (!sessionId || typeof window === "undefined") return null;
  const pending = readPendingFirstMessage(sessionId);
  if (!pending?.message?.trim()) return null;
  return {
    message: pending.message,
    model: pending.model,
    capabilityPresetId: pending.capabilityPresetId,
    skillIds: pending.skillIds,
    referencedArtifactIds: pending.referencedArtifactIds,
    session: pending.session ?? null,
    userMessage: {
      id: `pending-user-${sessionId}`,
      sessionId,
      role: "user",
      content: pending.message,
      createdAt: new Date().toISOString(),
    },
  };
}

function readPendingFirstMessage(
  sessionId: string,
): PendingFirstMessage | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(PENDING_FIRST_MESSAGE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as PendingFirstMessage;
    if (data.sessionId !== sessionId || !data.message?.trim()) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Resolved send parameters for a handed-off first message — computed on the
 * home page (after uploads/video-analysis/sheet-import and @-mention
 * resolution finish) and delivered to the session page, which is the only
 * place that can actually call `sendMessage` (useChat's state is per-mount,
 * so there is no way to "pre-start" a turn from a page that's about to
 * unmount).
 */
export type ResolvedFirstMessageOverrides = {
  model?: string;
  capabilityPresetId?: string;
  composerOptions?: ComposerOptions;
  skillIds?: string[];
  referencedArtifactIds?: string[];
  projectId?: string;
  bootstrapTitle?: string;
};

type PendingFirstMessageListener = {
  onStatus?: (label: string) => void;
  onResolve: (overrides: ResolvedFirstMessageOverrides) => void;
  onFail: (message: string) => void;
};

/**
 * In-memory only (module-level, survives the client-side route change) — this
 * is same-tab coordination between two mounted components, not persistence,
 * so sessionStorage doesn't apply.
 */
const pendingFirstMessageListeners = new Map<string, PendingFirstMessageListener>();
const resolvedFirstMessages = new Map<string, ResolvedFirstMessageOverrides>();
const failedFirstMessages = new Map<string, string>();

/**
 * Registers the session page's callbacks for a specific handoff. If the home
 * page already resolved or failed before this attaches — a text-only first
 * message with no uploads can resolve in under a millisecond, likely before
 * the session page finishes mounting — replay it immediately instead of
 * losing it.
 */
export function registerPendingFirstMessageListener(
  sessionId: string,
  listener: PendingFirstMessageListener,
): () => void {
  pendingFirstMessageListeners.set(sessionId, listener);
  const failure = failedFirstMessages.get(sessionId);
  if (failure !== undefined) {
    failedFirstMessages.delete(sessionId);
    listener.onFail(failure);
  } else {
    const resolved = resolvedFirstMessages.get(sessionId);
    if (resolved) {
      resolvedFirstMessages.delete(sessionId);
      listener.onResolve(resolved);
    }
  }
  return () => {
    if (pendingFirstMessageListeners.get(sessionId) === listener) {
      pendingFirstMessageListeners.delete(sessionId);
    }
  };
}

export function notifyPendingFirstMessageStatus(sessionId: string, label: string): void {
  pendingFirstMessageListeners.get(sessionId)?.onStatus?.(label);
}

export function resolvePendingFirstMessage(
  sessionId: string,
  overrides: ResolvedFirstMessageOverrides,
): void {
  const listener = pendingFirstMessageListeners.get(sessionId);
  if (listener) {
    listener.onResolve(overrides);
  } else {
    resolvedFirstMessages.set(sessionId, overrides);
  }
}

export function failPendingFirstMessage(sessionId: string, message: string): void {
  const listener = pendingFirstMessageListeners.get(sessionId);
  if (listener) {
    listener.onFail(message);
  } else {
    failedFirstMessages.set(sessionId, message);
  }
}

/** Peek without consuming — used for optimistic chat UI during session load. */
export function peekPendingFirstMessage(
  sessionId: string,
): PendingFirstMessage | null {
  return readPendingFirstMessage(sessionId);
}

export function takePendingFirstMessage(
  sessionId: string,
): PendingFirstMessage | null {
  const data = readPendingFirstMessage(sessionId);
  if (!data) {
    // Clear corrupt / mismatched payload
    if (typeof window !== "undefined") {
      const raw = window.sessionStorage.getItem(PENDING_FIRST_MESSAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as PendingFirstMessage;
          if (parsed.sessionId === sessionId) {
            window.sessionStorage.removeItem(PENDING_FIRST_MESSAGE_KEY);
          }
        } catch {
          window.sessionStorage.removeItem(PENDING_FIRST_MESSAGE_KEY);
        }
      }
    }
    return null;
  }
  window.sessionStorage.removeItem(PENDING_FIRST_MESSAGE_KEY);
  return data;
}
