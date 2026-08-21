/**
 * Explicit single-version Brain lifecycle stamp for pre-Brain ContentVersions.
 * Never mutates article body in-place. Never bulk-accepts.
 */

import type { LifecycleRepository } from "@ai-affiliate/database";
import { persistBrainLifecycleOnVersion } from "../core/persist-lifecycle.js";
import { readBrainLifecycle } from "../core/acceptance.js";
import { evaluateExistingContentVersion } from "./evaluate-existing.js";
import { ensureChannelModulesRegistered } from "../shadow/observe.js";

export type StampExistingResult = {
  contentVersionId: string;
  stamped: boolean;
  decision: string;
  state: string;
  downstreamAllowed: boolean;
  bodyMutated: false;
  reason: string;
  brainRunId?: string | null;
};

export async function stampExistingContentVersion(input: {
  repo: LifecycleRepository;
  contentVersionId: string;
  /** Force ACTIVE authority semantics for stamp (does not flip process default permanently). */
  asActive?: boolean;
}): Promise<StampExistingResult> {
  ensureChannelModulesRegistered();
  const version = await input.repo.findContentVersion(input.contentVersionId);
  if (!version) {
    return {
      contentVersionId: input.contentVersionId,
      stamped: false,
      decision: "SKIPPED",
      state: "BLOCKED_INTERNAL",
      downstreamAllowed: false,
      bodyMutated: false,
      reason: "CONTENT_VERSION_NOT_FOUND",
    };
  }

  const existing = readBrainLifecycle(version.structuredContent);
  if (existing) {
    return {
      contentVersionId: version.id,
      stamped: false,
      decision: existing.brainDecision,
      state: existing.state,
      downstreamAllowed: existing.downstreamAllowed,
      bodyMutated: false,
      reason: "SKIPPED_ALREADY_MANAGED",
      brainRunId: existing.brainRunId,
    };
  }

  const evaluated = await evaluateExistingContentVersion({
    repo: input.repo,
    contentVersionId: version.id,
  });

  if (!evaluated.proposedLifecycle) {
    return {
      contentVersionId: version.id,
      stamped: false,
      decision: evaluated.brainDecision,
      state: "BLOCKED_REGEN",
      downstreamAllowed: false,
      bodyMutated: false,
      reason: evaluated.regenerationReason ?? "NO_LIFECYCLE",
    };
  }

  // asActive is informational — evaluate already uses ACTIVE authority for cutover stamps
  void input.asActive;

  const brainRepo = input.repo.createEditorialBrainRepository();
  const brainRun = await brainRepo.createBrainRun({
    channel: "BLOG",
    mode: "ACTIVE",
    status: "COMPLETED",
    contentId: version.contentId,
    contentVersionId: version.id,
    contentType: "blogger-article",
    brainDecision: evaluated.brainDecision,
    legacyDecision: "STAMP_EXISTING",
    finalDecision: `BRAIN_ACTIVE:${evaluated.brainDecision}|STAMP_EXISTING`,
    failureCodes: evaluated.failureCodes,
    metadata: {
      stampExisting: true,
      bucket: evaluated.bucket,
      stampEligible: evaluated.stampEligible,
    },
  });

  await persistBrainLifecycleOnVersion(input.repo, version.id, {
    ...evaluated.proposedLifecycle,
    brainRunId: brainRun.id,
    humanApprovalStatus: "pending",
  });

  return {
    contentVersionId: version.id,
    stamped: true,
    decision: evaluated.brainDecision,
    state: evaluated.proposedLifecycle.state,
    downstreamAllowed: evaluated.proposedLifecycle.downstreamAllowed,
    bodyMutated: false,
    reason:
      evaluated.bucket === "ACCEPTABLE_EXISTING"
        ? "STAMPED_ACCEPTED"
        : evaluated.bucket === "BAD_INPUT"
          ? "STAMPED_BLOCKED_BAD_INPUT"
          : "STAMPED_BLOCKED_REQUIRES_REGENERATION_OR_REPAIR_PATH",
    brainRunId: brainRun.id,
  };
}
