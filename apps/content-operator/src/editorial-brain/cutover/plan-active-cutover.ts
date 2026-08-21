/**
 * Read-only ACTIVE cutover plan for pre-Brain REVIEWING versions.
 * Persists plan JSON under /tmp or workspace for execute snapshot check — CLI writes file optionally.
 */

import { createHash } from "node:crypto";
import type { PrismaClient } from "@ai-affiliate/database";
import { LifecycleRepository } from "@ai-affiliate/database";
import { readBrainLifecycle } from "../core/acceptance.js";
import { classifyContentVersionCompatibility } from "../core/compatibility.js";
import {
  evaluateExistingContentVersion,
  type CutoverBucket,
  type EvaluateExistingResult,
  type ProductionRelevance,
} from "./evaluate-existing.js";

export type CutoverPlanItem = EvaluateExistingResult & {
  compatibilityClass: string;
  productionRelevance: ProductionRelevance;
  inCutoverScope: boolean;
  versionNumber: number;
  isLatestForContent: boolean;
  hasDraftTarget: boolean;
  hasPublishedEvidence: boolean;
  strategyId: string | null;
  topicId: string | null;
};

export type ActiveCutoverPlan = {
  readOnly: true;
  planId: string;
  createdAt: string;
  snapshotHash: string;
  totalReviewed: number;
  acceptableExisting: number;
  requiresRegen: number;
  badInput: number;
  unsafeAmbiguous: number;
  skippedAlreadyManaged: number;
  skippedPublishedHistorical: number;
  skippedObsolete: number;
  skippedSuperseded: number;
  currentPublicationCandidateCount: number;
  obsoleteOrSupersededCount: number;
  inScopeCount: number;
  buckets: Record<CutoverBucket, CutoverPlanItem[]>;
  items: CutoverPlanItem[];
  /** IDs that should be stamped/blocked for safe ACTIVE cutover (in-scope only) */
  executableVersionIds: string[];
};

function classifyRelevance(input: {
  status: string;
  isLatest: boolean;
  hasDraftTarget: boolean;
  hasPublishedEvidence: boolean;
  createdBy: string | null;
  title: string;
}): ProductionRelevance {
  if (input.hasPublishedEvidence) return "PUBLISHED_HISTORICAL";
  if (!input.isLatest) return "SUPERSEDED";
  const created = (input.createdBy ?? "").toLowerCase();
  const title = input.title.toLowerCase();
  if (
    created.includes("test") ||
    created.includes("fixture") ||
    title.includes("[test]") ||
    title.includes("fixture")
  ) {
    return "OBSOLETE_EXPERIMENT";
  }
  if (input.hasDraftTarget) return "DRAFT_TARGET";
  if (input.status === "REVIEWING" || input.status === "REVISION_REQUIRED") {
    return "CURRENT_PUBLICATION_CANDIDATE";
  }
  if (input.status === "APPROVED") return "HUMAN_APPROVAL_QUEUE";
  return "OTHER_REVIEWING";
}

function emptyBuckets(): Record<CutoverBucket, CutoverPlanItem[]> {
  return {
    ACCEPTABLE_EXISTING: [],
    REQUIRES_REGEN: [],
    BAD_INPUT: [],
    UNSAFE_AMBIGUOUS: [],
    SKIP_ALREADY_MANAGED: [],
    SKIP_PUBLISHED_HISTORICAL: [],
    SKIP_OBSOLETE: [],
    SKIP_SUPERSEDED: [],
  };
}

export async function planActiveCutover(input: {
  prisma: PrismaClient;
  repo: LifecycleRepository;
  /** If true, only evaluate latest versions per content (scope optimization). Default true for inventory of all reviewing. */
  preferLatestOnly?: boolean;
}): Promise<ActiveCutoverPlan> {
  const versions = await input.prisma.contentVersion.findMany({
    select: {
      id: true,
      contentId: true,
      status: true,
      title: true,
      versionNumber: true,
      structuredContent: true,
      createdBy: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const versionIds = versions.map((v) => v.id);
  const contents = await input.prisma.content.findMany({
    where: { id: { in: [...new Set(versions.map((v) => v.contentId))] } },
    select: { id: true, strategyId: true, topicCandidateId: true },
  });
  const contentMeta = new Map(contents.map((c) => [c.id, c]));

  const latestByContent = new Map<string, string>();
  for (const v of versions) {
    if (!latestByContent.has(v.contentId)) latestByContent.set(v.contentId, v.id);
  }

  const targets =
    versionIds.length === 0
      ? []
      : await input.prisma.publicationTarget.findMany({
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
      t.publishedAt != null || Boolean(t.publishedExternalId) || t.status === "PUBLISHED";
    if (published) publishedByVersion.add(t.contentVersionId);
    else draftByVersion.add(t.contentVersionId);
  }

  const buckets = emptyBuckets();
  const items: CutoverPlanItem[] = [];
  let currentPublicationCandidateCount = 0;
  let obsoleteOrSupersededCount = 0;

  for (const v of versions) {
    const lifecycle = readBrainLifecycle(v.structuredContent);
    const isLatest = latestByContent.get(v.contentId) === v.id;
    const hasPublished = publishedByVersion.has(v.id);
    const hasDraft = draftByVersion.has(v.id) && !hasPublished;
    const meta = contentMeta.get(v.contentId);
    const assessment = classifyContentVersionCompatibility({
      contentVersionId: v.id,
      status: v.status,
      structuredContent: v.structuredContent,
      hasPublishedEvidence: hasPublished,
      hasDraftTarget: hasDraft,
      stampable: Boolean(
        v.structuredContent &&
          typeof v.structuredContent === "object" &&
          "article" in (v.structuredContent as object),
      ),
    });

    const relevance = classifyRelevance({
      status: v.status,
      isLatest,
      hasDraftTarget: hasDraft,
      hasPublishedEvidence: hasPublished,
      createdBy: v.createdBy,
      title: v.title,
    });

    if (
      relevance === "SUPERSEDED" ||
      relevance === "OBSOLETE_EXPERIMENT" ||
      relevance === "PUBLISHED_HISTORICAL"
    ) {
      obsoleteOrSupersededCount += 1;
    }
    if (
      relevance === "CURRENT_PUBLICATION_CANDIDATE" ||
      relevance === "DRAFT_TARGET" ||
      relevance === "HUMAN_APPROVAL_QUEUE"
    ) {
      currentPublicationCandidateCount += 1;
    }

    // Skip published historical — never stamp
    if (assessment.compatibilityClass === "PUBLISHED_HISTORICAL" || hasPublished) {
      const item: CutoverPlanItem = {
        contentVersionId: v.id,
        contentId: v.contentId,
        title: v.title,
        channel: "BLOG",
        currentStatus: v.status,
        brainDecision: "SKIPPED",
        failureCodes: [],
        hasRequiredProvenance: false,
        stampEligible: false,
        bucket: "SKIP_PUBLISHED_HISTORICAL",
        regenerationReason: null,
        hardValidationOk: true,
        proposedLifecycle: null,
        bodyMutated: false,
        compatibilityClass: "PUBLISHED_HISTORICAL",
        productionRelevance: "PUBLISHED_HISTORICAL",
        inCutoverScope: false,
        versionNumber: v.versionNumber,
        isLatestForContent: isLatest,
        hasDraftTarget: hasDraft,
        hasPublishedEvidence: true,
        strategyId: meta?.strategyId ?? null,
        topicId: meta?.topicCandidateId ?? null,
      };
      buckets.SKIP_PUBLISHED_HISTORICAL.push(item);
      items.push(item);
      continue;
    }

    if (lifecycle) {
      const item: CutoverPlanItem = {
        contentVersionId: v.id,
        contentId: v.contentId,
        title: v.title,
        channel: "BLOG",
        currentStatus: v.status,
        brainDecision: lifecycle.brainDecision,
        failureCodes: [],
        hasRequiredProvenance: true,
        stampEligible: false,
        bucket: "SKIP_ALREADY_MANAGED",
        regenerationReason: null,
        hardValidationOk: true,
        proposedLifecycle: lifecycle,
        bodyMutated: false,
        compatibilityClass: "BRAIN_MANAGED",
        productionRelevance: relevance,
        inCutoverScope: false,
        versionNumber: v.versionNumber,
        isLatestForContent: isLatest,
        hasDraftTarget: hasDraft,
        hasPublishedEvidence: hasPublished,
        strategyId: meta?.strategyId ?? null,
        topicId: meta?.topicCandidateId ?? null,
      };
      buckets.SKIP_ALREADY_MANAGED.push(item);
      items.push(item);
      continue;
    }

    if (relevance === "SUPERSEDED") {
      const item: CutoverPlanItem = {
        contentVersionId: v.id,
        contentId: v.contentId,
        title: v.title,
        channel: "BLOG",
        currentStatus: v.status,
        brainDecision: "SKIPPED",
        failureCodes: [],
        hasRequiredProvenance: false,
        stampEligible: false,
        bucket: "SKIP_SUPERSEDED",
        regenerationReason: null,
        hardValidationOk: true,
        proposedLifecycle: null,
        bodyMutated: false,
        compatibilityClass: assessment.compatibilityClass,
        productionRelevance: "SUPERSEDED",
        inCutoverScope: false,
        versionNumber: v.versionNumber,
        isLatestForContent: false,
        hasDraftTarget: hasDraft,
        hasPublishedEvidence: hasPublished,
        strategyId: meta?.strategyId ?? null,
        topicId: meta?.topicCandidateId ?? null,
      };
      buckets.SKIP_SUPERSEDED.push(item);
      items.push(item);
      continue;
    }

    if (relevance === "OBSOLETE_EXPERIMENT") {
      const item: CutoverPlanItem = {
        contentVersionId: v.id,
        contentId: v.contentId,
        title: v.title,
        channel: "BLOG",
        currentStatus: v.status,
        brainDecision: "SKIPPED",
        failureCodes: [],
        hasRequiredProvenance: false,
        stampEligible: false,
        bucket: "SKIP_OBSOLETE",
        regenerationReason: null,
        hardValidationOk: true,
        proposedLifecycle: null,
        bodyMutated: false,
        compatibilityClass: assessment.compatibilityClass,
        productionRelevance: "OBSOLETE_EXPERIMENT",
        inCutoverScope: false,
        versionNumber: v.versionNumber,
        isLatestForContent: isLatest,
        hasDraftTarget: hasDraft,
        hasPublishedEvidence: hasPublished,
        strategyId: meta?.strategyId ?? null,
        topicId: meta?.topicCandidateId ?? null,
      };
      buckets.SKIP_OBSOLETE.push(item);
      items.push(item);
      continue;
    }

    // Only evaluate REVIEWING / REVISION / APPROVED candidates missing lifecycle
    if (
      assessment.compatibilityClass !== "REVIEWING_PRE_BRAIN" &&
      assessment.compatibilityClass !== "GENERATED_PRE_BRAIN" &&
      assessment.compatibilityClass !== "DRAFTED_PRE_BRAIN"
    ) {
      continue;
    }

    const evaluated = await evaluateExistingContentVersion({
      repo: input.repo,
      contentVersionId: v.id,
    });

    const inCutoverScope =
      relevance === "CURRENT_PUBLICATION_CANDIDATE" ||
      relevance === "DRAFT_TARGET" ||
      relevance === "HUMAN_APPROVAL_QUEUE" ||
      relevance === "OTHER_REVIEWING";

    const item: CutoverPlanItem = {
      ...evaluated,
      compatibilityClass: assessment.compatibilityClass,
      productionRelevance: relevance,
      inCutoverScope,
      versionNumber: v.versionNumber,
      isLatestForContent: isLatest,
      hasDraftTarget: hasDraft,
      hasPublishedEvidence: hasPublished,
      strategyId: meta?.strategyId ?? null,
      topicId: meta?.topicCandidateId ?? null,
    };
    buckets[item.bucket].push(item);
    items.push(item);
  }

  const executableVersionIds = items
    .filter((i) => i.inCutoverScope && i.bucket !== "SKIP_ALREADY_MANAGED")
    .filter(
      (i) =>
        i.bucket === "ACCEPTABLE_EXISTING" ||
        i.bucket === "REQUIRES_REGEN" ||
        i.bucket === "BAD_INPUT" ||
        i.bucket === "UNSAFE_AMBIGUOUS",
    )
    .map((i) => i.contentVersionId);

  const createdAt = new Date().toISOString();
  const snapshotPayload = executableVersionIds
    .slice()
    .sort()
    .map((id) => {
      const it = items.find((x) => x.contentVersionId === id)!;
      return `${id}:${it.bucket}:${it.brainDecision}:${it.currentStatus}`;
    })
    .join("|");
  const snapshotHash = createHash("sha256").update(snapshotPayload).digest("hex").slice(0, 24);
  const planId = `cutover-${createdAt.slice(0, 10)}-${snapshotHash.slice(0, 10)}`;

  return {
    readOnly: true,
    planId,
    createdAt,
    snapshotHash,
    totalReviewed: items.filter((i) =>
      ["ACCEPTABLE_EXISTING", "REQUIRES_REGEN", "BAD_INPUT", "UNSAFE_AMBIGUOUS"].includes(
        i.bucket,
      ),
    ).length,
    acceptableExisting: buckets.ACCEPTABLE_EXISTING.length,
    requiresRegen: buckets.REQUIRES_REGEN.length,
    badInput: buckets.BAD_INPUT.length,
    unsafeAmbiguous: buckets.UNSAFE_AMBIGUOUS.length,
    skippedAlreadyManaged: buckets.SKIP_ALREADY_MANAGED.length,
    skippedPublishedHistorical: buckets.SKIP_PUBLISHED_HISTORICAL.length,
    skippedObsolete: buckets.SKIP_OBSOLETE.length,
    skippedSuperseded: buckets.SKIP_SUPERSEDED.length,
    currentPublicationCandidateCount,
    obsoleteOrSupersededCount,
    inScopeCount: executableVersionIds.length,
    buckets,
    items,
    executableVersionIds,
  };
}
