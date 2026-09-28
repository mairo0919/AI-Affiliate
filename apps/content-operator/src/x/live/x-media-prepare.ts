/**
 * Prepare article-pipeline image bytes for X v2 media upload.
 * Resize/scale only when over X image size limit — never crop/composite.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** X documented image attachment size cap. */
export const X_IMAGE_MAX_BYTES = 5_000_000;

export type PreparedXImage = {
  bytes: Buffer;
  mimeType: string;
  sourceUrl: string;
  scaled: boolean;
};

function sniffMime(bytes: Buffer, fallback: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return fallback.split(";")[0]?.trim() || "image/jpeg";
}

/**
 * Proportional downscale via macOS `sips` when available; otherwise leave as-is
 * (caller may fail on size). Never crops.
 */
function scaleDownWithSips(bytes: Buffer, mimeType: string): Buffer | null {
  if (process.platform !== "darwin") return null;
  const dir = mkdtempSync(join(tmpdir(), "x-media-"));
  const ext =
    mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const input = join(dir, `in.${ext}`);
  const output = join(dir, `out.${ext}`);
  try {
    writeFileSync(input, bytes);
    // Max edge 4096 keeps aspect ratio (sips -Z).
    const result = spawnSync(
      "sips",
      ["-Z", "4096", input, "--out", output],
      { encoding: "utf8" },
    );
    if (result.status !== 0) return null;
    const out = readFileSync(output);
    return out.length > 0 && out.length < bytes.length ? out : null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function prepareArticleImageForXUpload(input: {
  sourceUrl: string;
  bytes?: Uint8Array;
  mimeType?: string;
  fetchImpl?: typeof fetch;
}): Promise<PreparedXImage> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let bytes: Buffer;
  let headerMime = input.mimeType ?? "image/jpeg";

  if (input.bytes) {
    bytes = Buffer.from(input.bytes);
  } else {
    const response = await fetchImpl(input.sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch media source status=${response.status}`);
    }
    headerMime = response.headers.get("content-type") ?? headerMime;
    bytes = Buffer.from(await response.arrayBuffer());
  }

  const mimeType = sniffMime(bytes, headerMime);
  let scaled = false;

  if (bytes.length > X_IMAGE_MAX_BYTES) {
    const scaledBytes = scaleDownWithSips(bytes, mimeType);
    if (scaledBytes && scaledBytes.length <= X_IMAGE_MAX_BYTES) {
      bytes = scaledBytes;
      scaled = true;
    } else if (bytes.length > X_IMAGE_MAX_BYTES) {
      throw new Error(
        `Image exceeds X ${X_IMAGE_MAX_BYTES} byte limit after scale attempt`,
      );
    }
  }

  return {
    bytes,
    mimeType,
    sourceUrl: input.sourceUrl,
    scaled,
  };
}
