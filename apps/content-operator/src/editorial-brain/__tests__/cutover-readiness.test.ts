/**
 * QualityGate semantic integration + ACTIVE cutover readiness tests.
 */

import { describe, expect, it } from "vitest";
import {
  BUSINESS_LLM_REVIEW_TYPES,
  LEGACY_SEMANTIC_LLM_REVIEW_TYPES,
  QUALITY_GATE_EXECUTION_INVENTORY,
  SEMANTIC_COVERAGE_PARITY,
  applyBrainProductionAuthority,
  brainAcceptedDoesNotAutoApprove,
  buildGateExecutionPlan,
  classifyContentVersionCompatibility,
  experienceMustNotMutateLearningRules,
  getChannelCapabilities,
  handleBrainInternalError,
  isBrainAcceptedForDownstream,
  mergeBrainLifecycleIntoStructured,
  preBrainCutoverPolicy,
  withEditorialBrainModeOverride,
  ensureChannelModulesRegistered,
} from "../index.js";

ensureChannelModulesRegistered();

function acceptedStructured(versionId = "v-accepted") {
  return mergeBrainLifecycleIntoStructured(null, {
    mode: "ACTIVE",
    channel: "BLOG",
    state: "ACCEPTED",
    brainDecision: "PASS",
    legacyDecision: "GENERATED_OK",
    downstreamAllowed: true,
    acceptedContentVersionId: versionId,
    blockReason: null,
    brainRunId: "br1",
    initialContentVersionId: versionId,
    repairContentVersionId: null,
    humanApprovalRequired: true,
    humanApprovalStatus: "pending",
    repairAttempted: false,
    maxRepairAttempts: 1,
  });
}

describe("QualityGate execution plan", () => {
  it("1. SHADOW → legacy semantic runs", () => {
    const plan = buildGateExecutionPlan({ mode: "SHADOW", structuredContent: {} });
    expect(plan.semanticAuthority).toBe("LEGACY");
    expect(plan.skipLegacySemanticLlm).toBe(false);
    expect(plan.allowedLlmReviewTypes).toEqual(
      expect.arrayContaining([...LEGACY_SEMANTIC_LLM_REVIEW_TYPES, ...BUSINESS_LLM_REVIEW_TYPES]),
    );
  });

  it("2. ACTIVE accepted → legacy semantic skipped", () => {
    const plan = withEditorialBrainModeOverride("ACTIVE", () =>
      buildGateExecutionPlan({
        mode: "ACTIVE",
        structuredContent: acceptedStructured(),
      }),
    );
    expect(plan.semanticAuthority).toBe("BRAIN");
    expect(plan.skipLegacySemanticLlm).toBe(true);
    expect(plan.skipLegacySemanticDeterministic).toBe(true);
    expect(plan.allowedLlmReviewTypes).toEqual([...BUSINESS_LLM_REVIEW_TYPES]);
    expect(plan.legacySemanticGateSkippedReason).toBe("ACTIVE_BRAIN_SEMANTIC_AUTHORITY");
  });

  it("3. ACTIVE blocked / missing → still no legacy semantic fallback", () => {
    const plan = buildGateExecutionPlan({ mode: "ACTIVE", structuredContent: {} });
    expect(plan.skipLegacySemanticLlm).toBe(true);
    expect(plan.legacySemanticGateSkippedReason).toBe(
      "ACTIVE_FAIL_CLOSED_NO_LEGACY_SEMANTIC_FALLBACK",
    );
  });

  it("4. ACTIVE Brain internal error → fail closed", () => {
    const r = handleBrainInternalError({
      mode: "ACTIVE",
      channel: "BLOG",
      channelCapabilities: getChannelCapabilities("BLOG"),
      errorMessage: "boom",
      contentVersionId: "v1",
    });
    expect(r.continueGeneration).toBe(false);
    expect(r.lifecycle.state).toBe("BLOCKED_INTERNAL");
  });

  it("5–6. business + hard gates remain in inventory as ACTIVE-run", () => {
    const hard = QUALITY_GATE_EXECUTION_INVENTORY.filter(
      (e) => e.category === "HARD_DETERMINISTIC",
    );
    const business = QUALITY_GATE_EXECUTION_INVENTORY.filter(
      (e) => e.category === "BUSINESS_PUBLISH_POLICY",
    );
    expect(hard.every((e) => e.runInActiveWhenBrainAuthority || e.stage === "brain_acceptance")).toBe(
      true,
    );
    expect(business.every((e) => e.runInActiveWhenBrainAuthority)).toBe(true);
  });

  it("7. semantic-only duplicate LLM cost = 0 in ACTIVE plan", () => {
    const plan = buildGateExecutionPlan({
      mode: "ACTIVE",
      structuredContent: acceptedStructured(),
    });
    expect(
      plan.allowedLlmReviewTypes.filter((t) =>
        (LEGACY_SEMANTIC_LLM_REVIEW_TYPES as readonly string[]).includes(t),
      ),
    ).toEqual([]);
  });

  it("semantic coverage parity has no product-specific transplants", () => {
    expect(SEMANTIC_COVERAGE_PARITY.every((r) => !/商品|fanza|dmm/i.test(r.brainAxis))).toBe(
      true,
    );
    expect(SEMANTIC_COVERAGE_PARITY.filter((r) => r.disposition === "brain").length).toBeGreaterThan(
      3,
    );
  });
});

describe("Pre-Brain compatibility", () => {
  it("8. pre-brain REVIEWING implicit accept forbidden", () => {
    const a = classifyContentVersionCompatibility({
      contentVersionId: "v1",
      status: "REVIEWING",
      structuredContent: {},
      hasPublishedEvidence: false,
      hasDraftTarget: false,
      stampable: true,
    });
    expect(a.compatibilityClass).toBe("REVIEWING_PRE_BRAIN");
    expect(a.implicitAcceptForbidden).toBe(true);
    expect(a.cutoverAction).toBe("requires_re_review_stamp");
    const gate = withEditorialBrainModeOverride("ACTIVE", () =>
      isBrainAcceptedForDownstream({ structuredContent: {}, contentVersionId: "v1" }),
    );
    expect(gate.allowed).toBe(false);
  });

  it("9. pre-brain published historical maintained", () => {
    const a = classifyContentVersionCompatibility({
      contentVersionId: "v-pub",
      status: "APPROVED",
      structuredContent: {},
      hasPublishedEvidence: true,
      hasDraftTarget: false,
    });
    expect(a.compatibilityClass).toBe("PUBLISHED_HISTORICAL");
    expect(a.cutoverAction).toBe("none_historical");
    expect(preBrainCutoverPolicy().publishedHistoricalInvalidationForbidden).toBe(true);
  });

  it("10. missing lifecycle ACTIVE draft拒否", () => {
    const gate = withEditorialBrainModeOverride("ACTIVE", () =>
      isBrainAcceptedForDownstream({ structuredContent: {}, contentVersionId: "v1" }),
    );
    expect(gate.allowed).toBe(false);
  });

  it("11. accepted lifecycle draft可", () => {
    const gate = withEditorialBrainModeOverride("ACTIVE", () =>
      isBrainAcceptedForDownstream({
        structuredContent: acceptedStructured("v2"),
        contentVersionId: "v2",
      }),
    );
    expect(gate.allowed).toBe(true);
  });

  it("12. human approval境界維持", () => {
    expect(brainAcceptedDoesNotAutoApprove().brainPassEqualsPublishApproval).toBe(false);
  });

  it("13. repair PASS accepted versionのみ", () => {
    const r = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "BLOG",
      channelCapabilities: getChannelCapabilities("BLOG"),
      brainDecision: "TARGETED_REPAIR",
      repairAttempted: true,
      repairOutcome: "PASS",
      initialContentVersionId: "v1",
      repairContentVersionId: "v2",
    });
    expect(r.lifecycle.acceptedContentVersionId).toBe("v2");
  });

  it("14. failed repaired version publish不可", () => {
    const r = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "BLOG",
      channelCapabilities: getChannelCapabilities("BLOG"),
      brainDecision: "TARGETED_REPAIR",
      repairAttempted: true,
      repairOutcome: "REGEN_CANDIDATE",
      initialContentVersionId: "v1",
      repairContentVersionId: "v2",
    });
    expect(r.downstreamAllowed).toBe(false);
  });

  it("15. cutover audit module is read-only typed", async () => {
    const { auditActiveCutover } = await import("../cutover/audit-active-cutover.js");
    expect(typeof auditActiveCutover).toBe("function");
    expect(preBrainCutoverPolicy().bulkDbAcceptMigrationForbidden).toBe(true);
  });

  it("16. SHADOW backward compatibility", () => {
    const plan = buildGateExecutionPlan({ mode: "SHADOW", structuredContent: {} });
    expect(plan.skipLegacySemanticLlm).toBe(false);
    const gate = withEditorialBrainModeOverride("SHADOW", () =>
      isBrainAcceptedForDownstream({ structuredContent: {}, contentVersionId: "v1" }),
    );
    expect(gate.allowed).toBe(true);
  });

  it("X REPAIR → BLOCK", () => {
    const r = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "X",
      channelCapabilities: getChannelCapabilities("X"),
      brainDecision: "TARGETED_REPAIR",
      initialContentVersionId: "x1",
    });
    expect(r.lifecycle.blockReason).toBe("CHANNEL_REPAIR_UNSUPPORTED");
  });

  it("19–23. LearningRule / no auto publish-approve", () => {
    expect(experienceMustNotMutateLearningRules()).toEqual({
      autoPromote: false,
      writesLearningRule: false,
    });
    expect(brainAcceptedDoesNotAutoApprove().requiresAwaitHumanApproval).toBe(true);
  });
});
