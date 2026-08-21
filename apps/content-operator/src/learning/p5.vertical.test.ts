import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, P5Repository, createDatabaseClient } from "@ai-affiliate/database";
import { normalizeSnapshotMetrics, sumCanonical } from "./analytics-aggregator.js";
import { evaluateDeterministically } from "./evaluation-engine.js";
import { runP5MockVertical } from "./p5-vertical.js";

loadConfig({ requireDatabaseUrl: false });
const database = createDatabaseClient();
const lifecycleRepo = new LifecycleRepository(database.prisma);
const p5Repo = new P5Repository(database.prisma);

describe("P5 analytics aggregator", () => {
  it("normalizes aliases and computes CTR", () => {
    const n = normalizeSnapshotMetrics({
      pageViews: 100,
      clicks: 5,
      retweets: 2,
      custom_widget: 9,
    });
    expect(n.canonical.views).toBe(100);
    expect(n.canonical.clicks).toBe(5);
    expect(n.canonical.ctr).toBeCloseTo(0.05);
    expect(n.canonical.repost).toBe(2);
    expect(n.platformSpecific.custom_widget).toBe(9);
  });

  it("sums canonical metrics across snapshots", () => {
    const summed = sumCanonical([
      normalizeSnapshotMetrics({ impressions: 100, clicks: 4 }),
      normalizeSnapshotMetrics({ impressions: 100, clicks: 6 }),
    ]);
    expect(summed.impressions).toBe(200);
    expect(summed.clicks).toBe(10);
    expect(summed.ctr).toBeCloseTo(0.05);
  });
});

describe("P5 evaluation engine", () => {
  it("scores blogger content deterministically", () => {
    const result = evaluateDeterministically({
      platform: "BLOGGER",
      version: {
        id: "v1",
        contentId: "c1",
        versionNumber: 1,
        parentVersionId: null,
        revisionType: "initial",
        title: "サンプル商品の概要まとめ",
        summary: "s",
        body: [
          "# 概要",
          "本記事はアフィリエイト広告を含む場合があります。",
          "18歳未満の方は対象外です。",
          "## 詳細",
          "公開情報ベースで要点をまとめます。",
          "商品ページ https://example.invalid/p/1",
        ].join("\n"),
        structuredContent: null,
        status: "APPROVED",
        createdBy: "test",
        modelRunId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      aggregate: {
        id: "a1",
        contentId: "c1",
        contentVersionId: "v1",
        publicationTargetId: null,
        platform: "BLOGGER",
        windowStart: new Date(),
        windowEnd: new Date(),
        impressions: 1000,
        views: 700,
        clicks: 40,
        ctr: 0.04,
        engagement: 20,
        likes: 10,
        reposts: 2,
        comments: 3,
        bookmarks: 5,
        articleOpens: 50,
        readTimeSeconds: 80,
        externalClicks: 35,
        publicationAgeHours: 24,
        sampleSnapshotCount: 2,
        normalizedMetrics: {},
        platformMetrics: null,
        sourceSnapshotIds: [],
        metadata: null,
        createdAt: new Date(),
      },
    });
    expect(result.overallScore).toBeGreaterThan(0.3);
    expect(result.seoScore).toBeGreaterThan(0);
    expect(result.evaluationReason.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});

describe("P5 mock vertical", () => {
  beforeAll(async () => {
    await database.connect();
  });
  afterAll(async () => {
    await database.disconnect();
  });
  beforeEach(async () => {
    await database.prisma.strategyFeedback.deleteMany();
    await database.prisma.learningRule.deleteMany();
    await database.prisma.experimentResult.deleteMany();
    await database.prisma.experimentVariant.deleteMany();
    await database.prisma.experiment.deleteMany();
    await database.prisma.evaluationFinding.deleteMany();
    await database.prisma.evaluation.deleteMany();
    await database.prisma.analyticsAggregate.deleteMany();
    await database.prisma.analyticsSnapshot.deleteMany();
    await database.prisma.linkReplacementEvent.deleteMany();
    await database.prisma.productLinkUsage.deleteMany();
    await database.prisma.publicationRecord.deleteMany();
    await database.prisma.publicationTarget.deleteMany();
    await database.prisma.revisionAction.deleteMany();
    await database.prisma.qualityReviewRecord.deleteMany();
    await database.prisma.policyEvaluation.deleteMany();
    await database.prisma.contentVersionClaim.deleteMany();
    await database.prisma.claimSource.deleteMany();
    await database.prisma.claim.deleteMany();
    await database.prisma.contentVersion.deleteMany();
    await database.prisma.content.deleteMany();
    await database.prisma.contentStrategy.deleteMany();
    await database.prisma.topicCandidate.deleteMany();
    await database.prisma.researchFinding.deleteMany();
    await database.prisma.sourceDocument.deleteMany();
    await database.prisma.productLink.deleteMany();
    await database.prisma.productSnapshot.deleteMany();
    await database.prisma.affiliateProduct.deleteMany();
    await database.prisma.costRecord.deleteMany();
    await database.prisma.modelRun.deleteMany();
    await database.prisma.operatorJob.deleteMany();
  });

  it("runs Analytics→Evaluation→Experiment→Learning→StrategyFeedback without mutating published body", async () => {
    const config = loadConfig({ requireDatabaseUrl: false });
    const summary = await runP5MockVertical({ lifecycleRepo, p5Repo, config });
    expect(summary.aggregateId).toBeTruthy();
    expect(summary.evaluationId).toBeTruthy();
    expect(summary.experimentId).toBeTruthy();
    expect(summary.learningRuleIds.length).toBeGreaterThan(0);
    expect(summary.strategyFeedbackId).toBeTruthy();
    expect(summary.nextStrategyId).toBeTruthy();
    expect(summary.originalBodyUnchanged).toBe(true);

    const costs = await database.prisma.costRecord.findMany({
      where: {
        operationType: { in: ["EVALUATION", "EXPERIMENT", "LEARNING", "STRATEGY_FEEDBACK", "STRATEGY"] },
      },
    });
    expect(costs.length).toBeGreaterThan(0);

    const runs = await database.prisma.modelRun.findMany({
      where: {
        taskType: { in: ["EVALUATION", "EXPERIMENT", "LEARNING", "STRATEGY_FEEDBACK", "STRATEGY"] },
      },
    });
    expect(runs.length).toBeGreaterThan(0);

    const exp = await p5Repo.findExperiment(summary.experimentId);
    expect(exp?.status).toBe("COMPLETED");
    expect(exp?.results.some((r) => r.winner)).toBe(true);
  });
});
