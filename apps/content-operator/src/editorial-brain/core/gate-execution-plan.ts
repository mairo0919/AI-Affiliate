/**
 * QualityGate execution inventory + mode-aware execution plan SSOT.
 * Extends authority classification with call-site / cost / ACTIVE skip rules.
 */

import type { BrainRunMode } from "./types.js";
import {
  authorityForGateStage,
  type QualityGateAuthorityClass,
} from "./authority.js";
import { readBrainLifecycle } from "./acceptance.js";

export type GateExecutionKind = "deterministic" | "llm" | "aggregate";

export type QualityGateExecutionInventoryEntry = {
  stage: string;
  category: QualityGateAuthorityClass;
  kind: GateExecutionKind;
  callSite: string;
  blockingAuthority: "hard" | "semantic" | "business" | "none";
  brainOverlap:
    | "full"
    | "partial"
    | "none"
    | "n/a";
  brainOverlapNotes: string;
  runInShadow: boolean;
  /** When ACTIVE + Brain path is semantic authority */
  runInActiveWhenBrainAuthority: boolean;
  incursLlmCost: boolean;
};

/**
 * Full execution inventory — classification + whether ACTIVE should call the stage.
 */
export const QUALITY_GATE_EXECUTION_INVENTORY: QualityGateExecutionInventoryEntry[] = [
  {
    stage: "schema_validation",
    category: "HARD_DETERMINISTIC",
    kind: "deterministic",
    callSite: "QualityGateService.evaluate",
    blockingAuthority: "hard",
    brainOverlap: "none",
    brainOverlapNotes: "Schema presence — deterministic only",
    runInShadow: true,
    runInActiveWhenBrainAuthority: true,
    incursLlmCost: false,
  },
  {
    stage: "claim_validation",
    category: "HARD_DETERMINISTIC",
    kind: "deterministic",
    callSite: "QualityGateService.evaluate",
    blockingAuthority: "hard",
    brainOverlap: "none",
    brainOverlapNotes: "Claim ownership / blocked status",
    runInShadow: true,
    runInActiveWhenBrainAuthority: true,
    incursLlmCost: false,
  },
  {
    stage: "deterministic_fact_validation",
    category: "HARD_DETERMINISTIC",
    kind: "deterministic",
    callSite: "QualityGateService.evaluate",
    blockingAuthority: "hard",
    brainOverlap: "none",
    brainOverlapNotes: "Placeholder sanitize",
    runInShadow: true,
    runInActiveWhenBrainAuthority: true,
    incursLlmCost: false,
  },
  {
    stage: "cta_product_link_validation",
    category: "BUSINESS_PUBLISH_POLICY",
    kind: "deterministic",
    callSite: "QualityGateService.evaluate",
    blockingAuthority: "business",
    brainOverlap: "none",
    brainOverlapNotes: "CTA URL — business/publish",
    runInShadow: true,
    runInActiveWhenBrainAuthority: true,
    incursLlmCost: false,
  },
  {
    stage: "policy_review",
    category: "BUSINESS_PUBLISH_POLICY",
    kind: "deterministic",
    callSite: "QualityGateService.evaluate + runQualityReviews policy eval",
    blockingAuthority: "business",
    brainOverlap: "none",
    brainOverlapNotes: "Disclosure / PolicyRule",
    runInShadow: true,
    runInActiveWhenBrainAuthority: true,
    incursLlmCost: false,
  },
  {
    stage: "intro_quality",
    category: "SEMANTIC_EDITORIAL",
    kind: "deterministic",
    callSite: "evaluateIntroQuality via QualityGate + runQualityReviews",
    blockingAuthority: "semantic",
    brainOverlap: "full",
    brainOverlapNotes: "Filler/boilerplate ⊂ Brain FILLER / OPENING axes",
    runInShadow: true,
    runInActiveWhenBrainAuthority: false,
    incursLlmCost: false,
  },
  {
    stage: "editorial_value",
    category: "SEMANTIC_EDITORIAL",
    kind: "deterministic",
    callSite: "evaluateEditorialQuality via QualityGateService.evaluate",
    blockingAuthority: "semantic",
    brainOverlap: "full",
    brainOverlapNotes: "Repetition/density ⊂ Brain REPETITION / INFORMATION_GAIN",
    runInShadow: true,
    runInActiveWhenBrainAuthority: false,
    incursLlmCost: false,
  },
  {
    stage: "llm_quality_reviews",
    category: "SEMANTIC_EDITORIAL",
    kind: "aggregate",
    callSite: "ContentGenerationService.runQualityReviews",
    blockingAuthority: "semantic",
    brainOverlap: "partial",
    brainOverlapNotes: "Bundle: semantic LLM types skipped in ACTIVE; business types remain",
    runInShadow: true,
    runInActiveWhenBrainAuthority: true, // still runs, but filtered
    incursLlmCost: true,
  },
  {
    stage: "claim-consistency",
    category: "SEMANTIC_EDITORIAL",
    kind: "llm",
    callSite: "runQualityReviews → review.claim",
    blockingAuthority: "semantic",
    brainOverlap: "full",
    brainOverlapNotes: "Grounding / claim entailment → Brain SemanticReviewer",
    runInShadow: true,
    runInActiveWhenBrainAuthority: false,
    incursLlmCost: true,
  },
  {
    stage: "factual-consistency",
    category: "SEMANTIC_EDITORIAL",
    kind: "llm",
    callSite: "runQualityReviews → review.factual",
    blockingAuthority: "semantic",
    brainOverlap: "full",
    brainOverlapNotes: "Factual support → Brain grounding/unsupported inference",
    runInShadow: true,
    runInActiveWhenBrainAuthority: false,
    incursLlmCost: true,
  },
  {
    stage: "writing-quality",
    category: "SEMANTIC_EDITORIAL",
    kind: "llm",
    callSite: "runQualityReviews → review.writing-quality",
    blockingAuthority: "semantic",
    brainOverlap: "full",
    brainOverlapNotes: "Prose quality → Brain editorial axes (no prompt-rule copy)",
    runInShadow: true,
    runInActiveWhenBrainAuthority: false,
    incursLlmCost: true,
  },
  {
    stage: "seo-basic",
    category: "BUSINESS_PUBLISH_POLICY",
    kind: "llm",
    callSite: "runQualityReviews → review.seo",
    blockingAuthority: "business",
    brainOverlap: "none",
    brainOverlapNotes: "SEO heuristics — keep in ACTIVE",
    runInShadow: true,
    runInActiveWhenBrainAuthority: true,
    incursLlmCost: true,
  },
  {
    stage: "adult-policy",
    category: "BUSINESS_PUBLISH_POLICY",
    kind: "llm",
    callSite: "runQualityReviews → review.adult-policy",
    blockingAuthority: "business",
    brainOverlap: "none",
    brainOverlapNotes: "Adult policy — keep in ACTIVE",
    runInShadow: true,
    runInActiveWhenBrainAuthority: true,
    incursLlmCost: true,
  },
  {
    stage: "blogger-readiness",
    category: "BUSINESS_PUBLISH_POLICY",
    kind: "llm",
    callSite: "runQualityReviews → review.channel-fit",
    blockingAuthority: "business",
    brainOverlap: "none",
    brainOverlapNotes: "Channel readiness — keep in ACTIVE",
    runInShadow: true,
    runInActiveWhenBrainAuthority: true,
    incursLlmCost: true,
  },
  {
    stage: "article_format_compliance",
    category: "HARD_DETERMINISTIC",
    kind: "deterministic",
    callSite: "evaluateArticleFormatCompliance",
    blockingAuthority: "hard",
    brainOverlap: "none",
    brainOverlapNotes: "Format hard contract",
    runInShadow: true,
    runInActiveWhenBrainAuthority: true,
    incursLlmCost: false,
  },
  {
    stage: "brain_acceptance",
    category: "HARD_DETERMINISTIC",
    kind: "deterministic",
    callSite: "QualityGateService.evaluate (ACTIVE only)",
    blockingAuthority: "hard",
    brainOverlap: "n/a",
    brainOverlapNotes: "ACTIVE fail-closed acceptance gate",
    runInShadow: false,
    runInActiveWhenBrainAuthority: true,
    incursLlmCost: false,
  },
  {
    stage: "final_publication_readiness",
    category: "BUSINESS_PUBLISH_POLICY",
    kind: "aggregate",
    callSite: "QualityGateService.evaluate",
    blockingAuthority: "business",
    brainOverlap: "none",
    brainOverlapNotes: "Aggregate readiness",
    runInShadow: true,
    runInActiveWhenBrainAuthority: true,
    incursLlmCost: false,
  },
];

/** Semantic LLM review types fully covered by Brain — skip call in ACTIVE. */
export const LEGACY_SEMANTIC_LLM_REVIEW_TYPES = [
  "claim-consistency",
  "factual-consistency",
  "writing-quality",
] as const;

export type LegacySemanticLlmReviewType = (typeof LEGACY_SEMANTIC_LLM_REVIEW_TYPES)[number];

/** Business LLM review types — always eligible. */
export const BUSINESS_LLM_REVIEW_TYPES = [
  "seo-basic",
  "adult-policy",
  "blogger-readiness",
] as const;

/**
 * Coverage parity: legacy semantic criteria vs Brain responsibility.
 * No product/prompt-specific rule migration.
 */
export const SEMANTIC_COVERAGE_PARITY = [
  {
    legacy: "claim-consistency",
    disposition: "brain" as const,
    brainAxis: "grounding / claim entailment (SemanticReviewer)",
  },
  {
    legacy: "factual-consistency",
    disposition: "brain" as const,
    brainAxis: "unsupported/interpretive/evaluative/name-derived inference",
  },
  {
    legacy: "writing-quality",
    disposition: "brain" as const,
    brainAxis: "editorial flow / filler / repetition / information gain",
  },
  {
    legacy: "intro_quality",
    disposition: "brain" as const,
    brainAxis: "FILLER / OPENING",
  },
  {
    legacy: "editorial_value",
    disposition: "brain" as const,
    brainAxis: "REPETITION / INFORMATION_GAIN / INFORMATION_DENSITY",
  },
  {
    legacy: "seo-basic",
    disposition: "business" as const,
    brainAxis: "n/a — BUSINESS_PUBLISH_POLICY",
  },
  {
    legacy: "adult-policy",
    disposition: "business" as const,
    brainAxis: "n/a — BUSINESS_PUBLISH_POLICY",
  },
  {
    legacy: "blogger-readiness",
    disposition: "business" as const,
    brainAxis: "n/a — BUSINESS_PUBLISH_POLICY",
  },
];

export type SemanticAuthority = "LEGACY" | "BRAIN";

export type GateExecutionPlan = {
  mode: BrainRunMode;
  semanticAuthority: SemanticAuthority;
  /** Brain lifecycle present → Brain is semantic authority in ACTIVE */
  brainLifecyclePresent: boolean;
  skipLegacySemanticDeterministic: boolean;
  skipLegacySemanticLlm: boolean;
  legacySemanticGateSkippedReason: string | null;
  runBrainAcceptanceStage: boolean;
  allowedLlmReviewTypes: string[];
};

/**
 * Decide what QualityGate executes for this version/mode.
 * ACTIVE + missing lifecycle: still skip legacy semantic (no fallback authority) + fail-closed on brain_acceptance.
 */
export function buildGateExecutionPlan(input: {
  mode: BrainRunMode;
  structuredContent: unknown;
}): GateExecutionPlan {
  const lifecycle = readBrainLifecycle(input.structuredContent);
  const brainLifecyclePresent = lifecycle != null;

  if (input.mode !== "ACTIVE") {
    return {
      mode: "SHADOW",
      semanticAuthority: "LEGACY",
      brainLifecyclePresent,
      skipLegacySemanticDeterministic: false,
      skipLegacySemanticLlm: false,
      legacySemanticGateSkippedReason: null,
      runBrainAcceptanceStage: false,
      allowedLlmReviewTypes: [
        ...LEGACY_SEMANTIC_LLM_REVIEW_TYPES,
        ...BUSINESS_LLM_REVIEW_TYPES,
      ],
    };
  }

  // ACTIVE: Brain is sole semantic authority — never fall back to legacy semantic LLM
  return {
    mode: "ACTIVE",
    semanticAuthority: "BRAIN",
    brainLifecyclePresent,
    skipLegacySemanticDeterministic: true,
    skipLegacySemanticLlm: true,
    legacySemanticGateSkippedReason: brainLifecyclePresent
      ? "ACTIVE_BRAIN_SEMANTIC_AUTHORITY"
      : "ACTIVE_FAIL_CLOSED_NO_LEGACY_SEMANTIC_FALLBACK",
    runBrainAcceptanceStage: true,
    allowedLlmReviewTypes: [...BUSINESS_LLM_REVIEW_TYPES],
  };
}

export function shouldRunStage(
  stage: string,
  plan: GateExecutionPlan,
): boolean {
  const entry = QUALITY_GATE_EXECUTION_INVENTORY.find((e) => e.stage === stage);
  if (!entry) return true;
  if (plan.mode === "SHADOW") return entry.runInShadow;
  if (stage === "brain_acceptance") return plan.runBrainAcceptanceStage;
  if (
    plan.skipLegacySemanticDeterministic &&
    entry.category === "SEMANTIC_EDITORIAL" &&
    entry.kind === "deterministic"
  ) {
    return false;
  }
  if (
    plan.skipLegacySemanticLlm &&
    entry.kind === "llm" &&
    entry.category === "SEMANTIC_EDITORIAL"
  ) {
    return false;
  }
  return entry.runInActiveWhenBrainAuthority;
}

export function inventoryByCategory(): Record<QualityGateAuthorityClass, string[]> {
  const out: Record<QualityGateAuthorityClass, string[]> = {
    HARD_DETERMINISTIC: [],
    SEMANTIC_EDITORIAL: [],
    BUSINESS_PUBLISH_POLICY: [],
    DUPLICATE_OBSOLETE: [],
  };
  for (const e of QUALITY_GATE_EXECUTION_INVENTORY) {
    out[e.category].push(e.stage);
  }
  // Keep authority catalog orphan stages classifiable
  void authorityForGateStage;
  return out;
}
