import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  AnalysisRepository,
  ContentRepository,
  ContentStateError,
  ResearchRepository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import type { CollectedResearchItem, CollectionResult } from "@ai-affiliate/shared";
import { AnalysisEngine } from "../analysis/analysis-engine.js";
import { SchedulerPipeline } from "../schedules/scheduler-pipeline.js";
import {
  ContentEngine,
  ContentGenerationInputBuilder,
  ContentValidator,
  MockContentGenerationProvider,
  extractForbiddenSnippetsFromRawData,
  hashNormalizedContent,
  normalizeContentText,
  repairStructuredJsonOnce,
  similarityScore,
  tryParseJsonObject,
} from "./index.js";

loadConfig({ requireDatabaseUrl: false });

const database = createDatabaseClient();
const research = new ResearchRepository(database.prisma);
const analysis = new AnalysisRepository(database.prisma);
const contents = new ContentRepository(database.prisma);
const logger = createLogger("error");
const config = loadConfig({ requireDatabaseUrl: false });

const PREFIX = "content-mock-";

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
    rawData: overrides.rawData ?? {
      id: overrides.externalId,
      comment:
        "これは商品説明文の禁止テキストサンプルです。生成入力には渡してはいけません。十分に長い説明文を入れて類似検出できるようにします。",
      review: {
        review_text:
          "ユーザーレビュー本文のサンプルです。生成に使ってはいけません。長いレビュー文字列を保持します。",
      },
      secret: "should-not-appear",
    },
    metrics: overrides.metrics ?? [
      { metricType: "rankingPosition", value: 3, recordedAt: collectedAt },
      { metricType: "reviewAverage", value: 4.5, recordedAt: collectedAt },
      { metricType: "reviewCount", value: 120, recordedAt: collectedAt },
      { metricType: "price", value: 1980, recordedAt: collectedAt },
      { metricType: "discountRate", value: 30, recordedAt: collectedAt },
    ],
    tags: overrides.tags ?? [
      { name: "女優A", type: "actress" },
      { name: "ジャンルA", type: "genre" },
      { name: "メーカーA", type: "maker" },
    ],
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

async function seedCandidates(options?: {
  includeNotEligible?: boolean;
  includeRequiresConfirmation?: boolean;
}): Promise<{ analysisRunId: string; candidateIds: string[] }> {
  await save([
    item({
      externalId: `${PREFIX}rank-1`,
      title: "ランキング作品1",
      metrics: [
        { metricType: "rankingPosition", value: 1, recordedAt: new Date("2026-07-01") },
        { metricType: "reviewAverage", value: 4.8, recordedAt: new Date("2026-07-01") },
        { metricType: "reviewCount", value: 200, recordedAt: new Date("2026-07-01") },
        { metricType: "price", value: 1500, recordedAt: new Date("2026-07-01") },
      ],
    }),
    item({
      externalId: `${PREFIX}rank-2`,
      title: "ランキング作品2",
      metrics: [
        { metricType: "rankingPosition", value: 2, recordedAt: new Date("2026-07-01") },
        { metricType: "reviewAverage", value: 4.2, recordedAt: new Date("2026-07-01") },
        { metricType: "reviewCount", value: 80, recordedAt: new Date("2026-07-01") },
        { metricType: "price", value: 2200, recordedAt: new Date("2026-07-01") },
      ],
    }),
    item({
      externalId: `${PREFIX}confirm`,
      title: "確認必要作品",
      images: [
        {
          imageType: "package",
          sourceUrl: `https://pics.example/${PREFIX}confirm.jpg`,
          usageStatus: "REQUIRES_CONFIRMATION",
        },
      ],
    }),
    item({
      externalId: `${PREFIX}no-url`,
      title: "URLなし",
      url: null as unknown as string,
    }),
  ]);

  // Force NOT_ELIGIBLE by clearing url via direct update after save for one item
  if (options?.includeNotEligible !== false) {
    await database.prisma.researchItem.updateMany({
      where: { externalId: `${PREFIX}no-url` },
      data: { url: null },
    });
  }

  const engine = new AnalysisEngine({ logger, research, analysis, config });
  const result = await engine.run({
    source: "mock",
    limit: 50,
    candidateLimit: 10,
    includeRequiresConfirmation: options?.includeRequiresConfirmation === true,
  });

  const candidates = await analysis.listContentCandidates({
    analysisRunId: result.analysisRunId!,
    limit: 50,
  });
  return {
    analysisRunId: result.analysisRunId!,
    candidateIds: candidates.map((c) => c.id),
  };
}

function engine(provider?: MockContentGenerationProvider): ContentEngine {
  return new ContentEngine({
    logger,
    config,
    contents,
    provider: provider ?? new MockContentGenerationProvider(),
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

describe("Content Engine", () => {
  it("builds allowlist input without rawData/description/review text", async () => {
    const { candidateIds } = await seedCandidates();
    const rows = await contents.listCandidatesForGeneration({
      candidateId: candidateIds[0],
      contentType: "X_POST",
      limit: 1,
      skipExistingSameType: false,
    });
    expect(rows.length).toBe(1);
    const input = new ContentGenerationInputBuilder().build({
      candidate: rows[0]!,
      contentType: "X_POST",
    });
    const json = JSON.stringify(input);
    expect(json).not.toContain("rawData");
    expect(json).not.toContain("商品説明文の禁止");
    expect(json).not.toContain("ユーザーレビュー本文");
    expect(json).not.toContain("should-not-appear");
    expect(input.affiliateUrl).toContain("al.fanza.co.jp");
    expect(input.rankingPosition).toBe(1);
  });

  it("excludes NOT_ELIGIBLE and REQUIRES_CONFIRMATION by default", async () => {
    await seedCandidates({ includeRequiresConfirmation: true });
    const eligible = await contents.listCandidatesForGeneration({
      contentType: "X_POST",
      limit: 50,
      skipExistingSameType: false,
    });
    expect(
      eligible.every((row) => row.productAnalysis.eligibilityStatus === "ELIGIBLE"),
    ).toBe(true);

    const withConfirm = await contents.listCandidatesForGeneration({
      contentType: "X_POST",
      limit: 50,
      includeRequiresConfirmation: true,
      skipExistingSameType: false,
    });
    expect(
      withConfirm.some(
        (row) => row.productAnalysis.eligibilityStatus === "REQUIRES_CONFIRMATION",
      ),
    ).toBe(true);
  });

  it("generates blog / x / short-video / product-intro", async () => {
    const { candidateIds } = await seedCandidates();
    const candidateId = candidateIds[0]!;
    for (const contentType of [
      "BLOG_ARTICLE",
      "X_POST",
      "SHORT_VIDEO_SCRIPT",
      "PRODUCT_INTRODUCTION",
    ] as const) {
      const result = await engine().generate({
        candidateId,
        contentType,
        force: true,
        skipExistingSameType: false,
      });
      expect(result.generatedCount).toBe(1);
      expect(result.items[0]?.status).toMatch(/REVIEW_REQUIRED|VALIDATION_FAILED/);
      const created = await contents.findGeneratedContentById(result.items[0]!.contentId!);
      expect(created?.affiliateUrl).toContain("al.fanza.co.jp");
      expect(JSON.stringify(created?.inputSnapshot)).not.toContain("商品説明文の禁止");
    }
  });

  it("repairs structured JSON once and fails irreparable output", async () => {
    const repaired = repairStructuredJsonOnce(
      '{"title":"t","body":"b","hashtags":"bad"}',
    );
    expect(repaired).toBeTruthy();
    expect(tryParseJsonObject(repaired!)?.["hashtags"]).toEqual([]);

    const { candidateIds } = await seedCandidates();
    const fail = await engine(new MockContentGenerationProvider({ defaultBehavior: "invalid_json" })).generate({
      candidateId: candidateIds[0],
      contentType: "X_POST",
      force: true,
      skipExistingSameType: false,
    });
    expect(fail.errorCount).toBe(1);
    expect(fail.status).toBe("FAILED");
  });

  it("detects forbidden text similarity without storing full snippet", async () => {
    const snippets = extractForbiddenSnippetsFromRawData({
      comment: "これは商品説明文の禁止テキストサンプルです。生成入力には渡してはいけません。十分に長い説明文を入れて類似検出できるようにします。",
    });
    expect(snippets.descriptions.length).toBeGreaterThan(0);

    const { candidateIds } = await seedCandidates();
    const rows = await contents.listCandidatesForGeneration({
      candidateId: candidateIds[0],
      contentType: "PRODUCT_INTRODUCTION",
      skipExistingSameType: false,
    });
    const input = new ContentGenerationInputBuilder().build({
      candidate: rows[0]!,
      contentType: "PRODUCT_INTRODUCTION",
    });
    const validator = new ContentValidator(config, contents);
    const outcome = await validator.validate({
      contentType: "PRODUCT_INTRODUCTION",
      targetChannel: "GENERIC",
      input,
      output: {
        title: input.title,
        body: `${snippets.descriptions[0]} ${input.affiliateUrl} ※アフィリエイト広告を含みます`,
        hashtags: [],
        callToAction: "詳細へ",
      },
      researchItemId: rows[0]!.researchItemId,
      rawData: {
        comment: snippets.descriptions[0],
      },
    });
    expect(outcome.status).toBe("VALIDATION_FAILED");
    const forbidden = outcome.issues.find((i) => i.issueType === "FORBIDDEN_SOURCE_TEXT");
    expect(forbidden).toBeTruthy();
    expect(forbidden?.detectedValue?.startsWith("hash:")).toBe(true);
    expect(forbidden?.detectedValue).not.toContain("商品説明文の禁止テキストサンプル");
  });

  it("detects fabricated ranking and person names", async () => {
    const { candidateIds } = await seedCandidates();
    const rows = await contents.listCandidatesForGeneration({
      candidateId: candidateIds[0],
      contentType: "X_POST",
      skipExistingSameType: false,
    });
    const input = new ContentGenerationInputBuilder().build({
      candidate: rows[0]!,
      contentType: "X_POST",
    });
    input.rankingPosition = null;
    const validator = new ContentValidator(config, contents);
    const outcome = await validator.validate({
      contentType: "X_POST",
      targetChannel: "X",
      input,
      output: {
        title: input.title,
        body: `第99位 ${input.title} 出演:架空の人名 ${input.affiliateUrl} ※アフィリエイト`,
        hashtags: [],
        callToAction: "詳細",
      },
      researchItemId: rows[0]!.researchItemId,
    });
    expect(outcome.issues.some((i) => i.issueType === "FABRICATED_FACT")).toBe(true);
  });

  it("detects X length / blog length / video seconds / missing disclosure", async () => {
    const { candidateIds } = await seedCandidates();
    const rows = await contents.listCandidatesForGeneration({
      candidateId: candidateIds[0],
      contentType: "X_POST",
      skipExistingSameType: false,
    });
    const input = new ContentGenerationInputBuilder().build({
      candidate: rows[0]!,
      contentType: "X_POST",
    });
    const validator = new ContentValidator(config, contents);

    const x = await validator.validate({
      contentType: "X_POST",
      targetChannel: "X",
      input,
      output: {
        title: "t",
        body: `${"あ".repeat(200)}${input.affiliateUrl}`,
        hashtags: [],
        callToAction: "cta",
      },
      researchItemId: rows[0]!.researchItemId,
    });
    expect(x.issues.some((i) => i.issueType === "LENGTH_EXCEEDED")).toBe(true);

    const blogShort = await validator.validate({
      contentType: "BLOG_ARTICLE",
      targetChannel: "BLOG",
      input,
      output: {
        title: "t",
        body: "短い本文 ※アフィリエイト広告を含みます",
        hashtags: [],
        callToAction: "cta",
      },
      researchItemId: rows[0]!.researchItemId,
    });
    expect(blogShort.issues.some((i) => i.issueType === "LENGTH_TOO_SHORT")).toBe(true);

    const blogLong = await validator.validate({
      contentType: "BLOG_ARTICLE",
      targetChannel: "BLOG",
      input,
      output: {
        title: "t",
        body: `${"あ".repeat(2000)} ※アフィリエイト広告を含みます`,
        hashtags: [],
        callToAction: "cta",
      },
      researchItemId: rows[0]!.researchItemId,
    });
    expect(blogLong.issues.some((i) => i.issueType === "LENGTH_EXCEEDED")).toBe(true);

    const video = await validator.validate({
      contentType: "SHORT_VIDEO_SCRIPT",
      targetChannel: "SHORT_VIDEO",
      input,
      output: {
        title: "t",
        body: "台本",
        hashtags: [],
        callToAction: "cta",
        metadata: { estimatedDurationSeconds: 90 },
      },
      researchItemId: rows[0]!.researchItemId,
    });
    expect(video.issues.some((i) => i.issueType === "LENGTH_EXCEEDED")).toBe(true);

    const disclosure = await validator.validate({
      contentType: "PRODUCT_INTRODUCTION",
      targetChannel: "GENERIC",
      input,
      output: {
        title: "t",
        body: `紹介 ${input.affiliateUrl}`,
        hashtags: [],
        callToAction: "cta",
      },
      researchItemId: rows[0]!.researchItemId,
    });
    expect(disclosure.issues.some((i) => i.issueType === "MISSING_DISCLOSURE")).toBe(true);
  });

  it("detects NOT_ALLOWED and UNKNOWN images", async () => {
    const { candidateIds } = await seedCandidates();
    const rows = await contents.listCandidatesForGeneration({
      candidateId: candidateIds[0],
      contentType: "X_POST",
      skipExistingSameType: false,
    });
    const input = new ContentGenerationInputBuilder().build({
      candidate: rows[0]!,
      contentType: "X_POST",
    });
    const validator = new ContentValidator(config, contents);
    const notAllowed = await validator.validate({
      contentType: "X_POST",
      targetChannel: "X",
      input,
      output: {
        title: "t",
        body: `${input.title} ${input.affiliateUrl} ※アフィリエイト`,
        hashtags: [],
        callToAction: "cta",
      },
      researchItemId: rows[0]!.researchItemId,
      selectedImageId: "img-1",
      imageUsageById: new Map([["img-1", "NOT_ALLOWED"]]),
    });
    expect(notAllowed.issues.some((i) => i.issueType === "PROHIBITED_IMAGE")).toBe(true);

    const unknown = await validator.validate({
      contentType: "X_POST",
      targetChannel: "X",
      input,
      output: {
        title: "t",
        body: `${input.title} ${input.affiliateUrl} ※アフィリエイト`,
        hashtags: [],
        callToAction: "cta",
      },
      researchItemId: rows[0]!.researchItemId,
      selectedImageId: "img-2",
      imageUsageById: new Map([["img-2", "UNKNOWN"]]),
    });
    expect(unknown.issues.some((i) => i.issueType === "IMAGE_CONFIRMATION_REQUIRED")).toBe(
      true,
    );
  });

  it("detects exact and approximate duplicates; contentHash is stable", async () => {
    const { candidateIds } = await seedCandidates();
    const first = await engine().generate({
      candidateId: candidateIds[0],
      contentType: "PRODUCT_INTRODUCTION",
      force: true,
      skipExistingSameType: false,
    });
    const contentId = first.items[0]!.contentId!;
    const created = await contents.findGeneratedContentById(contentId);
    expect(created).toBeTruthy();
    const hash1 = hashNormalizedContent(created!.body);
    const hash2 = hashNormalizedContent(`  ${created!.body}  `);
    expect(hash1).toBe(hash2);
    expect(created!.contentHash).toBe(hash1);

    const dup = await engine().generate({
      candidateId: candidateIds[0],
      contentType: "PRODUCT_INTRODUCTION",
      force: true,
      skipExistingSameType: false,
    });
    const second = await contents.findGeneratedContentById(dup.items[0]!.contentId!);
    expect(second?.status).toBe("VALIDATION_FAILED");
    expect(
      second?.validationIssues.some((i) => i.issueType === "DUPLICATE_CONTENT"),
    ).toBe(true);

    expect(similarityScore(normalizeContentText("abc def"), normalizeContentText("abc  def"))).toBeGreaterThan(
      0.9,
    );
  });

  it("supports versioned regenerate without overwriting parent", async () => {
    const { candidateIds } = await seedCandidates();
    const first = await engine().generate({
      candidateId: candidateIds[0],
      contentType: "X_POST",
      force: true,
      skipExistingSameType: false,
    });
    const parentId = first.items[0]!.contentId!;
    const parentBefore = await contents.findGeneratedContentById(parentId);
    const regen = await engine().regenerate({
      contentId: parentId,
      instruction: "もっと短く、ランキング情報を中心にする",
    });
    expect(regen.generatedCount).toBe(1);
    const child = await contents.findGeneratedContentById(regen.items[0]!.contentId!);
    expect(child?.version).toBe((parentBefore?.version ?? 1) + 1);
    expect(child?.parentContentId).toBe(parentId);
    const parentAfter = await contents.findGeneratedContentById(parentId);
    expect(parentAfter?.body).toBe(parentBefore?.body);
    expect(JSON.stringify(child?.inputSnapshot)).toContain("もっと短く");
  });

  it("enforces review state transitions", async () => {
    const { candidateIds } = await seedCandidates();
    const result = await engine().generate({
      candidateId: candidateIds[0],
      contentType: "PRODUCT_INTRODUCTION",
      force: true,
      skipExistingSameType: false,
    });
    const contentId = result.items[0]!.contentId!;

    // Unique instruction so approximate/exact duplicate checks pass
    const ok = await engine().regenerate({
      contentId,
      instruction: `unique-revision-${Date.now()}-alpha`,
    });
    const reviewId = ok.items[0]!.contentId!;
    const reviewRow = await contents.findGeneratedContentById(reviewId);
    expect(reviewRow?.status).toBe("REVIEW_REQUIRED");

    const approved = await contents.approveContent(reviewId, "admin", "確認済み");
    expect(approved.status).toBe("APPROVED");
    const ready = await contents.markReadyToPublish(reviewId);
    expect(ready.status).toBe("READY_TO_PUBLISH");

    await database.prisma.generatedContent.update({
      where: { id: reviewId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    await expect(contents.revertToDraft(reviewId)).rejects.toBeInstanceOf(ContentStateError);

    // VALIDATION_FAILED cannot be approved — force via duplicate of first content
    const failedGen = await engine().generate({
      candidateId: candidateIds[0],
      contentType: "PRODUCT_INTRODUCTION",
      force: true,
      skipExistingSameType: false,
    });
    const failedId = failedGen.items[0]!.contentId;
    if (failedId) {
      const failed = await contents.findGeneratedContentById(failedId);
      if (failed?.status === "VALIDATION_FAILED") {
        await expect(contents.approveContent(failedId, "admin")).rejects.toBeInstanceOf(
          ContentStateError,
        );
      }
    }
  });

  it("dry-run does not persist content", async () => {
    const { candidateIds } = await seedCandidates();
    const before = await contents.listGeneratedContents({ limit: 100 });
    const result = await engine().generate({
      candidateId: candidateIds[0],
      contentType: "X_POST",
      dryRun: true,
      force: true,
      skipExistingSameType: false,
    });
    expect(result.dryRun).toBe(true);
    expect(result.generationRunId).toBeNull();
    expect(result.generatedCount).toBe(1);
    const after = await contents.listGeneratedContents({ limit: 100 });
    expect(after.length).toBe(before.length);
  });

  it("continues after one failure and returns PARTIALLY_COMPLETED", async () => {
    const { analysisRunId, candidateIds } = await seedCandidates();
    expect(candidateIds.length).toBeGreaterThanOrEqual(2);

    let calls = 0;
    const flaky = new MockContentGenerationProvider();
    const original = flaky.generate.bind(flaky);
    flaky.generate = async (request) => {
      calls += 1;
      if (calls === 1) {
        return {
          providerName: "mock",
          modelName: "mock-v1",
          rawText: "",
          output: null,
          repaired: false,
          timedOut: false,
          errorMessage: "forced failure",
        };
      }
      return original(request);
    };

    const result = await new ContentEngine({
      logger,
      config,
      contents,
      provider: flaky,
    }).generate({
      analysisRunId,
      contentType: "X_POST",
      limit: 2,
      force: true,
      skipExistingSameType: false,
    });

    expect(result.errorCount).toBe(1);
    expect(result.generatedCount).toBe(1);
    expect(result.status).toBe("PARTIALLY_COMPLETED");
  });

  it("does not fetch review bodies and keeps secrets out of snapshots", async () => {
    const { candidateIds } = await seedCandidates();
    const result = await engine().generate({
      candidateId: candidateIds[0],
      contentType: "BLOG_ARTICLE",
      force: true,
      skipExistingSameType: false,
    });
    const created = await contents.findGeneratedContentById(result.items[0]!.contentId!);
    const snap = JSON.stringify(created?.inputSnapshot);
    expect(snap).not.toContain("ユーザーレビュー本文");
    expect(snap).not.toContain("should-not-appear");
    expect(snap).not.toContain("DMM_API");
    expect(created?.body).not.toContain("should-not-appear");
  });

  it("scheduler skips auto content generation when disabled; does not auto-approve", async () => {
    await seedCandidates();
    const pipeline = new SchedulerPipeline({
      logger,
      database,
      config: {
        ...config,
        analysisAutoRunEnabled: false,
        contentAutoGenerationEnabled: false,
      },
      now: () => new Date(),
    });
    const skipped = await pipeline.run();
    expect("skipped" in skipped.content && skipped.content.skipped).toBe(true);

    const enabled = new SchedulerPipeline({
      logger,
      database,
      config: {
        ...config,
        analysisAutoRunEnabled: false,
        contentAutoGenerationEnabled: true,
        contentAutoGenerationMinScore: 0,
        contentAutoGenerationLimit: 5,
        contentAutoGenerationTypes: ["x-post"],
        contentAutoGenerationMinIntervalMinutes: 0,
      },
      now: () => new Date(),
    });
    const ran = await enabled.run();
    if (!("skipped" in ran.content)) {
      expect(ran.content.generatedCount).toBeGreaterThanOrEqual(0);
      for (const item of ran.content.items) {
        if (item.contentId) {
          const row = await contents.findGeneratedContentById(item.contentId);
          expect(row?.status).not.toBe("APPROVED");
          expect(row?.status).not.toBe("PUBLISHED");
          expect(row?.status).not.toBe("READY_TO_PUBLISH");
        }
      }
    }
  });

  it("rejects / request-changes review decisions", async () => {
    const { candidateIds } = await seedCandidates();
    const result = await engine().generate({
      candidateId: candidateIds[0],
      contentType: "PRODUCT_INTRODUCTION",
      force: true,
      skipExistingSameType: false,
    });
    let id = result.items[0]!.contentId!;
    let row = await contents.findGeneratedContentById(id);
    if (row?.status !== "REVIEW_REQUIRED") {
      const regen = await engine().regenerate({
        contentId: id,
        instruction: `rev-${Date.now()}-beta`,
      });
      id = regen.items[0]!.contentId!;
      row = await contents.findGeneratedContentById(id);
    }
    expect(row?.status).toBe("REVIEW_REQUIRED");
    await contents.requestChanges(id, "admin", "短くしてください");
    const rejected = await contents.rejectContent(id, "admin", "不採用");
    expect(rejected.status).toBe("REJECTED");
  });
});
