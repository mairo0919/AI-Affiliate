/**
 * X media from existing article image pipeline (structuredContent.images).
 *
 * SSOT path (same as WordPress):
 *   FANZA → ResearchImage → resolution/rights → structuredContent.images → WP
 *
 * X reuses those resolved URLs. No X-specific FANZA fetch, no external search,
 * no crop/composite — attach URL reference only (scale/resize at upload time if needed).
 */

import {
  parseArticleImages,
  type ArticleImage,
} from "../generation/article-images.js";

export const X_ARTICLE_MEDIA_POLICY_VERSION = "x-article-media-v1";

export type XArticleMediaCandidate = {
  role: "hero" | "auxiliary";
  sourceUrl: string;
  imageType: string;
  researchImageId: string | null;
  usageStatus: string;
  adopted: boolean;
  excludeReason: string | null;
};

export type XArticleMediaPick = {
  decision: "SAFE_IMAGE" | "TEXT_ONLY";
  reason: string;
  selectedUrl: string | null;
  selectedRole: "hero" | "auxiliary" | null;
  selectedImageType: string | null;
  researchImageId: string | null;
  candidates: XArticleMediaCandidate[];
};

/**
 * Prefer WP hero, then WP sample (auxiliary). Else TEXT_ONLY.
 * Only ALLOWED images that already passed article resolution/rights.
 */
export function selectXMediaFromArticleImages(input: {
  articleImages?: ArticleImage[] | unknown | null;
}): XArticleMediaPick {
  const images = Array.isArray(input.articleImages)
    ? input.articleImages.every(
        (x) => x && typeof x === "object" && "sourceUrl" in (x as object),
      )
      ? (input.articleImages as ArticleImage[]).filter(
          (i) => typeof i.sourceUrl === "string" && i.sourceUrl.trim().length > 0,
        )
      : parseArticleImages(input.articleImages)
    : parseArticleImages(input.articleImages);

  const allowed = images.filter((i) => i.usageStatus === "ALLOWED");
  const hero = allowed.find((i) => i.role === "hero") ?? null;
  const samples = allowed.filter((i) => i.role === "auxiliary");
  const pick = hero ?? samples[0] ?? null;

  const candidates: XArticleMediaCandidate[] = images.map((img) => {
    const isPick =
      pick != null && img.sourceUrl === pick.sourceUrl && img.role === pick.role;
    let excludeReason: string | null = null;
    if (img.usageStatus !== "ALLOWED") excludeReason = `usage_${img.usageStatus}`;
    else if (!isPick && pick) {
      excludeReason = pick.role === "hero" ? "hero_preferred" : "not_selected";
    } else if (!pick) excludeReason = "none_allowed";
    return {
      role: img.role,
      sourceUrl: img.sourceUrl,
      imageType: img.imageType,
      researchImageId: img.researchImageId,
      usageStatus: img.usageStatus,
      adopted: Boolean(isPick),
      excludeReason: isPick ? null : excludeReason,
    };
  });

  if (!pick) {
    return {
      decision: "TEXT_ONLY",
      reason:
        images.length === 0
          ? "no_structuredContent_images"
          : "no_ALLOWED_article_images",
      selectedUrl: null,
      selectedRole: null,
      selectedImageType: null,
      researchImageId: null,
      candidates,
    };
  }

  return {
    decision: "SAFE_IMAGE",
    reason: pick.role === "hero" ? "article_hero" : "article_sample",
    selectedUrl: pick.sourceUrl,
    selectedRole: pick.role,
    selectedImageType: pick.imageType,
    researchImageId: pick.researchImageId,
    candidates,
  };
}
