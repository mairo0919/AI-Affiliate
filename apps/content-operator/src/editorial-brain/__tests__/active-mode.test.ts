/**
 * ACTIVE mode lifecycle / authority / fail-closed simulations (no publish).
 */

import { describe, expect, it } from "vitest";
import {
  applyBrainProductionAuthority,
  brainAcceptedDoesNotAutoApprove,
  editorialAuthorityBoundary,
  experienceMustNotMutateLearningRules,
  getChannelCapabilities,
  handleBrainInternalError,
  isBrainAcceptedForDownstream,
  MAX_ACTIVE_REPAIR_ATTEMPTS,
  MAX_TARGETED_REPAIR_ATTEMPTS,
  mergeBrainLifecycleIntoStructured,
  QUALITY_GATE_STAGE_CATALOG,
  resolveEditorialBrainMode,
  withEditorialBrainModeOverride,
  ensureChannelModulesRegistered,
} from "../index.js";

ensureChannelModulesRegistered();

describe("Editorial Brain ACTIVE lifecycle", () => {
  it("default mode is SHADOW", () => {
    // Explicit unset/invalid values — not process.env (production may be ACTIVE)
    expect(resolveEditorialBrainMode("")).toBe("SHADOW");
    expect(resolveEditorialBrainMode("nope")).toBe("SHADOW");
    expect(resolveEditorialBrainMode("SHADOW")).toBe("SHADOW");
    expect(withEditorialBrainModeOverride("SHADOW", () => resolveEditorialBrainMode("ACTIVE"))).toBe(
      "SHADOW",
    );
    expect(resolveEditorialBrainMode("ACTIVE")).toBe("ACTIVE");
  });

  it("1. clean initial PASS → ACCEPTED", () => {
    const r = withEditorialBrainModeOverride("ACTIVE", () =>
      applyBrainProductionAuthority({
        mode: "ACTIVE",
        channel: "BLOG",
        channelCapabilities: getChannelCapabilities("BLOG"),
        brainDecision: "PASS",
        initialContentVersionId: "v1",
      }),
    );
    expect(r.lifecycle.state).toBe("ACCEPTED");
    expect(r.downstreamAllowed).toBe(true);
    expect(r.lifecycle.acceptedContentVersionId).toBe("v1");
  });

  it("2. repair DELETE → PASS → ACCEPTED repaired version", () => {
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
    expect(r.lifecycle.state).toBe("ACCEPTED");
    expect(r.lifecycle.acceptedContentVersionId).toBe("v2");
    expect(r.downstreamAllowed).toBe(true);
  });

  it("3. repair REPLACE → PASS → ACCEPTED", () => {
    const r = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "BLOG",
      channelCapabilities: getChannelCapabilities("BLOG"),
      brainDecision: "TARGETED_REPAIR",
      repairAttempted: true,
      repairOutcome: "PASS",
      initialContentVersionId: "v1",
      repairContentVersionId: "v2-replace",
    });
    expect(r.lifecycle.acceptedContentVersionId).toBe("v2-replace");
  });

  it("4. repair → REGEN → BLOCKED", () => {
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
    expect(r.lifecycle.state).toBe("BLOCKED_REGEN");
    expect(r.downstreamAllowed).toBe(false);
  });

  it("5. BAD_INPUT → BLOCKED", () => {
    const r = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "BLOG",
      channelCapabilities: getChannelCapabilities("BLOG"),
      brainDecision: "PASS",
      badInput: true,
      initialContentVersionId: "v1",
    });
    expect(r.lifecycle.state).toBe("BLOCKED_INPUT");
    expect(r.lifecycle.blockReason).toBe("BAD_INPUT_CLAIM");
  });

  it("6. Brain internal error ACTIVE → BLOCKED", () => {
    const r = handleBrainInternalError({
      mode: "ACTIVE",
      channel: "BLOG",
      channelCapabilities: getChannelCapabilities("BLOG"),
      errorMessage: "boom",
      contentVersionId: "v1",
    });
    expect(r.continueGeneration).toBe(false);
    expect(r.lifecycle.state).toBe("BLOCKED_INTERNAL");
    expect(r.failureCode).toBe("BRAIN_INTERNAL_ERROR");
  });

  it("7. same internal error SHADOW → continue generation", () => {
    const r = handleBrainInternalError({
      mode: "SHADOW",
      channel: "BLOG",
      channelCapabilities: getChannelCapabilities("BLOG"),
      errorMessage: "boom",
      contentVersionId: "v1",
      legacyDecision: "GENERATED_OK",
    });
    expect(r.continueGeneration).toBe(true);
    expect(r.lifecycle.downstreamAllowed).toBe(false);
    expect(r.lifecycle.state).toBe("SHADOW_OBSERVED");
  });

  it("8. human approval still required after Brain ACCEPTED", () => {
    expect(brainAcceptedDoesNotAutoApprove()).toEqual({
      brainPassEqualsPublishApproval: false,
      requiresAwaitHumanApproval: true,
    });
  });

  it("9. accepted + human approval path is publish-candidate only (no auto publish)", () => {
    const structured = mergeBrainLifecycleIntoStructured(null, {
      mode: "ACTIVE",
      channel: "BLOG",
      state: "ACCEPTED",
      brainDecision: "PASS",
      legacyDecision: "GENERATED_OK",
      downstreamAllowed: true,
      acceptedContentVersionId: "v2",
      blockReason: null,
      brainRunId: "br1",
      initialContentVersionId: "v1",
      repairContentVersionId: "v2",
      humanApprovalRequired: true,
      humanApprovalStatus: "pending",
      repairAttempted: true,
      maxRepairAttempts: 1,
    });
    const gate = withEditorialBrainModeOverride("ACTIVE", () =>
      isBrainAcceptedForDownstream({
        structuredContent: structured,
        contentVersionId: "v2",
      }),
    );
    expect(gate.allowed).toBe(true);
    // still pending human — Brain does not approve
    expect(gate.lifecycle?.humanApprovalStatus).toBe("pending");
  });

  it("X TARGETED_REPAIR without capability → BLOCKED (no BLOG repair reuse)", () => {
    const r = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "X",
      channelCapabilities: getChannelCapabilities("X"),
      brainDecision: "TARGETED_REPAIR",
      repairAttempted: false,
      initialContentVersionId: "xv1",
    });
    expect(getChannelCapabilities("X").targetedRepair).toBe(false);
    expect(r.lifecycle.blockReason).toBe("CHANNEL_REPAIR_UNSUPPORTED");
    expect(r.downstreamAllowed).toBe(false);
  });

  it("SHADOW does not allow downstream via stamp", () => {
    const r = applyBrainProductionAuthority({
      mode: "SHADOW",
      channel: "BLOG",
      channelCapabilities: getChannelCapabilities("BLOG"),
      brainDecision: "PASS",
      initialContentVersionId: "v1",
    });
    expect(r.lifecycle.state).toBe("SHADOW_OBSERVED");
    expect(r.downstreamAllowed).toBe(false);
  });

  it("draft gate: ACTIVE rejects non-accepted version", () => {
    const blocked = withEditorialBrainModeOverride("ACTIVE", () =>
      isBrainAcceptedForDownstream({
        structuredContent: {},
        contentVersionId: "v1",
      }),
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("BRAIN_LIFECYCLE_MISSING");
  });

  it("draft gate: SHADOW allows without lifecycle stamp", () => {
    const ok = withEditorialBrainModeOverride("SHADOW", () =>
      isBrainAcceptedForDownstream({
        structuredContent: {},
        contentVersionId: "v1",
      }),
    );
    expect(ok.allowed).toBe(true);
  });

  it("repair max remains 1", () => {
    expect(MAX_TARGETED_REPAIR_ATTEMPTS).toBe(1);
    expect(MAX_ACTIVE_REPAIR_ATTEMPTS).toBe(1);
  });

  it("QualityGate catalog classifies stages", () => {
    expect(QUALITY_GATE_STAGE_CATALOG.some((e) => e.authority === "HARD_DETERMINISTIC")).toBe(
      true,
    );
    expect(QUALITY_GATE_STAGE_CATALOG.some((e) => e.authority === "SEMANTIC_EDITORIAL")).toBe(
      true,
    );
    expect(editorialAuthorityBoundary().neverDoubleBillSemantic).toBe(true);
  });

  it("LearningRule unchanged guard", () => {
    expect(experienceMustNotMutateLearningRules()).toEqual({
      autoPromote: false,
      writesLearningRule: false,
    });
  });

  it("accepted version mismatch blocks wrong ContentVersion", () => {
    const structured = mergeBrainLifecycleIntoStructured(null, {
      mode: "ACTIVE",
      channel: "BLOG",
      state: "ACCEPTED",
      brainDecision: "PASS",
      legacyDecision: null,
      downstreamAllowed: true,
      acceptedContentVersionId: "accepted-v",
      blockReason: null,
      brainRunId: null,
      initialContentVersionId: "v0",
      repairContentVersionId: "accepted-v",
      humanApprovalRequired: true,
      humanApprovalStatus: "pending",
      repairAttempted: true,
      maxRepairAttempts: 1,
    });
    const wrong = withEditorialBrainModeOverride("ACTIVE", () =>
      isBrainAcceptedForDownstream({
        structuredContent: structured,
        contentVersionId: "other-v",
      }),
    );
    expect(wrong.allowed).toBe(false);
    expect(wrong.reason).toBe("BRAIN_ACCEPTED_VERSION_MISMATCH");
  });
});
