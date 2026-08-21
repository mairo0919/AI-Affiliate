/**
 * Generation authority SSOT — OPTION B (primary).
 *
 * Priority (higher cannot be overridden by lower) — JSON only; not restated as prompt walls:
 * 1. FACTUAL / SAFETY
 * 2. EVIDENCE_PACK (WHAT — product title / Claims / official description)
 * 3. WRITING_SKELETON (HOW — light progression hint)
 * 4. BLOG_CHANNEL_REQUIREMENTS
 * 5. MINIMAL_STYLE
 *
 * r29: Brain-overlapping duty flags removed. Canonical generatorDuty = 1 string.
 */

import { OPTION_B_GENERATOR_POLICY } from "../article-pattern/natural-product-intro-policy.js";

export const GENERATION_AUTHORITY_PRIORITY = [
  "FACTUAL_SAFETY",
  "EVIDENCE_PACK",
  "WRITING_SKELETON",
  "BLOG_CHANNEL_REQUIREMENTS",
  "MINIMAL_STYLE",
] as const;

/** @deprecated r15 path — kept for tests/compat; not injected into Generator when OPTION B is active */
export const LEGACY_GENERATION_AUTHORITY_PRIORITY = [
  "FACTUAL_SAFETY",
  "SEGMENT_CONTRACTS",
  "EVIDENCE_MAPPING_PLAN",
  "REFERENCE_TRANSFORM_BLUEPRINT",
  "REFERENCE_BLUEPRINT",
  "EDITORIAL_PLAN",
  "SELECTED_PATTERN_SUMMARY",
  "GENERIC_WRITING_STYLE",
] as const;

export type GenerationAuthorityRank = (typeof GENERATION_AUTHORITY_PRIORITY)[number];

export type PlanViolationFeedback = {
  attempt: number;
  violatedSegments: string[];
  missingRequiredContributionIds: string[];
  forbiddenReusedContributionIds: string[];
  prematurelyConsumedContributionIds?: string[];
  codes: string[];
  consumedContributionFacets?: string[];
  semanticReuseFamilies?: string[];
  failureClass?: string;
  failureSignature?: string;
  note: string;
};

function pickOptionB(
  contract: Record<string, unknown>,
): {
  writingSkeleton: Record<string, unknown> | null;
  evidencePack: Record<string, unknown> | null;
} {
  const layers =
    typeof contract.layers === "object" && contract.layers
      ? (contract.layers as Record<string, unknown>)
      : {};
  const writingSkeleton =
    (contract.writingSkeleton as Record<string, unknown> | undefined) ??
    (layers.WRITING_SKELETON as Record<string, unknown> | undefined) ??
    null;
  const evidencePack =
    (contract.evidencePack as Record<string, unknown> | undefined) ??
    (layers.EVIDENCE_PACK as Record<string, unknown> | undefined) ??
    null;
  return { writingSkeleton, evidencePack };
}

/**
 * OPTION B Generator authority — small, non-competing SSOT.
 * Reviewer-only walls stay out of this object.
 */
export function buildOptionBGenerationAuthority(input: {
  writingSkeleton: Record<string, unknown>;
  evidencePack: Record<string, unknown>;
  planViolationFeedback?: PlanViolationFeedback | null;
  channel?: {
    ctaRequired?: boolean;
    disclosureSystemAppended?: boolean;
    language?: string;
  };
}): Record<string, unknown> {
  return {
    mode: "OPTION_B",
    authorityPriority: [...GENERATION_AUTHORITY_PRIORITY],
    rule: "Lower ranks must not override higher ranks. Style never weakens FACTUAL or EVIDENCE_PACK. Do not invent facts. Do not pad with catalog metadata.",
    FACTUAL_SAFETY: {
      useOnlySupportedFacts: true,
      noInventedFacts: true,
      noFabricatedSocialProof: true,
      noCompetitorProseCopy: true,
      noCatalogShellPadding: true,
    },
    EVIDENCE_PACK: input.evidencePack,
    WRITING_SKELETON: input.writingSkeleton,
    BLOG_CHANNEL_REQUIREMENTS: {
      language: input.channel?.language ?? "ja",
      ctaWidgetRequired: input.channel?.ctaRequired !== false,
      disclosureAppendedBySystem: input.channel?.disclosureSystemAppended !== false,
      noInventedImageUrls: true,
      noDuplicateFreshnessNotice: true,
    },
    MINIMAL_STYLE: {
      language: "ja",
      articleShape: "natural_product_intro",
    },
    /** Canonical single duty — not duplicated into prompt / skeleton / pack (r29). */
    generatorDuty: [OPTION_B_GENERATOR_POLICY],
    planViolationFeedback: input.planViolationFeedback ?? null,
  };
}

export function buildGenerationAuthorityPromptContract(input: {
  brainGenerationContract: Record<string, unknown>;
  editorialPatternSummary?: Record<string, unknown> | null;
  structurePatternSummary?: Record<string, unknown> | null;
  planViolationFeedback?: PlanViolationFeedback | null;
  plannerFailureTendencies?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const { writingSkeleton, evidencePack } = pickOptionB(input.brainGenerationContract);
  if (writingSkeleton && evidencePack) {
    return buildOptionBGenerationAuthority({
      writingSkeleton,
      evidencePack,
      planViolationFeedback: input.planViolationFeedback,
    });
  }

  return {
    mode: "TRANSITION_MINIMAL",
    authorityPriority: [...GENERATION_AUTHORITY_PRIORITY],
    rule: "OPTION B inputs missing — use FACTUAL_SAFETY only; do not invent. Prefer DEFER over catalog padding.",
    FACTUAL_SAFETY: {
      useOnlySupportedFacts: true,
      noInventedFacts: true,
      noFabricatedSocialProof: true,
      noCompetitorProseCopy: true,
      noCatalogShellPadding: true,
    },
    EVIDENCE_PACK: null,
    WRITING_SKELETON: null,
    BLOG_CHANNEL_REQUIREMENTS: {
      language: "ja",
      ctaWidgetRequired: true,
      disclosureAppendedBySystem: true,
    },
    MINIMAL_STYLE: { language: "ja", articleShape: "natural_product_intro" },
    planViolationFeedback: input.planViolationFeedback ?? null,
    legacyAdvisory: {
      note: "Legacy SEGMENT/REFERENCE layers demoted; not authoritative for generation.",
      hadSegmentContracts: Boolean(
        (input.brainGenerationContract.layers as Record<string, unknown> | undefined)
          ?.SEGMENT_CONTRACTS ?? input.brainGenerationContract.segmentContracts,
      ),
    },
    generatorDuty: ["Use only SUPPORTED facts. Do not invent. Do not pad with catalog shells."],
  };
}

/** Slim pattern contracts — strategy headers only (no duplicate instruction walls). */
export function slimEditorialPatternForPrompt(
  full: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!full) return null;
  return {
    patternId: full.patternId,
    label: full.label,
    opening: full.opening,
    development: full.development,
    transition: full.transition,
    avoidCategories: full.avoidCategories,
    title: full.title,
    summaryRole: full.summaryRole,
  };
}

export function slimStructurePatternForPrompt(
  full: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!full) return null;
  return {
    patternId: full.patternId,
    label: full.label,
    blocks: full.blocks,
    articleOutputContract: full.articleOutputContract,
    constraints: full.constraints,
  };
}

export function slimClaimUsagePlanForPrompt(
  full: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!full) return null;
  return {
    hookClaimIds: full.hookClaimIds,
    developmentClaimIds: full.developmentClaimIds,
    omitCtaBridge: full.omitCtaBridge,
    omitInterestDevelopment: full.omitInterestDevelopment,
    claimBudget: full.claimBudget,
    groundedInference: full.groundedInference,
  };
}

/** Approximate JSON size for tests (UTF-8 bytes). */
export function estimateAuthorityJsonBytes(authority: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(authority), "utf8");
}
