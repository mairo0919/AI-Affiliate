/**
 * X_SOCIAL_MEDIA gate + official sample selection for X posts.
 *
 * Flow:
 *   official samples
 *   → material rights (FANZA video sample eligibility)
 *   → X visual safety (per image)
 *   → site approval (FANZA_X_SITE_APPROVED)
 *   → pick SAFE image or WAITING_*
 *
 * ARTICLE_IMAGE usageStatus RC alone does not block X material eligibility.
 * Sample index is ranking priority only — never an auto-SAFE signal.
 */

import { imageContentKey, isTrustedDmmImageUrl } from "../generation/article-images.js";
import { CONTENT_POLICY_SURFACE } from "./content-policy-surfaces.js";
import {
  evaluateFanzaOfficialSampleMaterialRights,
  FANZA_X_SAMPLE_TRANSFORM_POLICY,
} from "./x-fanza-sample-rights.js";

export const X_SOCIAL_MEDIA_POLICY_VERSION = "x-social-media-v3";

/** Final attach decision for an X post (TEXT_ONLY auto-post is not used). */
export type XSocialMediaDecision =
  | "SAFE_IMAGE"
  | "X_ANNOUNCE_CARD"
  | "WAITING_FOR_X_IMAGE"
  | "WAITING_FOR_AFFILIATE_SITE_APPROVAL"
  /** @deprecated Kept for older dry-run callers; treated as waiting. */
  | "TEXT_ONLY";

export type XSocialMediaAssetKind =
  | "X_SOCIAL_SAFE"
  | "ARTICLE_PACKAGE"
  | "ARTICLE_SAMPLE"
  | "OFFICIAL_SAMPLE"
  | "UNKNOWN";

export type XSocialVisualStatus =
  | "X_SOCIAL_SAFE"
  | "X_SOCIAL_UNSAFE"
  | "UNASSESSED"
  | "SKIPPED_RIGHTS";

export type XImageRightsStatus =
  | "ALLOWED"
  | "REQUIRES_CONFIRMATION"
  | "NOT_ALLOWED"
  | "UNKNOWN"
  | "MATERIAL_ELIGIBLE"
  | "BLOCKED_SITE_APPROVAL";

export type XMaterialRightsStatus = "ELIGIBLE" | "NOT_ELIGIBLE" | "N/A";

/** Optional operator / future vision hints — never invent. */
export type XSocialVisualHints = {
  faceVisible?: boolean;
  clothedNormal?: boolean;
  sexualPose?: boolean;
  nudityOrLingerie?: boolean;
  sexualAct?: boolean;
  largeSexualText?: boolean;
  portraitFriendly?: boolean;
  subjectClear?: boolean;
};

export type XSocialMediaCandidate = {
  sourceUrl?: string | null;
  imageType?: string | null;
  /** Explicit pre-marked X-safe asset (future / announce path). */
  xTimelineSafe?: boolean;
  assetKind?: XSocialMediaAssetKind;
  adultVisualRisk?: boolean;
  usageStatus?: string | null;
  visualHints?: XSocialVisualHints | null;
  sourceKind?: string | null;
};

export type XSocialMediaCandidateReport = {
  sampleIndex: number | null;
  sourceUrl: string;
  sourceKind: string;
  imageType: string | null;
  earlyPreferred: boolean;
  /** Effective attach rights (ALLOWED only when material eligible AND site approved). */
  rightsStatus: XImageRightsStatus;
  rightsReason: string;
  /** Material-only eligibility (independent of FANZA_X_SITE_APPROVED). */
  materialRightsStatus: XMaterialRightsStatus;
  materialRightsReason: string;
  siteApprovalStatus: "APPROVED" | "NOT_APPROVED" | "N/A";
  xSocialStatus: XSocialVisualStatus;
  xSocialReasons: string[];
  suitabilityScore: number;
  adopted: boolean;
  excludeReason: string | null;
};

export type XSocialMediaEvaluation = {
  decision: XSocialMediaDecision;
  reason: string;
  contentPolicySurface: typeof CONTENT_POLICY_SURFACE.X_SOCIAL_MEDIA;
  policyVersion: string;
  selectedUrl: string | null;
  selectedSampleIndex: number | null;
  selectedReason: string | null;
  fanzaXSiteApproved: boolean;
  transformPolicy: typeof FANZA_X_SAMPLE_TRANSFORM_POLICY;
  notes: string[];
  candidates: XSocialMediaCandidateReport[];
};

/**
 * Parse official FANZA sample index from URL (jp-N / js-N / {cid}-N).
 * Returns 0-based sample index (jp-1 → 0).
 */
export function parseOfficialSampleIndex(sourceUrl: string): number | null {
  const key = imageContentKey(sourceUrl);
  if (!key || key.family !== "sample") return null;
  const m = key.contentKey.match(/:sample:(\d+)$/);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n - 1;
}

function normalizeRightsStatus(raw: string | null | undefined): XImageRightsStatus {
  const u = (raw ?? "").trim().toUpperCase();
  if (u === "ALLOWED") return "ALLOWED";
  if (u === "REQUIRES_CONFIRMATION" || u === "RC") return "REQUIRES_CONFIRMATION";
  if (u === "NOT_ALLOWED") return "NOT_ALLOWED";
  if (u === "UNKNOWN") return "UNKNOWN";
  return "UNKNOWN";
}

/**
 * Per-image X timeline visual assessment.
 * Does NOT use sample index as a safety signal.
 * Without positive visualHints, samples stay UNASSESSED (cannot auto-SAFE).
 */
export function assessXSocialVisualContent(input: {
  sourceUrl: string;
  imageType?: string | null;
  adultVisualRisk?: boolean;
  visualHints?: XSocialVisualHints | null;
  assetKind?: XSocialMediaAssetKind | null;
}): { status: XSocialVisualStatus; reasons: string[]; suitabilityScore: number } {
  const reasons: string[] = [];
  const key = imageContentKey(input.sourceUrl);
  const family = key?.family ?? "other";
  const hints = input.visualHints ?? null;

  if (input.adultVisualRisk === true) {
    return {
      status: "X_SOCIAL_UNSAFE",
      reasons: ["adult_visual_risk_flag"],
      suitabilityScore: -100,
    };
  }

  if (hints?.nudityOrLingerie === true || hints?.sexualAct === true || hints?.sexualPose === true) {
    return {
      status: "X_SOCIAL_UNSAFE",
      reasons: ["visual_hint_explicit"],
      suitabilityScore: -100,
    };
  }
  if (hints?.largeSexualText === true) {
    return {
      status: "X_SOCIAL_UNSAFE",
      reasons: ["visual_hint_large_sexual_text"],
      suitabilityScore: -80,
    };
  }

  // Package / main covers are typically explicit marketing art — not timeline-safe by default.
  if (
    family === "package" ||
    input.assetKind === "ARTICLE_PACKAGE" ||
    /main_|package|pl\.jpg|ps\.jpg|pt\.jpg/i.test(input.imageType ?? "") ||
    /pl\.(jpe?g|webp)$/i.test(input.sourceUrl)
  ) {
    return {
      status: "X_SOCIAL_UNSAFE",
      reasons: ["package_or_main_cover_default_not_timeline_safe"],
      suitabilityScore: -50,
    };
  }

  // Pre-marked dedicated X asset
  if (input.assetKind === "X_SOCIAL_SAFE") {
    let score = 50;
    if (hints?.faceVisible) score += 20;
    if (hints?.clothedNormal) score += 20;
    if (hints?.portraitFriendly) score += 10;
    if (hints?.subjectClear) score += 10;
    return {
      status: "X_SOCIAL_SAFE",
      reasons: ["asset_kind_x_social_safe"],
      suitabilityScore: score,
    };
  }

  // Official samples: require positive assessment signals — index alone never grants SAFE.
  if (family === "sample" || input.assetKind === "OFFICIAL_SAMPLE" || input.assetKind === "ARTICLE_SAMPLE") {
    const positive =
      hints?.clothedNormal === true ||
      hints?.faceVisible === true ||
      hints?.portraitFriendly === true;
    if (!positive) {
      return {
        status: "UNASSESSED",
        reasons: [
          "official_sample_without_positive_visual_assessment",
          "sample_index_is_not_a_safety_signal",
        ],
        suitabilityScore: 0,
      };
    }
    let score = 40;
    if (hints?.faceVisible) score += 25;
    if (hints?.clothedNormal) score += 25;
    if (hints?.portraitFriendly) score += 10;
    if (hints?.subjectClear) score += 10;
    if (hints?.largeSexualText === false) score += 5;
    reasons.push("positive_visual_hints");
    return { status: "X_SOCIAL_SAFE", reasons, suitabilityScore: score };
  }

  return {
    status: "UNASSESSED",
    reasons: ["unknown_image_family_unassessed"],
    suitabilityScore: 0,
  };
}

/**
 * Material rights for X attach candidates.
 * Official FANZA samples: ELIGIBLE without inventing site approval.
 * Effective ALLOWED only when FANZA_X_SITE_APPROVED=true.
 */
function evaluateCandidateRights(input: {
  sourceUrl: string;
  usageStatus?: string | null;
  imageType?: string | null;
  sourceKind?: string | null;
  assetKind?: XSocialMediaAssetKind | null;
  productCanonicalId?: string | null;
  fanzaXSiteApproved: boolean;
  fanzaService?: string | null;
  fanzaFloor?: string | null;
  provider?: string | null;
}): {
  materialRightsStatus: XMaterialRightsStatus;
  materialRightsReason: string;
  rightsStatus: XImageRightsStatus;
  rightsReason: string;
  siteApprovalStatus: "APPROVED" | "NOT_APPROVED" | "N/A";
  mayRunVisualGate: boolean;
} {
  const siteApprovalStatus = input.fanzaXSiteApproved ? "APPROVED" : "NOT_APPROVED";
  const isOfficialSample =
    input.assetKind === "OFFICIAL_SAMPLE" ||
    input.sourceKind === "fanza_official_sample" ||
    imageContentKey(input.sourceUrl)?.family === "sample";

  if (isOfficialSample) {
    const material = evaluateFanzaOfficialSampleMaterialRights({
      sourceUrl: input.sourceUrl,
      imageType: input.imageType,
      storedUsageStatus: input.usageStatus,
      sourceKind: input.sourceKind ?? "fanza_official_sample",
      productCanonicalId: input.productCanonicalId,
      provider: input.provider ?? "fanza",
      fanzaService: input.fanzaService,
      fanzaFloor: input.fanzaFloor,
    });

    if (material.status !== "ELIGIBLE") {
      return {
        materialRightsStatus: "NOT_ELIGIBLE",
        materialRightsReason: material.reason,
        rightsStatus: "NOT_ALLOWED",
        rightsReason: material.reason,
        siteApprovalStatus,
        mayRunVisualGate: false,
      };
    }

    // Material OK — do not invent ALLOWED when site unapproved.
    if (!input.fanzaXSiteApproved) {
      return {
        materialRightsStatus: "ELIGIBLE",
        materialRightsReason: material.reason,
        rightsStatus: "BLOCKED_SITE_APPROVAL",
        rightsReason: "FANZA_X_SITE_APPROVED=false",
        siteApprovalStatus: "NOT_APPROVED",
        mayRunVisualGate: true,
      };
    }

    return {
      materialRightsStatus: "ELIGIBLE",
      materialRightsReason: material.reason,
      rightsStatus: "ALLOWED",
      rightsReason: "material_eligible_and_fanza_x_site_approved",
      siteApprovalStatus: "APPROVED",
      mayRunVisualGate: true,
    };
  }

  if (input.assetKind === "X_SOCIAL_SAFE") {
    const stored = normalizeRightsStatus(input.usageStatus);
    if (stored === "NOT_ALLOWED") {
      return {
        materialRightsStatus: "NOT_ELIGIBLE",
        materialRightsReason: "stored_NOT_ALLOWED",
        rightsStatus: "NOT_ALLOWED",
        rightsReason: "stored_NOT_ALLOWED",
        siteApprovalStatus,
        mayRunVisualGate: false,
      };
    }
    if (!input.fanzaXSiteApproved) {
      return {
        materialRightsStatus: "ELIGIBLE",
        materialRightsReason: "x_social_safe_asset",
        rightsStatus: "BLOCKED_SITE_APPROVAL",
        rightsReason: "FANZA_X_SITE_APPROVED=false",
        siteApprovalStatus: "NOT_APPROVED",
        mayRunVisualGate: true,
      };
    }
    return {
      materialRightsStatus: "ELIGIBLE",
      materialRightsReason: "x_social_safe_asset",
      rightsStatus: "ALLOWED",
      rightsReason: "x_social_safe_and_site_approved",
      siteApprovalStatus: "APPROVED",
      mayRunVisualGate: true,
    };
  }

  return {
    materialRightsStatus: "NOT_ELIGIBLE",
    materialRightsReason: "unsupported_asset_for_x_sample_rights",
    rightsStatus: normalizeRightsStatus(input.usageStatus),
    rightsReason: "unsupported_asset_for_x_sample_rights",
    siteApprovalStatus,
    mayRunVisualGate: false,
  };
}

/**
 * Build ordered official sample candidates (early samples first for ranking only).
 */
export function collectOfficialSampleCandidates(input: {
  researchImages: Array<{
    sourceUrl: string;
    imageType?: string | null;
    usageStatus?: string | null;
    visualHints?: XSocialVisualHints | null;
    adultVisualRisk?: boolean;
  }>;
  earlySamplePreferCount?: number;
}): Array<
  XSocialMediaCandidate & {
    sampleIndex: number | null;
    earlyPreferred: boolean;
    sourceKind: string;
  }
> {
  const prefer = Math.max(0, input.earlySamplePreferCount ?? 5);
  const samples: Array<{
    sourceUrl: string;
    imageType: string | null;
    usageStatus: string | null;
    sampleIndex: number;
    visualHints: XSocialVisualHints | null;
    adultVisualRisk?: boolean;
  }> = [];

  for (const row of input.researchImages) {
    const url = row.sourceUrl?.trim();
    if (!url) continue;
    const idx = parseOfficialSampleIndex(url);
    if (idx == null) continue;
    samples.push({
      sourceUrl: url,
      imageType: row.imageType ?? null,
      usageStatus: row.usageStatus ?? null,
      sampleIndex: idx,
      visualHints: row.visualHints ?? null,
      adultVisualRisk: row.adultVisualRisk,
    });
  }

  // Dedupe by sample index — prefer jp (larger) URL
  const byIndex = new Map<number, (typeof samples)[number]>();
  for (const s of samples.sort((a, b) => a.sampleIndex - b.sampleIndex)) {
    const prev = byIndex.get(s.sampleIndex);
    if (!prev) {
      byIndex.set(s.sampleIndex, s);
      continue;
    }
    const prevIsJp = /jp-\d+/i.test(prev.sourceUrl);
    const nextIsJp = /jp-\d+/i.test(s.sourceUrl);
    if (!prevIsJp && nextIsJp) byIndex.set(s.sampleIndex, s);
  }

  return [...byIndex.values()]
    .sort((a, b) => a.sampleIndex - b.sampleIndex)
    .map((s) => ({
      sourceUrl: s.sourceUrl,
      imageType: s.imageType,
      usageStatus: s.usageStatus,
      sampleIndex: s.sampleIndex,
      earlyPreferred: s.sampleIndex < prefer,
      assetKind: "OFFICIAL_SAMPLE" as const,
      sourceKind: "fanza_official_sample",
      visualHints: s.visualHints,
      adultVisualRisk: s.adultVisualRisk,
    }));
}

/**
 * Full X image selection: material rights → visual → site approval → ranked pick.
 * Early sample preference is sort priority only.
 */
export function selectXSocialMediaImage(input: {
  researchImages?: Array<{
    sourceUrl: string;
    imageType?: string | null;
    usageStatus?: string | null;
    visualHints?: XSocialVisualHints | null;
    adultVisualRisk?: boolean;
  }> | null;
  /** Extra candidates (e.g. future X_SOCIAL_SAFE announce card). */
  extraCandidates?: XSocialMediaCandidate[] | null;
  productCanonicalId?: string | null;
  /** @deprecated Unused for official samples — material eligibility is separate. */
  fanzaAffiliateImageTermsVerified?: boolean;
  /** DMM/FANZA X listing approval — default false; never invent true. */
  fanzaXSiteApproved?: boolean;
  fanzaService?: string | null;
  fanzaFloor?: string | null;
  earlySamplePreferCount?: number;
  announceCardAvailable?: boolean;
  announceCardUrl?: string | null;
}): XSocialMediaEvaluation {
  const notes: string[] = [];
  const prefer = Math.max(0, input.earlySamplePreferCount ?? 5);
  const reports: XSocialMediaCandidateReport[] = [];
  const fanzaXSiteApproved = input.fanzaXSiteApproved === true;

  const official = collectOfficialSampleCandidates({
    researchImages: input.researchImages ?? [],
    earlySamplePreferCount: prefer,
  });

  const extras = (input.extraCandidates ?? []).map((c) => ({
    ...c,
    sampleIndex: parseOfficialSampleIndex(c.sourceUrl ?? ""),
    earlyPreferred: false,
    sourceKind: c.sourceKind ?? c.assetKind ?? "extra",
  }));

  const pool = [...official, ...extras];

  for (const c of pool) {
    const url = c.sourceUrl?.trim() ?? "";
    if (!url) continue;

    const rights = evaluateCandidateRights({
      sourceUrl: url,
      usageStatus: c.usageStatus,
      imageType: c.imageType,
      sourceKind: String(c.sourceKind),
      assetKind: c.assetKind,
      productCanonicalId: input.productCanonicalId,
      fanzaXSiteApproved,
      fanzaService: input.fanzaService,
      fanzaFloor: input.fanzaFloor,
      provider: "fanza",
    });

    if (!rights.mayRunVisualGate) {
      reports.push({
        sampleIndex: c.sampleIndex ?? null,
        sourceUrl: url,
        sourceKind: String(c.sourceKind),
        imageType: c.imageType ?? null,
        earlyPreferred: Boolean(c.earlyPreferred),
        rightsStatus: rights.rightsStatus,
        rightsReason: rights.rightsReason,
        materialRightsStatus: rights.materialRightsStatus,
        materialRightsReason: rights.materialRightsReason,
        siteApprovalStatus: rights.siteApprovalStatus,
        xSocialStatus: "SKIPPED_RIGHTS",
        xSocialReasons: ["material_rights_blocked"],
        suitabilityScore: -1,
        adopted: false,
        excludeReason: `material_${rights.materialRightsStatus}:${rights.materialRightsReason}`,
      });
      continue;
    }

    if (!isTrustedDmmImageUrl(url) && c.assetKind !== "X_SOCIAL_SAFE") {
      reports.push({
        sampleIndex: c.sampleIndex ?? null,
        sourceUrl: url,
        sourceKind: String(c.sourceKind),
        imageType: c.imageType ?? null,
        earlyPreferred: Boolean(c.earlyPreferred),
        rightsStatus: rights.rightsStatus,
        rightsReason: rights.rightsReason,
        materialRightsStatus: rights.materialRightsStatus,
        materialRightsReason: rights.materialRightsReason,
        siteApprovalStatus: rights.siteApprovalStatus,
        xSocialStatus: "X_SOCIAL_UNSAFE",
        xSocialReasons: ["untrusted_host"],
        suitabilityScore: -1,
        adopted: false,
        excludeReason: "untrusted_host",
      });
      continue;
    }

    const visual = assessXSocialVisualContent({
      sourceUrl: url,
      imageType: c.imageType,
      adultVisualRisk: c.adultVisualRisk,
      visualHints: c.visualHints,
      assetKind: c.assetKind,
    });

    let score = visual.suitabilityScore;
    if (visual.status === "X_SOCIAL_SAFE" && c.earlyPreferred) {
      score += 15;
      visual.reasons.push("early_sample_rank_boost_not_safety");
    }

    const attachReady =
      rights.rightsStatus === "ALLOWED" && visual.status === "X_SOCIAL_SAFE";
    reports.push({
      sampleIndex: c.sampleIndex ?? null,
      sourceUrl: url,
      sourceKind: String(c.sourceKind),
      imageType: c.imageType ?? null,
      earlyPreferred: Boolean(c.earlyPreferred),
      rightsStatus: rights.rightsStatus,
      rightsReason: rights.rightsReason,
      materialRightsStatus: rights.materialRightsStatus,
      materialRightsReason: rights.materialRightsReason,
      siteApprovalStatus: rights.siteApprovalStatus,
      xSocialStatus: visual.status,
      xSocialReasons: visual.reasons,
      suitabilityScore: score,
      adopted: false,
      excludeReason: attachReady
        ? null
        : rights.rightsStatus === "BLOCKED_SITE_APPROVAL"
          ? `site_approval_blocked;x_social_${visual.status}`
          : `x_social_${visual.status}:${visual.reasons.join(",")}`,
    });
  }

  const baseReturn = {
    contentPolicySurface: CONTENT_POLICY_SURFACE.X_SOCIAL_MEDIA,
    policyVersion: X_SOCIAL_MEDIA_POLICY_VERSION,
    fanzaXSiteApproved,
    transformPolicy: FANZA_X_SAMPLE_TRANSFORM_POLICY,
    candidates: reports,
  };

  const safe = reports
    .filter((r) => r.rightsStatus === "ALLOWED" && r.xSocialStatus === "X_SOCIAL_SAFE")
    .sort((a, b) => {
      if (a.earlyPreferred !== b.earlyPreferred) return a.earlyPreferred ? -1 : 1;
      if (b.suitabilityScore !== a.suitabilityScore) {
        return b.suitabilityScore - a.suitabilityScore;
      }
      return (a.sampleIndex ?? 999) - (b.sampleIndex ?? 999);
    });

  if (safe.length > 0) {
    const pick = safe[0]!;
    pick.adopted = true;
    pick.excludeReason = null;
    notes.push(`adopted_sampleIndex=${pick.sampleIndex}`);
    return {
      ...baseReturn,
      decision: "SAFE_IMAGE",
      reason: "rights_allowed_and_x_social_safe",
      selectedUrl: pick.sourceUrl,
      selectedSampleIndex: pick.sampleIndex,
      selectedReason: [
        pick.earlyPreferred ? "early_sample_priority" : "other_sample",
        ...pick.xSocialReasons,
        `suitability=${pick.suitabilityScore}`,
      ].join(";"),
      notes,
    };
  }

  // Material-eligible + visual assessed, but site not approved → separate publication block
  const materialEligible = reports.filter((r) => r.materialRightsStatus === "ELIGIBLE");
  if (!fanzaXSiteApproved && materialEligible.length > 0) {
    notes.push("material_rights_separated_from_site_approval");
    notes.push("WAITING_FOR_AFFILIATE_SITE_APPROVAL");
    return {
      ...baseReturn,
      decision: "WAITING_FOR_AFFILIATE_SITE_APPROVAL",
      reason: "FANZA_X_SITE_APPROVED=false",
      selectedUrl: null,
      selectedSampleIndex: null,
      selectedReason: null,
      notes,
    };
  }

  if (input.announceCardAvailable && input.announceCardUrl?.trim() && fanzaXSiteApproved) {
    notes.push("fallback_x_announce_card");
    return {
      ...baseReturn,
      decision: "X_ANNOUNCE_CARD",
      reason: "no_safe_official_sample_use_announce_card",
      selectedUrl: input.announceCardUrl.trim(),
      selectedSampleIndex: null,
      selectedReason: "future_x_announce_card",
      notes,
    };
  }

  notes.push("TEXT_ONLY_auto_post_disabled");
  notes.push("WAITING_FOR_X_IMAGE");
  return {
    ...baseReturn,
    decision: "WAITING_FOR_X_IMAGE",
    reason:
      reports.length === 0
        ? "no_official_sample_candidates"
        : "no_x_social_safe_image_after_rights",
    selectedUrl: null,
    selectedSampleIndex: null,
    selectedReason: null,
    notes,
  };
}

/**
 * Backward-compatible entry: prefers selectXSocialMediaImage when research images given.
 * Legacy bare candidates without research list still supported.
 */
export function evaluateXSocialMedia(input: {
  candidates?: XSocialMediaCandidate[] | null;
  researchImages?: Array<{
    sourceUrl: string;
    imageType?: string | null;
    usageStatus?: string | null;
    visualHints?: XSocialVisualHints | null;
    adultVisualRisk?: boolean;
  }> | null;
  productCanonicalId?: string | null;
  fanzaAffiliateImageTermsVerified?: boolean;
  fanzaXSiteApproved?: boolean;
  fanzaService?: string | null;
  fanzaFloor?: string | null;
  earlySamplePreferCount?: number;
  announceCardAvailable?: boolean;
  announceCardUrl?: string | null;
}): XSocialMediaEvaluation {
  if (input.researchImages?.length || input.announceCardAvailable) {
    return selectXSocialMediaImage({
      researchImages: input.researchImages,
      extraCandidates: input.candidates,
      productCanonicalId: input.productCanonicalId,
      fanzaAffiliateImageTermsVerified: input.fanzaAffiliateImageTermsVerified,
      fanzaXSiteApproved: input.fanzaXSiteApproved,
      fanzaService: input.fanzaService,
      fanzaFloor: input.fanzaFloor,
      earlySamplePreferCount: input.earlySamplePreferCount,
      announceCardAvailable: input.announceCardAvailable,
      announceCardUrl: input.announceCardUrl,
    });
  }

  const fanzaXSiteApproved = input.fanzaXSiteApproved === true;
  const notes: string[] = [];
  const candidates = input.candidates ?? [];
  const reports: XSocialMediaCandidateReport[] = [];

  for (const c of candidates) {
    const url = c.sourceUrl?.trim() ?? "";
    if (!url) continue;
    const rights = evaluateCandidateRights({
      sourceUrl: url,
      usageStatus: c.usageStatus,
      imageType: c.imageType,
      sourceKind: c.sourceKind ?? c.assetKind,
      assetKind: c.assetKind,
      productCanonicalId: input.productCanonicalId,
      fanzaXSiteApproved,
      fanzaService: input.fanzaService,
      fanzaFloor: input.fanzaFloor,
    });
    const visual = rights.mayRunVisualGate
      ? assessXSocialVisualContent({
          sourceUrl: url,
          imageType: c.imageType,
          adultVisualRisk: c.adultVisualRisk,
          visualHints: c.visualHints,
          assetKind: c.assetKind,
        })
      : {
          status: "SKIPPED_RIGHTS" as const,
          reasons: ["material_rights_blocked"],
          suitabilityScore: -1,
        };
    const ok =
      rights.rightsStatus === "ALLOWED" && visual.status === "X_SOCIAL_SAFE";
    reports.push({
      sampleIndex: parseOfficialSampleIndex(url),
      sourceUrl: url,
      sourceKind: c.assetKind ?? "UNKNOWN",
      imageType: c.imageType ?? null,
      earlyPreferred: false,
      rightsStatus: rights.rightsStatus,
      rightsReason: rights.rightsReason,
      materialRightsStatus: rights.materialRightsStatus,
      materialRightsReason: rights.materialRightsReason,
      siteApprovalStatus: rights.siteApprovalStatus,
      xSocialStatus: visual.status,
      xSocialReasons: visual.reasons,
      suitabilityScore: visual.suitabilityScore,
      adopted: false,
      excludeReason: ok ? null : "legacy_not_attach_ready",
    });
    if (ok) {
      reports[reports.length - 1]!.adopted = true;
      return {
        decision: "SAFE_IMAGE",
        reason: "legacy_x_social_safe_asset",
        contentPolicySurface: CONTENT_POLICY_SURFACE.X_SOCIAL_MEDIA,
        policyVersion: X_SOCIAL_MEDIA_POLICY_VERSION,
        selectedUrl: url,
        selectedSampleIndex: parseOfficialSampleIndex(url),
        selectedReason: "legacy_explicit_x_social_safe",
        fanzaXSiteApproved,
        transformPolicy: FANZA_X_SAMPLE_TRANSFORM_POLICY,
        notes,
        candidates: reports,
      };
    }
  }

  if (!fanzaXSiteApproved && reports.some((r) => r.materialRightsStatus === "ELIGIBLE")) {
    return {
      decision: "WAITING_FOR_AFFILIATE_SITE_APPROVAL",
      reason: "FANZA_X_SITE_APPROVED=false",
      contentPolicySurface: CONTENT_POLICY_SURFACE.X_SOCIAL_MEDIA,
      policyVersion: X_SOCIAL_MEDIA_POLICY_VERSION,
      selectedUrl: null,
      selectedSampleIndex: null,
      selectedReason: null,
      fanzaXSiteApproved,
      transformPolicy: FANZA_X_SAMPLE_TRANSFORM_POLICY,
      notes: [...notes, "WAITING_FOR_AFFILIATE_SITE_APPROVAL"],
      candidates: reports,
    };
  }

  return {
    decision: "WAITING_FOR_X_IMAGE",
    reason: candidates.length === 0 ? "no_x_social_media_candidates" : "no_timeline_safe_image",
    contentPolicySurface: CONTENT_POLICY_SURFACE.X_SOCIAL_MEDIA,
    policyVersion: X_SOCIAL_MEDIA_POLICY_VERSION,
    selectedUrl: null,
    selectedSampleIndex: null,
    selectedReason: null,
    fanzaXSiteApproved,
    transformPolicy: FANZA_X_SAMPLE_TRANSFORM_POLICY,
    notes: [...notes, "TEXT_ONLY_auto_post_disabled"],
    candidates: reports,
  };
}
