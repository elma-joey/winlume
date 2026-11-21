import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { getCurrentUserId } from "@/lib/auth/session";
import { webStore } from "@/lib/host/web/store-singleton";

type IdContext = { params: Promise<{ id: string }> };

const imageExtensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  "image/gif": "gif", "image/bmp": "bmp", "image/avif": "avif", "image/heic": "heic",
};

function imageDownloadDisposition(name: string, mimeType: string): string {
  const extension = imageExtensions[mimeType.toLowerCase()] ?? "bin";
  const base = Array.from(name.toWellFormed().replace(/[\r\n<>:"/\\|?*]/g, "-").trim())
    .slice(0, 60).join("").replace(/\.(?:png|jpe?g|webp|gif|bmp|avif|heic)$/i, "");
  const encoded = encodeURIComponent(`${base || "reizo-image"}.${extension}`)
    .replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="reizo-image.${extension}"; filename*=UTF-8''${encoded}`;
}

/**
 * GET /api/artifacts/[id]/raw — raw bytes with the artifact's real
 * mimeType, for direct use as an <img src> (or any binary download).
 */
export async function GET(request: NextRequest, context: IdContext) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Missing artifact id" }, { status: 400 });
  }

  const artifact = await webStore.artifacts.get(userId, id);
  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }
  const download = request.nextUrl.searchParams.get("download") === "1";
  if (download && artifact.kind !== "image") {
    return NextResponse.json({ error: "Image artifact not found" }, { status: 404 });
  }

  const size = await webStore.artifacts.contentSize(userId, id);
  if (size === null || size === 0) {
    return NextResponse.json({ error: "Artifact content not ready" }, { status: 404 });
  }

  const range = artifact.kind === "video" ? request.headers.get("range") : null;
  let start = 0;
  let end = size - 1;
  let partial = false;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
    if (!match) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const requestedStart = match[1] ? Number(match[1]) : undefined;
    const requestedEnd = match[2] ? Number(match[2]) : undefined;
    if (
      (requestedStart !== undefined && (!Number.isInteger(requestedStart) || requestedStart < 0)) ||
      (requestedEnd !== undefined && (!Number.isInteger(requestedEnd) || requestedEnd < 0))
    ) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    if (requestedStart === undefined && requestedEnd !== undefined) {
      start = Math.max(0, size - requestedEnd);
    } else {
      start = requestedStart ?? 0;
      end = Math.min(size - 1, requestedEnd ?? size - 1);
    }
    if (start >= size || end < start) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    partial = true;
  }
  const stream = await webStore.artifacts.createReadStream(userId, id, { start, end });
  if (!stream) return NextResponse.json({ error: "Artifact content not ready" }, { status: 404 });
  const contentLength = end - start + 1;

  return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: partial ? 206 : 200,
    headers: {
      "Content-Type": artifact.mimeType || "application/octet-stream",
      "Cache-Control": download ? "private, no-store" : "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": download ? imageDownloadDisposition(artifact.name, artifact.mimeType) : "inline",
      "Content-Length": String(contentLength),
      ...(artifact.kind === "video" ? { "Accept-Ranges": "bytes" } : {}),
      ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}
