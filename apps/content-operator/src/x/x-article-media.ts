/**
 * X media from existing article image pipeline (structuredContent.images).
 *
 * SSOT path (same as WordPress):
 *   FANZA → ResearchImage → resolution/rights → structuredContent.images → WP
 *
 * X reuses those resolved URLs. No X-specific FANZA fetch, no external search,
 * no crop/composite — attach URL reference only (scale/resize at upload time if needed).
 *
 * Selection for X (not WP hero-first):
 * prefer comparatively modest package/sample candidates among ALLOWED images.
 */

import {
  parseArticleImages,
  type ArticleImage,
} from "../generation/article-images.js";

export const X_ARTICLE_MEDIA_POLICY_VERSION = "x-article-media-v2";

export type XArticleMediaCandidate = {
  role: "hero" | "auxiliary";
  sourceUrl: string;
  imageType: string;
  researchImageId: string | null;
  usageStatus: string;
  adopted: boolean;
  excludeReason: string | null;
  /** Lower = preferred for X timeline (proxy for lower explicitness). */
  exposureProxyScore?: number;
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

const DISALLOWED_TYPE_RE =
  /performer.?list|actress.?list|actor.?list|face.?list|banner|bnr|campaign/i;

/**
 * Deterministic exposure proxy (no vision model).
 * Lower score = preferred for X timeline.
 * Prefer auxiliary samples over package/hero covers when both ALLOWED.
 */
export function exposureProxyScoreForX(img: {
  role: string;
  imageType: string;
  sourceUrl: string;
}): number | null {
  const type = (img.imageType ?? "").toLowerCase();
  const url = (img.sourceUrl ?? "").toLowerCase();
  if (DISALLOWED_TYPE_RE.test(type) || DISALLOWED_TYPE_RE.test(url)) {
    return null;
  }
  if (/banner|\/bnr\/|_bnr_/i.test(url)) return null;

  let score = 50;
  if (img.role === "hero") score += 25;
  if (img.role === "auxiliary") score -= 10;

  if (type.includes("sample_small") || /js-\d+/i.test(url)) score -= 15;
  else if (type.includes("sample_large") || /jp-\d+/i.test(url)) score -= 5;
  else if (type.includes("main_list") || /pl\.(jpg|webp)/i.test(url)) score += 20;
  else if (type.includes("main_large") || /ps\.(jpg|webp)/i.test(url)) score += 15;
  else if (type.includes("package") || type.includes("page_og")) score += 18;
  else if (type.includes("page_reference")) score += 5;

  // Earlier sample index often used as milder key art in article pipelines.
  const sampleIdx = url.match(/jp-(\d+)/i)?.[1] ?? url.match(/js-(\d+)/i)?.[1];
  if (sampleIdx) {
    const n = Number.parseInt(sampleIdx, 10);
    if (Number.isFinite(n)) score += Math.min(n, 8);
  }

  return score;
}

/**
 * Prefer comparatively modest ALLOWED article images for X.
 * Hero is not auto-preferred. performer-list / banner excluded.
 * Else TEXT_ONLY.
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

  const scored = images.map((img) => {
    const usageOk = img.usageStatus === "ALLOWED";
    const exposure = usageOk
      ? exposureProxyScoreForX({
          role: img.role,
          imageType: img.imageType,
          sourceUrl: img.sourceUrl,
        })
      : null;
    return { img, exposure, usageOk };
  });

  const eligible = scored
    .filter((s) => s.usageOk && s.exposure != null)
    .sort((a, b) => (a.exposure! - b.exposure!) || a.img.sourceUrl.localeCompare(b.img.sourceUrl));
  const pick = eligible[0]?.img ?? null;
  const pickExposure = eligible[0]?.exposure ?? null;

  const candidates: XArticleMediaCandidate[] = scored.map(({ img, exposure, usageOk }) => {
    const isPick =
      pick != null && img.sourceUrl === pick.sourceUrl && img.role === pick.role;
    let excludeReason: string | null = null;
    if (!usageOk) excludeReason = `usage_${img.usageStatus}`;
    else if (exposure == null) excludeReason = "disallowed_type_or_banner_or_performer_list";
    else if (!isPick && pick) {
      excludeReason =
        pick.role === "auxiliary" && img.role === "hero"
          ? "prefer_less_explicit_sample_over_hero"
          : "higher_exposure_proxy";
    } else if (!pick) excludeReason = "none_allowed";
    return {
      role: img.role,
      sourceUrl: img.sourceUrl,
      imageType: img.imageType,
      researchImageId: img.researchImageId,
      usageStatus: img.usageStatus,
      adopted: Boolean(isPick),
      excludeReason: isPick ? null : excludeReason,
      exposureProxyScore: exposure ?? undefined,
    };
  });

  if (!pick) {
    return {
      decision: "TEXT_ONLY",
      reason:
        images.length === 0
          ? "no_structuredContent_images"
          : "no_allowed_modest_article_images",
      selectedUrl: null,
      selectedRole: null,
      selectedImageType: null,
      researchImageId: null,
      candidates,
    };
  }

  const reason =
    pick.role === "auxiliary"
      ? "prefer_less_explicit_sample"
      : pickExposure != null && images.some((i) => i.role === "auxiliary")
        ? "hero_only_allowed_modest"
        : "article_package_modest_fallback";

  return {
    decision: "SAFE_IMAGE",
    reason,
    selectedUrl: pick.sourceUrl,
    selectedRole: pick.role,
    selectedImageType: pick.imageType,
    researchImageId: pick.researchImageId,
    candidates,
  };
}
