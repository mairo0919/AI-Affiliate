/**
 * Failure taxonomy SSOT — product/version-agnostic codes.
 * Do not hardcode v5/v6/v7 fixture phrases here.
 */

export const EDITORIAL_FAILURE_CODES = [
  "GROUNDING",
  "UNSUPPORTED_INFERENCE",
  "INTERPRETIVE_INFERENCE",
  "EVALUATIVE_INFERENCE",
  "NAME_DERIVED_INFERENCE",
  "SOCIAL_PROOF",
  "REPETITION",
  "INFORMATION_GAIN_LOW",
  "INFORMATION_DENSITY_LOW",
  "INSUFFICIENT_SUPPORTED_MATERIAL",
  "FILLER",
  "CATALOG_NARRATION",
  "EDITORIAL_FLOW",
  "OPENING",
  "TITLE",
  "CTA",
  "SUMMARY",
  "STRUCTURE",
  "CLAIM_ALLOCATION",
  "GENERATION_PLAN_UNDERUSE",
  "SOURCE_TITLE_RESTATEMENT",
  "CHANNEL_CONSTRAINT",
  "TEMPLATE_FATIGUE",
  "DUPLICATE_CONTENT",
  "PERFORMANCE_SIGNAL",
  "REFERENCE_PROGRESSION_VIOLATION",
  "UNMAPPED_PADDING",
  "EVIDENCE_OMISSION",
  "REFERENCE_NEAR_COPY",
  "WRONG_SEGMENT_EVIDENCE_USAGE",
  "GRAMMATICAL_INTEGRITY",
  "INCOMPLETE_CLAUSE",
  "REFERENCE_TRANSFORM_MISSED",
  "GENERIC_EVALUATIVE_PADDING",
] as const;

export type EditorialFailureCode = (typeof EDITORIAL_FAILURE_CODES)[number];

export function isEditorialFailureCode(code: string): code is EditorialFailureCode {
  return (EDITORIAL_FAILURE_CODES as readonly string[]).includes(code);
}

export const FAILURE_CODE_META: Record<
  EditorialFailureCode,
  {
    deterministicHint: boolean;
    brainReview: boolean;
    defaultSeverity: "BLOCKING" | "WARNING" | "INFO";
  }
> = {
  GROUNDING: { deterministicHint: true, brainReview: true, defaultSeverity: "BLOCKING" },
  UNSUPPORTED_INFERENCE: {
    deterministicHint: true,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
  INTERPRETIVE_INFERENCE: {
    deterministicHint: false,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
  EVALUATIVE_INFERENCE: {
    deterministicHint: false,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
  NAME_DERIVED_INFERENCE: {
    deterministicHint: true,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
  SOCIAL_PROOF: { deterministicHint: true, brainReview: true, defaultSeverity: "BLOCKING" },
  REPETITION: { deterministicHint: true, brainReview: true, defaultSeverity: "BLOCKING" },
  INFORMATION_GAIN_LOW: {
    deterministicHint: false,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
  INFORMATION_DENSITY_LOW: {
    deterministicHint: false,
    brainReview: true,
    defaultSeverity: "WARNING",
  },
  INSUFFICIENT_SUPPORTED_MATERIAL: {
    deterministicHint: true,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
  FILLER: { deterministicHint: true, brainReview: true, defaultSeverity: "WARNING" },
  /** Body that only dumps maker/availability without editorial development — blocking for publishable BLOG. */
  CATALOG_NARRATION: { deterministicHint: true, brainReview: true, defaultSeverity: "BLOCKING" },
  EDITORIAL_FLOW: { deterministicHint: false, brainReview: true, defaultSeverity: "WARNING" },
  OPENING: { deterministicHint: true, brainReview: true, defaultSeverity: "WARNING" },
  TITLE: { deterministicHint: true, brainReview: true, defaultSeverity: "WARNING" },
  CTA: { deterministicHint: true, brainReview: true, defaultSeverity: "WARNING" },
  SUMMARY: { deterministicHint: true, brainReview: true, defaultSeverity: "WARNING" },
  STRUCTURE: { deterministicHint: true, brainReview: false, defaultSeverity: "BLOCKING" },
  CLAIM_ALLOCATION: { deterministicHint: true, brainReview: false, defaultSeverity: "BLOCKING" },
  GENERATION_PLAN_UNDERUSE: {
    deterministicHint: true,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
  SOURCE_TITLE_RESTATEMENT: {
    deterministicHint: true,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
  CHANNEL_CONSTRAINT: {
    deterministicHint: true,
    brainReview: false,
    defaultSeverity: "BLOCKING",
  },
  TEMPLATE_FATIGUE: { deterministicHint: true, brainReview: true, defaultSeverity: "WARNING" },
  DUPLICATE_CONTENT: { deterministicHint: true, brainReview: true, defaultSeverity: "WARNING" },
  PERFORMANCE_SIGNAL: { deterministicHint: false, brainReview: false, defaultSeverity: "INFO" },
  REFERENCE_PROGRESSION_VIOLATION: {
    deterministicHint: true,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
  UNMAPPED_PADDING: { deterministicHint: true, brainReview: true, defaultSeverity: "BLOCKING" },
  EVIDENCE_OMISSION: { deterministicHint: true, brainReview: true, defaultSeverity: "BLOCKING" },
  REFERENCE_NEAR_COPY: { deterministicHint: true, brainReview: true, defaultSeverity: "BLOCKING" },
  WRONG_SEGMENT_EVIDENCE_USAGE: {
    deterministicHint: true,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
  GRAMMATICAL_INTEGRITY: {
    deterministicHint: true,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
  INCOMPLETE_CLAUSE: {
    deterministicHint: true,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
  REFERENCE_TRANSFORM_MISSED: {
    deterministicHint: true,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
  GENERIC_EVALUATIVE_PADDING: {
    deterministicHint: true,
    brainReview: true,
    defaultSeverity: "BLOCKING",
  },
};
