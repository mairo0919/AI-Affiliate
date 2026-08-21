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
import {
  buildImprovedEditorialArticleFixture,
  buildThinCatalogArticleFixture,
  evaluateEditorialQuality,
  EDITORIAL_THRESHOLDS,
} from "../generation/editorial-quality.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import { QualityGateService } from "../generation/quality-gate.js";
import { structuredToPlainBody, parseBloggerArticle } from "../generation/structured-article.js";
import { StrategyWithFeedbackService } from "../ops-p6/strategy-with-feedback.js";
import { ArticlePatternService } from "./article-pattern-service.js";
import {
  assertWritingFeaturesAreAbstract,
  extractWritingFeaturesDeterministic,
  getWritingFeaturesLlmJsonSchema,
  mergeWritingFeatures,
} from "./writing-extraction.js";
import { DEFAULT_SINGLE_WRITING_POLICY, type ArticleFormatSpec } from "./types.js";
import { extractArticleStructureFeatures } from "./structure-extraction.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("Writing feature extraction (unit)", () => {
  it("extracts abstract writing features without storing prose templates", () => {
    const html = loadFixture("single-a.html");
    const w = extractWritingFeaturesDeterministic({ html, title: "t" });
    assertWritingFeaturesAreAbstract(w);
    expect(w.audienceFramingUsed || w.benefitFramingUsed || w.curiosityGapUsed).toBe(true);
    expect(w.sectionPurposeSequence.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(w)).not.toMatch(/シリーズやメーカーが好みに近い人の候補リスト/);
  });

  it("LLM schema forbids free-form prose fields and merge stays abstract", () => {
    const schema = getWritingFeaturesLlmJsonSchema();
    expect(schema.additionalProperties).toBe(false);
    const base = extractWritingFeaturesDeterministic({
      html: loadFixture("single-b.html"),
    });
    const merged = mergeWritingFeatures(base, {
      introHookType: "audience_framing",
      benefitFramingUsed: true,
    });
    assertWritingFeaturesAreAbstract(merged);
    expect(merged.introHookType).toBe("audience_framing");
  });

  it("structure extraction nests writingFeatures + imageRoles", () => {
    const extracted = extractArticleStructureFeatures({
      html: loadFixture("single-c.html"),
      sourceUrl: "https://media-c.example.test/c",
    });
    expect(extracted.features.writingFeatures.informationDensityBucket).toBeTruthy();
    expect(extracted.features.imageRoles.length).toBe(extracted.features.imageCount);
  });
});

describe("Editorial quality benchmarks (unit)", () => {
  const policy = { ...DEFAULT_SINGLE_WRITING_POLICY };

  it("blocks thin title-paraphrase catalog articles under writingPolicy", () => {
    const thin = buildThinCatalogArticleFixture("Sample Catalog Thin");
    const result = evaluateEditorialQuality({
      ...thin,
      productTitle: "Sample Catalog Thin",
      writingPolicy: policy,
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.severity === "blocking")).toBe(true);
    expect(
      result.findings.some((f) =>
        ["TITLE_PARAPHRASE_DEPENDENCY", "EDITORIAL_VALUE_MISSING", "GENERIC_AI_PROSE", "LEAD_BODY_REPETITION"].includes(
          f.code,
        ),
      ),
    ).toBe(true);
  });

  it("passes improved editorial fixture under writingPolicy", () => {
    const improved = buildImprovedEditorialArticleFixture("Sample Catalog Improved");
    const result = evaluateEditorialQuality({
      ...improved,
      productTitle: "Sample Catalog Improved",
      writingPolicy: policy,
    });
    expect(result.ok).toBe(true);
    expect(result.metrics.informationDensity).toBeGreaterThanOrEqual(
      EDITORIAL_THRESHOLDS.minInformationDensity,
    );
  });

  it("legacy without writingPolicy does not block", () => {
    const thin = buildThinCatalogArticleFixture("Legacy Thin");
    const result = evaluateEditorialQuality({
      ...thin,
      productTitle: "Legacy Thin",
      writingPolicy: null,
    });
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
  });
});

loadConfig({ requireDatabaseUrl: false });
const database = createDatabaseClient();
const lifecycleRepo = new LifecycleRepository(database.prisma);
const p5 = new P5Repository(database.prisma);
const p6 = new P6Repository(database.prisma);
const patterns = new ArticlePatternRepository(database.prisma);

describe("Writing Pattern vertical (Observation → ACTIVE writingPolicy → Gate)", () => {
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

  function service() {
    return new ArticlePatternService(patterns, lifecycleRepo, p5, p6, {
      minimumSampleCount: 3,
      minimumDomainDiversity: 2,
    });
  }

  it("persists writingFeatures without article body; aggregates writingPolicy", async () => {
    const svc = service();
    const mockLlmExtractor = async () => ({
      introHookType: "audience_framing",
      benefitFramingUsed: true,
      audienceFramingUsed: true,
    });
    const withLlm = new ArticlePatternService(
      patterns,
      lifecycleRepo,
      p5,
      p6,
      { minimumSampleCount: 3, minimumDomainDiversity: 2 },
      mockLlmExtractor,
    );

    for (const [url, file] of [
      ["https://review-a.example.test/a", "single-a.html"],
      ["https://blog-b.example.test/b", "single-b.html"],
      ["https://media-c.example.test/c", "single-c.html"],
    ] as const) {
      await withLlm.observeFromHtml({ sourceUrl: url, html: loadFixture(file), title: file });
    }

    const rows = await patterns.listObservations({ limit: 10 });
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toMatch(/向いている人の材料として/);
      const source = await database.prisma.sourceDocument.findUnique({
        where: { id: row.sourceDocumentId! },
      });
      expect(source?.normalizedText).toBeNull();
      const features = row.features as { writingFeatures?: { introHookType?: string } };
      expect(features.writingFeatures?.introHookType).toBeTruthy();
    }

    const { aggregation, format } = await svc.aggregateAndProposeFormat({
      formatKey: "NEW_RELEASE_SINGLE",
    });
    expect(aggregation.meetsThresholds).toBe(true);
    expect(format?.status).toBe("PROPOSED");
    const spec = format!.spec as ArticleFormatSpec;
    expect(spec.writingPolicy).toBeTruthy();
    expect(spec.writingPolicy?.requireEditorialValue).toBe(true);
    expect(aggregation.featureSummary.writingFeatureFrequencies.introHookType).toBeTruthy();
  });

  it("ACTIVE writingPolicy improves generation vs thin catalog; Gate fails thin / passes improved", async () => {
    const svc = service();
    for (const [url, file] of [
      ["https://a.example.test/w", "single-a.html"],
      ["https://b.example.test/w", "single-b.html"],
      ["https://c.example.test/w", "single-c.html"],
    ] as const) {
      await svc.observeFromHtml({ sourceUrl: url, html: loadFixture(file) });
    }
    const { format } = await svc.aggregateAndProposeFormat({ formatKey: "NEW_RELEASE_SINGLE" });
    await svc.approveFormat(format!.id, "human");
    const active = await svc.activateFormat(format!.id, "human");
    expect(active.status).toBe("ACTIVE");
    const writingPolicy = (active.spec as ArticleFormatSpec).writingPolicy;
    expect(writingPolicy).toBeTruthy();

    // Thin article must FAIL gate when writingPolicy active
    const thin = buildThinCatalogArticleFixture("Thin Product");
    const topic = await lifecycleRepo.createTopicCandidate({
      title: "Thin Product",
      status: "READY",
    });
    const strategy = await lifecycleRepo.createStrategy({
      topicCandidateId: topic.id,
      objective: "t",
      targetAudience: "t",
      userIntent: "t",
      formatCategory: "ARTICLE",
      formatKey: "NEW_RELEASE_SINGLE",
      angle: "t",
      primaryChannel: "BLOGGER",
      candidateChannels: ["BLOGGER"],
    });
    const thinContent = await lifecycleRepo.createContent({
      topicCandidateId: topic.id,
      strategyId: strategy.id,
      status: "DRAFT",
    });
    const thinVersion = await lifecycleRepo.createContentVersion({
      contentId: thinContent.id,
      versionNumber: 1,
      title: thin.title,
      summary: thin.summary,
      body: thin.body,
      structuredContent: { channel: "BLOGGER", article: thin.article, productTitle: "Thin Product" },
      status: "REVIEWING",
    });
    const llm = new MockLLMProvider();
    const generation = new ContentGenerationService(
      lifecycleRepo,
      llm,
      { generation: "mock", review: "mock", revision: "mock" },
      async () => ({
        formatId: active.id,
        formatKey: active.formatKey,
        spec: active.spec as ArticleFormatSpec,
      }),
    );
    const gate = new QualityGateService(lifecycleRepo, generation, async () => active.spec as ArticleFormatSpec);

    const thinGate = await gate.evaluate(thinVersion.id, {
      formatSpec: active.spec as ArticleFormatSpec,
      minScore: 0.2,
    });
    expect(thinGate.overall).toBe("failed");
    expect(thinGate.blockingFindings.length).toBeGreaterThan(0);

    // Improved fixture PASS — use structured article that parseBloggerArticle accepts
    const improved = buildImprovedEditorialArticleFixture("Improved Product");
    const improvedArticle = {
      title: improved.title,
      summary: improved.summary,
      lead: improved.lead,
      sections: improved.article.sections,
      cta: improved.article.cta,
      sourceReferences: [],
      seoTitle: improved.title,
      metaDescription: improved.summary,
      labels: ["editorial"],
      warnings: [],
      usedClaimIds: [] as string[],
      usedProductLinkIds: [] as string[],
      articleFormat: "NEW_RELEASE_SINGLE",
    };
    const improvedContent = await lifecycleRepo.createContent({
      topicCandidateId: topic.id,
      strategyId: strategy.id,
      status: "DRAFT",
    });
    const improvedVersion = await lifecycleRepo.createContentVersion({
      contentId: improvedContent.id,
      versionNumber: 1,
      title: improved.title,
      summary: improved.summary,
      body: improved.body,
      structuredContent: {
        channel: "BLOGGER",
        article: improvedArticle,
        productTitle: "Improved Product",
      },
      status: "REVIEWING",
    });
    const claim = await lifecycleRepo.createClaim({
      statement: "Improved Product は公開カタログ上で確認できる",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    await lifecycleRepo.attachVersionClaim({
      contentVersionId: improvedVersion.id,
      claimId: claim.id,
      usageType: "supporting",
      validationStatus: "validated",
    });

    const improvedGate = await gate.evaluate(improvedVersion.id, {
      formatSpec: active.spec as ArticleFormatSpec,
      minScore: 0.2,
    });
    expect(improvedGate.overall === "failed").toBe(false);
    expect(improvedGate.stages.some((s) => s.stage === "editorial_value" && s.ok)).toBe(true);

    // Generation with writingPolicy uses improved mock shape
    const strategySvc = new StrategyWithFeedbackService(lifecycleRepo, p5, p6, llm, svc);
    const genTopic = await lifecycleRepo.createTopicCandidate({
      title: "Gen Product Vertical",
      status: "READY",
    });
    const { strategy: genStrategy } = await strategySvc.generate({
      topicCandidateId: genTopic.id,
    });
    expect(genStrategy.formatKey).toBe("NEW_RELEASE_SINGLE");
    const genClaim = await lifecycleRepo.createClaim({
      statement: "Gen Product Vertical のメーカーは公開情報で確認できる",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: genStrategy.id,
    });
    const generated = await generation.generateBloggerArticle({
      topicId: genTopic.id,
      strategyId: genStrategy.id,
      productTitle: "Gen Product Vertical",
      ctaUrl: "https://example.invalid/p",
      claimIds: [genClaim.id],
    });
    expect(generated.article.title).toContain("候補");
    expect(generated.article.sections.some((s) => /ポイント|位置づけ|事実/.test(s.heading ?? ""))).toBe(
      true,
    );
    const modelRun = await lifecycleRepo.findModelRun(generated.modelRunId);
    expect(modelRun?.metadata).toMatchObject({ articleFormat: "NEW_RELEASE_SINGLE" });
    expect(
      (modelRun?.metadata as { writingPolicy?: unknown }).writingPolicy ||
        (modelRun?.metadata as { formatSpec?: { writingPolicy?: unknown } }).formatSpec
          ?.writingPolicy,
    ).toBeTruthy();

    // structural difference vs thin default mock
    const thinParsed = parseBloggerArticle({
      title: buildThinCatalogArticleFixture("Gen Product Vertical").title,
      summary: buildThinCatalogArticleFixture("Gen Product Vertical").summary,
      lead: buildThinCatalogArticleFixture("Gen Product Vertical").lead,
      sections: buildThinCatalogArticleFixture("Gen Product Vertical").article.sections,
      cta: buildThinCatalogArticleFixture("Gen Product Vertical").article.cta,
      sourceReferences: [],
      seoTitle: "t",
      metaDescription: "m",
      labels: [],
      warnings: [],
      usedClaimIds: [],
      usedProductLinkIds: [],
      articleFormat: "new-release",
    });
    expect(structuredToPlainBody(generated.article)).not.toEqual(
      structuredToPlainBody(thinParsed),
    );
  });

  it("INACTIVE format writingPolicy is not applied to Gate (legacy compat)", async () => {
    const thin = buildThinCatalogArticleFixture("No Policy");
    const content = await lifecycleRepo.createContent({ status: "DRAFT" });
    const version = await lifecycleRepo.createContentVersion({
      contentId: content.id,
      versionNumber: 1,
      title: thin.title,
      summary: thin.summary,
      body: thin.body,
      structuredContent: { channel: "BLOGGER", article: thin.article },
      status: "REVIEWING",
    });
    const llm = new MockLLMProvider();
    const generation = new ContentGenerationService(lifecycleRepo, llm, {
      generation: "mock",
      review: "mock",
      revision: "mock",
    });
    const gate = new QualityGateService(lifecycleRepo, generation);
    const result = await gate.evaluate(version.id, { minScore: 0.2 });
    // Without writingPolicy, editorial stage ok; may still warn on claims missing
    const editorial = result.stages.find((s) => s.stage === "editorial_value");
    expect(editorial?.ok).toBe(true);
  });
});
