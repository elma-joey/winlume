import type { CapabilityPresetId } from "./capability-presets";

export const COMPOSER_MODES = [
  "chat",
  "image",
  "video",
  "canvas",
  "sheet",
] as const;

export type ComposerMode = (typeof COMPOSER_MODES)[number];

export const IMAGE_SIZE_OPTIONS = [
  { value: "1024x1024", label: "方图 · 1024" },
  { value: "1536x1024", label: "横图 · 1536×1024" },
  { value: "1024x1536", label: "竖图 · 1024×1536" },
] as const;

export type ImageSize = (typeof IMAGE_SIZE_OPTIONS)[number]["value"];

export type ComposerOptions = {
  mode: ComposerMode;
  size?: ImageSize;
  count?: 1 | 2 | 3 | 4;
  imageModel?: string;
  directImage?: true;
  toolId?: string;
  toolParams?: Record<string, string | boolean>;
};

const BASE_AGENT_TOOLS = [
  "todo_write",
  "write_artifact",
  "read_artifact",
  "list_artifacts",
] as const;

const MODE_PRESETS: Record<Exclude<ComposerMode, "chat">, CapabilityPresetId> = {
  image: "image-default",
  video: "video-default",
  canvas: "canvas-default",
  sheet: "sheet-default",
};

export function modeForCapabilityPreset(
  presetId: string | null | undefined,
): ComposerMode {
  switch (presetId) {
    case "image-default":
      return "image";
    case "video-default":
      return "video";
    case "canvas-default":
      return "canvas";
    case "sheet-default":
      return "sheet";
    default:
      return "chat";
  }
}

export function capabilityPresetForMode(
  mode: ComposerMode,
): CapabilityPresetId | null {
  return mode === "chat" ? null : MODE_PRESETS[mode];
}

export function normalizeComposerOptions(raw: unknown): ComposerOptions | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!COMPOSER_MODES.includes(value.mode as ComposerMode)) return null;
  const mode = value.mode as ComposerMode;
  const size = IMAGE_SIZE_OPTIONS.some((option) => option.value === value.size)
    ? (value.size as ImageSize)
    : undefined;
  const count =
    typeof value.count === "number" && Number.isInteger(value.count) && value.count >= 1 && value.count <= 4
      ? (value.count as ComposerOptions["count"])
      : undefined;
  const toolId =
    typeof value.toolId === "string" && value.toolId.trim().length <= 80
      ? value.toolId.trim() || undefined
      : undefined;
  const rawParams = value.toolParams;
  const toolParams: Record<string, string | boolean> = {};
  if (rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)) {
    for (const [key, param] of Object.entries(rawParams)) {
      if (
        key.length <= 80 &&
        ((typeof param === "string" && param.length <= 400) || typeof param === "boolean")
      ) {
        toolParams[key] = param;
      }
    }
  }

  return {
    mode,
    ...(typeof value.imageModel === "string" && value.imageModel.trim() && value.imageModel.length <= 100 ? { imageModel: value.imageModel.trim() } : {}),
    ...(mode === "image" && value.directImage === true ? { directImage: true as const } : {}),
    ...(mode === "image" && size ? { size } : {}),
    ...(mode === "image" && count ? { count } : {}),
    ...(toolId ? { toolId } : {}),
    ...(Object.keys(toolParams).length ? { toolParams } : {}),
  };
}

/** Runtime allowlist for a turn-scoped Composer mode. Chat keeps legacy behavior. */
export function toolNamesForComposerMode(
  mode: ComposerMode,
): readonly string[] | undefined {
  switch (mode) {
    case "image":
      return [
        ...BASE_AGENT_TOOLS,
        "generate_image",
        "fuse_images",
        "generate_ecommerce_image_set",
        "remove_background",
        "upscale_image",
        "remove_watermark_or_subtitles",
      ];
    case "canvas":
      return [...BASE_AGENT_TOOLS, "generate_canvas"];
    case "sheet":
      return [...BASE_AGENT_TOOLS, "generate_sheet"];
    case "video":
      return [...BASE_AGENT_TOOLS];
    default:
      return undefined;
  }
}

export function composerOptionsReminder(raw: unknown): string | null {
  const options = normalizeComposerOptions(raw);
  if (!options || options.mode === "chat") return null;

  if (options.mode === "video") {
    return "<system-reminder>视频生成模式已选择，但当前服务端尚未接入视频生成工具。请明确告知用户当前不可用，不要假装创建视频。</system-reminder>";
  }

  const lines = [
    "<system-reminder>",
    `本轮 Composer 模式：${options.mode === "image" ? "图片创作" : options.mode === "canvas" ? "可编辑画布" : "可编辑表格"}。`,
  ];
  if (options.mode === "image") {
    lines.push(
      `调用图片工具时使用输出尺寸 ${options.size ?? "1024x1024"}，生成数量 ${options.count ?? 1}。`,
      "这些是本轮用户明确选择的参数；不要自行改成其他尺寸或数量。",
    );
  }
  lines.push("只调用当前模式允许的工具；不要把结果声称为已经完成的文件。", "</system-reminder>");
  return lines.join("\n");
}
