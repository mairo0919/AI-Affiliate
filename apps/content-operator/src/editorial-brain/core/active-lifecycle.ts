/**
 * ACTIVE Brain lifecycle state machine SSOT.
 * MAX_TARGETED_REPAIR_ATTEMPTS remains 1 — ACTIVE does not increase repair budget.
 */

import type { BrainDecision, BrainRunMode, EditorialChannelId } from "./types.js";
import type { ChannelBrainCapabilities } from "./channel-module.js";

/** Explicit lifecycle states (production authority). */
export type BrainLifecycleState =
  | "PLAN"
  | "GENERATE"
  | "DET_VALIDATE"
  | "BRAIN_REVIEW"
  | "REPAIR"
  | "ACCEPTED"
  | "BLOCKED_REGEN"
  | "BLOCKED_INPUT"
  | "BLOCKED_INTERNAL"
  | "BLOCKED_HUMAN_REVIEW"
  | "SHADOW_OBSERVED";

export type BrainLifecycleRecord = {
  mode: BrainRunMode;
  channel: EditorialChannelId;
  state: BrainLifecycleState;
  brainDecision: string;
  legacyDecision: string | null;
  downstreamAllowed: boolean;
  /** Explicit accepted version id — never "latest wins". */
  acceptedContentVersionId: string | null;
  blockReason: string | null;
  brainRunId: string | null;
  initialContentVersionId: string | null;
  repairContentVersionId: string | null;
  humanApprovalRequired: true;
  humanApprovalStatus: "pending" | "approved" | "rejected" | "n/a";
  repairAttempted: boolean;
  maxRepairAttempts: 1;
};

export const MAX_ACTIVE_REPAIR_ATTEMPTS = 1 as const;

/**
 * Map Brain review/repair outcome → terminal lifecycle state (ACTIVE).
 */
export function resolveActiveTerminalState(input: {
  brainDecision: BrainDecision | string;
  channelCapabilities: ChannelBrainCapabilities;
  repairAttempted: boolean;
  repairOutcome?: BrainDecision | string | null;
  badInput?: boolean;
  internalError?: boolean;
  internalErrorCode?: string;
}): {
  state: BrainLifecycleState;
  downstreamAllowed: boolean;
  blockReason: string | null;
  brainDecision: string;
} {
  if (input.internalError) {
    return {
      state: "BLOCKED_INTERNAL",
      downstreamAllowed: false,
      blockReason: input.internalErrorCode ?? "BRAIN_INTERNAL_ERROR",
      brainDecision: "ESCALATE",
    };
  }
  if (input.badInput) {
    return {
      state: "BLOCKED_INPUT",
      downstreamAllowed: false,
      blockReason: "BAD_INPUT_CLAIM",
      brainDecision: "ESCALATE",
    };
  }

  const effective = String(input.repairAttempted ? input.repairOutcome ?? input.brainDecision : input.brainDecision);

  if (effective === "PASS") {
    return {
      state: "ACCEPTED",
      downstreamAllowed: true,
      blockReason: null,
      brainDecision: "PASS",
    };
  }

  if (
    effective === "DEFER_INSUFFICIENT_MATERIAL" ||
    effective === "INSUFFICIENT_SUPPORTED_MATERIAL"
  ) {
    return {
      state: "BLOCKED_REGEN",
      downstreamAllowed: false,
      blockReason: "INSUFFICIENT_SUPPORTED_MATERIAL",
      brainDecision: "DEFER_INSUFFICIENT_MATERIAL",
    };
  }

  if (effective === "TARGETED_REPAIR") {
    if (!input.channelCapabilities.targetedRepair) {
      return {
        state: "BLOCKED_REGEN",
        downstreamAllowed: false,
        blockReason: "CHANNEL_REPAIR_UNSUPPORTED",
        brainDecision: "TARGETED_REPAIR",
      };
    }
    if (input.repairAttempted) {
      // Already used max=1 — further TARGETED_REPAIR becomes block
      return {
        state: "BLOCKED_REGEN",
        downstreamAllowed: false,
        blockReason: "QUALITY_REPAIR_REQUIRED",
        brainDecision: "REGEN_CANDIDATE",
      };
    }
    // Caller should run repair; this is pre-repair terminal only if not attempting
    return {
      state: "BLOCKED_REGEN",
      downstreamAllowed: false,
      blockReason: "QUALITY_REPAIR_REQUIRED",
      brainDecision: "TARGETED_REPAIR",
    };
  }

  if (
    effective === "REGEN_CANDIDATE" ||
    effective === "FULL_REGEN" ||
    effective === "REPLAN"
  ) {
    return {
      state: "BLOCKED_REGEN",
      downstreamAllowed: false,
      blockReason: "QUALITY_REPAIR_REQUIRED",
      brainDecision: effective,
    };
  }

  if (effective === "ESCALATE" || effective === "HUMAN_REVIEW_CANDIDATE") {
    return {
      state: "BLOCKED_HUMAN_REVIEW",
      downstreamAllowed: false,
      blockReason: "BRAIN_REVIEW_FAILED",
      brainDecision: effective,
    };
  }

  return {
    state: "BLOCKED_REGEN",
    downstreamAllowed: false,
    blockReason: "BRAIN_REVIEW_FAILED",
    brainDecision: effective,
  };
}

export function buildLifecycleRecord(input: {
  mode: BrainRunMode;
  channel: EditorialChannelId;
  terminal: ReturnType<typeof resolveActiveTerminalState>;
  legacyDecision?: string | null;
  brainRunId?: string | null;
  initialContentVersionId?: string | null;
  repairContentVersionId?: string | null;
  repairAttempted?: boolean;
  humanApprovalStatus?: BrainLifecycleRecord["humanApprovalStatus"];
}): BrainLifecycleRecord {
  const acceptedId =
    input.terminal.downstreamAllowed
      ? input.repairContentVersionId ?? input.initialContentVersionId ?? null
      : null;
  return {
    mode: input.mode,
    channel: input.channel,
    state: input.mode === "SHADOW" ? "SHADOW_OBSERVED" : input.terminal.state,
    brainDecision: input.terminal.brainDecision,
    legacyDecision: input.legacyDecision ?? null,
    // SHADOW never gains production authority via this stamp
    downstreamAllowed: input.mode === "ACTIVE" ? input.terminal.downstreamAllowed : false,
    acceptedContentVersionId: input.mode === "ACTIVE" ? acceptedId : null,
    blockReason: input.mode === "ACTIVE" ? input.terminal.blockReason : null,
    brainRunId: input.brainRunId ?? null,
    initialContentVersionId: input.initialContentVersionId ?? null,
    repairContentVersionId: input.repairContentVersionId ?? null,
    humanApprovalRequired: true,
    humanApprovalStatus: input.humanApprovalStatus ?? "pending",
    repairAttempted: Boolean(input.repairAttempted),
    maxRepairAttempts: MAX_ACTIVE_REPAIR_ATTEMPTS,
  };
}

export function formatActiveFinalDecision(lifecycle: BrainLifecycleRecord): string {
  if (lifecycle.mode === "SHADOW") {
    return `LEGACY:${lifecycle.legacyDecision ?? "UNKNOWN"}|BRAIN_SHADOW:${lifecycle.brainDecision}`;
  }
  if (lifecycle.downstreamAllowed) {
    return `BRAIN_ACTIVE:PASS|STATE:ACCEPTED|DOWNSTREAM:ALLOW`;
  }
  return `BRAIN_ACTIVE:${lifecycle.brainDecision}|STATE:${lifecycle.state}|DOWNSTREAM:BLOCK|REASON:${lifecycle.blockReason ?? "UNKNOWN"}`;
}
