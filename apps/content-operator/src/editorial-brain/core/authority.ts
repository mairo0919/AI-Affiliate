/**
 * Authority boundary + QualityGate classification catalog.
 * Brain owns semantic editorial quality; deterministic validators own hard contracts.
 */

export type QualityGateAuthorityClass =
  | "HARD_DETERMINISTIC"
  | "SEMANTIC_EDITORIAL"
  | "BUSINESS_PUBLISH_POLICY"
  | "DUPLICATE_OBSOLETE";

export type QualityGateStageCatalogEntry = {
  stage: string;
  authority: QualityGateAuthorityClass;
  notes: string;
};

/**
 * Classification of existing QualityGate stages — non-destructive catalog.
 * ACTIVE: SEMANTIC_EDITORIAL is not a second final authority when Brain ACCEPTED.
 */
export const QUALITY_GATE_STAGE_CATALOG: QualityGateStageCatalogEntry[] = [
  {
    stage: "schema_validation",
    authority: "HARD_DETERMINISTIC",
    notes: "Title/body schema presence",
  },
  {
    stage: "claim_validation",
    authority: "HARD_DETERMINISTIC",
    notes: "Claim ownership / blocked claim status",
  },
  {
    stage: "deterministic_fact_validation",
    authority: "HARD_DETERMINISTIC",
    notes: "Placeholder leak / sanitize",
  },
  {
    stage: "cta_product_link_validation",
    authority: "BUSINESS_PUBLISH_POLICY",
    notes: "Public CTA URL presence",
  },
  {
    stage: "policy_review",
    authority: "BUSINESS_PUBLISH_POLICY",
    notes: "Disclosure / policy rules",
  },
  {
    stage: "intro_quality",
    authority: "SEMANTIC_EDITORIAL",
    notes: "Boilerplate intro — Brain authority when ACTIVE+accepted",
  },
  {
    stage: "editorial_value",
    authority: "SEMANTIC_EDITORIAL",
    notes: "Legacy editorial benchmarks — Brain authority when ACTIVE+accepted",
  },
  {
    stage: "llm_quality_reviews",
    authority: "SEMANTIC_EDITORIAL",
    notes: "Legacy LLM semantic reviews — do not double-bill vs Brain",
  },
  {
    stage: "claim-consistency",
    authority: "SEMANTIC_EDITORIAL",
    notes: "LLM review type overlapping Brain grounding",
  },
  {
    stage: "factual-consistency",
    authority: "SEMANTIC_EDITORIAL",
    notes: "LLM review type overlapping Brain grounding",
  },
  {
    stage: "writing-quality",
    authority: "SEMANTIC_EDITORIAL",
    notes: "LLM writing quality — Brain authority when ACTIVE+accepted",
  },
  {
    stage: "seo-basic",
    authority: "BUSINESS_PUBLISH_POLICY",
    notes: "SEO heuristics",
  },
  {
    stage: "adult-policy",
    authority: "BUSINESS_PUBLISH_POLICY",
    notes: "Adult policy",
  },
  {
    stage: "blogger-readiness",
    authority: "BUSINESS_PUBLISH_POLICY",
    notes: "Publish readiness cues",
  },
  {
    stage: "article_format_compliance",
    authority: "HARD_DETERMINISTIC",
    notes: "Format hard contract",
  },
  {
    stage: "final_publication_readiness",
    authority: "BUSINESS_PUBLISH_POLICY",
    notes: "Aggregate readiness",
  },
  {
    stage: "brain_acceptance",
    authority: "HARD_DETERMINISTIC",
    notes: "ACTIVE: Brain ACCEPTED + hard deterministic PASS",
  },
];

export function authorityForGateStage(stage: string): QualityGateAuthorityClass {
  const hit = QUALITY_GATE_STAGE_CATALOG.find((e) => e.stage === stage);
  return hit?.authority ?? "DUPLICATE_OBSOLETE";
}

export function isSemanticEditorialStage(stage: string): boolean {
  return authorityForGateStage(stage) === "SEMANTIC_EDITORIAL";
}

/** What Brain owns vs deterministic validators. */
export function editorialAuthorityBoundary(): {
  brainOwns: string[];
  deterministicOwns: string[];
  neverDoubleBillSemantic: true;
} {
  return {
    brainOwns: [
      "semantic editorial quality",
      "grounding",
      "repetition",
      "unsupported inference",
      "information gain",
      "filler",
      "editorial decision",
      "repair decision",
    ],
    deterministicOwns: [
      "schema",
      "claim ownership",
      "provenance",
      "URL",
      "policy",
      "format hard contract",
      "character hard limit",
      "bad input",
      "publish sanitize",
    ],
    neverDoubleBillSemantic: true,
  };
}
