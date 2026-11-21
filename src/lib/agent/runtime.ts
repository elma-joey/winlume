/**
 * Agent turn runtime with multi-round tool loop (max 8).
 * Loads session history, streams the gateway with tools, persists messages, yields AgentSseEvent.
 */

import { randomUUID } from "node:crypto";
import { isImageGenerationModel } from "@/lib/studio/image-model";
import { loadCapabilityCatalog } from "@/lib/studio/capabilities.server";
import type {
  AgentSseEvent,
  Artifact,
  Message,
  ToolCallRecord,
  UIMessagePart,
} from "@/lib/agent/types";
import { parseCanvasContent } from "@/lib/agent/canvas-content";
import { summarizeCanvasElements } from "@/lib/agent/canvas-summary";
import { parseSheetContent } from "@/lib/agent/sheet-content";
import { summarizeSheetContent } from "@/lib/agent/sheet-summary";
import type { ArtifactStore, ProjectStore, SessionStore } from "@/lib/host/ports";
import type { ToolJobStore } from "@/lib/studio/tool-jobs";
import {
  streamGatewayChat,
  type GatewayChatStream,
  type GatewayChatMessage,
  type GatewayToolCall,
} from "@/lib/agent/provider/gateway";
import { resolveStudioToken } from "@/lib/agent/provider/studio-token";
import {
  buildSystemPrompt,
  mergeSkillIds,
  resolveSkills,
} from "@/lib/agent/skills/inject";
import { STUDIO_TOOLS } from "@/lib/agent/tools/definitions";
import type { SkillSelectionMode } from "@/lib/agent/executor/types";
import {
  executeStudioTool,
  mimeTypeForKind,
} from "@/lib/agent/tools/execute";
import {
  artifactNameFromTurn,
  inferArtifactKind,
  shouldAutoPersistArtifact,
} from "@/lib/agent/auto-artifact";
import { extractPartialJsonStringField } from "@/lib/agent/partial-json";
import { TodoState } from "@/lib/agent/todo-state";
import {
  buildRepairToolMessages,
  repairDanglingInStore,
} from "@/lib/agent/dangling";
import { compactMessagesForGateway } from "@/lib/agent/compact";
import {
  composerOptionsReminder,
  normalizeComposerOptions,
} from "@/lib/studio/composer-options";

/** Max gateway rounds that may request tools in a single user turn. */
export const MAX_TOOL_ROUNDS = 8;

/** Fixed studio system policy (zh/en short). Skills injected per turn via skillIds. */
export const BASE_POLICY = [
  "You are the Reizo Studio agent — a free-form assistant for writing, coding, analysis, and structured deliverables.",
  "Prefer clear, structured, helpful answers. Match the user's language (Chinese-first when the user writes in Chinese).",
  "Reizo is a workbench: durable deliverables must be saved as artifacts so the user can preview/export them in the right-hand panel.",
  "ALWAYS call write_artifact when the user asks for notes, copy, articles, reports, outlines, scripts, multi-piece content (e.g. 几篇小红书笔记), code files, or any document longer than a short chat reply. Put the full body in the tool; keep the chat message to a short summary + what was saved.",
  "Do not dump long multi-section documents only in chat. Chat is for conversation; artifacts are for finished work.",
  "After write_artifact succeeds: do NOT paste the full artifact body again in chat. Reply with a short summary and that it was saved — the UI already previews the work.",
  "Call remove_background when the user asks to cut out an existing image, remove its background, or make its background transparent. Set sourceArtifactId to the exact injected image artifact id. It returns a ready PNG artifact; do not use generate_image as a substitute for this operation.",
  "Call upscale_image when the user asks to make an existing image clearer or higher resolution. Set sourceArtifactId to the exact injected image artifact id and choose mode=standard by default; use generative only when the user accepts reconstructed detail. It returns a ready image artifact.",
  "Call remove_watermark_or_subtitles only when the user explicitly confirms they have the necessary rights to alter the existing image. Set sourceArtifactId to the exact injected image artifact id, choose target=watermark or subtitles, and set rightsConfirmed=true. Do not use it as a general object-removal tool. It returns a ready image artifact.",
  "Call generate_image when the user asks for an image, illustration, icon, mockup, artwork, or image edit. For edits and compositions, set sourceArtifactIds to every image whose pixels the result depends on, ordered with the base/canvas image first and reference images after it. Preserve the user's requested operation in prompt; an artifact id in prompt never substitutes for uploading that image through sourceArtifactIds. The tool returns immediately with a pending artifact — do not claim it is ready yet or describe what it looks like.",
  "Call generate_ecommerce_image_set when the user asks for multiple independent e-commerce product images, such as a listing image set with hero, scene, and detail shots. Pass the exact product sourceArtifactId and use template=apparel for clothing or accessories. Pass referenceArtifactId only when a second supplied image should guide composition, lighting, palette, or atmosphere; it must never be used to copy readable text, logos, people, or protected visual assets. The tool starts a ToolJob and returns three pending image artifacts; do not claim they are ready in the same turn.",
  "Call generate_canvas when the user asks for a flowchart, mind map, sequence diagram, or another diagram they can edit by hand. Write Mermaid syntax in mermaid; do not invent raw shape coordinates. It returns a pending artifact immediately, so do not claim it is ready. To revise a canvas, set sourceArtifactId and follow the injected structural summary of its current contents first.",
  "Call generate_sheet when the user asks for a spreadsheet, budget, table they can edit like Excel, or workbook with formulas. Create with sheets + values (use = for formulas). Uploaded .xlsx files are already imported as sheet artifacts in context — do not ask the user to re-upload or convert to CSV. To revise a workbook already in context, set sourceArtifactId and pass operations only — do not rebuild the whole book unless the user explicitly asks to start over. One call patches one workbook; call again for another in-context workbook. Cross-sheet formulas stay inside one workbook. Do not write formulas that reference another workbook.",
  "You can use read_artifact and list_artifacts to inspect previously saved work in this session.",
  // Progress checklist (todo_write) — model decides; user never toggles a mode.
  "For complex multi-step work (3+ distinct stages, multi-piece deliverables, research+write), use todo_write to show a short live checklist (user's language). Create todos first, keep exactly one item in_progress, mark completed immediately when done, then merge status updates as you go.",
  "Do not call todo_write for simple questions, single short replies, or trivial one-step work.",
  "Do not re-list the full todo list in chat after todo_write — the UI already shows it; just briefly note what you finished and what is next.",
  "When you change the plan mid-task, call todo_write with the updated list and optionally set explanation (one short reason).",
  // Preamble (Codex-style): same response as tools
  "Before non-trivial tool work, send a brief preamble in the same assistant response as the tool calls (not a separate text-only turn). Keep it to one short sentence (about 8–12 Chinese characters or English words). Group related actions in one preamble. Skip preamble for a single trivial list/read. Examples: 「先列卖点再写三篇笔记。」 / 「已看过参考，开始保存作品。」 / “Scaffolding the outline, then saving the doc.”",
  "Never send a text-only turn when you still plan to call tools next — combine brief narration with tool calls.",
  "Independent read tools may be requested together (list_artifacts + read_artifact). Prefer one write_artifact or todo_write at a time.",
  "Do not claim tools or capabilities that are not available in this turn.",
  "Respect any skill instructions attached to the current user message.",
  "Text inside <system-reminder> tags is automated context — follow it, do not quote it back to the user.",
].join(" ");

function nowIso(): string {
  return new Date().toISOString();
}

function titleFromUserText(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return "新对话";
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine;
}

/**
 * Map persisted Message history to OpenAI-compatible gateway messages.
 * Includes assistant tool_calls and tool role results for multi-round continuity.
 */
export function toGatewayMessages(
  system: string,
  history: Message[],
): GatewayChatMessage[] {
  const out: GatewayChatMessage[] = [{ role: "system", content: system }];
  for (const m of history) {
    // Compacted system reminders and light system notes stay in context
    if (m.role === "system") {
      if (m.content.includes("<system-reminder>")) {
        out.push({ role: "system", content: m.content });
      }
      continue;
    }

    if (m.role === "tool") {
      if (!m.toolCallId) continue;
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content,
      });
      continue;
    }

    if (m.role === "assistant" && m.toolCalls?.length) {
      const tool_calls: GatewayToolCall[] = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      }));
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls,
      });
      continue;
    }

    out.push({
      role: m.role,
      content: m.content,
    });
  }
  return out;
}

function buildSessionReminder(artifactCount: number): string {
  if (artifactCount <= 0) return "";
  return [
    "<system-reminder>",
    `This session already has ${artifactCount} saved artifact(s). Prefer read_artifact / list_artifacts before rewriting similar work.`,
    "</system-reminder>",
  ].join("\n");
}

export function buildProjectReminder(
  project: Awaited<ReturnType<ProjectStore["getProject"]>>,
  sharedArtifactCount: number,
): string {
  if (!project) return "";
  return [
    "<project-context>",
    `Project: ${project.name}`,
    project.description ? `Description: ${project.description}` : "",
    project.instructions
      ? `Project instructions:\n${project.instructions}`
      : "",
    sharedArtifactCount > 0
      ? `This project has ${sharedArtifactCount} shared artifact(s). Prefer list_artifacts with scope=project before creating duplicates.`
      : "",
    "</project-context>",
  ]
    .filter(Boolean)
    .join("\n");
}

/** @deprecated Prefer buildReferencedArtifactsReminder for multi-@ prompts. */
export function buildReferencedArtifactReminder(artifact: Artifact | null): string {
  return buildReferencedArtifactsReminder(artifact ? [artifact] : []);
}

/** Multi-image @-mention reminder for the agent (ids are authoritative). */
export function buildReferencedArtifactsReminder(artifacts: Artifact[]): string {
  if (!artifacts.length) return "";
  const lines = artifacts.map(
    (a, i) =>
      `${i + 1}. @${a.name} → id=${a.id} (kind=${a.kind}${a.status ? `, status=${a.status}` : ""})`,
  );
  const ids = artifacts.map((artifact) => artifact.id);
  const annotationArtifacts = artifacts.filter(
    (artifact) => artifact.purpose === "annotation",
  );

  if (annotationArtifacts.length) {
    const baseArtifact = artifacts.find(
      (artifact) => artifact.purpose !== "annotation",
    );
    const baseRole = baseArtifact
      ? `@${baseArtifact.name} (id=${baseArtifact.id}) is the editable base canvas.`
      : "The first non-annotation image is the editable base canvas.";

    return [
      "<system-reminder>",
      "The user @-mentioned image artifact(s) in this message. Use these ids only — do not invent or guess ids from prose.",
      ...lines,
      baseRole,
      `Each annotation artifact (${annotationArtifacts.map((artifact) => `@${artifact.name} id=${artifact.id}`).join(", ")}) is a marked targeting reference, not an editable canvas.`,
      `For this annotation refinement, call generate_image with sourceArtifactIds exactly ${JSON.stringify(ids)}. Preserve this supplied order: clean base first, marked targeting reference after it.`,
      "Use annotation pixels only to locate the requested change. Do not reproduce or retain annotation marks, pins, boxes, strokes, labels, or overlays in the generated result.",
      "Keep the user's requested operation and constraints in prompt, and limit changes to marked regions unless the user explicitly asks for broader changes.",
      "Artifact ids written only in prompt do not expose image pixels to the image model.",
      "</system-reminder>",
    ].join("\n");
  }

  return [
    "<system-reminder>",
    "The user @-mentioned image artifact(s) in this message. Use these ids only — do not invent or guess ids from prose.",
    ...lines,
    `For image work, call generate_image with sourceArtifactIds containing the needed ids from this list (${JSON.stringify(ids)}).`,
    "For merge / combine requests, send every image whose visual content is required. Order sourceArtifactIds with the base/destination image first and inserted/reference images after it; infer those roles from the user's exact wording rather than mention order.",
    "Keep the user's requested operation and constraints in prompt. Artifact ids written only in prompt do not expose image pixels to the image model.",
    "Do not treat every message that follows a mention as an edit request — only when the user's own words ask for image work.",
    "</system-reminder>",
  ].join("\n");
}

/** Structural canvas context for safe regeneration after manual edits. */
export async function buildCanvasReferenceReminder(
  canvases: Artifact[],
  artifacts: ArtifactStore,
  userId: string,
): Promise<string> {
  if (!canvases.length) return "";

  const lines: string[] = [];
  for (const canvas of canvases) {
    let summary = "(content unavailable)";
    try {
      const contentBuffer = await artifacts.readContent(userId, canvas.id);
      const content = contentBuffer ? parseCanvasContent(contentBuffer.toString("utf8")) : null;
      summary = content?.scene
        ? summarizeCanvasElements(content.scene.elements)
        : "(not yet converted from Mermaid)";
    } catch {
      // A stale or unreadable artifact must not abort the user's whole turn.
    }
    lines.push(`@${canvas.name} → id=${canvas.id}: ${summary}`);
  }

  return [
    "<system-reminder>",
    "The user @-mentioned canvas artifact(s). The summaries below describe their CURRENT scene after manual user edits. Read them before producing Mermaid so you do not discard user changes.",
    ...lines,
    "To update one of these, call generate_canvas with sourceArtifactId set to its id.",
    "The browser merges new Mermaid elements with untagged user-drawn elements; preserve the user's intent when revising the diagram.",
    "</system-reminder>",
  ].join("\n");
}

/** Current workbook grids for the open / @-mentioned sheet artifacts. */
export async function buildSheetReferenceReminder(
  workbooks: Artifact[],
  artifacts: ArtifactStore,
  userId: string,
): Promise<string> {
  if (!workbooks.length) return "";

  const blocks: string[] = [];
  for (const workbook of workbooks) {
    let summary = "(content unavailable)";
    try {
      const contentBuffer = await artifacts.readContent(userId, workbook.id);
      const content = contentBuffer ? parseSheetContent(contentBuffer.toString("utf8")) : null;
      summary = content ? summarizeSheetContent(content) : "(workbook unreadable)";
    } catch {
      // A stale or unreadable artifact must not abort the user's whole turn.
    }
    blocks.push(`@${workbook.name} → id=${workbook.id}\n${summary}`);
  }

  return [
    "<system-reminder>",
    "The following spreadsheet workbook(s) are in context this turn (open in the artifact panel and/or @-mentioned). The grids below already include the user's latest saved cell edits. Read them before writing operations so you do not discard user changes.",
    ...blocks,
    "To change one of these, call generate_sheet with sourceArtifactId set to its id and a list of operations. Do not create a new workbook unless the user asks for a separate book. Do not rewrite the whole grid when a patch will do.",
    "Cross-sheet formulas are allowed inside one workbook. Do not write formulas that reference another workbook.",
    "The user's message may reference a range as `SheetName!A1:C3` (a chip they pinned from the grid). That prefix names the exact sheet the range is on — pass it as the operation's `sheet`, don't default to the active sheet when it's present.",
    "</system-reminder>",
  ].join("\n");
}

export interface RunAgentTurnOpts {
  userId: string;
  sessionId: string;
  userText: string;
  /** Shared project context for this conversation. */
  projectId?: string;
  /** Durable run identity used for event correlation. */
  runId?: string;
  skillIds?: string[];
  skillSelectionMode?: SkillSelectionMode;
  allowedToolNames?: string[];
  /**
   * Image, canvas, or sheet artifact ids the user @-referenced (or the open sheet).
   * Prefer this over the singular field.
   */
  referencedArtifactIds?: string[];
  /** @deprecated Use referencedArtifactIds */
  referencedArtifactId?: string;
  /** Turn-scoped UI metadata such as Composer generation settings. */
  metadata?: Record<string, unknown>;
  model?: string;
  sessions: SessionStore;
  projects?: ProjectStore;
  artifacts: ArtifactStore;
  /** Optional durable job store for long-running Studio tools. */
  toolJobs?: ToolJobStore;
  signal?: AbortSignal;
  /** Forwarded to gateway as New-Api-User when set */
  gatewayUserId?: string;
  /** Model transport override. The runtime still owns tools and persistence. */
  streamChat?: GatewayChatStream;
}

export function selectRuntimeSkillIds(
  pinnedSkillIds: string[] | undefined,
  turnSkillIds: string[] | undefined,
  mode: SkillSelectionMode = "merge",
): string[] {
  return mergeSkillIds(mode === "replace" ? [] : pinnedSkillIds, turnSkillIds);
}

export function selectStudioTools(allowedToolNames?: readonly string[]) {
  if (allowedToolNames === undefined) return [...STUDIO_TOOLS];
  const allowed = new Set(allowedToolNames);
  return STUDIO_TOOLS.filter((tool) => allowed.has(tool.function.name));
}

function applyComposerGenerationOptions(
  toolName: string,
  rawInput: unknown,
  rawOptions: unknown,
): unknown {
  const options = normalizeComposerOptions(rawOptions);
  if (!options || options.mode !== "image") return rawInput;
  const generationTool =
    toolName === "generate_image" ||
    toolName === "fuse_images" ||
    toolName === "generate_ecommerce_image_set";
  const specialistTool =
    toolName === "remove_background" ||
    toolName === "upscale_image" ||
    toolName === "remove_watermark_or_subtitles";
  if (!generationTool && !specialistTool) {
    return rawInput;
  }
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }
  const toolParams = options.toolParams ?? {};
  const toolOverrides: Record<string, string | boolean> = {};
  if (options.toolId === "background-removal" && typeof toolParams.subject === "string") {
    toolOverrides.subject = toolParams.subject;
  }
  if (options.toolId === "image-clarity" && typeof toolParams.mode === "string") {
    toolOverrides.mode = toolParams.mode;
  }
  if (options.toolId === "watermark-subtitle-removal") {
    if (typeof toolParams.target === "string") toolOverrides.target = toolParams.target;
    if (toolParams.rightsConfirmed === true) toolOverrides.rightsConfirmed = true;
  }
  if (options.toolId === "ecommerce-image-set" && typeof toolParams.template === "string") {
    toolOverrides.template = toolParams.template;
  }
  return {
    ...(rawInput as Record<string, unknown>),
    ...toolOverrides,
    ...(generationTool && options.size ? { size: options.size } : {}),
    ...(toolName === "generate_image" && options.count
      ? { count: options.count }
      : {}),
  };
}

/**
 * Run one user→assistant turn with up to MAX_TOOL_ROUNDS tool rounds.
 * Yields SSE events for the chat route.
 */
export async function* runAgentTurn(
  opts: RunAgentTurnOpts,
): AsyncGenerator<AgentSseEvent, void, undefined> {
  const { userId, sessionId, sessions, artifacts, signal } = opts;
  const streamChat = opts.streamChat ?? streamGatewayChat;
  const userText = opts.userText.trim();
  if (!userText) {
    yield { type: "error", message: "消息不能为空", code: "empty_message" };
    yield { type: "done", reason: "error" };
    return;
  }

  if (signal?.aborted) {
    yield { type: "done", reason: "cancelled" };
    return;
  }

  let session = await sessions.getSession(userId, sessionId);
  if (!session) {
    yield {
      type: "error",
      message: "会话不存在",
      code: "session_not_found",
    };
    yield { type: "done", reason: "error" };
    return;
  }

  const composer = normalizeComposerOptions(opts.metadata?.composerOptions);
  const directImageModel = composer?.directImage ? composer.imageModel : undefined;
  const model =
    (typeof opts.model === "string" && opts.model.trim()) || session.model;
  if (!directImageModel && model !== session.model) {
    session = await sessions.updateSession(userId, sessionId, {
      model,
      capabilityPresetId: null,
    });
  }

  const projectId = opts.projectId ?? session.projectId;
  const project = projectId && opts.projects
    ? await opts.projects.getProject(userId, projectId)
    : null;
  if (projectId && !project) {
    yield {
      type: "error",
      message: "项目不存在或无权访问",
      code: "project_not_found",
    };
    yield { type: "done", reason: "error" };
    return;
  }

  // Repair any dangling tool_calls from a previous aborted turn
  await repairDanglingInStore(sessions, userId, sessionId, "interrupted");

  const prior = await sessions.listMessages(userId, sessionId);
  const isFirstTurn = prior.length === 0;

  const requestedIds = [
    ...(opts.referencedArtifactIds ?? []),
    ...(opts.referencedArtifactId ? [opts.referencedArtifactId] : []),
  ];
  const uniqueIds = [...new Set(requestedIds.map((id) => id.trim()).filter(Boolean))];
  const referencedArtifacts: Artifact[] = [];
  for (const id of uniqueIds) {
    try {
      const found = await artifacts.get(userId, id);
      if (found && (found.kind === "image" || found.kind === "canvas" || found.kind === "sheet") && found.status !== "failed") {
        referencedArtifacts.push(found);
      }
    } catch {
      /* ignore invalid id */
    }
  }

  // Persist turn-selected ids only on Message for audit; inject uses merged set below.
  const userMessage: Message = {
    id: randomUUID(),
    sessionId,
    role: "user",
    content: userText,
    ...(referencedArtifacts.length ? { attachmentIds: referencedArtifacts.map(({ id }) => id) } : {}),
    ...(opts.skillIds?.length ? { skillIds: opts.skillIds } : {}),
    createdAt: nowIso(),
  };

  await sessions.appendMessages(userId, sessionId, [userMessage]);

  if (isFirstTurn) {
    const title = titleFromUserText(userText);
    if (title !== session.title) {
      session = await sessions.updateSession(userId, sessionId, { title });
    }
  }

  yield { type: "session", sessionId };

  // Image models speak the Images API, not Chat Completions or tool calling.
  // Keep the normal run/session event contract so artifacts survive navigation.
  if (directImageModel || isImageGenerationModel(model)) {
    if (opts.allowedToolNames && !opts.allowedToolNames.includes("generate_image")) {
      yield { type: "error", message: "请切换到图片模式后使用此模型。", code: "image_mode_required" };
      yield { type: "done", reason: "error" };
      return;
    }
    if (directImageModel) {
      const token = await resolveStudioToken(opts.gatewayUserId ?? userId);
      const catalog = await loadCapabilityCatalog({ authToken: token });
      if (!isImageGenerationModel(directImageModel) || !catalog.models.includes(directImageModel)) {
        yield { type: "error", message: "当前账号没有可用的所选图片模型。", code: "image_model_unavailable" };
        yield { type: "done", reason: "error" };
        return;
      }
    }
    const generationModel = directImageModel ?? model;
    const messageId = randomUUID();
    const callId = randomUUID();
    const sourceIds = directImageModel ? referencedArtifacts.filter(({ kind }) => kind === "image").map(({ id }) => id) : uniqueIds;
    const input = applyComposerGenerationOptions("generate_image", {
      name: "生成图片", prompt: userText, model: generationModel, size: "1024x1024", count: 1,
      ...(sourceIds.length ? { sourceArtifactIds: sourceIds } : {}),
    }, opts.metadata?.composerOptions);
    await sessions.appendMessages(userId, sessionId, [{
      id: messageId, sessionId, role: "assistant", content: "正在提交图片生成任务。",
      toolCalls: [{ id: callId, name: "generate_image", arguments: JSON.stringify(input) }],
      metadata: { model: generationModel }, createdAt: nowIso(),
    }]);
    yield { type: "message_start", messageId };
    yield { type: "text_delta", text: "正在提交图片生成任务。" };
    yield { type: "tool_call", id: callId, name: "generate_image", input };
    const result = await executeStudioTool("generate_image", JSON.stringify(input), {
      userId, sessionId, projectId, runId: opts.runId, artifacts, messageId, userIntent: userText,
    });
    await sessions.appendMessages(userId, sessionId, [{
      id: randomUUID(), sessionId, role: "tool", toolCallId: callId,
      content: result.content, createdAt: nowIso(),
    }]);
    yield { type: "tool_result", id: callId, ok: result.ok, summary: result.ok ? "图片生成任务已提交" : result.summary };
    for (const event of result.events ?? []) yield event;
    if (!result.ok) yield { type: "error", message: result.summary, code: "image_generation_failed" };
    yield { type: "done", reason: result.ok ? "completed" : "error" };
    return;
  }

  const effectiveSkillIds = selectRuntimeSkillIds(
    [...(project?.pinnedSkillIds ?? []), ...(session.pinnedSkillIds ?? [])],
    opts.skillIds,
    opts.skillSelectionMode,
  );
  const skills = await resolveSkills(effectiveSkillIds);
  let artifactCount = 0;
  let sharedArtifactCount = 0;
  try {
    artifactCount = (await artifacts.listBySession(userId, sessionId)).length;
    if (projectId) {
      sharedArtifactCount = (await artifacts.listByProject(userId, projectId)).length;
    }
  } catch {
    /* ignore */
  }
  const reminder = buildSessionReminder(artifactCount);

  const referencedImages = referencedArtifacts.filter((artifact) => artifact.kind === "image");
  const referencedCanvases = referencedArtifacts.filter((artifact) => artifact.kind === "canvas");
  const referencedSheets = referencedArtifacts.filter((artifact) => artifact.kind === "sheet");
  const artifactReminder = buildReferencedArtifactsReminder(referencedImages);
  const canvasReminder = await buildCanvasReferenceReminder(
    referencedCanvases,
    artifacts,
    userId,
  );
  const sheetReminder = await buildSheetReferenceReminder(
    referencedSheets,
    artifacts,
    userId,
  );

  const projectReminder = buildProjectReminder(project, sharedArtifactCount);
  const combinedReminder = [
    reminder,
    projectReminder,
    artifactReminder,
    canvasReminder,
    sheetReminder,
    composerOptionsReminder(opts.metadata?.composerOptions),
  ]
    .filter(Boolean)
    .join("\n\n");
  const system = buildSystemPrompt(
    combinedReminder ? `${BASE_POLICY}\n\n${combinedReminder}` : BASE_POLICY,
    skills,
  );
  const tools = selectStudioTools(opts.allowedToolNames);
  const allowedToolNames =
    opts.allowedToolNames === undefined ? null : new Set(opts.allowedToolNames);
  /** Turn-scoped checklist shared across tool rounds (merge semantics). */
  const todoState = new TodoState();

  let history = compactMessagesForGateway(
    await sessions.listMessages(userId, sessionId),
    { sessionId },
  );
  let gatewayMessages = toGatewayMessages(system, history);

  let sawError = false;
  let cancelled = false;
  /** True when write_artifact succeeded at least once this user turn. */
  let wroteArtifact = false;
  /** Last non-empty assistant text streamed this turn (for auto-artifact fallback). */
  let lastAssistantText = "";
  let lastAssistantMessageId: string | undefined;

  const studioToken = await resolveStudioToken(opts.gatewayUserId ?? userId);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }

    // Minted up front (not at persist time) and reported immediately so the
    // client can reassign its optimistic id in place instead of remounting
    // once this message round-trips through reconciliation.
    const roundMessageId = randomUUID();
    yield { type: "message_start", messageId: roundMessageId };

    let assistantText = "";
    let thinkingText = "";
    const thinkingStartedAt = Date.now();
    let completedToolCalls: { id: string; name: string; arguments: string }[] =
      [];
    let streamError = false;

    // Live write_artifact argument stream → UI draft (avoid "stuck thinking")
    const toolArgAcc = new Map<string, { name: string; arguments: string }>();
    let lastDraftLen = 0;
    let announcedWriteTool = false;

    try {
      for await (const chunk of streamChat({
        model,
        messages: gatewayMessages,
        tools,
        token: studioToken,
        userId: opts.gatewayUserId ?? userId,
        signal,
      })) {
        if (signal?.aborted) {
          cancelled = true;
          break;
        }

        if (chunk.kind === "text") {
          assistantText += chunk.text;
          yield { type: "text_delta", text: chunk.text };
          continue;
        }

        if (chunk.kind === "thinking") {
          thinkingText += chunk.text;
          yield { type: "thinking", text: chunk.text };
          continue;
        }

        if (chunk.kind === "tool_calls") {
          completedToolCalls = chunk.calls;
          continue;
        }

        if (chunk.kind === "tool_call_delta") {
          const prev = toolArgAcc.get(chunk.id) ?? { name: "", arguments: "" };
          if (chunk.name) prev.name += chunk.name;
          if (chunk.argumentsDelta) prev.arguments += chunk.argumentsDelta;
          toolArgAcc.set(chunk.id, prev);

          const toolName = prev.name;
          if (toolName === "write_artifact" || toolName.endsWith("write_artifact")) {
            if (!announcedWriteTool) {
              announcedWriteTool = true;
              yield {
                type: "tool_call",
                id: chunk.id,
                name: "write_artifact",
                input: { streaming: true },
              };
            }
            const draft = extractPartialJsonStringField(
              prev.arguments,
              "content",
            );
            const draftName =
              extractPartialJsonStringField(prev.arguments, "name") ??
              undefined;
            if (draft != null && draft.length > lastDraftLen) {
              lastDraftLen = draft.length;
              // Unified progress + legacy artifact_draft for older clients
              yield {
                type: "tool_progress",
                id: chunk.id,
                kind: "draft",
                text: draft,
                ...(draftName ? { name: draftName } : {}),
              };
              yield {
                type: "artifact_draft",
                ...(draftName ? { name: draftName } : {}),
                text: draft,
              };
            }
          }
          continue;
        }

        if (chunk.kind === "error") {
          streamError = true;
          sawError = true;
          yield {
            type: "error",
            message: chunk.message,
            code: "gateway_error",
          };
          break;
        }
      }
    } catch (err) {
      if (
        signal?.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        cancelled = true;
      } else {
        sawError = true;
        const message =
          err instanceof Error ? err.message : "Agent turn failed unexpectedly";
        yield { type: "error", message, code: "runtime_error" };
      }
      break;
    }

    if (cancelled || streamError) break;
    if (signal?.aborted) {
      cancelled = true;
      break;
    }

    const thinkingDurationSec = thinkingText
      ? Math.max(1, Math.round((Date.now() - thinkingStartedAt) / 1_000))
      : undefined;
    const roundParts: UIMessagePart[] = [
      ...(thinkingText ? [{ type: "reasoning", text: thinkingText } as const] : []),
      ...(assistantText ? [{ type: "text", text: assistantText } as const] : []),
    ];
    const roundMetadata =
      thinkingDurationSec !== undefined
        ? { model, thinkingDurationSec }
        : { model };

    // Final text reply (no tools this round)
    if (!completedToolCalls.length) {
      if (assistantText) {
        lastAssistantText = assistantText;
        const assistantMessage: Message = {
          id: roundMessageId,
          sessionId,
          role: "assistant",
          content: assistantText,
          ...(roundParts.length ? { parts: roundParts } : {}),
          metadata: roundMetadata,
          createdAt: nowIso(),
        };
        lastAssistantMessageId = assistantMessage.id;
        await sessions.appendMessages(userId, sessionId, [assistantMessage]);
      } else if (round === 0) {
        // Empty stream with no tools — still complete without persisting empty msg
      }
      break;
    }

    // Persist assistant message that requested tools (may include intermediate text)
    const assistantId = roundMessageId;
    if (assistantText) {
      lastAssistantText = assistantText;
      lastAssistantMessageId = assistantId;
    }
    const toolCallRecords: ToolCallRecord[] = completedToolCalls.map((c) => ({
      id: c.id,
      name: c.name,
      arguments: c.arguments,
    }));

    await sessions.appendMessages(userId, sessionId, [
      {
        id: assistantId,
        sessionId,
        role: "assistant",
        content: assistantText,
        toolCalls: toolCallRecords,
        ...(roundParts.length ? { parts: roundParts } : {}),
        metadata: roundMetadata,
        createdAt: nowIso(),
      },
    ]);

    // Announce all tool calls first (UI), then run independent tools in parallel
    type CallResult = {
      call: (typeof completedToolCalls)[number];
      parsedInput: unknown;
      result: Awaited<ReturnType<typeof executeStudioTool>>;
    };

    for (const call of completedToolCalls) {
      let parsedInput: unknown = {};
      try {
        parsedInput = call.arguments?.trim()
          ? (JSON.parse(call.arguments) as unknown)
          : {};
      } catch {
        parsedInput = { _raw: call.arguments };
      }
      parsedInput = applyComposerGenerationOptions(
        call.name,
        parsedInput,
        opts.metadata?.composerOptions,
      );
      yield {
        type: "tool_call",
        id: call.id,
        name: call.name,
        input: parsedInput,
      };
    }

    if (signal?.aborted) {
      cancelled = true;
      // Repair: assistant tool_calls already persisted, no results yet
      const dangling = completedToolCalls.map((c) => ({
        id: c.id,
        name: c.name,
      }));
      if (dangling.length) {
        await sessions.appendMessages(
          userId,
          sessionId,
          buildRepairToolMessages(sessionId, dangling, "cancelled"),
        );
      }
      break;
    }

    // Codex-style: only mark tools that are safe to parallelize.
    // write_artifact / todo_write stay serial (shared stores); reads can parallel.
    const canParallel = (name: string) =>
      name === "read_artifact" || name === "list_artifacts";

    const runOne = async (
      call: (typeof completedToolCalls)[number],
    ): Promise<CallResult> => {
      let parsedInput: unknown = {};
      try {
        parsedInput = call.arguments?.trim()
          ? (JSON.parse(call.arguments) as unknown)
          : {};
      } catch {
        parsedInput = { _raw: call.arguments };
      }
      parsedInput = applyComposerGenerationOptions(
        call.name,
        parsedInput,
        opts.metadata?.composerOptions,
      );
      if (allowedToolNames && !allowedToolNames.has(call.name)) {
        const message = `Tool is not allowed for this Run: ${call.name}`;
        return {
          call,
          parsedInput,
          result: { ok: false, summary: message, content: message },
        };
      }
      if (call.name === "generate_image") {
        const catalog = await loadCapabilityCatalog({ authToken: studioToken });
        const imageModels = catalog.models.filter(isImageGenerationModel);
        const preferred = normalizeComposerOptions(opts.metadata?.composerOptions)?.imageModel;
        const args = parsedInput && typeof parsedInput === "object" ? parsedInput as Record<string, unknown> : {};
        const selected = preferred ?? (typeof args.model === "string" && imageModels.includes(args.model) ? args.model : imageModels[0]);
        if (!selected || !imageModels.includes(selected)) {
          return { call, parsedInput, result: { ok: false, summary: "当前账户没有可用的所选图片模型，请在高级设置中重新选择。", content: "Selected image model is unavailable. Do not claim an image was generated." } };
        }
        parsedInput = { ...args, model: selected };
      }
      const result = await executeStudioTool(
        call.name,
        JSON.stringify(parsedInput),
        {
          userId,
          sessionId,
          ...(projectId ? { projectId } : {}),
          ...(opts.runId ? { runId: opts.runId } : {}),
          artifacts,
          ...(opts.toolJobs ? { toolJobs: opts.toolJobs } : {}),
          messageId: assistantId,
          todoState,
          userIntent: opts.userText,
        },
      );
      return { call, parsedInput, result };
    };

    const settled: CallResult[] = [];
    let i = 0;
    while (i < completedToolCalls.length) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      const call = completedToolCalls[i]!;
      if (canParallel(call.name)) {
        const batch: typeof completedToolCalls = [];
        while (
          i < completedToolCalls.length &&
          canParallel(completedToolCalls[i]!.name)
        ) {
          batch.push(completedToolCalls[i]!);
          i += 1;
        }
        settled.push(...(await Promise.all(batch.map(runOne))));
      } else {
        settled.push(await runOne(call));
        i += 1;
      }
    }

    if (signal?.aborted) {
      cancelled = true;
    }

    const toolMessages: Message[] = [];
    for (const { call, result } of settled) {
      if (call.name === "write_artifact" && result.ok) {
        wroteArtifact = true;
      }

      yield {
        type: "tool_result",
        id: call.id,
        ok: result.ok,
        summary: result.summary,
      };

      if (result.events?.length) {
        for (const ev of result.events) {
          yield ev;
        }
      }

      toolMessages.push({
        id: randomUUID(),
        sessionId,
        role: "tool",
        content: result.content,
        toolCallId: call.id,
        createdAt: nowIso(),
      });
    }

    if (toolMessages.length) {
      await sessions.appendMessages(userId, sessionId, toolMessages);
    }

    if (cancelled) break;

    // Continue next gateway round with tool results in history
    history = compactMessagesForGateway(
      await sessions.listMessages(userId, sessionId),
      { sessionId },
    );
    gatewayMessages = toGatewayMessages(system, history);
  }

  if (signal?.aborted) cancelled = true;

  // Ensure no dangling tool_calls remain after cancel mid-turn
  if (cancelled) {
    await repairDanglingInStore(sessions, userId, sessionId, "cancelled");
  }

  // Workbench guarantee: long / structured deliverables become artifacts even if
  // the model only replied in chat (common with gpt-* when tool use is ignored).
  if (
    !cancelled &&
    !sawError &&
    !wroteArtifact &&
    lastAssistantText
  ) {
    if (shouldAutoPersistArtifact(userText, lastAssistantText)) {
      try {
        const name = artifactNameFromTurn(userText, lastAssistantText);
        const kind = inferArtifactKind(lastAssistantText);
        const id = randomUUID();
        const createdAt = nowIso();
        const artifact = await artifacts.write(
          {
            id,
            userId,
            sessionId,
            ...(projectId ? { projectId } : {}),
            ...(lastAssistantMessageId
              ? { messageId: lastAssistantMessageId }
              : {}),
            name,
            kind,
            mimeType: mimeTypeForKind(kind),
            storageKey: "",
            createdAt,
          },
          lastAssistantText,
        );
        wroteArtifact = true;
        yield {
          type: "artifact",
          artifactId: artifact.id,
          name: artifact.name,
          kind: artifact.kind,
        };
        // Brief system note in the stream so UI can show "已归档为作品"
        yield {
          type: "text_delta",
          text: `\n\n——\n已自动保存为作品「${artifact.name}」，可在右侧预览与导出。`,
        };
        // Persist the note on the assistant message when possible
        if (lastAssistantMessageId) {
          const msgs = await sessions.listMessages(userId, sessionId);
          const target = msgs.find((m) => m.id === lastAssistantMessageId);
          if (target && target.role === "assistant") {
            // Session store may not support patch — append a light system line as new message
            await sessions.appendMessages(userId, sessionId, [
              {
                id: randomUUID(),
                sessionId,
                role: "system",
                content: `已自动保存为作品「${artifact.name}」（id=${artifact.id}）`,
                createdAt: nowIso(),
              },
            ]);
          }
        }
      } catch {
        // Auto-artifact must never fail the turn
      }
    }
  }

  if (cancelled) {
    yield { type: "done", reason: "cancelled" };
  } else if (sawError) {
    yield { type: "done", reason: "error" };
  } else {
    yield { type: "done", reason: "completed" };
  }
}
