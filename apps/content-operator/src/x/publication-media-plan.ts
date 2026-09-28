import { XPublishError } from "./types.js";

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
