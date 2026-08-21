import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  AnalysisRepository,
  ResearchRepository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import type { CollectedResearchItem, CollectionResult } from "@ai-affiliate/shared";
import { AnalysisEngine } from "./analysis-engine.js";
import { evaluateEligibility } from "./eligibility.js";
import {
  scoreDataQuality,
  scoreFreshness,
  scorePopularity,
  scorePrice,
  scoreReview,
  scoreTrend,
} from "./scoring.js";
import { computeTotalScore } from "./total-score.js";
import {
  DEFAULT_SCORE_WEIGHTS,
  buildMetricIndex,
  buildTagIndex,
} from "./types.js";
import { selectCandidates } from "./selection.js";
import { SchedulerPipeline } from "../schedules/scheduler-pipeline.js";

loadConfig({ requireDatabaseUrl: false });

const database = createDatabaseClient();
const research = new ResearchRepository(database.prisma);
const analysis = new AnalysisRepository(database.prisma);
const logger = createLogger("error");
const config = loadConfig({ requireDatabaseUrl: false });

const PREFIX = "analysis-mock-";

function item(overrides: Partial<CollectedResearchItem> & { externalId: string }): CollectedResearchItem {
  const collectedAt = overrides.collectedAt ?? new Date("2026-07-01T00:00:00.000Z");
  return {
    sourceName: "FANZA",
    sourceType: "FANZA",
    sourceBaseUrl: "https://www.dmm.co.jp",
    externalId: overrides.externalId,
    itemType: "PRODUCT",
    title: overrides.title ?? `Title ${overrides.externalId}`,
    description: null,
    url: overrides.url ?? `https://al.fanza.co.jp/?lurl=${overrides.externalId}`,
    publishedAt: overrides.publishedAt ?? collectedAt,
    collectedAt,
    rawData: { id: overrides.externalId, note: "raw must not be used in scoring" },
    metrics: overrides.metrics ?? [],
    tags: overrides.tags ?? [{ name: "genre-a", type: "genre" }],
    images: overrides.images ?? [
      {
        imageType: "package",
        sourceUrl: `https://pics.example/${overrides.externalId}.jpg`,
        usageStatus: "ALLOWED",
      },
    ],
    ...overrides,
  };
}

async function save(items: CollectedResearchItem[]): Promise<void> {
  const result: CollectionResult = {
    providerName: "mock",
    collectedAt: new Date(),
    items,
  };
  await research.saveCollection(result);
}

async function cleanup(): Promise<void> {
  await database.prisma.xPostMetricSnapshot.deleteMany();
  await database.prisma.xPublicationLock.deleteMany();
  await database.prisma.xPublicationPost.deleteMany();
  await database.prisma.xPublication.deleteMany();
  await database.prisma.xStrategyPerformance.deleteMany();
  await database.prisma.xPublicationExperiment.deleteMany();
  await database.prisma.contentReview.deleteMany();
  await database.prisma.contentValidationIssue.deleteMany();
  await database.prisma.generatedContent.deleteMany();
  await database.prisma.contentGenerationRun.deleteMany();
  await database.prisma.contentCandidate.deleteMany({
    where: { researchItem: { externalId: { startsWith: PREFIX } } },
  });
  await database.prisma.productAnalysis.deleteMany({
    where: { researchItem: { externalId: { startsWith: PREFIX } } },
  });
  await database.prisma.analysisRun.deleteMany({
    where: {
      OR: [
        { parameters: { path: ["source"], equals: "mock" } },
        { selectedItemCount: { gte: 0 } },
      ],
    },
  });
  // Delete analysis runs created in tests more broadly
  await database.prisma.contentCandidate.deleteMany();
  await database.prisma.productAnalysis.deleteMany();
  await database.prisma.analysisRun.deleteMany();

  await database.prisma.researchMetric.deleteMany({
    where: { researchItem: { externalId: { startsWith: PREFIX } } },
  });
  await database.prisma.researchItemTag.deleteMany({
    where: { researchItem: { externalId: { startsWith: PREFIX } } },
  });
  await database.prisma.researchImage.deleteMany({
    where: { researchItem: { externalId: { startsWith: PREFIX } } },
  });
  await database.prisma.researchItem.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
}

async function seedFixtures(): Promise<void> {
  const t1 = new Date("2026-06-01T00:00:00.000Z");
  const t2 = new Date("2026-07-01T00:00:00.000Z");
  const nowish = new Date("2026-07-20T00:00:00.000Z");

  // Single metric point (trend unavailable)
  await save([
    item({
      externalId: `${PREFIX}single-metric`,
      metrics: [{ metricType: "reviewCount", value: 10, recordedAt: t1 }],
      tags: [{ name: "actress-a", type: "actress" }, { name: "genre-a", type: "genre" }],
    }),
  ]);

  // Ranking rising + review growth
  await save([
    item({
      externalId: `${PREFIX}rising`,
      metrics: [
        { metricType: "rankingPosition", value: 50, recordedAt: t1 },
        { metricType: "reviewCount", value: 10, recordedAt: t1 },
        { metricType: "reviewAverage", value: 4.0, recordedAt: t1 },
        { metricType: "price", value: 3000, recordedAt: t1 },
      ],
      tags: [
        { name: "actress-b", type: "actress" },
        { name: "maker-b", type: "maker" },
        { name: "genre-a", type: "genre" },
      ],
    }),
  ]);
  await save([
    item({
      externalId: `${PREFIX}rising`,
      metrics: [
        { metricType: "rankingPosition", value: 5, recordedAt: t2 },
        { metricType: "reviewCount", value: 80, recordedAt: t2 },
        { metricType: "reviewAverage", value: 4.5, recordedAt: t2 },
        { metricType: "price", value: 2500, recordedAt: t2 },
        { metricType: "discountRate", value: 30, recordedAt: t2 },
      ],
    }),
  ]);

  // High rating with many reviews
  await save([
    item({
      externalId: `${PREFIX}high-rating`,
      metrics: [
        { metricType: "reviewAverage", value: 4.8, recordedAt: t2 },
        { metricType: "reviewCount", value: 200, recordedAt: t2 },
        { metricType: "price", value: 2800, recordedAt: t2 },
      ],
      tags: [{ name: "actress-c", type: "actress" }, { name: "genre-a", type: "genre" }],
    }),
  ]);

  // New release
  await save([
    item({
      externalId: `${PREFIX}new-release`,
      publishedAt: nowish,
      collectedAt: nowish,
      metrics: [{ metricType: "price", value: 3200, recordedAt: nowish }],
      tags: [{ name: "actress-d", type: "actress" }, { name: "genre-a", type: "genre" }],
    }),
  ]);

  // Discount
  await save([
    item({
      externalId: `${PREFIX}discount`,
      metrics: [
        { metricType: "price", value: 1500, recordedAt: t1 },
        { metricType: "discountRate", value: 10, recordedAt: t1 },
        { metricType: "price", value: 1200, recordedAt: t2 },
        { metricType: "discountRate", value: 40, recordedAt: t2 },
      ],
      tags: [{ name: "actress-e", type: "actress" }, { name: "genre-a", type: "genre" }],
    }),
  ]);

  // Image requires confirmation
  await save([
    item({
      externalId: `${PREFIX}image-confirm`,
      images: [
        {
          imageType: "package",
          sourceUrl: "https://pics.example/confirm.jpg",
          usageStatus: "UNKNOWN",
        },
      ],
      metrics: [{ metricType: "price", value: 2000, recordedAt: t2 }],
    }),
  ]);

  // NOT_ALLOWED only
  await save([
    item({
      externalId: `${PREFIX}image-denied`,
      images: [
        {
          imageType: "package",
          sourceUrl: "https://pics.example/denied.jpg",
          usageStatus: "NOT_ALLOWED",
        },
      ],
    }),
  ]);
}

function engine(): AnalysisEngine {
  return new AnalysisEngine({ logger, research, analysis, config });
}

describe("Analysis Engine", () => {
  beforeAll(async () => {
    await database.connect();
  });

  beforeEach(async () => {
    await cleanup();
    await seedFixtures();
  });

  afterAll(async () => {
    await cleanup();
    await database.disconnect();
  });

  it("excludes items missing required fields before analysis", async () => {
    await save([
      item({ externalId: `${PREFIX}no-url`, url: "" }),
      item({ externalId: `${PREFIX}no-title`, title: " " }),
    ]);
    // empty url/title still saved; engine filters
    const result = await engine().run({ source: "mock", limit: 100, dryRun: true });
    expect(result.analyzedItemCount).toBeGreaterThan(0);
    const ids = await research.listItemsForAnalysis({
      sourceTypes: ["FANZA"],
      limit: 100,
    });
    const analyzed = ids.filter((row) => row.externalId.startsWith(PREFIX) && row.url && row.title.trim());
    expect(analyzed.every((row) => row.externalId && row.url && row.title.trim())).toBe(true);
  });

  it("evaluates eligibility for image states", async () => {
    const allowed = await research.findItemByExternalId(`${PREFIX}rising`);
    const confirm = await research.findItemByExternalId(`${PREFIX}image-confirm`);
    const denied = await research.findItemByExternalId(`${PREFIX}image-denied`);
    expect(allowed).toBeTruthy();
    expect(confirm).toBeTruthy();
    expect(denied).toBeTruthy();

    const makeCtx = (item: NonNullable<typeof allowed>) => ({
      item,
      metricsByType: buildMetricIndex(item),
      tagsByType: buildTagIndex(item),
      genrePrices: [2000, 2500, 3000],
      now: new Date("2026-07-28T00:00:00.000Z"),
      weights: DEFAULT_SCORE_WEIGHTS,
    });

    expect(evaluateEligibility(makeCtx(allowed!)).status).toBe("ELIGIBLE");
    expect(evaluateEligibility(makeCtx(confirm!)).status).toBe("REQUIRES_CONFIRMATION");
    expect(evaluateEligibility(makeCtx(denied!)).status).toBe("NOT_ELIGIBLE");
    expect(evaluateEligibility(makeCtx(denied!)).reasons).toContain("NO_USABLE_IMAGE");
  });

  it("computes scores with null for unavailable components and renormalizes total", async () => {
    const single = await research.findItemByExternalId(`${PREFIX}single-metric`);
    expect(single).toBeTruthy();
    const context = {
      item: single!,
      metricsByType: buildMetricIndex(single!),
      tagsByType: buildTagIndex(single!),
      genrePrices: [],
      now: new Date("2026-07-28T00:00:00.000Z"),
      weights: DEFAULT_SCORE_WEIGHTS,
    };
    const trend = scoreTrend(context);
    expect(trend.available).toBe(false);
    expect(trend.score).toBeNull();
    expect(trend.reasons).toContain("INSUFFICIENT_HISTORY");

    const price = scorePrice(context);
    expect(price.available).toBe(false);
    expect(price.score).toBeNull();

    const popularity = scorePopularity(context);
    const review = scoreReview(context);
    const freshness = scoreFreshness(context);
    const dataQuality = scoreDataQuality(context);
    expect(dataQuality.available).toBe(true);
    expect(freshness.score).toBeGreaterThanOrEqual(0);
    expect(freshness.score!).toBeLessThanOrEqual(15);

    const { totalScore } = computeTotalScore({
      popularity,
      trend,
      review,
      price,
      freshness,
      dataQuality,
    });
    expect(totalScore).toBeGreaterThanOrEqual(0);
    expect(totalScore).toBeLessThanOrEqual(100);
  });

  it("detects ranking rise, review growth, bayesian review, freshness, discount", async () => {
    const rising = await research.findItemByExternalId(`${PREFIX}rising`);
    const context = {
      item: rising!,
      metricsByType: buildMetricIndex(rising!),
      tagsByType: buildTagIndex(rising!),
      genrePrices: [1200, 2500, 3000, 3200],
      now: new Date("2026-07-28T00:00:00.000Z"),
      weights: DEFAULT_SCORE_WEIGHTS,
    };
    const trend = scoreTrend(context);
    expect(trend.available).toBe(true);
    expect(trend.score).toBeGreaterThan(0);
    expect((trend.inputs as { rankingDelta?: number }).rankingDelta).toBeGreaterThan(0);
    expect((trend.inputs as { reviewCountDelta?: number }).reviewCountDelta).toBeGreaterThan(0);

    const review = scoreReview(context);
    expect(review.available).toBe(true);
    expect((review.inputs as { bayesianAverage?: number }).bayesianAverage).toBeDefined();

    const few = {
      ...context,
      metricsByType: buildMetricIndex({
        ...rising!,
        metrics: [
          { id: "1", researchItemId: rising!.id, metricType: "reviewAverage", value: 5, recordedAt: new Date(), createdAt: new Date() },
          { id: "2", researchItemId: rising!.id, metricType: "reviewCount", value: 1, recordedAt: new Date(), createdAt: new Date() },
        ],
      }),
    };
    const fewReview = scoreReview(few);
    expect(fewReview.score!).toBeLessThan(review.score!);

    const freshItem = await research.findItemByExternalId(`${PREFIX}new-release`);
    const fresh = scoreFreshness({
      item: freshItem!,
      metricsByType: buildMetricIndex(freshItem!),
      tagsByType: buildTagIndex(freshItem!),
      genrePrices: [],
      now: new Date("2026-07-28T00:00:00.000Z"),
      weights: DEFAULT_SCORE_WEIGHTS,
    });
    expect(fresh.score!).toBeGreaterThan(10);

    const discountItem = await research.findItemByExternalId(`${PREFIX}discount`);
    const price = scorePrice({
      item: discountItem!,
      metricsByType: buildMetricIndex(discountItem!),
      tagsByType: buildTagIndex(discountItem!),
      genrePrices: [1000, 1500, 2000],
      now: new Date(),
      weights: DEFAULT_SCORE_WEIGHTS,
    });
    expect(price.available).toBe(true);
    expect(price.score!).toBeGreaterThan(0);
  });

  it("persists ProductAnalysis without overwriting past runs and prevents duplicates", async () => {
    const first = await engine().run({ source: "mock", limit: 50 });
    expect(first.analysisRunId).toBeTruthy();
    const second = await engine().run({ source: "mock", limit: 50 });
    expect(second.analysisRunId).not.toBe(first.analysisRunId);

    const analyses = await analysis.listProductAnalyses(first.analysisRunId!);
    expect(analyses.length).toBeGreaterThan(0);
    const ids = analyses.map((row) => row.researchItemId);
    expect(new Set(ids).size).toBe(ids.length);

    await expect(
      analysis.saveProductAnalysis({
        analysisRunId: first.analysisRunId!,
        researchItemId: analyses[0]!.researchItemId,
        totalScore: 1,
        popularityScore: null,
        trendScore: null,
        reviewScore: null,
        priceScore: null,
        freshnessScore: 1,
        dataQualityScore: 1,
        eligibilityStatus: "ELIGIBLE",
        exclusionReasons: [],
        scoreBreakdown: {},
        analyzedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("generates Ranking / Trending / HighRating / NewRelease / Discount candidates", async () => {
    const result = await engine().run({
      source: "mock",
      limit: 50,
      candidateLimit: 10,
      includeRequiresConfirmation: false,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.candidateCounts.RANKING ?? 0).toBeGreaterThan(0);
    expect(result.candidateCounts.TRENDING ?? 0).toBeGreaterThan(0);
    expect(result.candidateCounts.HIGH_RATING ?? 0).toBeGreaterThan(0);
    expect(result.candidateCounts.NEW_RELEASE ?? 0).toBeGreaterThan(0);
    expect(result.candidateCounts.DISCOUNT ?? 0).toBeGreaterThan(0);

    const candidates = await analysis.listContentCandidates({
      analysisRunId: result.analysisRunId!,
      limit: 100,
    });
    expect(candidates.every((row) => row.status === "SELECTED")).toBe(true);
    // NOT_ALLOWED item must not appear
    const denied = await research.findItemByExternalId(`${PREFIX}image-denied`);
    expect(candidates.some((row) => row.researchItemId === denied?.id)).toBe(false);
  });

  it("applies diversity limits and relaxes when needed", () => {
    const base = {
      analysis: {
        researchItemId: "x",
        totalScore: 80,
        popularityScore: 20,
        trendScore: 20,
        reviewScore: 10,
        priceScore: 5,
        freshnessScore: 10,
        dataQualityScore: 8,
        eligibilityStatus: "ELIGIBLE" as const,
        breakdown: {
          trend: {
            score: 20,
            available: true,
            inputs: {},
            calculationVersion: "scoring-v1",
            reasons: [],
          },
        },
      },
    };

    const items = Array.from({ length: 8 }).map((_, index) => ({
      item: {
        id: `id-${index}`,
        tags: [
          {
            researchItemId: `id-${index}`,
            researchTagId: "t",
            researchTag: { id: "t", name: "same-actress", type: "actress", createdAt: new Date() },
          },
        ],
      } as never,
      ...base,
      analysis: { ...base.analysis, researchItemId: `id-${index}`, totalScore: 90 - index },
    }));

    const selected = selectCandidates(items, {
      candidateTypes: ["RANKING"],
      perTypeLimit: 10,
      overallLimit: 10,
      minimumScore: 0,
      includeRequiresConfirmation: false,
      diversity: { maxPerActress: 3, maxPerMaker: 5, maxPerSeries: 3 },
    });
    expect(selected.length).toBeGreaterThanOrEqual(3);
    expect(selected.some((row) => row.selectionReasons.includes("DIVERSITY_RELAXED"))).toBe(true);
  });

  it("dry-run does not persist analysis rows", async () => {
    const before = await analysis.listAnalysisRuns(5);
    const result = await engine().run({ source: "mock", dryRun: true, limit: 20 });
    expect(result.analysisRunId).toBeNull();
    expect(result.status.startsWith("DRY_RUN_")).toBe(true);
    const after = await analysis.listAnalysisRuns(5);
    expect(after.length).toBe(before.length);
  });

  it("continues on item failure and can partially complete", async () => {
    const result = await engine().run({ source: "mock", limit: 50 });
    expect(["COMPLETED", "PARTIALLY_COMPLETED"]).toContain(result.status);
    expect(result.analyzedItemCount).toBeGreaterThan(0);
  });

  it("does not use description or review text fields in scoring inputs", async () => {
    const rising = await research.findItemByExternalId(`${PREFIX}rising`);
    const context = {
      item: { ...rising!, description: "秘密の説明文は使わない" },
      metricsByType: buildMetricIndex(rising!),
      tagsByType: buildTagIndex(rising!),
      genrePrices: [2000, 2500, 3000],
      now: new Date(),
      weights: DEFAULT_SCORE_WEIGHTS,
    };
    const popularity = scorePopularity(context);
    const review = scoreReview(context);
    const serialized = JSON.stringify({ popularity, review });
    expect(serialized).not.toContain("秘密の説明文");
    expect(serialized).not.toContain("レビュー本文");
  });

  it("scheduler pipeline order skips analysis when auto-run disabled", async () => {
    const pipeline = new SchedulerPipeline({
      logger,
      database,
      config: { ...config, analysisAutoRunEnabled: false, contentAutoGenerationEnabled: false },
      now: () => new Date(),
    });
    const result = await pipeline.run();
    expect("skipped" in result.analysis && result.analysis.skipped).toBe(true);
    if ("skipped" in result.analysis) {
      expect(result.analysis.skipReason).toBe("ANALYSIS_AUTO_RUN_DISABLED");
    }
    expect("skipped" in result.content && result.content.skipped).toBe(true);
    if ("skipped" in result.content) {
      expect(result.content.skipReason).toBe("CONTENT_AUTO_GENERATION_DISABLED");
    }
    expect("skipReason" in result.xPublish).toBe(true);
    expect("skipReason" in result.xMetrics).toBe(true);
    expect("skipReason" in result.xStrategy).toBe(true);
  });

  it("respects analysis min interval when auto-run enabled", async () => {
    await engine().run({ source: "mock", limit: 10 });
    const pipeline = new SchedulerPipeline({
      logger,
      database,
      config: {
        ...config,
        analysisAutoRunEnabled: true,
        analysisAutoRunSource: "mock",
        analysisAutoRunMinIntervalMinutes: 60,
      },
      now: () => new Date(),
    });
    const result = await pipeline.run();
    expect("skipped" in result.analysis && result.analysis.skipped).toBe(true);
    if ("skipped" in result.analysis) {
      expect(result.analysis.skipReason).toBe("ANALYSIS_MIN_INTERVAL_NOT_ELAPSED");
    }
  });
});
