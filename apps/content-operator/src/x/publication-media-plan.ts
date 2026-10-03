import { officialFanzaMediaHost } from "../adapters/affiliate/fanza-affiliate-provider.js";
import { selectXMediaFromArticleImages } from "./x-article-media.js";
import { XPublishError } from "./types.js";

export function officialMediaMatchesCanonicalCid(url: string, cid: string): boolean {
  const id = cid.trim().toLowerCase();
  if (!id || !officialFanzaMediaHost(url)) return false;
  try {
    return new URL(url).pathname.toLowerCase().includes(`/${id}/`);
  } catch {
    return false;
  }
}

/**
 * Snapshot media URL wins. When an old TEXT_ONLY snapshot stored no URL,
 * ALLOWED article/research images recovered at publish time are used.
 * A real absence of official images stays text-only.
 */
export function resolveRootMediaUrl(input: {
  snapshotUrl: string | null;
  fallbackImages?: unknown;
  expectedCid?: string | null;
}): string | null {
  const cid = input.expectedCid?.trim().toLowerCase() ?? "";
  const accept = (url: string) => !cid || officialMediaMatchesCanonicalCid(url, cid);
  const snapshot = input.snapshotUrl?.trim() ?? "";
  if (snapshot && accept(snapshot)) return snapshot;
  const pick = selectXMediaFromArticleImages({ articleImages: input.fallbackImages });
  if (pick.decision === "SAFE_IMAGE" && pick.selectedUrl?.trim() && accept(pick.selectedUrl)) {
    return pick.selectedUrl.trim();
  }
  return null;
}

/**
 * ROOT is the only post that may carry a product image.
 * When a media URL was resolved, publishing text-only is refused.
 * CTA and replies always return no mediaIds, even if a URL is supplied.
 */
export function planPostMediaIds(input: {
  isRoot: boolean;
  mediaUrl: string | null;
  uploadedMediaId: string | null;
}): string[] | undefined {
  if (!input.isRoot) return undefined;
  const mediaUrl = input.mediaUrl?.trim() ?? "";
  if (!mediaUrl) return undefined;
  const mediaId = input.uploadedMediaId?.trim() ?? "";
  if (!mediaId) {
    throw new XPublishError(
      "product image available but ROOT mediaIds is empty — refusing text-only ROOT",
      "Configuration",
      { retryable: false },
    );
  }
  return [mediaId];
}
