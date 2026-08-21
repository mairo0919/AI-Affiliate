/**
 * ContentVersion Brain acceptance — no new DB columns.
 * Stored under structuredContent.brainLifecycle.
 */

import type { BrainLifecycleRecord } from "./active-lifecycle.js";
import { resolveEditorialBrainMode } from "./mode.js";

export const BRAIN_LIFECYCLE_KEY = "brainLifecycle" as const;

export function readBrainLifecycle(
  structuredContent: unknown,
): BrainLifecycleRecord | null {
  if (!structuredContent || typeof structuredContent !== "object") return null;
  const raw = (structuredContent as Record<string, unknown>)[BRAIN_LIFECYCLE_KEY];
  if (!raw || typeof raw !== "object") return null;
  return raw as BrainLifecycleRecord;
}

export function mergeBrainLifecycleIntoStructured(
  structuredContent: unknown,
  lifecycle: BrainLifecycleRecord,
): Record<string, unknown> {
  const base =
    structuredContent && typeof structuredContent === "object"
      ? { ...(structuredContent as Record<string, unknown>) }
      : {};
  return {
    ...base,
    [BRAIN_LIFECYCLE_KEY]: lifecycle,
  };
}

/**
 * ACTIVE: only explicitly Brain-accepted versions may proceed to draft/publish candidate.
 * SHADOW: Brain does not gate (backward compatible).
 */
export function isBrainAcceptedForDownstream(input: {
  structuredContent: unknown;
  contentVersionId: string;
  mode?: ReturnType<typeof resolveEditorialBrainMode>;
}): { allowed: boolean; reason: string | null; lifecycle: BrainLifecycleRecord | null } {
  const mode = input.mode ?? resolveEditorialBrainMode();
  if (mode !== "ACTIVE") {
    return { allowed: true, reason: null, lifecycle: readBrainLifecycle(input.structuredContent) };
  }
  const lifecycle = readBrainLifecycle(input.structuredContent);
  if (!lifecycle) {
    return {
      allowed: false,
      reason: "BRAIN_LIFECYCLE_MISSING",
      lifecycle: null,
    };
  }
  if (lifecycle.state !== "ACCEPTED" || !lifecycle.downstreamAllowed) {
    return {
      allowed: false,
      reason: lifecycle.blockReason ?? `BRAIN_STATE_${lifecycle.state}`,
      lifecycle,
    };
  }
  if (
    lifecycle.acceptedContentVersionId &&
    lifecycle.acceptedContentVersionId !== input.contentVersionId
  ) {
    return {
      allowed: false,
      reason: "BRAIN_ACCEPTED_VERSION_MISMATCH",
      lifecycle,
    };
  }
  return { allowed: true, reason: null, lifecycle };
}

/** Human approval is separate — Brain ACCEPTED ≠ auto-approve. */
export function brainAcceptedDoesNotAutoApprove(): {
  brainPassEqualsPublishApproval: false;
  requiresAwaitHumanApproval: true;
} {
  return {
    brainPassEqualsPublishApproval: false,
    requiresAwaitHumanApproval: true,
  };
}
