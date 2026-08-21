/**
 * Semantic assertion model for Editorial Brain Shadow Review.
 * Product names are never hard-coded — only general support types.
 */

import type { EditorialFailureCode } from "../core/failure-taxonomy.js";
import type { PredicateFamily, RepetitionKind } from "./predicate-families.js";

export type AssertionSupportType =
  | "DIRECT"
  | "SAFE_COMPOSITION"
  | "UNSUPPORTED"
  | "INTERPRETIVE"
  | "EVALUATIVE"
  | "NAME_DERIVED"
  | "SOCIAL_PROOF"
  | "FILLER"
  | "REPETITION";

export type SemanticAssertion = {
  assertion: string;
  sourceSegment: string;
  supportingClaimIds: string[];
  supportType: AssertionSupportType;
  confidence: number;
  addsInformation: boolean;
  failureCodes: EditorialFailureCode[];
  /** Facets newly introduced by this assertion (when supported) */
  novelFacets: string[];
  /** Optional relation families detected on the assertion */
  predicateFamilies?: PredicateFamily[];
  /** Internal repetition classification (not a new failure taxonomy code) */
  repetitionKind?: RepetitionKind;
};

export type SemanticReviewStats = {
  assertionCount: number;
  supportedNovelAssertionCount: number;
  unsupportedAssertionCount: number;
  interpretiveCount: number;
  evaluativeCount: number;
  nameDerivedCount: number;
  socialProofCount: number;
  repetitionCount: number;
  fillerCount: number;
  /** Distinct claim facets newly covered by supported assertions */
  novelFacetCoverage: number;
  affectedSegmentRoles: string[];
};

export type SemanticReviewResult = {
  assertions: SemanticAssertion[];
  stats: SemanticReviewStats;
  failureCodes: EditorialFailureCode[];
};

/**
 * Future QualityGate-integrated semantic reviewer port.
 * Shadow Phase uses DeterministicSemanticReviewer (no extra LLM call).
 * A later LLM implementation must replace Gate LLM reviews — not run in parallel forever.
 */
export type SemanticReviewerPort = {
  readonly kind: "deterministic" | "llm_structured";
  review(input: {
    segments: Array<{ role: string; text: string }>;
    claims: Array<{ id: string; statement: string; kind?: string }>;
    allocatedClaimIds: string[];
    sourceTexts?: string[];
    optionBNaturalIntro?: boolean;
  }): Promise<SemanticReviewResult> | SemanticReviewResult;
};
