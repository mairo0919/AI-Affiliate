import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  ArticlePatternRepository,
  LifecycleRepository,
  P5Repository,
  P6Repository,
  cleanupLifecycleTablesForTests,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { MockLLMProvider } from "../adapters/llm/mock-llm-provider.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import { QualityGateService } from "../generation/quality-gate.js";
import { StrategyWithFeedbackService } from "../ops-p6/strategy-with-feedback.js";
import { ArticlePatternService, ArticlePatternError } from "./article-pattern-service.js";
import {
  asResolveFormatSpec,
  createResolveActiveFormat,
} from "./resolve-active-format.js";
import { evaluateArticleFormatCompliance } from "./format-compliance.js";
import { aggregateArticlePatterns } from "./pattern-aggregation.js";
import {
  assertFeaturesAreStructuralOnly,
  extractArticleStructureFeatures,
} from "./structure-extraction.js";
import type { ArticleFormatSpec } from "./types.js";
import { DEFAULT_SINGLE_WRITING_POLICY } from "./types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

const SAMPLE_SPEC: ArticleFormatSpec = {
  targetProductCount: { min: 1, max: 1 },
  requiredSectionOrder: ["intro", "product_sections", "cta"],
  optionalSections: [],
  ctaPolicy: { minCount: 1, maxCount: 2, preferredPositions: ["bottom"] },
  imagePolicy: { minCount: 0, enforce: false },
  rankingRequired: false,
  comparisonTableRequired: false,
  introPolicy: { maxChars: 400 },
  lengthPolicy: { minChars: 80, maxChars: 5000 },
};

describe("ArticleStructureExtraction (deterministic)", () => {
  it("extracts heading/image/CTA/sectionOrder without storing prose templates", () => {
    const html = loadFixture("single-a.html");
    const extracted = extractArticleStructureFeatures({
      html,
      title: "新作レビュー Sample Catalog A",
      sourceUrl: "https://review-a.example.test/articles/a",
    });
    assertFeaturesAreStructuralOnly(extracted.features);
    expect(extracted.features.headingCount).toBeGreaterThanOrEqual(2);
    expect(extracted.features.imageCount).toBe(1);
    expect(extracted.features.ctaCount).toBeGreaterThanOrEqual(1);
    expect(extracted.features.sectionOrder).toContain("intro");
    expect(extracted.features.sectionOrder).toContain("product_sections");
    expect(JSON.stringify(extracted.features)).not.toMatch(/本作はカタログ上で確認できる新作です/);
    expect(extracted.features.headingPatterns.every((p) => /^h[1-6]$/.test(p))).toBe(true);
  });
});

describe("PatternAggregation + FormatCompliance (unit)", () => {
  it("requires multi-domain diversity and does not activate-worthy confidence alone", () => {
    const obs = [
      {
        id: "1",
        sourceDomain: "a.test",
        sourceUrl: "https://a.test/1",
        articleTypeHint: "single_review",
        features: {
          ...extractArticleStructureFeatures({
            html: loadFixture("single-a.html"),
            sourceUrl: "https://a.test/1",
          }).features,
        },
      },
      {
        id: "2",
        sourceDomain: "a.test",
        sourceUrl: "https://a.test/2",
        articleTypeHint: "single_review",
        features: {
          ...extractArticleStructureFeatures({
            html: loadFixture("single-a.html"),
            sourceUrl: "https://a.test/2",
          }).features,
        },
      },
      {
        id: "3",
        sourceDomain: "a.test",
        sourceUrl: "https://a.test/3",
        articleTypeHint: "single_review",
        features: {
          ...extractArticleStructureFeatures({
            html: loadFixture("single-a.html"),
            sourceUrl: "https://a.test/3",
          }).features,
        },
      },
    ] as Parameters<typeof aggregateArticlePatterns>[0];

    const result = aggregateArticlePatterns(obs, {
      minimumSampleCount: 3,
      minimumDomainDiversity: 2,
    });
    expect(result?.meetsThresholds).toBe(false);
    expect(result?.domainDiversity).toBe(1);
  });

  it("passes format compliance for compliant single-product article", () => {
    const check = evaluateArticleFormatCompliance({
      formatKey: "NEW_RELEASE_SINGLE",
      spec: SAMPLE_SPEC,
      title: "Sample",
      body: "十分な長さの本文です。公開情報を整理し、詳細は https://example.invalid/p を確認してください。追加の説明を入れて長さを確保します。さらに確認できる事実のみを記載します。",
      article: {
        lead: "導入",
        sections: [{ heading: "情報", paragraphs: ["事実"], lists: [] }],
        cta: { label: "詳細", url: "https://example.invalid/p" },
      },
      estimatedProductCount: 1,
    });
    expect(check.ok).toBe(true);
    expect(check.findings.filter((f) => f.severity === "blocking")).toHaveLength(0);
  });

  it("warns when format productCount exceeds single-product path", () => {
    const check = evaluateArticleFormatCompliance({
      formatKey: "BEST_5",
      spec: { ...SAMPLE_SPEC, targetProductCount: { min: 5, max: 5 } },
      title: "Sample",
      body: "十分な長さの本文です。公開情報を整理し、詳細は https://example.invalid/p を確認してください。追加の説明を入れて長さを確保します。さらに確認できる事実のみを記載します。",
      article: {
        lead: "導入",
        sections: [{ heading: "情報", paragraphs: ["事実"], lists: [] }],
        cta: { label: "詳細", url: "https://example.invalid/p" },
      },
      estimatedProductCount: 1,
    });
    expect(check.findings.some((f) => f.code === "FORMAT_PRODUCT_COUNT" && f.severity === "warning")).toBe(
      true,
    );
    expect(check.ok).toBe(true);
  });

  it("legacy without ACTIVE spec stays compatible", () => {
    const check = evaluateArticleFormatCompliance({
      formatKey: "new-release",
      spec: null,
      body: "x",
    });
    expect(check.ok).toBe(true);
  });
});

loadConfig({ requireDatabaseUrl: false });
const database = createDatabaseClient();
const lifecycleRepo = new LifecycleRepository(database.prisma);
const p5 = new P5Repository(database.prisma);
const p6 = new P6Repository(database.prisma);
const patterns = new ArticlePatternRepository(database.prisma);

describe("ArticlePattern vertical (Observation → ACTIVE → Strategy → generate → Gate)", () => {
  beforeAll(async () => {
    await database.connect();
  });
  afterAll(async () => {
    await database.disconnect();
  });
  beforeEach(async () => {
    await cleanupLifecycleTablesForTests(database.prisma);
    await database.prisma.auditEvent.deleteMany();
    await database.prisma.promptDefinition.deleteMany();
    await seedP45Prompts(lifecycleRepo);
  });

  function service(thresholds = { minimumSampleCount: 3, minimumDomainDiversity: 2 }) {
    return new ArticlePatternService(patterns, lifecycleRepo, p5, p6, thresholds);
  }

  it("persists Observation features only — no full HTML body on SourceDocument/Observation", async () => {
    const svc = service();
    const html = loadFixture("single-a.html");
    const obs = await svc.observeFromHtml({
      sourceUrl: "https://review-a.example.test/articles/a",
      html,
      title: "A",
    });
    expect(obs.features).toBeTruthy();
    expect(JSON.stringify(obs)).not.toContain("本作はカタログ上で確認できる新作です");
    const source = await database.prisma.sourceDocument.findUnique({
      where: { id: obs.sourceDocumentId! },
    });
    expect(source?.normalizedText).toBeNull();
    expect(source?.metadata).toMatchObject({ storesFullBody: false });
  });

  it("aggregates across domains; single domain cannot approve/activate", async () => {
    const svc = service();
    const html = loadFixture("single-a.html");
    await svc.observeFromHtml({
      sourceUrl: "https://only.example.test/1",
      html,
      title: "1",
    });
    await svc.observeFromHtml({
      sourceUrl: "https://only.example.test/2",
      html: loadFixture("single-b.html"),
      title: "2",
    });
    await svc.observeFromHtml({
      sourceUrl: "https://only.example.test/3",
      html: loadFixture("single-c.html"),
      title: "3",
    });
    const { aggregation, format } = await svc.aggregateAndProposeFormat({
      formatKey: "NEW_RELEASE_SINGLE",
    });
    expect(aggregation.meetsThresholds).toBe(false);
    expect(format).toBeNull();

    const forced = await svc.aggregateAndProposeFormat({
      formatKey: "NEW_RELEASE_SINGLE",
      forceProposeBelowThreshold: true,
    });
    expect(forced.format?.status).toBe("PROPOSED");
    await expect(svc.approveFormat(forced.format!.id, "op")).rejects.toBeInstanceOf(
      ArticlePatternError,
    );
    await expect(svc.activateFormat(forced.format!.id, "op")).rejects.toMatchObject({
      code: "approval_required",
    });
  });

  it("minimum sample not met → no format without force", async () => {
    const svc = service({ minimumSampleCount: 3, minimumDomainDiversity: 2 });
    await svc.observeFromHtml({
      sourceUrl: "https://a.example.test/1",
      html: loadFixture("single-a.html"),
    });
    await svc.observeFromHtml({
      sourceUrl: "https://b.example.test/1",
      html: loadFixture("single-b.html"),
    });
    const { format } = await svc.aggregateAndProposeFormat({ formatKey: "NEW_RELEASE_SINGLE" });
    expect(format).toBeNull();
  });

  it("runs full vertical with human approval and ACTIVE format into Strategy/generate/Gate", async () => {
    const svc = service();
    const urls = [
      ["https://review-a.example.test/a", "single-a.html"],
      ["https://blog-b.example.test/b", "single-b.html"],
      ["https://media-c.example.test/c", "single-c.html"],
    ] as const;
    for (const [url, file] of urls) {
      await svc.observeFromHtml({ sourceUrl: url, html: loadFixture(file), title: file });
    }

    const { aggregation, format: proposed } = await svc.aggregateAndProposeFormat({
      formatKey: "NEW_RELEASE_SINGLE",
    });
    expect(aggregation.meetsThresholds).toBe(true);
    expect(proposed?.status).toBe("PROPOSED");
    expect(proposed?.domainDiversity).toBeGreaterThanOrEqual(2);
    expect(proposed?.sampleExternal).toBeGreaterThanOrEqual(3);

    await expect(svc.activateFormat(proposed!.id, "op")).rejects.toMatchObject({
      code: "approval_required",
    });

    const awaiting = await svc.approveFormat(proposed!.id, "human-reviewer");
    expect(awaiting.status).toBe("AWAITING_APPROVAL");
    expect(awaiting.approvedBy).toBe("human-reviewer");

    const active = await svc.activateFormat(proposed!.id, "human-reviewer");
    expect(active.status).toBe("ACTIVE");
    expect(active.linkedLearningRuleId).toBeTruthy();
    const rule = await p6.findLearningRule(active.linkedLearningRuleId!);
    expect(rule?.status).toBe("ACTIVE");
    expect(rule?.ruleType).toBe("article_format");

    const llm = new MockLLMProvider();
    const strategySvc = new StrategyWithFeedbackService(lifecycleRepo, p5, p6, llm, svc);
    const topic = await lifecycleRepo.createTopicCandidate({
      title: "Sample Catalog Item Vertical",
      summary: "fixture vertical",
      formatHint: "article",
      status: "READY",
    });
    const { strategy } = await strategySvc.generate({
      topicCandidateId: topic.id,
      platform: "BLOGGER",
      contentType: "article",
    });
    expect(strategy.formatKey).toBe("NEW_RELEASE_SINGLE");
    expect(strategy.formatCategory).toBe(active.formatCategory);

    const resolveActiveFormat = createResolveActiveFormat(svc);
    const generation = new ContentGenerationService(
      lifecycleRepo,
      llm,
      { generation: "mock", review: "mock", revision: "mock" },
      resolveActiveFormat,
    );
    const claim = await lifecycleRepo.createClaim({
      statement: "Sample Catalog Item Vertical は公開カタログ上で確認できる",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });

    const generated = await generation.generateBloggerArticle({
      topicId: topic.id,
      strategyId: strategy.id,
      productTitle: "Sample Catalog Item Vertical",
      ctaUrl: "https://example.invalid/product",
      claimIds: [claim.id],
    });
    expect(generated.article.articleFormat).toBe("NEW_RELEASE_SINGLE");
    const modelRun = await lifecycleRepo.findModelRun(generated.modelRunId);
    expect(modelRun?.metadata).toMatchObject({
      articleFormat: "NEW_RELEASE_SINGLE",
      formatKey: "NEW_RELEASE_SINGLE",
      formatId: active.id,
      writingPolicyApplied: true,
    });
    const meta = modelRun?.metadata as { formatSpec?: Record<string, unknown> };
    expect(meta.formatSpec).toBeTruthy();
    expect(meta.formatSpec).toHaveProperty("targetProductCount");

    const resolveFormatSpec = asResolveFormatSpec(resolveActiveFormat);
    const gate = new QualityGateService(lifecycleRepo, generation, resolveFormatSpec);
    const result = await gate.evaluate(generated.version.id);
    const formatStage = result.stages.find((s) => s.stage === "article_format_compliance");
    expect(formatStage).toBeTruthy();
    expect(formatStage?.ok).toBe(true);
    expect(result.overall === "failed").toBe(false);
  });

  it("Claim priority: format multi-product unmet does not invent facts (warning metadata)", async () => {
    const svc = service();
    for (const [url, file] of [
      ["https://a.example.test/x", "single-a.html"],
      ["https://b.example.test/x", "single-b.html"],
      ["https://c.example.test/x", "single-c.html"],
    ] as const) {
      await svc.observeFromHtml({ sourceUrl: url, html: loadFixture(file) });
    }
    const { format } = await svc.aggregateAndProposeFormat({ formatKey: "BEST_5_TEST" });
    expect(format).toBeTruthy();
    await patterns.updateFormat(format!.id, {
      spec: {
        ...SAMPLE_SPEC,
        targetProductCount: { min: 5, max: 5 },
        writingPolicy: DEFAULT_SINGLE_WRITING_POLICY,
      },
      sampleExternal: 3,
      domainDiversity: 3,
    });
    await svc.approveFormat(format!.id, "op");
    await svc.activateFormat(format!.id, "op");

    const llm = new MockLLMProvider();
    const strategySvc = new StrategyWithFeedbackService(lifecycleRepo, p5, p6, llm, svc);
    const topic = await lifecycleRepo.createTopicCandidate({
      title: "Claim Over Format",
      status: "READY",
    });
    const actives = await svc.listFormats("ACTIVE");
    for (const f of actives) {
      if (f.formatKey !== "BEST_5_TEST") {
        await svc.suspendFormat(f.id, "op", "isolate");
      }
    }
    const { strategy } = await strategySvc.generate({ topicCandidateId: topic.id });
    expect(strategy.formatKey).toBe("BEST_5_TEST");

    const generation = new ContentGenerationService(
      lifecycleRepo,
      llm,
      { generation: "mock", review: "mock", revision: "mock" },
      createResolveActiveFormat(svc),
    );
    const claim = await lifecycleRepo.createClaim({
      statement: "単一商品の事実のみ",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    const generated = await generation.generateBloggerArticle({
      topicId: topic.id,
      strategyId: strategy.id,
      productTitle: "Single Product",
      ctaUrl: "https://example.invalid/p",
      claimIds: [claim.id],
    });
    expect(generated.article.sections.length).toBeGreaterThan(0);
    const modelRun = await lifecycleRepo.findModelRun(generated.modelRunId);
    const formatSpec = (modelRun?.metadata as { formatSpec?: { _claimOverFormat?: boolean } })
      ?.formatSpec;
    expect(formatSpec?._claimOverFormat).toBe(true);
  });
});
