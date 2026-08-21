import type { EligibilityStatus } from "@ai-affiliate/database";
import type { AnalysisContext } from "./types.js";
import { ELIGIBILITY_VERSION } from "./types.js";

export interface EligibilityResult {
  status: EligibilityStatus;
  reasons: string[];
  version: string;
}

export function evaluateEligibility(context: AnalysisContext): EligibilityResult {
  const reasons: string[] = [];
  const item = context.item;

  if (!item.externalId || item.externalId.trim() === "") {
    reasons.push("MISSING_EXTERNAL_ID");
  }
  if (!item.title || item.title.trim() === "") {
    reasons.push("MISSING_TITLE");
  }
  if (!item.url || item.url.trim() === "") {
    reasons.push("MISSING_AFFILIATE_URL");
  }

  const images = item.images ?? [];
  const hasAllowed = images.some((image) => image.usageStatus === "ALLOWED");
  const hasConfirm = images.some(
    (image) =>
      image.usageStatus === "REQUIRES_CONFIRMATION" || image.usageStatus === "UNKNOWN",
  );
  const onlyNotAllowed =
    images.length > 0 && images.every((image) => image.usageStatus === "NOT_ALLOWED");
  const noImages = images.length === 0;

  if (onlyNotAllowed) {
    reasons.push("NO_USABLE_IMAGE");
  }

  const hasPublicMeta =
    Boolean(item.publishedAt) ||
    context.tagsByType.size > 0 ||
    context.metricsByType.has("price") ||
    context.metricsByType.has("reviewCount");

  if (!hasPublicMeta && reasons.length === 0) {
    reasons.push("INSUFFICIENT_PUBLIC_METADATA");
  }

  // Hard NOT_ELIGIBLE
  if (
    reasons.includes("MISSING_EXTERNAL_ID") ||
    reasons.includes("MISSING_TITLE") ||
    reasons.includes("MISSING_AFFILIATE_URL") ||
    reasons.includes("NO_USABLE_IMAGE")
  ) {
    return { status: "NOT_ELIGIBLE", reasons, version: ELIGIBILITY_VERSION };
  }

  if (noImages || (!hasAllowed && hasConfirm)) {
    if (!hasAllowed) {
      reasons.push("IMAGE_USAGE_REQUIRES_CONFIRMATION");
    }
    return { status: "REQUIRES_CONFIRMATION", reasons, version: ELIGIBILITY_VERSION };
  }

  if (!hasAllowed) {
    reasons.push("NO_USABLE_IMAGE");
    return { status: "NOT_ELIGIBLE", reasons, version: ELIGIBILITY_VERSION };
  }

  return { status: "ELIGIBLE", reasons: [], version: ELIGIBILITY_VERSION };
}
