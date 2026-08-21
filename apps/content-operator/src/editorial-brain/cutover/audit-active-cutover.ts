/**
 * Read-only ACTIVE cutover audit — no DB writes.
 */

import type { PrismaClient } from "@ai-affiliate/database";
import {
  classifyContentVersionCompatibility,
  type CompatibilityCutoverAction,
  type ContentVersionCompatibilityClass,
} from "../core/compatibility.js";
import { readBrainLifecycle } from "../core/acceptance.js";

export type CutoverAuditReport = {
  readOnly: true;
  totalRelevantContentVersions: number;
  brainManagedCount: number;
  acceptedCount: number;
  blockedCount: number;
  missingBrainLifecycleCount: number;
  reviewingPreBrainCount: number;
  draftedPreBrainCount: number;
  publishedHistoricalCount: number;
  generatedPreBrainCount: number;
  requiresReReviewCount: number;
  requiresRegenerationCount: number;
  unsafeAmbiguousCount: number;
  byClass: Record<ContentVersionCompatibilityClass, number>;
  sampleMissingLifecycle: Array<{
    contentVersionId: string;
    status: string;
    compatibilityClass: ContentVersionCompatibilityClass;
    cutoverAction: CompatibilityCutoverAction;
  }>;
  /** Production blockers for ACTIVE flip (excludes historical + superseded + obsolete) */
  unsafeProductionCandidatesMissingLifecycle: number;
  productionCandidatesAllBrainManagedOrBlocked: boolean;
};

function emptyByClass(): Record<ContentVersionCompatibilityClass, number> {
  return {
    PUBLISHED_HISTORICAL: 0,
    DRAFTED_PRE_BRAIN: 0,
    REVIEWING_PRE_BRAIN: 0,
    GENERATED_PRE_BRAIN: 0,
    BRAIN_MANAGED: 0,
  };
}

export async function auditActiveCutover(prisma: PrismaClient): Promise<CutoverAuditReport> {
  const versions = await prisma.contentVersion.findMany({
    select: {
      id: true,
      status: true,
      structuredContent: true,
      contentId: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const versionIds = versions.map((v) => v.id);
  const targets =
    versionIds.length === 0
      ? []
      : await prisma.publicationTarget.findMany({
          where: { contentVersionId: { in: versionIds } },
          select: {
            contentVersionId: true,
            status: true,
            publishedAt: true,
            publishedExternalId: true,
          },
        });

  const publishedByVersion = new Set<string>();
  const draftByVersion = new Set<string>();
  for (const t of targets) {
    const published =
      t.publishedAt != null ||
      Boolean(t.publishedExternalId) ||
      t.status === "PUBLISHED";
    if (published) publishedByVersion.add(t.contentVersionId);
    else draftByVersion.add(t.contentVersionId);
  }

  const byClass = emptyByClass();
  let acceptedCount = 0;
  let blockedCount = 0;
  let missingBrainLifecycleCount = 0;
  let requiresReReviewCount = 0;
  let requiresRegenerationCount = 0;
  let unsafeAmbiguousCount = 0;
  let unsafeProductionCandidatesMissingLifecycle = 0;
  const sampleMissingLifecycle: CutoverAuditReport["sampleMissingLifecycle"] = [];

  // latest per content
  const latestByContent = new Map<string, string>();
  for (const v of versions) {
    if (!latestByContent.has(v.contentId)) latestByContent.set(v.contentId, v.id);
  }

  for (const v of versions) {
    const lifecycle = readBrainLifecycle(v.structuredContent);
    const isLatest = latestByContent.get(v.contentId) === v.id;
    const stampable =
      v.structuredContent != null &&
      typeof v.structuredContent === "object" &&
      "article" in (v.structuredContent as object);

    const assessment = classifyContentVersionCompatibility({
      contentVersionId: v.id,
      status: v.status,
      structuredContent: v.structuredContent,
      hasPublishedEvidence: publishedByVersion.has(v.id),
      hasDraftTarget: draftByVersion.has(v.id) && !publishedByVersion.has(v.id),
      stampable,
    });

    byClass[assessment.compatibilityClass] += 1;

    if (!lifecycle) {
      missingBrainLifecycleCount += 1;
      if (sampleMissingLifecycle.length < 25) {
        sampleMissingLifecycle.push({
          contentVersionId: v.id,
          status: v.status,
          compatibilityClass: assessment.compatibilityClass,
          cutoverAction: assessment.cutoverAction,
        });
      }
      // Production candidate = latest + reviewing/drafted + not published
      if (
        isLatest &&
        !publishedByVersion.has(v.id) &&
        (assessment.compatibilityClass === "REVIEWING_PRE_BRAIN" ||
          assessment.compatibilityClass === "DRAFTED_PRE_BRAIN" ||
          assessment.compatibilityClass === "GENERATED_PRE_BRAIN")
      ) {
        unsafeProductionCandidatesMissingLifecycle += 1;
      }
    } else if (lifecycle.state === "ACCEPTED" && lifecycle.downstreamAllowed) {
      acceptedCount += 1;
    } else if (String(lifecycle.state).startsWith("BLOCKED")) {
      blockedCount += 1;
    }

    if (assessment.cutoverAction === "requires_re_review_stamp") requiresReReviewCount += 1;
    if (assessment.cutoverAction === "requires_regeneration") requiresRegenerationCount += 1;
    if (assessment.cutoverAction === "unsafe_ambiguous") unsafeAmbiguousCount += 1;
  }

  return {
    readOnly: true,
    totalRelevantContentVersions: versions.length,
    brainManagedCount: byClass.BRAIN_MANAGED,
    acceptedCount,
    blockedCount,
    missingBrainLifecycleCount,
    reviewingPreBrainCount: byClass.REVIEWING_PRE_BRAIN,
    draftedPreBrainCount: byClass.DRAFTED_PRE_BRAIN,
    publishedHistoricalCount: byClass.PUBLISHED_HISTORICAL,
    generatedPreBrainCount: byClass.GENERATED_PRE_BRAIN,
    requiresReReviewCount,
    requiresRegenerationCount,
    unsafeAmbiguousCount,
    byClass,
    sampleMissingLifecycle,
    unsafeProductionCandidatesMissingLifecycle,
    productionCandidatesAllBrainManagedOrBlocked:
      unsafeProductionCandidatesMissingLifecycle === 0,
  };
}
