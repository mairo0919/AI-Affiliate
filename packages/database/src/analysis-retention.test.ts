import { afterAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createDatabaseClient } from "./client.js";
import {
  applyAnalysisRetention,
  loadAnalysisRetentionReport,
  resolveRetentionCommand,
  shouldAutoPruneAfterAnalysis,
} from "./analysis-retention.js";

describe("analysis retention command", () => {
  it("defaults to dry-run and lets --dry-run win over --apply", () => {
    expect(resolveRetentionCommand({ dryRun: false, apply: false }).mode).toBe("dry-run");
    expect(resolveRetentionCommand({ dryRun: true, apply: true, confirmPrune: 1 }).mode).toBe(
      "dry-run",
    );
  });

  it("refuses apply without an explicit confirm count", () => {
    const refused = resolveRetentionCommand({ dryRun: false, apply: true });
    expect(refused.mode).toBe("refuse");
    expect(refused.reason).toContain("--confirm-prune");
  });

  it("allows apply only when confirm count is present", () => {
    expect(resolveRetentionCommand({ dryRun: false, apply: true, confirmPrune: 3 }).mode).toBe(
      "apply",
    );
  });

  it("does not auto-prune a skipped analysis phase", () => {
    expect(shouldAutoPruneAfterAnalysis({ autoPrune: true, skipped: true })).toBe(false);
    expect(shouldAutoPruneAfterAnalysis({ autoPrune: false, skipped: false })).toBe(false);
    expect(shouldAutoPruneAfterAnalysis({ autoPrune: true, skipped: false })).toBe(true);
  });
});

describe("analysis retention database", () => {
  const database = createDatabaseClient();
  const prisma: PrismaClient = database.prisma;
  const sourceName = "analysis-retention-spec";
  const createdRunIds: string[] = [];

  afterAll(async () => {
    await prisma.xPublication.deleteMany({ where: { idempotencyKey: "retention-spec-x" } });
    await prisma.generatedContent.deleteMany({
      where: { contentHash: { in: ["retention-spec-hash-a", "retention-spec-hash-keep"] } },
    });
    if (createdRunIds.length > 0) {
      await prisma.contentCandidate.deleteMany({ where: { analysisRunId: { in: createdRunIds } } });
      await prisma.productAnalysis.deleteMany({ where: { analysisRunId: { in: createdRunIds } } });
      await prisma.analysisRun.deleteMany({ where: { id: { in: createdRunIds } } });
    }
    await prisma.researchItem.deleteMany({
      where: { externalId: { in: ["retention-spec-a", "retention-spec-b"] } },
    });
    await prisma.researchSource.deleteMany({ where: { name: sourceName } });
    await database.disconnect();
  });

  it("keeps the current run, protected references, and latest rows, then prunes the rest", async () => {
    await database.connect();
    const source = await prisma.researchSource.create({
      data: { name: sourceName, type: "OTHER", baseUrl: "https://example.com" },
    });
    const itemA = await prisma.researchItem.create({
      data: {
        sourceId: source.id,
        externalId: "retention-spec-a",
        itemType: "PRODUCT",
        title: "Retention spec A",
        url: "https://example.com/a",
        collectedAt: new Date("2026-01-01T00:00:00.000Z"),
        rawData: { spec: true },
      },
    });
    const itemB = await prisma.researchItem.create({
      data: {
        sourceId: source.id,
        externalId: "retention-spec-b",
        itemType: "PRODUCT",
        title: "Retention spec B",
        url: "https://example.com/b",
        collectedAt: new Date("2026-01-01T00:00:00.000Z"),
        rawData: { spec: true },
      },
    });

    const run0 = await prisma.analysisRun.create({
      data: {
        analysisType: "CONTENT_CANDIDATE_SELECTION",
        status: "COMPLETED",
        parameters: { spec: "run0" },
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const run1 = await prisma.analysisRun.create({
      data: {
        analysisType: "CONTENT_CANDIDATE_SELECTION",
        status: "COMPLETED",
        parameters: { spec: "run1" },
        startedAt: new Date("2026-01-02T00:00:00.000Z"),
        completedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    const run2 = await prisma.analysisRun.create({
      data: {
        analysisType: "CONTENT_CANDIDATE_SELECTION",
        status: "COMPLETED",
        parameters: { spec: "run2" },
        startedAt: new Date("2026-01-03T00:00:00.000Z"),
        completedAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    });
    const run3 = await prisma.analysisRun.create({
      data: {
        analysisType: "CONTENT_CANDIDATE_SELECTION",
        status: "COMPLETED",
        parameters: { spec: "run3" },
        startedAt: new Date("2099-01-04T00:00:00.000Z"),
        completedAt: new Date("2099-01-04T00:00:00.000Z"),
      },
    });
    const run4 = await prisma.analysisRun.create({
      data: {
        analysisType: "CONTENT_CANDIDATE_SELECTION",
        status: "RUNNING",
        parameters: { spec: "run4" },
        startedAt: new Date("2099-01-05T00:00:00.000Z"),
      },
    });
    createdRunIds.push(run0.id, run1.id, run2.id, run3.id, run4.id);

    const analysisFor = async (runId: string, itemId: string, at: string, score: number) =>
      prisma.productAnalysis.create({
        data: {
          analysisRunId: runId,
          researchItemId: itemId,
          totalScore: score,
          dataQualityScore: 1,
          eligibilityStatus: "ELIGIBLE",
          exclusionReasons: [],
          scoreBreakdown: { popularity: { score } },
          analyzedAt: new Date(at),
        },
      });
    const candidateFor = async (
      runId: string,
      itemId: string,
      analysisId: string,
      type: "RANKING" | "TRENDING",
      rank: number,
    ) =>
      prisma.contentCandidate.create({
        data: {
          analysisRunId: runId,
          researchItemId: itemId,
          productAnalysisId: analysisId,
          candidateType: type,
          rank,
          selectionScore: rank,
          selectionReasons: ["spec"],
        },
      });

    const a0 = await analysisFor(run0.id, itemA.id, "2026-01-01T00:00:00.000Z", 1);
    const c0 = await candidateFor(run0.id, itemA.id, a0.id, "RANKING", 9);
    const a1 = await analysisFor(run1.id, itemA.id, "2026-01-02T00:00:00.000Z", 2);
    const b1 = await analysisFor(run1.id, itemB.id, "2026-01-02T00:00:00.000Z", 2);
    const c1 = await candidateFor(run1.id, itemA.id, a1.id, "RANKING", 8);
    await candidateFor(run1.id, itemB.id, b1.id, "RANKING", 8);
    const b2 = await analysisFor(run2.id, itemB.id, "2026-01-03T00:00:00.000Z", 3);
    const c2 = await candidateFor(run2.id, itemB.id, b2.id, "RANKING", 3);
    const a3 = await analysisFor(run3.id, itemA.id, "2099-01-04T00:00:00.000Z", 10);
    const ranking = await candidateFor(run3.id, itemA.id, a3.id, "RANKING", 1);
    const trending = await candidateFor(run3.id, itemA.id, a3.id, "TRENDING", 2);
    const a4 = await analysisFor(run4.id, itemA.id, "2099-01-05T00:00:00.000Z", 11);

    await prisma.generatedContent.create({
      data: {
        contentCandidateId: c1.id,
        researchItemId: itemA.id,
        contentType: "BLOG_ARTICLE",
        title: "retention spec",
        body: "retention spec body",
        hashtags: [],
        affiliateUrl: "https://example.com/retention-spec",
        promptVersion: "spec",
        generationProvider: "mock",
        generationModel: "mock",
        inputSnapshot: {},
        contentHash: "retention-spec-hash-a",
        generatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    const keepContent = await prisma.generatedContent.create({
      data: {
        contentCandidateId: ranking.id,
        researchItemId: itemA.id,
        contentType: "BLOG_ARTICLE",
        title: "retention spec keep",
        body: "retention spec keep body",
        hashtags: [],
        affiliateUrl: "https://example.com/retention-spec-keep",
        promptVersion: "spec",
        generationProvider: "mock",
        generationModel: "mock",
        inputSnapshot: {},
        contentHash: "retention-spec-hash-keep",
        generatedAt: new Date("2099-01-04T00:00:00.000Z"),
      },
    });
    await prisma.xPublication.create({
      data: {
        generatedContentId: keepContent.id,
        contentCandidateId: c2.id,
        researchItemId: itemB.id,
        strategyType: "SINGLE_POST",
        idempotencyKey: "retention-spec-x",
      },
    });

    const ranksBefore = await prisma.contentCandidate.findMany({
      where: { analysisRunId: run3.id },
      orderBy: { rank: "asc" },
      select: { id: true, rank: true, candidateType: true },
    });

    const dry = await loadAnalysisRetentionReport(prisma, 1);
    expect(dry.latestCompletedRunId).toBe(run3.id);
    expect(dry.keepRunIds).toContain(run3.id);
    expect(dry.keepRunIds).toContain(run4.id);
    const countsAfterDry = await prisma.productAnalysis.count({
      where: { id: { in: [a0.id, a1.id, b1.id, b2.id, a3.id, a4.id] } },
    });
    expect(countsAfterDry).toBe(6);

    await expect(
      applyAnalysisRetention(prisma, {
        apply: true,
        keepRuns: 1,
        batchSize: 1,
        maxBatches: 1,
        confirmPrune: dry.productAnalysis.prune + 1,
        requireConfirm: true,
      }),
    ).rejects.toThrow(/confirm-prune mismatch/);
    expect(
      await prisma.productAnalysis.count({
        where: { id: { in: [a0.id, a1.id, b1.id, b2.id, a3.id, a4.id] } },
      }),
    ).toBe(6);

    const partial = await applyAnalysisRetention(prisma, {
      apply: true,
      keepRuns: 1,
      batchSize: 1,
      maxBatches: 1,
      confirmPrune: dry.productAnalysis.prune,
      requireConfirm: true,
    });
    expect(partial.deletedCandidates).toBe(1);
    expect(await prisma.contentCandidate.findUnique({ where: { id: c1.id } })).not.toBeNull();
    expect(await prisma.contentCandidate.findUnique({ where: { id: ranking.id } })).not.toBeNull();
    expect(await prisma.contentCandidate.findUnique({ where: { id: c2.id } })).not.toBeNull();

    const mid = await loadAnalysisRetentionReport(prisma, 1);
    const full = await applyAnalysisRetention(prisma, {
      apply: true,
      keepRuns: 1,
      batchSize: 50,
      confirmPrune: mid.productAnalysis.prune,
      requireConfirm: true,
    });
    expect(full.deletedAnalyses).toBeGreaterThan(0);

    expect(await prisma.analysisRun.findUnique({ where: { id: run0.id } })).toBeNull();
    expect(await prisma.productAnalysis.findUnique({ where: { id: a0.id } })).toBeNull();
    expect(await prisma.contentCandidate.findUnique({ where: { id: c0.id } })).toBeNull();
    expect(await prisma.analysisRun.findUnique({ where: { id: run3.id } })).not.toBeNull();
    expect(await prisma.productAnalysis.findUnique({ where: { id: a3.id } })).not.toBeNull();
    expect(await prisma.contentCandidate.findUnique({ where: { id: ranking.id } })).not.toBeNull();
    expect(await prisma.contentCandidate.findUnique({ where: { id: trending.id } })).not.toBeNull();
    expect(await prisma.analysisRun.findUnique({ where: { id: run4.id } })).not.toBeNull();
    expect(await prisma.productAnalysis.findUnique({ where: { id: a4.id } })).not.toBeNull();
    expect(await prisma.contentCandidate.findUnique({ where: { id: c1.id } })).not.toBeNull();
    expect(await prisma.productAnalysis.findUnique({ where: { id: a1.id } })).not.toBeNull();
    expect(await prisma.contentCandidate.findUnique({ where: { id: c2.id } })).not.toBeNull();
    expect(await prisma.productAnalysis.findUnique({ where: { id: b2.id } })).not.toBeNull();
    expect(await prisma.productAnalysis.findUnique({ where: { id: b1.id } })).toBeNull();
    expect(await prisma.generatedContent.findFirst({ where: { contentHash: "retention-spec-hash-a" } })).not.toBeNull();
    expect(await prisma.xPublication.findUnique({ where: { idempotencyKey: "retention-spec-x" } })).not.toBeNull();

    const ranksAfter = await prisma.contentCandidate.findMany({
      where: { analysisRunId: run3.id },
      orderBy: { rank: "asc" },
      select: { id: true, rank: true, candidateType: true },
    });
    expect(ranksAfter).toEqual(ranksBefore);

    const again = await loadAnalysisRetentionReport(prisma, 1);
    const second = await applyAnalysisRetention(prisma, {
      apply: true,
      keepRuns: 1,
      batchSize: 50,
      confirmPrune: again.productAnalysis.prune,
      requireConfirm: true,
    });
    expect(second.deletedAnalyses).toBe(0);
    expect(second.deletedCandidates).toBe(0);
    expect(second.deletedRuns).toBe(0);
    expect(again.latestCompletedRunId).toBe(run3.id);
  });
});
