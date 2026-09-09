/**
 * FANZA official video sample rights for X_SOCIAL_MEDIA (material eligibility).
 *
 * Separates:
 * - material rights (sample is an affiliate-usable FANZA video image type)
 * - site approval (X account listed/approved on DMM/FANZA affiliate side)
 *
 * Does NOT upgrade WordPress ARTICLE_IMAGE usageStatus SSOT.
 * Does NOT treat "terms unverified" alone as a hard block for official samples on X.
 * Does NOT invent FANZA_X_SITE_APPROVED=true.
 */

import { imageContentKey, isTrustedDmmImageUrl } from "../generation/article-images.js";

export const FANZA_X_SAMPLE_TRANSFORM_POLICY = {
  version: "fanza-x-sample-transform-v1",
  allowed: ["resize", "scale"] as const,
  prohibited: [
    "crop",
    "composite",
    "text_overlay",
    "black_out",
    "masking",
    "ai_modification",
  ] as const,
  note: "Only resize/scale of the original official sample; never alter content.",
} as const;

export type FanzaXMaterialRightsStatus = "ELIGIBLE" | "NOT_ELIGIBLE";

export type EvaluateFanzaOfficialSampleMaterialRightsInput = {
  sourceUrl: string;
  imageType?: string | null;
  /** Legacy ResearchImage.usageStatus — RC alone is not a material block for X samples. */
  storedUsageStatus?: string | null;
  sourceKind?: string | null;
  productCanonicalId?: string | null;
  /** Provider hint: fanza | dmm | unknown */
  provider?: string | null;
  /** Service/floor hint e.g. digital/videoa */
  fanzaService?: string | null;
  fanzaFloor?: string | null;
};

export type FanzaOfficialSampleMaterialRights = {
  status: FanzaXMaterialRightsStatus;
  reason: string;
  providerOk: boolean;
  categoryOk: boolean;
  sourceKindOk: boolean;
  officialTraceOk: boolean;
  notPerformerListFace: boolean;
  notBanner: boolean;
  notProhibited: boolean;
  transformPolicy: typeof FANZA_X_SAMPLE_TRANSFORM_POLICY;
};

function isPerformerListFaceImage(input: {
  sourceUrl: string;
  imageType?: string | null;
}): boolean {
  const t = (input.imageType ?? "").toLowerCase();
  if (/performer|actress.?face|cast.?face|face.?list|actor.?list/.test(t)) return true;
  const path = input.sourceUrl.toLowerCase();
  // Common DMM performer-list / face thumb patterns (not jp-N samples)
  if (/\/mono\/actjpgs?\//.test(path) || /\/actress\//.test(path)) return true;
  if (/face[-_]?thumb|performer[-_]?list/.test(path)) return true;
  return false;
}

function isBannerImage(input: {
  sourceUrl: string;
  imageType?: string | null;
}): boolean {
  const t = (input.imageType ?? "").toLowerCase();
  if (/banner|bnr|campaign.?banner/.test(t)) return true;
  const path = input.sourceUrl.toLowerCase();
  return /banner|\/bnr\/|_bnr_|campaign_banner/.test(path);
}

function isProhibitedMaterial(input: {
  sourceUrl: string;
  imageType?: string | null;
  storedUsageStatus?: string | null;
}): { prohibited: boolean; reason: string | null } {
  const stored = (input.storedUsageStatus ?? "").toUpperCase();
  if (stored === "NOT_ALLOWED") {
    return { prohibited: true, reason: "stored_usageStatus_NOT_ALLOWED" };
  }
  const t = (input.imageType ?? "").toLowerCase();
  if (/ai_generated|user_upload|screenshot_unofficial/.test(t)) {
    return { prohibited: true, reason: `prohibited_imageType=${t || "unknown"}` };
  }
  return { prohibited: false, reason: null };
}

function isFanzaVideoCategory(input: {
  fanzaService?: string | null;
  fanzaFloor?: string | null;
}): boolean {
  const service = (input.fanzaService ?? "digital").trim().toLowerCase();
  const floor = (input.fanzaFloor ?? "videoa").trim().toLowerCase();
  // Default factory category is FANZA digital videoa — samples for that path are in-scope.
  if (service === "digital" && (floor === "videoa" || floor === "videoc" || floor === "nikkatsu")) {
    return true;
  }
  // If unspecified, treat as video-capable default (ops default is videoa).
  if (!input.fanzaService && !input.fanzaFloor) return true;
  return false;
}

/**
 * Evaluate whether a FANZA official sample is material-eligible for X attach pipeline.
 * Site approval is checked separately via FANZA_X_SITE_APPROVED.
 */
export function evaluateFanzaOfficialSampleMaterialRights(
  input: EvaluateFanzaOfficialSampleMaterialRightsInput,
): FanzaOfficialSampleMaterialRights {
  const url = input.sourceUrl.trim();
  const key = imageContentKey(url);
  const provider = (input.provider ?? "fanza").trim().toLowerCase();
  const providerOk = provider === "fanza" || provider === "dmm";
  const categoryOk = isFanzaVideoCategory({
    fanzaService: input.fanzaService,
    fanzaFloor: input.fanzaFloor,
  });
  const sourceKind = (input.sourceKind ?? "").trim().toLowerCase();
  const sourceKindOk =
    sourceKind === "fanza_official_sample" ||
    sourceKind === "official_sample" ||
    (key?.family === "sample" && sourceKind === "");
  const officialTraceOk =
    Boolean(url) &&
    isTrustedDmmImageUrl(url) &&
    key?.family === "sample" &&
    Boolean(key.contentKey.match(/:sample:\d+$/));
  const notPerformerListFace = !isPerformerListFaceImage({
    sourceUrl: url,
    imageType: input.imageType,
  });
  const notBanner = !isBannerImage({ sourceUrl: url, imageType: input.imageType });
  const prohibited = isProhibitedMaterial({
    sourceUrl: url,
    imageType: input.imageType,
    storedUsageStatus: input.storedUsageStatus,
  });
  const notProhibited = !prohibited.prohibited;

  // Package/main covers are not "official sample" material for this X path.
  if (key?.family === "package") {
    return {
      status: "NOT_ELIGIBLE",
      reason: "package_cover_not_official_sample",
      providerOk,
      categoryOk,
      sourceKindOk: false,
      officialTraceOk: false,
      notPerformerListFace,
      notBanner,
      notProhibited,
      transformPolicy: FANZA_X_SAMPLE_TRANSFORM_POLICY,
    };
  }

  if (!providerOk) {
    return fail("provider_not_fanza_or_dmm", {
      providerOk,
      categoryOk,
      sourceKindOk,
      officialTraceOk,
      notPerformerListFace,
      notBanner,
      notProhibited,
    });
  }
  if (!categoryOk) {
    return fail("fanza_category_not_video_image_eligible", {
      providerOk,
      categoryOk,
      sourceKindOk,
      officialTraceOk,
      notPerformerListFace,
      notBanner,
      notProhibited,
    });
  }
  if (!sourceKindOk) {
    return fail("sourceKind_not_fanza_official_sample", {
      providerOk,
      categoryOk,
      sourceKindOk,
      officialTraceOk,
      notPerformerListFace,
      notBanner,
      notProhibited,
    });
  }
  if (!officialTraceOk) {
    return fail("official_source_trace_missing_or_untrusted", {
      providerOk,
      categoryOk,
      sourceKindOk,
      officialTraceOk,
      notPerformerListFace,
      notBanner,
      notProhibited,
    });
  }
  if (!notPerformerListFace) {
    return fail("performer_list_face_image", {
      providerOk,
      categoryOk,
      sourceKindOk,
      officialTraceOk,
      notPerformerListFace,
      notBanner,
      notProhibited,
    });
  }
  if (!notBanner) {
    return fail("banner_material", {
      providerOk,
      categoryOk,
      sourceKindOk,
      officialTraceOk,
      notPerformerListFace,
      notBanner,
      notProhibited,
    });
  }
  if (!notProhibited) {
    return fail(prohibited.reason ?? "prohibited_material", {
      providerOk,
      categoryOk,
      sourceKindOk,
      officialTraceOk,
      notPerformerListFace,
      notBanner,
      notProhibited,
    });
  }

  // Stored RC for article display must NOT alone block X material eligibility.
  return {
    status: "ELIGIBLE",
    reason: "fanza_official_video_sample_material_eligible",
    providerOk,
    categoryOk,
    sourceKindOk,
    officialTraceOk,
    notPerformerListFace,
    notBanner,
    notProhibited,
    transformPolicy: FANZA_X_SAMPLE_TRANSFORM_POLICY,
  };
}

function fail(
  reason: string,
  flags: Omit<
    FanzaOfficialSampleMaterialRights,
    "status" | "reason" | "transformPolicy"
  >,
): FanzaOfficialSampleMaterialRights {
  return {
    status: "NOT_ELIGIBLE",
    reason,
    ...flags,
    transformPolicy: FANZA_X_SAMPLE_TRANSFORM_POLICY,
  };
}
