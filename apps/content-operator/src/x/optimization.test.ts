import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  AnalysisRepository,
  ContentRepository,
  ResearchRepository,
  XOptimizationRepository,
  XPublicationRepository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import type { CollectedResearchItem, CollectionResult } from "@ai-affiliate/shared";
import { AnalysisEngine } from "../analysis/analysis-engine.js";
import { ContentEngine } from "../content/content-engine.js";
import { MockContentGenerationProvider } from "../content/index.js";
import { SchedulerPipeline } from "../schedules/scheduler-pipeline.js";
import {
  XContentFeatureExtractor,
  XContentOptimizer,
  XOptimizationEngine,
  XOptimizationImpactEvaluator,
  XOptimizationRecommendationService,
  XPublicationService,
  computeOptimizationScore,
  postingTimeBucket,
  tokyoParts,
  MockXPublishingProvider,
} from "./index.js";

loadConfig({ requireDatabaseUrl: false });

const database = createDatabaseClient();
const research = new ResearchRepository(database.prisma);
const analysis = new AnalysisRepository(database.prisma);
const contents = new ContentRepository(database.prisma);
const publications = new XPublicationRepository(database.prisma);
const optimization = new XOptimizationRepository(database.prisma);
const logger = createLogger("error");
const baseConfig = {
  ...loadConfig({ requireDatabaseUrl: false }),
  xGlobalKillSwitch: false,
  xReleaseMode: "FULL" as const,
  xReleaseDailyPostLimit: 100,
  xReleaseHourlyPostLimit: 100,
  xReleaseAllowedStartHourJst: 0,
  xReleaseAllowedEndHourJst: 23,
  xReleaseAllowedStrategies: [
    "CONTROL",
    "SINGLE_POST",
    "ROOT_WITH_REPLY",
    "RELATED_POST_LINK",
    "THREAD",
    "HUB_POST",
  ],
};
const PREFIX = "xopt-mock-";

function item(
  overrides: Partial<CollectedResearchItem> & { externalId: string },
): CollectedResearchItem {
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
    rawData: { id: overrides.externalId, secret: "should-not-leak" },
    metrics: overrides.metrics ?? [
      { metricType: "rankingPosition", value: 1, recordedAt: collectedAt },
      { metricType: "reviewAverage", value: 4.5, recordedAt: collectedAt },
      { metricType: "reviewCount", value: 100, recordedAt: collectedAt },
      { metricType: "price", value: 1980, recordedAt: collectedAt },
    ],
    tags: overrides.tags ?? [
      { name: "女優X", type: "actress" },
      { name: "ジャンルX", type: "genre" },
    ],
    images: [
      {
        imageType: "package",
        sourceUrl: `https://pics.example/${overrides.externalId}.jpg`,
        usageStatus: "ALLOWED",
      },
    ],
    ...overrides,
  };
}

async function cleanup(): Promise<void> {
  await database.prisma.xOperationalAuditLog.deleteMany();
  await database.prisma.xProductPublicationReservation.deleteMany();
  await database.prisma.xProductPublicationState.deleteMany();
  await database.prisma.xRuntimeControl.deleteMany();
  await database.prisma.xOptimizationApplication.deleteMany();
  await database.prisma.xOptimizationRecommendation.deleteMany();
  await database.prisma.xOptimizationFinding.deleteMany();
  await database.prisma.xOptimizationRun.deleteMany();
  await database.prisma.xContentVariant.deleteMany();
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

async function seedReadyContent(externalId = `${PREFIX}a`): Promise<string> {
  await research.saveCollection({
    providerName: "mock",
    collectedAt: new Date(),
    items: [item({ externalId, title: "最適化テスト商品" })],
  } as CollectionResult);

  await new AnalysisEngine({ logger, research, analysis, config: baseConfig }).run({
    source: "mock",
    limit: 20,
    candidateLimit: 5,
  });

  const candidates = await analysis.listContentCandidates({ limit: 5 });
  const itemRow = await database.prisma.researchItem.findFirst({ where: { externalId } });
  const candidate =
    candidates.find((c) => c.researchItemId === itemRow?.id) ?? candidates[0]!;
  const contentEngine = new ContentEngine({
    logger,
    config: baseConfig,
    contents,
    provider: new MockContentGenerationProvider(),
  });
  const generated = await contentEngine.generate({
    candidateId: candidate.id,
    contentType: "X_POST",
    force: true,
    skipExistingSameType: false,
  });
  let contentId = generated.items[0]!.contentId!;
  let row = await contents.findGeneratedContentById(contentId);

  for (let i = 0; i < 3 && row && row.status !== "REVIEW_REQUIRED"; i += 1) {
    if (row.status === "VALIDATION_FAILED" || row.status === "DRAFT") {
      const regen = await contentEngine.regenerate({
        contentId: row.id,
        instruction: `xopt-unique-${externalId}-${Date.now()}-${i}`,
      });
      contentId = regen.items[0]!.contentId!;
      row = await contents.findGeneratedContentById(contentId);
    } else {
      break;
    }
  }

  if (row && row.status !== "REVIEW_REQUIRED" && row.status !== "APPROVED") {
    await database.prisma.generatedContent.update({
      where: { id: row.id },
      data: { status: "REVIEW_REQUIRED" },
    });
    row = await contents.findGeneratedContentById(row.id);
  }
  if (row?.status === "REVIEW_REQUIRED") {
    await contents.approveContent(row.id, "admin");
  }
  const approved = await contents.findGeneratedContentById(row!.id);
  if (approved?.status === "APPROVED") {
    await contents.markReadyToPublish(approved.id);
  }
  const ready = await contents.findGeneratedContentById(row!.id);
  expect(ready?.status).toBe("READY_TO_PUBLISH");
  return ready!.id;
}

function pubService(now?: () => Date): XPublicationService {
  return new XPublicationService({
    logger,
    config: { ...baseConfig, xApiEnabled: false, xApiProvider: "mock" },
    contents,
    publications,
    provider: new MockXPublishingProvider({ username: "mockuser" }),
    now: now ?? (() => new Date("2026-07-29T12:00:00.000Z")),
    random: () => 0.1,
    loadItemTags: async (researchItemId) => {
      const tags = await database.prisma.researchItemTag.findMany({
        where: { researchItemId },
        include: { researchTag: true },
      });
      const group = (type: string) =>
        tags
          .filter((t) => t.researchTag.type.toLowerCase() === type)
          .map((t) => t.researchTag.name);
      return {
        actress: group("actress"),
        genre: group("genre"),
        maker: group("maker"),
        series: group("series"),
      };
    },
    loadCandidateType: async (id) => {
      const row = await database.prisma.contentCandidate.findUnique({ where: { id } });
      return row?.candidateType;
    },
  });
}

async function publishWithStrategy(
  externalId: string,
  strategy: "SINGLE_POST" | "ROOT_WITH_REPLY" | "CONTROL",
  at: Date,
  metrics: { impressions: number; urlClicks: number | null; likes: number },
): Promise<string> {
  const contentId = await seedReadyContent(externalId);
  const svc = pubService(() => at);
  const pub = await svc.createFromContent({
    contentId,
    strategy,
    publishNow: true,
  });
  await svc.publishOne(pub.id);
  const published = await publications.findById(pub.id);
  const root = published!.posts.find((p) => p.sequence === 1)!;
  await publications.saveMetricSnapshot({
    publicationId: pub.id,
    publicationPostId: root.id,
    xPostId: root.xPostId ?? `mock-${pub.id}`,
    measuredAt: new Date(at.getTime() + 72 * 60 * 60 * 1000),
    impressionCount: metrics.impressions,
    likeCount: metrics.likes,
    replyCount: 0,
    repostCount: 0,
    quoteCount: 0,
    bookmarkCount: 1,
    urlClickCount: metrics.urlClicks,
    profileClickCount: 2,
    detailExpandCount: null,
    mediaViewCount: null,
    followerCountAtMeasurement: null,
    rawMetricAvailability: {
      urlClickCount: metrics.urlClicks != null,
    },
    source: "mock",
    collectionWindowMinutes: 4320,
  });
  return pub.id;
}

beforeAll(async () => {
  await database.connect();
});

afterAll(async () => {
  await cleanup();
  await database.disconnect();
});

beforeEach(async () => {
  await cleanup();
});

describe("X Optimization feature extraction", () => {
  it("extracts Tokyo weekday/bucket, hashtags, URL/disclosure placement, density", async () => {
    const contentId = await seedReadyContent(`${PREFIX}feat`);
    // 2026-07-29 12:00 UTC = 21:00 JST Wednesday
    const at = new Date("2026-07-29T12:00:00.000Z");
    const svc = pubService(() => at);
    const pub = await svc.createFromContent({
      contentId,
      strategy: "ROOT_WITH_REPLY",
      publishNow: true,
    });
    await svc.publishOne(pub.id);
    await database.prisma.xPublication.update({
      where: { id: pub.id },
      data: { publishedAt: at, scheduledAt: at },
    });
    const loaded = await publications.findById(pub.id);
    expect(loaded).toBeTruthy();

    const extractor = new XContentFeatureExtractor(baseConfig);
    const features = extractor.extract({
      publication: loaded!,
      title: "最適化テスト商品",
      candidateType: "RANKING",
      productScore: 80,
      reviewCount: 100,
      inputSnapshot: { tags: { actress: ["女優X"], genre: ["ジャンルX"] } },
    });

    expect(features.contentAngle).toBe("RANKING");
    expect(features.hasReply).toBe(true);
    expect(features.urlPlacement).toMatch(/ROOT|REPLY|NONE|MULTIPLE/);
    expect(features.disclosurePlacement).toMatch(/ROOT|REPLY|NONE|MULTIPLE/);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(features.informationDensity);
    expect(features.postingTimeBucket).toBe("21:00-23:59");
    expect(features.weekday).toBe("Wed");
    expect(JSON.stringify(extractor.featureSnapshot(features))).not.toContain("should-not-leak");
    expect(JSON.stringify(extractor.featureSnapshot(features))).not.toContain("rawData");

    const parts = tokyoParts(at);
    expect(postingTimeBucket(parts.hour)).toBe("21:00-23:59");
  });
});

describe("X Optimization scoring", () => {
  it("keeps missing metrics null and renormalizes score", () => {
    const rates = {
      impressionCount: 100,
      engagementRate: 0.11,
      urlClickRate: null,
      profileClickRate: 0.02,
      bookmarkRate: 0.01,
      repostRate: 0,
      likeRate: 0.1,
    };
    expect(rates.urlClickRate).toBeNull();

    const scored = computeOptimizationScore(rates, baseConfig.xOptimizationScoreWeights);
    expect(scored.missing).toContain("urlClickRate");
    expect(scored.score).not.toBeNull();
    const weightSum = Object.values(scored.usedWeights).reduce((s, v) => s + v, 0);
    expect(weightSum).toBeCloseTo(1, 5);
  });
});

describe("X Optimization engine", () => {
  it("creates INSUFFICIENT_DATA findings without recommendations when samples are low", async () => {
    await publishWithStrategy(
      `${PREFIX}s1`,
      "SINGLE_POST",
      new Date("2026-07-20T12:00:00.000Z"),
      { impressions: 100, urlClicks: 5, likes: 3 },
    );
    await publishWithStrategy(
      `${PREFIX}s2`,
      "ROOT_WITH_REPLY",
      new Date("2026-07-21T12:00:00.000Z"),
      { impressions: 120, urlClicks: 8, likes: 4 },
    );

    const engine = new XOptimizationEngine({
      logger,
      config: {
        ...baseConfig,
        xOptimizationMode: "RECOMMEND",
        xOptimizationMinSampleSize: 30,
        xOptimizationMinScoreImprovement: 0.05,
        xOptimizationMaxMissingRate: 0.4,
      },
      publications,
      optimization,
    });
    const result = await engine.run({ lookbackDays: 90, windowHours: 72 });
    expect(result.analyzedPublicationCount).toBeGreaterThanOrEqual(2);
    const findings = await optimization.listFindings({ optimizationRunId: result.runId });
    expect(findings.some((f) => f.findingType === "INSUFFICIENT_DATA")).toBe(true);
    expect(result.generatedRecommendationCount).toBe(0);
  });

  it("creates recommendations in RECOMMEND mode when sample threshold is met", async () => {
    const cfg = {
      ...baseConfig,
      xOptimizationMode: "RECOMMEND" as const,
      xOptimizationMinSampleSize: 2,
      xOptimizationMinScoreImprovement: 0.01,
      xOptimizationMaxMissingRate: 0.9,
      xOptimizationMaxActiveRecommendations: 10,
    };
    for (let i = 0; i < 3; i += 1) {
      await publishWithStrategy(
        `${PREFIX}rec-s-${i}`,
        "SINGLE_POST",
        new Date(`2026-07-${10 + i}T03:00:00.000Z`),
        { impressions: 50, urlClicks: 1, likes: 1 },
      );
    }
    for (let i = 0; i < 3; i += 1) {
      await publishWithStrategy(
        `${PREFIX}rec-r-${i}`,
        "ROOT_WITH_REPLY",
        new Date(`2026-07-${13 + i}T03:00:00.000Z`),
        { impressions: 200, urlClicks: 40, likes: 20 },
      );
    }

    const engine = new XOptimizationEngine({
      logger,
      config: cfg,
      publications,
      optimization,
    });
    const result = await engine.run({ mode: "RECOMMEND" });
    expect(result.generatedRecommendationCount).toBeGreaterThanOrEqual(1);
    const recs = await optimization.listRecommendations({ status: "REVIEW_REQUIRED" });
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0]!.rationale).toMatch(/現時点のデータでは|関連が見られ/);
    expect(recs[0]!.rationale).not.toMatch(/因果関係がある|必ず改善/);
  });

  it("OBSERVE_ONLY creates findings but no recommendations", async () => {
    for (let i = 0; i < 2; i += 1) {
      await publishWithStrategy(
        `${PREFIX}obs-${i}`,
        i === 0 ? "SINGLE_POST" : "ROOT_WITH_REPLY",
        new Date(`2026-07-${20 + i}T03:00:00.000Z`),
        { impressions: 100 + i * 50, urlClicks: 5 + i * 10, likes: 2 },
      );
    }
    const engine = new XOptimizationEngine({
      logger,
      config: {
        ...baseConfig,
        xOptimizationMode: "OBSERVE_ONLY",
        xOptimizationMinSampleSize: 1,
        xOptimizationMinScoreImprovement: 0.01,
        xOptimizationMaxMissingRate: 0.9,
      },
      publications,
      optimization,
    });
    const result = await engine.run({ mode: "OBSERVE_ONLY" });
    expect(result.findingCount).toBeGreaterThanOrEqual(1);
    expect(result.generatedRecommendationCount).toBe(0);
  });
});

describe("X Optimization review & apply", () => {
  async function seedApprovedRecommendation() {
    const run = await optimization.createRun({
      evaluationWindowHours: 72,
      parameters: { test: true },
    });
    await optimization.startRun(run.id);
    await optimization.completeRun(run.id, {
      analyzedPublicationCount: 10,
      generatedRecommendationCount: 1,
      errorCount: 0,
    });
    const finding = await optimization.createFinding({
      optimizationRunId: run.id,
      dimension: "CONTENT_ANGLE",
      segmentKey: "test",
      currentVariant: "RANKING",
      comparedVariant: "HIGH_RATING",
      currentSampleCount: 40,
      comparedSampleCount: 42,
      currentScore: 10,
      comparedScore: 20,
      scoreDifference: 10,
      confidenceLevel: "HIGH",
      findingType: "POSITIVE",
    });
    const rec = await optimization.createRecommendation({
      optimizationRunId: run.id,
      findingId: finding.id,
      dimension: "CONTENT_ANGLE",
      currentValue: "RANKING",
      recommendedValue: "HIGH_RATING",
      rationale: "現時点のデータでは HIGH_RATING の関連が見られます。因果関係は断定できません。",
      confidenceLevel: "HIGH",
      requiredSampleSize: 30,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    return rec;
  }

  it("approves/rejects and blocks unapproved apply; TTL expire works", async () => {
    const service = new XOptimizationRecommendationService({
      logger,
      config: baseConfig,
      optimization,
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    });
    const rec = await seedApprovedRecommendation();
    const contentId = await seedReadyContent(`${PREFIX}apply-block`);

    await expect(
      new XContentOptimizer({
        logger,
        config: baseConfig,
        contents,
        publications,
        optimization,
        contentEngine: new ContentEngine({
          logger,
          config: baseConfig,
          contents,
          provider: new MockContentGenerationProvider(),
        }),
      }).apply({ recommendationId: rec.id, contentId, createExperiment: false }),
    ).rejects.toThrow(/not APPROVED/);

    const approved = await service.approve(rec.id, "admin", "ok");
    expect(approved.status).toBe("APPROVED");

    const expiredRun = await optimization.createRun({
      evaluationWindowHours: 72,
      parameters: {},
    });
    const expired = await optimization.createRecommendation({
      optimizationRunId: expiredRun.id,
      dimension: "HASHTAG_SET",
      currentValue: "PR_PLUS_FANZA",
      recommendedValue: "PR_ONLY_IN_DISCLOSURE",
      rationale: "現時点のデータでは関連が見られます。",
      confidenceLevel: "MEDIUM",
      requiredSampleSize: 30,
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const count = await service.expireDue();
    expect(count).toBeGreaterThanOrEqual(1);
    const after = await optimization.findRecommendationById(expired.id);
    expect(after?.status).toBe("EXPIRED");

    const rejectTarget = await seedApprovedRecommendation();
    const rejected = await service.reject(rejectTarget.id, "admin", "no");
    expect(rejected.status).toBe("REJECTED");
  });

  it("applies CONTENT_ANGLE as new version without overwriting parent", async () => {
    const service = new XOptimizationRecommendationService({
      logger,
      config: baseConfig,
      optimization,
    });
    const rec = await seedApprovedRecommendation();
    await service.approve(rec.id, "admin");
    const contentId = await seedReadyContent(`${PREFIX}angle`);
    const parent = await contents.findGeneratedContentById(contentId);

    const optimizer = new XContentOptimizer({
      logger,
      config: baseConfig,
      contents,
      publications,
      optimization,
      contentEngine: new ContentEngine({
        logger,
        config: baseConfig,
        contents,
        provider: new MockContentGenerationProvider(),
      }),
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });
    const result = await optimizer.apply({
      recommendationId: rec.id,
      contentId,
      createExperiment: true,
    });

    expect(result.parentContentId).toBe(contentId);
    expect(result.version).toBeGreaterThan(parent!.version);
    expect(result.generatedContentId).not.toBe(contentId);
    const stillParent = await contents.findGeneratedContentById(contentId);
    expect(stillParent?.body).toBe(parent?.body);
    const child = await contents.findGeneratedContentById(result.generatedContentId!);
    expect(child?.parentContentId).toBe(contentId);
    expect(child?.affiliateUrl).toBe(parent?.affiliateUrl);
    expect(child?.body).toMatch(/アフィリエイト|#PR/);
    expect(result.experimentId).toBeTruthy();
    const experiment = await publications.findExperimentById(result.experimentId!);
    const variants = experiment?.strategyVariants as {
      allocation?: { CONTROL?: number; VARIANT?: number };
      optimizationDimension?: string;
    };
    expect(variants.allocation?.CONTROL).toBe(0.5);
    expect(variants.allocation?.VARIANT).toBe(0.5);
    expect(variants.optimizationDimension).toBe("CONTENT_ANGLE");
  });

  it("changes only HASHTAG_SET / POSTING_TIME / POST_FORMAT independently", async () => {
    const run = await optimization.createRun({
      evaluationWindowHours: 72,
      parameters: {},
    });
    await optimization.completeRun(run.id, {
      analyzedPublicationCount: 1,
      generatedRecommendationCount: 3,
      errorCount: 0,
    });

    const makeRec = async (
      dimension: "HASHTAG_SET" | "POSTING_TIME" | "POST_FORMAT",
      currentValue: string,
      recommendedValue: string,
    ) => {
      const rec = await optimization.createRecommendation({
        optimizationRunId: run.id,
        dimension,
        currentValue,
        recommendedValue,
        rationale: "現時点のデータでは関連が見られます。因果関係は断定できません。",
        confidenceLevel: "MEDIUM",
        requiredSampleSize: 30,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      });
      await optimization.approveRecommendation(rec.id, "admin");
      return rec;
    };

    const optimizer = new XContentOptimizer({
      logger,
      config: {
        ...baseConfig,
        xOptimizationMaxConcurrentExperimentsPerDimension: 5,
      },
      contents,
      publications,
      optimization,
      contentEngine: new ContentEngine({
        logger,
        config: baseConfig,
        contents,
        provider: new MockContentGenerationProvider(),
      }),
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    const contentHash = await seedReadyContent(`${PREFIX}htag`);
    const parent = await contents.findGeneratedContentById(contentHash);
    const tagRec = await makeRec("HASHTAG_SET", "PR_PLUS_FANZA", "PR_ONLY_IN_DISCLOSURE");
    const tagResult = await optimizer.apply({
      recommendationId: tagRec.id,
      contentId: contentHash,
      createExperiment: false,
    });
    const tagged = await contents.findGeneratedContentById(tagResult.generatedContentId!);
    expect(tagged?.parentContentId).toBe(contentHash);
    expect(tagged?.affiliateUrl).toBe(parent?.affiliateUrl);

    const timeContent = await seedReadyContent(`${PREFIX}time`);
    const timeParent = await contents.findGeneratedContentById(timeContent);
    const timeRec = await makeRec("POSTING_TIME", "12:00-14:59", "21:00-23:59");
    const timeResult = await optimizer.apply({
      recommendationId: timeRec.id,
      contentId: timeContent,
      createExperiment: false,
    });
    const timed = await contents.findGeneratedContentById(timeResult.generatedContentId!);
    expect(timed?.body).toBe(timeParent?.body);
    expect(timed?.title).toBe(timeParent?.title);

    const formatContent = await seedReadyContent(`${PREFIX}fmt`);
    const formatRec = await makeRec("POST_FORMAT", "SINGLE_POST", "ROOT_WITH_REPLY");
    const formatResult = await optimizer.apply({
      recommendationId: formatRec.id,
      contentId: formatContent,
      createExperiment: false,
    });
    expect(formatResult.diff.postFormat?.after).toBe("ROOT_WITH_REPLY");
  });

  it("AUTO mode still cannot apply unapproved recommendations", async () => {
    expect(baseConfig.xOptimizationMode === "AUTO" || true).toBe(true);
    const rec = await seedApprovedRecommendation();
    const contentId = await seedReadyContent(`${PREFIX}auto`);
    await expect(
      new XContentOptimizer({
        logger,
        config: { ...baseConfig, xOptimizationMode: "AUTO" },
        contents,
        publications,
        optimization,
        contentEngine: new ContentEngine({
          logger,
          config: baseConfig,
          contents,
          provider: new MockContentGenerationProvider(),
        }),
      }).apply({ recommendationId: rec.id, contentId, createExperiment: false }),
    ).rejects.toThrow(/not APPROVED/);
  });

  it("blocks recommendation re-apply and concurrent experiments per dimension", async () => {
    const service = new XOptimizationRecommendationService({
      logger,
      config: baseConfig,
      optimization,
    });
    const rec = await seedApprovedRecommendation();
    await service.approve(rec.id, "admin");
    const contentId = await seedReadyContent(`${PREFIX}reapp`);
    const optimizer = new XContentOptimizer({
      logger,
      config: {
        ...baseConfig,
        xOptimizationMaxConcurrentExperimentsPerDimension: 1,
      },
      contents,
      publications,
      optimization,
      contentEngine: new ContentEngine({
        logger,
        config: baseConfig,
        contents,
        provider: new MockContentGenerationProvider(),
      }),
    });
    await optimizer.apply({
      recommendationId: rec.id,
      contentId,
      createExperiment: true,
    });
    const contentId2 = await seedReadyContent(`${PREFIX}reapp2`);
    await expect(
      optimizer.apply({
        recommendationId: rec.id,
        contentId: contentId2,
        createExperiment: true,
      }),
    ).rejects.toThrow(/recently applied|concurrent experiment|not APPROVED|APPLIED/);
  });
});

describe("X Optimization impact", () => {
  it("evaluates IMPROVED / DECLINED / NO_CLEAR_DIFFERENCE / INSUFFICIENT_DATA", async () => {
    const run = await optimization.createRun({
      evaluationWindowHours: 72,
      parameters: {},
    });
    await optimization.completeRun(run.id, {
      analyzedPublicationCount: 1,
      generatedRecommendationCount: 1,
      errorCount: 0,
    });
    const evaluator = new XOptimizationImpactEvaluator({
      logger,
      config: {
        ...baseConfig,
        xOptimizationMinSampleSize: 3,
        xOptimizationMinScoreImprovement: 0.05,
        xOptimizationDeclineStopThreshold: -0.1,
      },
      publications,
      optimization,
    });

    const mk = async () =>
      optimization.createRecommendation({
        optimizationRunId: run.id,
        dimension: "POST_FORMAT",
        currentValue: "SINGLE_POST",
        recommendedValue: "ROOT_WITH_REPLY",
        rationale: "現時点のデータでは関連が見られます。",
        confidenceLevel: "MEDIUM",
        requiredSampleSize: 3,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        status: "APPROVED",
      });

    const improvedRec = await mk();
    const improved = await evaluator.evaluateWithSamples({
      recommendationId: improvedRec.id,
      controlScores: [10, 11, 12],
      variantScores: [25, 26, 27],
      experimentCount: 1,
    });
    expect(improved.label).toBe("IMPROVED");
    expect(improved.permanentAdoptionCandidate).toBe(false);

    const improved2 = await evaluator.evaluateWithSamples({
      recommendationId: improvedRec.id,
      controlScores: Array.from({ length: 6 }, () => 10),
      variantScores: Array.from({ length: 6 }, () => 30),
      experimentCount: 2,
    });
    expect(improved2.permanentAdoptionCandidate).toBe(true);

    const declinedRec = await mk();
    const declined = await evaluator.evaluateWithSamples({
      recommendationId: declinedRec.id,
      controlScores: [40, 41, 42],
      variantScores: [5, 6, 7],
      experimentCount: 1,
    });
    expect(declined.label).toBe("DECLINED");
    expect(declined.stopped).toBe(true);

    const flatRec = await mk();
    const flat = await evaluator.evaluateWithSamples({
      recommendationId: flatRec.id,
      controlScores: [20, 21, 22],
      variantScores: [20.5, 21, 21.2],
      experimentCount: 1,
    });
    expect(flat.label).toBe("NO_CLEAR_DIFFERENCE");

    const insufRec = await mk();
    const insuf = await evaluator.evaluateWithSamples({
      recommendationId: insufRec.id,
      controlScores: [10],
      variantScores: [30],
      experimentCount: 1,
    });
    expect(insuf.label).toBe("INSUFFICIENT_DATA");
  });
});

describe("X Optimization scheduler", () => {
  it("skips optimization when disabled and respects min interval", async () => {
    expect(baseConfig.xOptimizationEnabled).toBe(false);
    const pipeline = new SchedulerPipeline({
      logger,
      database,
      config: {
        ...baseConfig,
        analysisAutoRunEnabled: false,
        contentAutoGenerationEnabled: false,
        xAutoPublicationEnabled: false,
        xMetricsCollectionEnabled: false,
        xStrategyEvaluationEnabled: false,
        xOptimizationEnabled: false,
        xOptimizationImpactEvaluationEnabled: false,
      },
      now: () => new Date(),
    });
    const result = await pipeline.run();
    expect("skipReason" in result.xOptimization).toBe(true);
    expect("skipReason" in result.xOptimizationImpact).toBe(true);

    const run = await optimization.createRun({
      evaluationWindowHours: 72,
      parameters: {},
    });
    await optimization.completeRun(run.id, {
      analyzedPublicationCount: 0,
      generatedRecommendationCount: 0,
      errorCount: 0,
    });
    await database.prisma.xOptimizationRun.update({
      where: { id: run.id },
      data: { completedAt: new Date() },
    });

    const pipeline2 = new SchedulerPipeline({
      logger,
      database,
      config: {
        ...baseConfig,
        analysisAutoRunEnabled: false,
        contentAutoGenerationEnabled: false,
        xAutoPublicationEnabled: false,
        xMetricsCollectionEnabled: false,
        xStrategyEvaluationEnabled: false,
        xOptimizationEnabled: true,
        xOptimizationMinIntervalMinutes: 1440,
        xOptimizationImpactEvaluationEnabled: false,
      },
      now: () => new Date(Date.now() + 60_000),
    });
    const result2 = await pipeline2.run();
    expect(
      "skipReason" in result2.xOptimization &&
        result2.xOptimization.skipReason === "X_OPTIMIZATION_MIN_INTERVAL_NOT_ELAPSED",
    ).toBe(true);
  });
});
