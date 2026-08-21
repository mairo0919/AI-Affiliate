/**
 * ACTIVE production authority application — pure + persist helpers.
 * Separates article quality failures from Brain observability/internal errors.
 */

import {
  buildLifecycleRecord,
  formatActiveFinalDecision,
  resolveActiveTerminalState,
  type BrainLifecycleRecord,
} from "./active-lifecycle.js";
import type { ChannelBrainCapabilities } from "./channel-module.js";
import type { BrainDecision, BrainRunMode, EditorialChannelId } from "./types.js";

/** Lifecycle / ops codes distinct from editorial quality taxonomy. */
export const BRAIN_LIFECYCLE_CODES = [
  "BRAIN_INTERNAL_ERROR",
  "BRAIN_REVIEW_FAILED",
  "BAD_INPUT_CLAIM",
  "QUALITY_REPAIR_REQUIRED",
  "CHANNEL_REPAIR_UNSUPPORTED",
  "INSUFFICIENT_SUPPORTED_MATERIAL",
  "BRAIN_LIFECYCLE_MISSING",
  "BRAIN_ACCEPTED_VERSION_MISMATCH",
  "BRAIN_NOT_ACCEPTED",
] as const;

export type BrainLifecycleCode = (typeof BRAIN_LIFECYCLE_CODES)[number];

export function applyBrainProductionAuthority(input: {
  mode: BrainRunMode;
  channel: EditorialChannelId;
  channelCapabilities: ChannelBrainCapabilities;
  brainDecision: BrainDecision | string;
  legacyDecision?: string | null;
  repairAttempted?: boolean;
  repairOutcome?: BrainDecision | string | null;
  badInput?: boolean;
  internalError?: boolean;
  internalErrorCode?: string;
  brainRunId?: string | null;
  initialContentVersionId?: string | null;
  repairContentVersionId?: string | null;
}): {
  lifecycle: BrainLifecycleRecord;
  finalDecision: string;
  downstreamAllowed: boolean;
} {
  const terminal = resolveActiveTerminalState({
    brainDecision: input.brainDecision,
    channelCapabilities: input.channelCapabilities,
    repairAttempted: Boolean(input.repairAttempted),
    repairOutcome: input.repairOutcome,
    badInput: input.badInput,
    internalError: input.internalError,
    internalErrorCode: input.internalErrorCode,
  });
  const lifecycle = buildLifecycleRecord({
    mode: input.mode,
    channel: input.channel,
    terminal,
    legacyDecision: input.legacyDecision,
    brainRunId: input.brainRunId,
    initialContentVersionId: input.initialContentVersionId,
    repairContentVersionId: input.repairContentVersionId,
    repairAttempted: input.repairAttempted,
  });
  return {
    lifecycle,
    finalDecision: formatActiveFinalDecision(lifecycle),
    downstreamAllowed: lifecycle.downstreamAllowed,
  };
}

/**
 * Fail-closed (ACTIVE) vs fail-open (SHADOW) for unexpected Brain errors.
 */
export function handleBrainInternalError(input: {
  mode: BrainRunMode;
  channel: EditorialChannelId;
  channelCapabilities: ChannelBrainCapabilities;
  errorMessage: string;
  legacyDecision?: string | null;
  contentVersionId?: string | null;
  brainRunId?: string | null;
}): {
  lifecycle: BrainLifecycleRecord;
  finalDecision: string;
  /** SHADOW: continue generation. ACTIVE: block downstream. */
  continueGeneration: boolean;
  failureCode: "BRAIN_INTERNAL_ERROR";
} {
  const applied = applyBrainProductionAuthority({
    mode: input.mode,
    channel: input.channel,
    channelCapabilities: input.channelCapabilities,
    brainDecision: "ESCALATE",
    legacyDecision: input.legacyDecision,
    internalError: true,
    internalErrorCode: "BRAIN_INTERNAL_ERROR",
    brainRunId: input.brainRunId,
    initialContentVersionId: input.contentVersionId,
  });
  return {
    lifecycle: applied.lifecycle,
    finalDecision: applied.finalDecision,
    continueGeneration: input.mode === "SHADOW",
    failureCode: "BRAIN_INTERNAL_ERROR",
  };
}
