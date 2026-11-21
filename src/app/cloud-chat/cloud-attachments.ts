import type { Artifact } from "@/lib/agent/types";
import { isSpreadsheetFile, MAX_SHEET_UPLOAD_BYTES } from "@/lib/agent/sheet-file";
import { uploadImageArtifact, uploadSheetArtifact } from "@/lib/studio/api";
import {
  fileToImageAttachment, isLikelyTextFile, MAX_IMAGE_BYTES, MAX_TEXT_FILE_BYTES,
} from "@/lib/studio/composer-attachments";
import { isStudioToolImageMimeType } from "@/lib/studio/tool-catalog";

export const CLOUD_ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp,.xlsx,.txt,.md,.csv,.json,.xml,.yaml,.yml,.log";
export const MAX_CLOUD_ATTACHMENTS = 4;

export type CloudAttachment = {
  id: string;
  file: File;
  kind: "image" | "sheet" | "text";
  artifact?: Artifact;
};

export function toCloudAttachment(file: File): CloudAttachment {
  const extension = /\.(png|jpe?g|webp)$/i.exec(file.name)?.[1].toLowerCase();
  const imageType = extension ? `image/${extension === "jpg" ? "jpeg" : extension}` : undefined;
  const isImage = isStudioToolImageMimeType(file.type) || Boolean(imageType);
  const kind = isImage ? "image" : isSpreadsheetFile(file) ? "sheet" : isLikelyTextFile(file) ? "text" : null;
  if (!kind) throw new Error("请选择 PNG、JPEG、WebP、XLSX 或文本文件。");
  if (!file.size) throw new Error("附件为空。");
  const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : kind === "sheet" ? MAX_SHEET_UPLOAD_BYTES : MAX_TEXT_FILE_BYTES;
  if (file.size > maxBytes) throw new Error(`附件超过 ${maxBytes / 1024} KB 上限。`);
  const normalized = kind === "image" && imageType && !isStudioToolImageMimeType(file.type)
    ? new File([file], file.name, { type: imageType }) : file;
  return { id: crypto.randomUUID(), file: normalized, kind };
}

export async function uploadCloudAttachment(sessionId: string, item: CloudAttachment): Promise<Artifact | undefined> {
  if (item.artifact) return item.artifact;
  if (item.kind === "image") {
    const image = await fileToImageAttachment(item.file);
    return uploadImageArtifact({ sessionId, name: image.name, dataUrl: image.dataUrl });
  }
  if (item.kind === "sheet") return uploadSheetArtifact({ sessionId, file: item.file });
}
