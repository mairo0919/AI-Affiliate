/**
 * Execute ACTIVE cutover plan — per-version Brain stamp, never bulk accept / body mutate.
 * Idempotent: already BRAIN_MANAGED / PUBLISHED_HISTORICAL skipped.
 */

import { createHash } from "node:crypto";
import type { PrismaClient } from "@ai-affiliate/database";
import { LifecycleRepository } from "@ai-affiliate/database";
import { readBrainLifecycle } from "../core/acceptance.js";
import { persistBrainLifecycleOnVersion } from "../core/persist-lifecycle.js";
import type { ActiveCutoverPlan, CutoverPlanItem } from "./plan-active-cutover.js";
import { evaluateExistingContentVersion } from "./evaluate-existing.js";
import { ensureChannelModulesRegistered } from "../shadow/observe.js";

export type CutoverExecuteResultRow = {
  contentVersionId: string;
  preBrainStatus: string;
  brainDecision: string;
  stampResult:
    | "STAMPED_ACCEPTED"
    | "BLOCKED_REGEN"
    | "BLOCKED_BAD_INPUT"
    | "FAILED_INTERNAL"
    | "SKIPPED_ALREADY_MANAGED"
    | "SKIPPED_PUBLISHED"
    | "SKIPPED_OUT_OF_SCOPE"
    | "SKIPPED_SNAPSHOT_MISMATCH";
  blockReason: string | null;
  brainRunId: string | null;
  processedAt: string;
};

export type ActiveCutoverExecuteReport = {
  planId: string;
  snapshotHash: string;
  snapshotValid: boolean;
  stampedAccepted: number;
  blockedRegen: number;
  blockedBadInput: number;
  failedInternal: number;
  skippedAlreadyManaged: number;
  skippedPublished: number;
  skippedOutOfScope: number;
  rows: CutoverExecuteResultRow[];
  bodyMutated: false;
  autoPublish: false;
  autoApprove: false;
};

function recomputeExecutableHash(items: CutoverPlanItem[]): string {
  const ids = items
    .filter((i) => i.inCutoverScope)
    .filter((i) =>
      ["ACCEPTABLE_EXISTING", "REQUIRES_REGEN", "BAD_INPUT", "UNSAFE_AMBIGUOUS"].includes(
        i.bucket,
      ),
    )
    .map((i) => i.contentVersionId)
    .sort();
  const payload = ids
    .map((id) => {
      const it = items.find((x) => x.contentVersionId === id)!;
      return `${id}:${it.bucket}:${it.brainDecision}:${it.currentStatus}`;
    })
    .join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

export async function executeActiveCutover(input: {
  prisma: PrismaClient;
  repo: LifecycleRepository;
  plan: ActiveCutoverPlan;
  /** Re-validate plan against live DB; refuse if drift */
  requireSnapshotMatch?: boolean;
}): Promise<ActiveCutoverExecuteReport> {
  ensureChannelModulesRegistered();
  const requireMatch = input.requireSnapshotMatch !== false;
  const liveHash = recomputeExecutableHash(input.plan.items);
  let snapshotValid = liveHash === input.plan.snapshotHash;

  // Live DB drift check: statuses / lifecycle presence must match plan expectations
  if (requireMatch) {
    if (!snapshotValid) {
      return {
        planId: input.plan.planId,
        snapshotHash: input.plan.snapshotHash,
        snapshotValid: false,
        stampedAccepted: 0,
        blockedRegen: 0,
        blockedBadInput: 0,
        failedInternal: 0,
        skippedAlreadyManaged: 0,
        skippedPublished: 0,
        skippedOutOfScope: 0,
        rows: input.plan.executableVersionIds.map((id) => ({
          contentVersionId: id,
          preBrainStatus: "UNKNOWN",
          brainDecision: "SKIPPED",
          stampResult: "SKIPPED_SNAPSHOT_MISMATCH" as const,
          blockReason: "PLAN_SNAPSHOT_HASH_DRIFT",
          brainRunId: null,
          processedAt: new Date().toISOString(),
        })),
        bodyMutated: false,
        autoPublish: false,
        autoApprove: false,
      };
    }
    for (const id of input.plan.executableVersionIds) {
      const planned = input.plan.items.find((i) => i.contentVersionId === id);
      const live = await input.repo.findContentVersion(id);
      if (!planned || !live) {
        snapshotValid = false;
        return {
          planId: input.plan.planId,
          snapshotHash: input.plan.snapshotHash,
          snapshotValid: false,
          stampedAccepted: 0,
          blockedRegen: 0,
          blockedBadInput: 0,
          failedInternal: 0,
          skippedAlreadyManaged: 0,
          skippedPublished: 0,
          skippedOutOfScope: 0,
          rows: [
            {
              contentVersionId: id,
              preBrainStatus: live?.status ?? "MISSING",
              brainDecision: "SKIPPED",
              stampResult: "SKIPPED_SNAPSHOT_MISMATCH",
              blockReason: "PLAN_VERSION_MISSING_OR_UNKNOWN",
              brainRunId: null,
              processedAt: new Date().toISOString(),
            },
          ],
          bodyMutated: false,
          autoPublish: false,
          autoApprove: false,
        };
      }
      if (live.status !== planned.currentStatus) {
        snapshotValid = false;
        return {
          planId: input.plan.planId,
          snapshotHash: input.plan.snapshotHash,
          snapshotValid: false,
          stampedAccepted: 0,
          blockedRegen: 0,
          blockedBadInput: 0,
          failedInternal: 0,
          skippedAlreadyManaged: 0,
          skippedPublished: 0,
          skippedOutOfScope: 0,
          rows: [
            {
              contentVersionId: id,
              preBrainStatus: live.status,
              brainDecision: "SKIPPED",
              stampResult: "SKIPPED_SNAPSHOT_MISMATCH",
              blockReason: `STATUS_DRIFT:${planned.currentStatus}->${live.status}`,
              brainRunId: null,
              processedAt: new Date().toISOString(),
            },
          ],
          bodyMutated: false,
          autoPublish: false,
          autoApprove: false,
        };
      }
    }
  }

  const rows: CutoverExecuteResultRow[] = [];
  let stampedAccepted = 0;
  let blockedRegen = 0;
  let blockedBadInput = 0;
  let failedInternal = 0;
  let skippedAlreadyManaged = 0;
  let skippedPublished = 0;
  let skippedOutOfScope = 0;

  const brainRepo = input.repo.createEditorialBrainRepository();

  for (const planItem of input.plan.items) {
    if (!planItem.inCutoverScope) {
      if (
        planItem.bucket === "SKIP_PUBLISHED_HISTORICAL" ||
        planItem.productionRelevance === "PUBLISHED_HISTORICAL"
      ) {
        skippedPublished += 1;
        rows.push({
          contentVersionId: planItem.contentVersionId,
          preBrainStatus: planItem.currentStatus,
          brainDecision: "SKIPPED",
          stampResult: "SKIPPED_PUBLISHED",
          blockReason: null,
          brainRunId: null,
          processedAt: new Date().toISOString(),
        });
      } else {
        skippedOutOfScope += 1;
      }
      continue;
    }

    if (
      !["ACCEPTABLE_EXISTING", "REQUIRES_REGEN", "BAD_INPUT", "UNSAFE_AMBIGUOUS"].includes(
        planItem.bucket,
      )
    ) {
      skippedOutOfScope += 1;
      continue;
    }

    try {
      const version = await input.repo.findContentVersion(planItem.contentVersionId);
      if (!version) {
        failedInternal += 1;
        rows.push({
          contentVersionId: planItem.contentVersionId,
          preBrainStatus: "MISSING",
          brainDecision: "ESCALATE",
          stampResult: "FAILED_INTERNAL",
          blockReason: "CONTENT_VERSION_NOT_FOUND",
          brainRunId: null,
          processedAt: new Date().toISOString(),
        });
        continue;
      }

      const existing = readBrainLifecycle(version.structuredContent);
      if (existing) {
        skippedAlreadyManaged += 1;
        rows.push({
          contentVersionId: version.id,
          preBrainStatus: version.status,
          brainDecision: existing.brainDecision,
          stampResult: "SKIPPED_ALREADY_MANAGED",
          blockReason: null,
          brainRunId: existing.brainRunId,
          processedAt: new Date().toISOString(),
        });
        continue;
      }

      // Re-evaluate live (idempotent safety) — do not trust stale plan alone for ACCEPT
      const evaluated = await evaluateExistingContentVersion({
        repo: input.repo,
        contentVersionId: version.id,
      });

      if (!evaluated.proposedLifecycle) {
        failedInternal += 1;
        rows.push({
          contentVersionId: version.id,
          preBrainStatus: version.status,
          brainDecision: evaluated.brainDecision,
          stampResult: "FAILED_INTERNAL",
          blockReason: evaluated.regenerationReason ?? "NO_PROPOSED_LIFECYCLE",
          brainRunId: null,
          processedAt: new Date().toISOString(),
        });
        continue;
      }

      const brainRun = await brainRepo.createBrainRun({
        channel: evaluated.channel === "X" ? "X" : "BLOG",
        mode: "ACTIVE",
        status: "COMPLETED",
        contentId: version.contentId,
        contentVersionId: version.id,
        contentType: "blogger-article",
        brainDecision: evaluated.brainDecision,
        legacyDecision: "CUTOVER_STAMP",
        finalDecision: `BRAIN_ACTIVE:${evaluated.brainDecision}|CUTOVER`,
        failureCodes: evaluated.failureCodes,
        metadata: {
          cutover: true,
          planId: input.plan.planId,
          bucket: evaluated.bucket,
          stampEligible: evaluated.stampEligible,
          productionRelevance: planItem.productionRelevance,
          preBrainStatus: version.status,
          processedAt: new Date().toISOString(),
        },
      });

      await persistBrainLifecycleOnVersion(input.repo, version.id, {
        ...evaluated.proposedLifecycle,
        brainRunId: brainRun.id,
        humanApprovalStatus: "pending",
      });

      await brainRepo.completeBrainRun(brainRun.id, {
        contentVersionId: version.id,
        finalDecision: `BRAIN_ACTIVE:${evaluated.brainDecision}|STATE:${evaluated.proposedLifecycle.state}`,
        metadata: {
          cutover: true,
          planId: input.plan.planId,
          bucket: evaluated.bucket,
          brainLifecycle: evaluated.proposedLifecycle,
          downstreamAllowed: evaluated.proposedLifecycle.downstreamAllowed,
          processedAt: new Date().toISOString(),
        },
      });

      if (evaluated.bucket === "ACCEPTABLE_EXISTING" && evaluated.stampEligible) {
        stampedAccepted += 1;
        rows.push({
          contentVersionId: version.id,
          preBrainStatus: version.status,
          brainDecision: evaluated.brainDecision,
          stampResult: "STAMPED_ACCEPTED",
          blockReason: null,
          brainRunId: brainRun.id,
          processedAt: new Date().toISOString(),
        });
      } else if (evaluated.bucket === "BAD_INPUT") {
        blockedBadInput += 1;
        rows.push({
          contentVersionId: version.id,
          preBrainStatus: version.status,
          brainDecision: evaluated.brainDecision,
          stampResult: "BLOCKED_BAD_INPUT",
          blockReason: evaluated.regenerationReason,
          brainRunId: brainRun.id,
          processedAt: new Date().toISOString(),
        });
      } else {
        blockedRegen += 1;
        rows.push({
          contentVersionId: version.id,
          preBrainStatus: version.status,
          brainDecision: evaluated.brainDecision,
          stampResult: "BLOCKED_REGEN",
          blockReason: evaluated.regenerationReason,
          brainRunId: brainRun.id,
          processedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      failedInternal += 1;
      rows.push({
        contentVersionId: planItem.contentVersionId,
        preBrainStatus: planItem.currentStatus,
        brainDecision: "ESCALATE",
        stampResult: "FAILED_INTERNAL",
        blockReason: error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN",
        brainRunId: null,
        processedAt: new Date().toISOString(),
      });
    }
  }

  return {
    planId: input.plan.planId,
    snapshotHash: input.plan.snapshotHash,
    snapshotValid,
    stampedAccepted,
    blockedRegen,
    blockedBadInput,
    failedInternal,
    skippedAlreadyManaged,
    skippedPublished,
    skippedOutOfScope,
    rows,
    bodyMutated: false,
    autoPublish: false,
    autoApprove: false,
  };
}
