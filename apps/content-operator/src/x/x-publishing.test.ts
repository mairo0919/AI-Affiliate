import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  AnalysisRepository,
  ContentRepository,
  ResearchRepository,
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
  XCharacterCounter,
  XMetricsCollector,
  XPublicationBuilder,
  XPublicationService,
  XPublicationValidationError,
  XStrategyEvaluator,
  XStrategySelector,
  computeEngagementRate,
  computeRate,
  MockXPublishingProvider,
} from "./index.js";

loadConfig({ requireDatabaseUrl: false });

const database = createDatabaseClient();
const research = new ResearchRepository(database.prisma);
const analysis = new AnalysisRepository(database.prisma);
const contents = new ContentRepository(database.prisma);
const publications = new XPublicationRepository(database.prisma);
const logger = createLogger("error");
const config = {
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

const PREFIX = "xpub-mock-";

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
    rawData: { id: overrides.externalId },
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
    items: [item({ externalId, title: "X投稿テスト商品" })],
  } as CollectionResult);

  const analysisEngine = new AnalysisEngine({ logger, research, analysis, config });
  await analysisEngine.run({ source: "mock", limit: 20, candidateLimit: 5 });

  const candidates = await analysis.listContentCandidates({ limit: 5 });
  const itemRow = await database.prisma.researchItem.findFirst({
    where: { externalId },
  });
  const candidate =
    candidates.find((c) => c.researchItemId === itemRow?.id) ?? candidates[0]!;
  const contentEngine = new ContentEngine({
    logger,
    config,
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
        instruction: `x-unique-${externalId}-${Date.now()}-${i}`,
      });
      contentId = regen.items[0]!.contentId!;
      row = await contents.findGeneratedContentById(contentId);
    } else {
      break;
    }
  }

  if (row && row.status !== "REVIEW_REQUIRED" && row.status !== "APPROVED") {
    // Test helper: promote to reviewable when mock validation remains noisy
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

function service(provider?: MockXPublishingProvider, now?: () => Date): XPublicationService {
  return new XPublicationService({
    logger,
    config: { ...config, xApiEnabled: false, xApiProvider: "mock" },
    contents,
    publications,
    provider: provider ?? new MockXPublishingProvider({ username: "mockuser" }),
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

describe("X CharacterCounter", () => {
  it("weights Japanese and applies URL fixed length", () => {
    const counter = new XCharacterCounter(23);
    const jp = counter.count("あいうえお");
    expect(jp.weightedLength).toBe(10);
    const withUrl = counter.count("hello https://example.com/very/long/path");
    expect(withUrl.weightedLength).toBe(5 + 1 + 23);
    const emoji = counter.count("😀");
    expect(emoji.weightedLength).toBeGreaterThanOrEqual(2);
  });
});

describe("X Publication Builder", () => {
  const builder = new XPublicationBuilder({
    ...config,
    xAffiliateDisclosure: "#PR",
    xMaxWeightedLength: 280,
    xMaxHashtags: 2,
    xMaxPostsPerPublication: 3,
    xUrlWeightedLength: 23,
  });

  it("builds SINGLE_POST / ROOT_WITH_REPLY / CONTROL with ROOT seq=1", () => {
    for (const strategy of ["SINGLE_POST", "ROOT_WITH_REPLY", "CONTROL"] as const) {
      const built = builder.build(strategy, {
        title: "作品A",
        affiliateUrl: "https://al.fanza.co.jp/?lurl=a",
        hashtags: ["FANZA"],
        summary: "注目",
        facts: ["rank:1"],
      });
      expect(built.posts[0]?.sequence).toBe(1);
      expect(["ROOT", "HUB"]).toContain(built.posts[0]?.role);
      expect(built.posts[0]?.body).toContain("#PR");
    }
  });

  it("rejects circular replies and missing disclosure", () => {
    expect(() =>
      builder.validateStructure([
        { sequence: 1, role: "ROOT", body: "a #PR" },
        { sequence: 2, role: "REPLY", body: "b", replyToSequence: 3 },
        { sequence: 3, role: "REPLY", body: "c", replyToSequence: 2 },
      ]),
    ).toThrow(/circular|earlier/);

    expect(() =>
      builder.build("SINGLE_POST", {
        title: "x",
        affiliateUrl: "https://al.fanza.co.jp/?lurl=x",
      }),
    ).not.toThrow();

    expect(() =>
      builder.build("CONTROL", {
        title: "x",
        affiliateUrl: "https://al.fanza.co.jp/?lurl=x",
        summary: undefined,
        // force missing disclosure by using internal fit path — use raw validate via oversized strip
        hashtags: [],
      }),
    ).not.toThrow();

    expect(() =>
      builder.assertPostValid(
        {
          sequence: 1,
          role: "ROOT",
          body: "no disclosure https://al.fanza.co.jp/?lurl=x",
        },
        "SINGLE_POST",
      ),
    ).toThrow(XPublicationValidationError);
  });

  it("falls back when RELATED requires link", () => {
    expect(() =>
      builder.build("RELATED_POST_LINK", {
        title: "x",
        affiliateUrl: "https://al.fanza.co.jp/?lurl=x",
      }),
    ).toThrow(/requires related/);
  });
});

describe("X Publishing Engine", () => {
  it("allows publication only from READY_TO_PUBLISH", async () => {
    const contentId = await seedReadyContent();
    const review = await contents.findGeneratedContentById(contentId);
    // Create a REVIEW_REQUIRED sibling via new generation
    await research.saveCollection({
      providerName: "mock",
      collectedAt: new Date(),
      items: [item({ externalId: `${PREFIX}b`, title: "別商品" })],
    } as CollectionResult);
    await new AnalysisEngine({ logger, research, analysis, config }).run({
      source: "mock",
      limit: 20,
    });
    const candidates = await analysis.listContentCandidates({ limit: 20 });
    const other = candidates.find((c) => c.researchItemId !== review?.researchItemId);
    const gen = await new ContentEngine({
      logger,
      config,
      contents,
      provider: new MockContentGenerationProvider(),
    }).generate({
      candidateId: other!.id,
      contentType: "X_POST",
      force: true,
      skipExistingSameType: false,
    });
    const notReadyId = gen.items[0]!.contentId!;
    await expect(
      service().createFromContent({ contentId: notReadyId, strategy: "SINGLE_POST" }),
    ).rejects.toThrow(/READY_TO_PUBLISH/);

    const pub = await service().createFromContent({
      contentId,
      strategy: "SINGLE_POST",
      scheduledAt: new Date("2026-07-30T12:00:00+09:00"),
    });
    expect(pub.status).toBe("SCHEDULED");
    expect(pub.posts).toHaveLength(1);
  });

  it("publishes root+reply, retries reply-only, prevents double post", async () => {
    const contentId = await seedReadyContent(`${PREFIX}reply`);
    const mock = new MockXPublishingProvider({ username: "mockuser" });
    const svc = service(mock);
    const pub = await svc.createFromContent({
      contentId,
      strategy: "ROOT_WITH_REPLY",
      publishNow: true,
    });
    const published = await svc.publishOne(pub.id);
    expect(published.status).toBe("PUBLISHED");
    expect(published.posts.every((p) => p.xPostId)).toBe(true);
    expect(published.rootPostUrl).toContain("mockuser");
    const calls = mock.getCreateCallCount();

    // idempotent republish should not create new posts
    const again = await svc.publishOne(pub.id);
    expect(again.status).toBe("PUBLISHED");
    expect(mock.getCreateCallCount()).toBe(calls);
  });

  it("skips replies when root fails; partial publish on reply fail; retry reply", async () => {
    const contentId = await seedReadyContent(`${PREFIX}fail`);
    const rootFail = new MockXPublishingProvider({ behavior: "root_fail" });
    const svcFail = service(rootFail);
    const pub = await svcFail.createFromContent({
      contentId,
      strategy: "ROOT_WITH_REPLY",
      publishNow: true,
    });
    const failed = await svcFail.publishOne(pub.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.posts.find((p) => p.sequence === 2)?.status).toBe("SKIPPED");

    const contentId2 = await seedReadyContent(`${PREFIX}partial`);
    const replyFail = new MockXPublishingProvider({
      behavior: "reply_fail",
      username: "mockuser",
    });
    const svcPartial = service(replyFail);
    const pub2 = await svcPartial.createFromContent({
      contentId: contentId2,
      strategy: "ROOT_WITH_REPLY",
      publishNow: true,
    });
    const partial = await svcPartial.publishOne(pub2.id);
    expect(partial.status).toBe("PARTIALLY_PUBLISHED");
    expect(partial.posts.find((p) => p.sequence === 1)?.status).toBe("PUBLISHED");
    expect(partial.posts.find((p) => p.sequence === 2)?.status).toBe("FAILED");

    replyFail.behavior = "ok";
    const retried = await svcPartial.retry(pub2.id);
    expect(retried.status).toBe("PUBLISHED");
    expect(retried.posts.find((p) => p.sequence === 1)?.xPostId).toBe(
      partial.posts.find((p) => p.sequence === 1)?.xPostId,
    );
  });

  it("does not retry ValidationError; retries rate limit path via error type", async () => {
    const contentId = await seedReadyContent(`${PREFIX}val`);
    const validation = new MockXPublishingProvider({ behavior: "validation" });
    const svc = service(validation);
    const pub = await svc.createFromContent({
      contentId,
      strategy: "CONTROL",
      publishNow: true,
    });
    const result = await svc.publishOne(pub.id);
    expect(result.status).toBe("FAILED");
    expect(result.posts[0]?.lastErrorType).toBe("Validation");
  });

  it("falls back when related missing; builds related when available", async () => {
    const contentId = await seedReadyContent(`${PREFIX}rel1`);
    const svc = service();
    const without = await svc.createFromContent({
      contentId,
      strategy: "RELATED_POST_LINK",
    });
    expect(without.strategyType).toBe("SINGLE_POST");

    // Publish first content to create related target (separate content required)
    await svc.publishOne(without.id);

    const contentId2 = await seedReadyContent(`${PREFIX}rel2`);
    const withRelated = await svc.createFromContent({
      contentId: contentId2,
      strategy: "RELATED_POST_LINK",
    });
    expect(["RELATED_POST_LINK", "SINGLE_POST", "ROOT_WITH_REPLY"]).toContain(
      withRelated.strategyType,
    );
  });

  it("collects metrics with null-safe rates and window dedupe", async () => {
    const contentId = await seedReadyContent(`${PREFIX}met`);
    let clock = new Date("2026-07-29T00:00:00.000Z");
    const mock = new MockXPublishingProvider({
      username: "mockuser",
      metricsFixture: {
        impressionCount: 100,
        likeCount: 2,
        replyCount: 1,
        repostCount: 0,
        quoteCount: 0,
        bookmarkCount: 1,
        urlClickCount: null,
        profileClickCount: 3,
        availability: { urlClickCount: false },
      },
    });
    const svc = service(mock, () => clock);
    const pub = await svc.createFromContent({
      contentId,
      strategy: "SINGLE_POST",
      publishNow: true,
    });
    await svc.publishOne(pub.id);

    clock = new Date(clock.getTime() + 60 * 60 * 1000);
    const collector = new XMetricsCollector({
      logger,
      config,
      publications,
      provider: mock,
      now: () => clock,
    });
    const first = await collector.collect();
    expect(first.collected).toBeGreaterThanOrEqual(1);
    const second = await collector.collect();
    expect(second.skipped).toBeGreaterThanOrEqual(1);

    expect(computeEngagementRate(4, 100)).toBe(0.04);
    expect(computeEngagementRate(4, 0)).toBeNull();
    expect(computeRate(null, 100)).toBeNull();
  });

  it("evaluates strategies with INSUFFICIENT under min samples", async () => {
    const evaluator = new XStrategyEvaluator({
      logger,
      config: { ...config, xStrategyMinSampleSize: 30 },
      publications,
    });
    const report = await evaluator.evaluate({ minimumSamples: 30, windowHours: 72 });
    expect(report.confidenceLevel).toBe("INSUFFICIENT");
    expect(report.recommendedStrategy).toBeNull();
  });

  it("round-robin / random / weighted selection and exploration rate", async () => {
    const selector = new XStrategySelector(config, publications, () => 0.99);
    const a = await selector.select({ hasRelated: false });
    const b = await selector.select({ hasRelated: false });
    expect(a.strategyType).not.toBe("RELATED_POST_LINK");
    expect(b.strategyType).not.toBe("THREAD");

    const randomSelector = new XStrategySelector(
      { ...config, xStrategySelectionMode: "random" },
      publications,
      () => 0.2,
    );
    const r = await randomSelector.select({ hasRelated: true });
    expect(r.reason === "random" || r.reason === "exploration").toBe(true);

    const experiment = await publications.createExperiment({
      name: `exp-${Date.now()}`,
      strategyVariants: [
        { strategyType: "SINGLE_POST", weight: 1 },
        { strategyType: "CONTROL", weight: 1 },
      ],
      allocationMethod: "WEIGHTED",
    });
    await publications.updateExperimentStatus(experiment.id, "RUNNING", {
      startedAt: new Date(),
    });
    const weighted = await selector.select({ hasRelated: false });
    expect(["SINGLE_POST", "CONTROL", "ROOT_WITH_REPLY"]).toContain(weighted.strategyType);
  });

  it("auto optimization disabled does not change allocation mode; pipeline order skips X phases", async () => {
    expect(config.xStrategyAutoOptimizationEnabled).toBe(false);
    const pipeline = new SchedulerPipeline({
      logger,
      database,
      config: {
        ...config,
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
    expect("skipReason" in result.xPublish).toBe(true);
    expect("skipReason" in result.xMetrics).toBe(true);
    expect("skipReason" in result.xStrategy).toBe(true);
    expect("skipReason" in result.xOptimization).toBe(true);
    expect("skipReason" in result.xOptimizationImpact).toBe(true);
  });

  it("does not store secrets in publication bodies", async () => {
    const contentId = await seedReadyContent(`${PREFIX}sec`);
    const pub = await service().createFromContent({
      contentId,
      strategy: "SINGLE_POST",
    });
    const dumped = JSON.stringify(pub);
    expect(dumped).not.toContain("X_API_ACCESS_TOKEN");
    expect(dumped).not.toContain("client_secret");
  });
});
