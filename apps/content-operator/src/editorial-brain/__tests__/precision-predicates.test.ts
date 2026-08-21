/**
 * Precision fixtures: evaluative relations + role-aware repetition.
 * No product hardcoding.
 */
import { describe, expect, it } from "vitest";
import { buildCoreEditorialPlan } from "../core/planner.js";
import { reviewArtifactShadow } from "../shadow/reviewer.js";
import { hasEvaluativeRelation } from "../shadow/predicate-families.js";
import { VALIDATION_FIXTURES } from "../validation/fixtures.js";

function reviewFixture(sampleId: string) {
  const fx = VALIDATION_FIXTURES.find((f) => f.sampleId === sampleId);
  if (!fx) throw new Error(`missing fixture ${sampleId}`);
  const core = buildCoreEditorialPlan({
    channel: fx.channel,
    formatKey: fx.formatKey,
    contentType: fx.contentType,
    availableClaims: fx.claims,
    selectedClaims: fx.claims,
    openingClaimIds: fx.openingClaimIds,
    hookClaimIds: fx.openingClaimIds,
    developmentClaimIds: fx.developmentClaimIds,
    structurePatternId: null,
    editorialPatternId: null,
  });
  return {
    fx,
    core,
    review: reviewArtifactShadow({
      artifact: fx.artifact,
      corePlan: core,
      claimStatements: fx.claims,
    }),
  };
}

describe("predicate / role-aware precision fixtures", () => {
  it("detects suitability conjugations as evaluative relations", () => {
    expect(hasEvaluativeRelation("刺激を求める視聴者に向いています。")).toBe(true);
    expect(hasEvaluativeRelation("おすすめです。")).toBe(true);
    expect(hasEvaluativeRelation("出演者Alphaがクレジットされている。")).toBe(false);
  });

  it("1. unsupported suitability → EVALUATIVE_INFERENCE", () => {
    const { review } = reviewFixture("fixture-suitability-unsupported");
    expect(review.failures.map((f) => f.code)).toEqual(
      expect.arrayContaining(["EVALUATIVE_INFERENCE"]),
    );
    expect(review.decision).not.toBe("PASS");
  });

  it("2. supported suitability → PASS", () => {
    const { review } = reviewFixture("fixture-suitability-supported");
    expect(review.failures.map((f) => f.code)).not.toContain("EVALUATIVE_INFERENCE");
    expect(review.decision).toBe("PASS");
  });

  it("3. unsupported evaluation + zero gain → EVALUATIVE + FILLER", () => {
    const { review } = reviewFixture("fixture-eval-zero-gain-filler");
    expect(review.failures.map((f) => f.code)).toEqual(
      expect.arrayContaining(["EVALUATIVE_INFERENCE", "FILLER"]),
    );
  });

  it("4. lead/body same facet restatement → REPETITION", () => {
    const { review } = reviewFixture("fixture-lead-body-full-restatement");
    expect(review.failures.map((f) => f.code)).toContain("REPETITION");
  });

  it("5. same claim different facets → PASS (not repetition)", () => {
    const { review } = reviewFixture("fixture-same-claim-new-facet");
    expect(review.failures.map((f) => f.code)).not.toContain("REPETITION");
    expect(review.decision).toBe("PASS");
  });

  it("6. title→lead overlap not blocking", () => {
    const { review } = reviewFixture("fixture-title-lead-overlap-ok");
    expect(review.decision).toBe("PASS");
    expect(review.failures.map((f) => f.code)).not.toContain("REPETITION");
  });

  it("7. summary→body overlap not repetition", () => {
    const { review } = reviewFixture("fixture-summary-body-overlap-ok");
    expect(review.failures.map((f) => f.code)).not.toContain("REPETITION");
    expect(review.decision).toBe("PASS");
  });

  it("8. summary unsupported evaluation → inference failure", () => {
    const { review } = reviewFixture("fixture-summary-eval-fail");
    expect(review.failures.map((f) => f.code)).toContain("EVALUATIVE_INFERENCE");
    expect(review.failures.map((f) => f.code)).not.toContain("REPETITION");
  });

  it("9. body A then A+B → novel gain, not full restatement", () => {
    const { review } = reviewFixture("fixture-body-a-then-ab");
    expect(review.metrics.supportedNovelAssertionCount).toBeGreaterThanOrEqual(2);
    expect(review.decision).toBe("PASS");
  });

  it("10. different claimIds, same facets → semantic repetition", () => {
    const { review } = reviewFixture("fixture-cross-claim-semantic-dup");
    expect(review.failures.map((f) => f.code)).toContain("REPETITION");
  });

  it("eval-risk-fail no longer attaches REPETITION as FP", () => {
    const { review } = reviewFixture("fixture-eval-risk-fail");
    expect(review.failures.map((f) => f.code)).toEqual(
      expect.arrayContaining(["EVALUATIVE_INFERENCE", "INTERPRETIVE_INFERENCE"]),
    );
    expect(review.failures.map((f) => f.code)).not.toContain("REPETITION");
  });

  it("title-rich explicit facts are not NAME_DERIVED", () => {
    const { review } = reviewFixture("fixture-title-rich-explicit-pass");
    expect(review.failures.map((f) => f.code)).not.toContain("NAME_DERIVED_INFERENCE");
    expect(review.decision).toBe("PASS");
  });

  it("title-rich keeps Claim-absent evaluation/unsupported as inference", () => {
    const { review } = reviewFixture("fixture-title-rich-extra-inference-fail");
    const codes = review.failures.map((f) => f.code);
    expect(codes).not.toContain("NAME_DERIVED_INFERENCE");
    expect(codes).toEqual(expect.arrayContaining(["EVALUATIVE_INFERENCE"]));
    expect(review.decision).not.toBe("PASS");
  });

  it("supported facet + new evaluation relation → EVALUATIVE_INFERENCE", () => {
    const { review } = reviewFixture("fixture-evaluative-on-supported-facet");
    expect(review.failures.map((f) => f.code)).toContain("EVALUATIVE_INFERENCE");
    expect(review.decision).not.toBe("PASS");
  });
});
