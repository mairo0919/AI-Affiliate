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
} from "../generation/editorial-quality.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import { compareContentVersionsQuality } from "../generation/version-quality-comparison.js";
import { ArticlePatternService, ArticlePatternError } from "./article-pattern-service.js";
import { createResolveActiveFormat } from "./resolve-active-format.js";
import { resolveObservationSourceKind } from "./source-kind.js";
import { createWritingFeatureLlmExtractor } from "./writing-llm-extractor.js";
import { getWritingFeaturesLlmJsonSchema } from "./writing-extraction.js";
import {
  DEFAULT_SINGLE_WRITING_POLICY,
  type ArticleFormatSpec,
} from "./types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

loadConfig({ requireDatabaseUrl: false });
const database = createDatabaseClient();
const lifecycleRepo = new LifecycleRepository(database.prisma);
const p5 = new P5Repository(database.prisma);
const p6 = new P6Repository(database.prisma);
const patterns = new ArticlePatternRepository(database.prisma);

describe("Live URL Writing Pattern (mock only — no external network)", () => {
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
    await database.prisma.modelRun.deleteMany();
    await database.prisma.costRecord.deleteMany();
    await seedP45Prompts(lifecycleRepo);
  });

  function serviceWithLlm(llm = new MockLLMProvider()) {
    const extractor = createWritingFeatureLlmExtractor({
      llm,
      repo: lifecycleRepo,
      model: "mock-llm-v1",
    });
    return {
      llm,
      svc: new ArticlePatternService(
        patterns,
        lifecycleRepo,
        p5,
        p6,
        { minimumSampleCount: 3, minimumDomainDiversity: 2 },
        extractor,
      ),
    };
  }

  it("observe-url env gate + confirm-external required", async () => {
    const { svc } = serviceWithLlm();
    const config = loadConfig({ requireDatabaseUrl: false });
    await expect(
      svc.observeFromUrl({
        sourceUrl: "https://review-a.example.test/live",
        confirmExternal: false,
        config: { ...config, researchAllowExternalRequests: true },
        mockHtml: loadFixture("single-a.html"),
      }),
    ).rejects.toMatchObject({ code: "external_fetch_denied" });

    await expect(
      svc.observeFromUrl({
        sourceUrl: "https://review-a.example.test/live",
        confirmExternal: true,
        config: { ...config, researchAllowExternalRequests: false },
        // without mockHtml, allow=false
      }),
    ).rejects.toMatchObject({ code: "external_fetch_denied" });
  });

  it("observeFromUrl with mockHtml stores live_url without body; Writing LLM ModelRun/Cost", async () => {
    const { svc, llm } = serviceWithLlm();
    const config = loadConfig({ requireDatabaseUrl: false });
    const html = loadFixture("single-a.html");
    const obs = await svc.observeFromUrl({
      sourceUrl: "https://review-a.example.test/live-a",
      confirmExternal: true,
      config: { ...config, researchAllowExternalRequests: false },
      mockHtml: html,
      title: "live-a",
    });

    expect(resolveObservationSourceKind(obs.metadata)).toBe("live_url");
    expect(JSON.stringify(obs)).not.toMatch(/本作はカタログ上で確認できる新作です/);
    const source = await database.prisma.sourceDocument.findUnique({
      where: { id: obs.sourceDocumentId! },
    });
    expect(source?.normalizedText).toBeNull();
    expect(source?.metadata).toMatchObject({
      storesFullBody: false,
      sourceKind: "live_url",
    });
    expect(obs.metadata).toMatchObject({
      sourceKind: "live_url",
      writingExtractionStatus: "llm_merged",
      storesFullBody: false,
    });

    const runs = await database.prisma.modelRun.findMany({
      where: { taskType: "WRITING_FEATURE_EXTRACTION" },
    });
    expect(runs.length).toBe(1);
    expect(runs[0]?.status).toBe("COMPLETED");
    expect(JSON.stringify(runs[0]?.metadata ?? {})).not.toMatch(/本作はカタログ/);
    const costs = await database.prisma.costRecord.findMany({
      where: { operationType: "WRITING_FEATURE_EXTRACTION" },
    });
    expect(costs.length).toBe(1);
    expect(llm.getUsageRecords().some((u) => u.taskType === "WRITING_FEATURE_EXTRACTION")).toBe(
      true,
    );
  });

  it("distinguishes fixture vs live_url; live-only aggregate excludes fixtures", async () => {
    const { svc } = serviceWithLlm();
    const config = loadConfig({ requireDatabaseUrl: false });

    await svc.observeFromHtml({
      sourceUrl: "https://fixture-a.example.test/a",
      html: loadFixture("single-a.html"),
      sourceKind: "fixture",
    });
    await svc.observeFromHtml({
      sourceUrl: "https://fixture-b.example.test/b",
      html: loadFixture("single-b.html"),
      sourceKind: "fixture",
    });
    await svc.observeFromHtml({
      sourceUrl: "https://fixture-c.example.test/c",
      html: loadFixture("single-c.html"),
      sourceKind: "fixture",
    });

    for (const [url, file] of [
      ["https://live-a.example.test/a", "single-a.html"],
      ["https://live-b.example.test/b", "single-b.html"],
      ["https://live-c.example.test/c", "single-c.html"],
    ] as const) {
      await svc.observeFromUrl({
        sourceUrl: url,
        confirmExternal: true,
        config,
        mockHtml: loadFixture(file),
      });
    }

    const liveOnly = await svc.aggregateAndProposeFormat({
      formatKey: "LIVE_SINGLE",
      sourceKind: "live_url",
    });
    expect(liveOnly.aggregation.sampleCount).toBe(3);
    expect(liveOnly.aggregation.domainDiversity).toBe(3);
    expect(liveOnly.format?.status).toBe("PROPOSED");
    expect(liveOnly.format?.metadata).toMatchObject({ sourceKind: "live_url" });

    // Default aggregate is live_url — fixtures alone must not propose when only fixtures exist in another key
    await cleanupLifecycleTablesForTests(database.prisma);
    await seedP45Prompts(lifecycleRepo);
    const { svc: svc2 } = serviceWithLlm();
    await svc2.observeFromHtml({
      sourceUrl: "https://only-fixture.example.test/1",
      html: loadFixture("single-a.html"),
      sourceKind: "fixture",
    });
    await svc2.observeFromHtml({
      sourceUrl: "https://only-fixture-b.example.test/1",
      html: loadFixture("single-b.html"),
      sourceKind: "fixture",
    });
    await svc2.observeFromHtml({
      sourceUrl: "https://only-fixture-c.example.test/1",
      html: loadFixture("single-c.html"),
      sourceKind: "fixture",
    });
    await expect(svc2.aggregateAndProposeFormat({ formatKey: "SHOULD_NOT" })).rejects.toMatchObject(
      { code: "no_observations" },
    );

    const fixtureAgg = await svc2.aggregateAndProposeFormat({
      formatKey: "FIXTURE_OK",
      sourceKind: "fixture",
    });
    expect(fixtureAgg.format?.status).toBe("PROPOSED");
  });

  it("live sample / domain diversity shortfalls do not create format", async () => {
    const { svc } = serviceWithLlm();
    const config = loadConfig({ requireDatabaseUrl: false });
    await svc.observeFromUrl({
      sourceUrl: "https://live-a.example.test/1",
      confirmExternal: true,
      config,
      mockHtml: loadFixture("single-a.html"),
    });
    await svc.observeFromUrl({
      sourceUrl: "https://live-a.example.test/2",
      confirmExternal: true,
      config,
      mockHtml: loadFixture("single-b.html"),
    });
    const { format, aggregation } = await svc.aggregateAndProposeFormat({
      formatKey: "LIVE_SHORT",
      sourceKind: "live_url",
    });
    expect(aggregation.meetsThresholds).toBe(false);
    expect(format).toBeNull();
  });

  it("writing LLM schema forbids free-form prose fields", () => {
    const schema = getWritingFeaturesLlmJsonSchema();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("introHookType");
  });

  it("PROPOSED → human approval required before ACTIVE", async () => {
    const { svc } = serviceWithLlm();
    const config = loadConfig({ requireDatabaseUrl: false });
    for (const [url, file] of [
      ["https://live-a.example.test/a", "single-a.html"],
      ["https://live-b.example.test/b", "single-b.html"],
      ["https://live-c.example.test/c", "single-c.html"],
    ] as const) {
      await svc.observeFromUrl({
        sourceUrl: url,
        confirmExternal: true,
        config,
        mockHtml: loadFixture(file),
      });
    }
    const { format } = await svc.aggregateAndProposeFormat({
      formatKey: "LIVE_GOV",
      sourceKind: "live_url",
    });
    expect(format?.status).toBe("PROPOSED");
    await expect(svc.activateFormat(format!.id, "op")).rejects.toMatchObject({
      code: "approval_required",
    });
    await svc.approveFormat(format!.id, "human");
    const active = await svc.activateFormat(format!.id, "human");
    expect(active.status).toBe("ACTIVE");
    const summary = svc.summarizeWritingPolicy(active);
    expect(summary?.sourceKind).toBe("live_url");
    expect(summary?.preferredHookTypes).toBeTruthy();
  });

  it("writingPolicy missing on ACTIVE format blocks LLM (call count 0)", async () => {
    const { svc } = serviceWithLlm();
    const config = loadConfig({ requireDatabaseUrl: false });
    for (const [url, file] of [
      ["https://live-a.example.test/a", "single-a.html"],
      ["https://live-b.example.test/b", "single-b.html"],
      ["https://live-c.example.test/c", "single-c.html"],
    ] as const) {
      await svc.observeFromUrl({
        sourceUrl: url,
        confirmExternal: true,
        config,
        mockHtml: loadFixture(file),
      });
    }
    const { format } = await svc.aggregateAndProposeFormat({
      formatKey: "LIVE_NO_WP",
      sourceKind: "live_url",
    });
    const spec = svc.parseSpec(format!) as ArticleFormatSpec;
    await patterns.updateFormat(format!.id, {
      spec: { ...spec, writingPolicy: undefined },
      sampleExternal: 3,
      domainDiversity: 3,
    });
    // Re-read and strip writingPolicy explicitly
    const emptied: ArticleFormatSpec = {
      ...spec,
    };
    delete emptied.writingPolicy;
    await patterns.updateFormat(format!.id, { spec: emptied as unknown as object });
    await svc.approveFormat(format!.id, "human");
    await svc.activateFormat(format!.id, "human");

    const llm = new MockLLMProvider();
    const generation = new ContentGenerationService(
      lifecycleRepo,
      llm,
      { generation: "mock", review: "mock", revision: "mock" },
      createResolveActiveFormat(svc),
    );
    const topic = await lifecycleRepo.createTopicCandidate({
      title: "No WP Product",
      status: "READY",
    });
    const strategy = await lifecycleRepo.createStrategy({
      topicCandidateId: topic.id,
      objective: "test",
      targetAudience: "readers",
      userIntent: "info",
      formatCategory: "ARTICLE",
      formatKey: "LIVE_NO_WP",
      angle: "test",
      primaryChannel: "BLOGGER",
      candidateChannels: ["BLOGGER"],
      status: "READY",
    });
    const beforeCalls = llm.getUsageRecords().length;
    await expect(
      generation.generateBloggerArticle({
        topicId: topic.id,
        strategyId: strategy.id,
        productTitle: "No WP Product",
        ctaUrl: "https://example.invalid/p",
      }),
    ).rejects.toMatchObject({ code: "writing_policy_missing" });
    expect(llm.getUsageRecords().length).toBe(beforeCalls);
  });

  it("legacy generation without ACTIVE format still works (compat)", async () => {
    const llm = new MockLLMProvider();
    const generation = new ContentGenerationService(
      lifecycleRepo,
      llm,
      { generation: "mock", review: "mock", revision: "mock" },
      async () => null,
    );
    const topic = await lifecycleRepo.createTopicCandidate({
      title: "Legacy Product",
      status: "READY",
    });
    const strategy = await lifecycleRepo.createStrategy({
      topicCandidateId: topic.id,
      objective: "legacy",
      targetAudience: "readers",
      userIntent: "info",
      formatCategory: "ARTICLE",
      formatKey: "new-release",
      angle: "legacy",
      primaryChannel: "BLOGGER",
      candidateChannels: ["BLOGGER"],
      status: "READY",
    });
    const claim = await lifecycleRepo.createClaim({
      statement: "Legacy Product は公開カタログ上で確認できる",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    const generated = await generation.generateBloggerArticle({
      topicId: topic.id,
      strategyId: strategy.id,
      productTitle: "Legacy Product",
      ctaUrl: "https://example.invalid/p",
      claimIds: [claim.id],
    });
    expect(generated.version.id).toBeTruthy();
    expect(llm.getUsageRecords().some((u) => u.taskType === "GENERATION_BLOGGER")).toBe(true);
  });

  it("ACTIVE writingPolicy is injected into generation metadata", async () => {
    const { svc } = serviceWithLlm();
    const config = loadConfig({ requireDatabaseUrl: false });
    for (const [url, file] of [
      ["https://live-a.example.test/a", "single-a.html"],
      ["https://live-b.example.test/b", "single-b.html"],
      ["https://live-c.example.test/c", "single-c.html"],
    ] as const) {
      await svc.observeFromUrl({
        sourceUrl: url,
        confirmExternal: true,
        config,
        mockHtml: loadFixture(file),
      });
    }
    const { format } = await svc.aggregateAndProposeFormat({
      formatKey: "LIVE_INJECT",
      sourceKind: "live_url",
    });
    await svc.approveFormat(format!.id, "human");
    await svc.activateFormat(format!.id, "human");

    const llm = new MockLLMProvider();
    const generation = new ContentGenerationService(
      lifecycleRepo,
      llm,
      { generation: "mock", review: "mock", revision: "mock" },
      createResolveActiveFormat(svc),
    );
    const topic = await lifecycleRepo.createTopicCandidate({
      title: "Inject Product",
      status: "READY",
    });
    const strategy = await lifecycleRepo.createStrategy({
      topicCandidateId: topic.id,
      objective: "inject",
      targetAudience: "readers",
      userIntent: "info",
      formatCategory: "ARTICLE",
      formatKey: "LIVE_INJECT",
      angle: "inject",
      primaryChannel: "BLOGGER",
      candidateChannels: ["BLOGGER"],
      status: "READY",
    });
    const claim = await lifecycleRepo.createClaim({
      statement: "Inject Product は公開カタログ上で確認できる",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    const generated = await generation.generateBloggerArticle({
      topicId: topic.id,
      strategyId: strategy.id,
      productTitle: "Inject Product",
      ctaUrl: "https://example.invalid/p",
      claimIds: [claim.id],
    });
    const modelRun = await lifecycleRepo.findModelRun(generated.modelRunId);
    const meta = modelRun?.metadata as {
      writingPolicy?: unknown;
      formatSpec?: { writingPolicy?: unknown };
    };
    expect(meta.writingPolicy && Object.keys(meta.writingPolicy as object).length).toBeGreaterThan(
      0,
    );
  });

  it("old/new comparison metrics: improved vs thin passes; same thin fails validation", async () => {
    const policy = DEFAULT_SINGLE_WRITING_POLICY;
    const thin = buildThinCatalogArticleFixture("Compare Product");
    const improved = buildImprovedEditorialArticleFixture("Compare Product");

    const thinEditorial = evaluateEditorialQuality({
      ...thin,
      productTitle: "Compare Product",
      writingPolicy: policy,
    });
    const improvedEditorial = evaluateEditorialQuality({
      ...improved,
      productTitle: "Compare Product",
      writingPolicy: policy,
    });
    expect(thinEditorial.ok).toBe(false);
    expect(improvedEditorial.ok).toBe(true);

    const topic = await lifecycleRepo.createTopicCandidate({
      title: "Compare Product",
      status: "READY",
    });
    const strategy = await lifecycleRepo.createStrategy({
      topicCandidateId: topic.id,
      objective: "compare",
      targetAudience: "readers",
      userIntent: "info",
      formatCategory: "ARTICLE",
      formatKey: "new-release",
      angle: "compare",
      primaryChannel: "BLOGGER",
      candidateChannels: ["BLOGGER"],
      status: "READY",
    });
    const content = await lifecycleRepo.createContent({
      topicCandidateId: topic.id,
      strategyId: strategy.id,
      status: "DRAFT",
    });
    const before = await lifecycleRepo.createContentVersion({
      contentId: content.id,
      versionNumber: 1,
      title: thin.title,
      body: thin.body,
      status: "DRAFT",
      structuredContent: {
        title: thin.title,
        summary: thin.summary,
        lead: thin.lead,
        article: thin.article,
        articleFormat: "new-release",
      },
    });
    const afterGood = await lifecycleRepo.createContentVersion({
      contentId: content.id,
      versionNumber: 2,
      title: improved.title,
      body: improved.body,
      status: "DRAFT",
      structuredContent: {
        title: improved.title,
        summary: improved.summary,
        lead: improved.lead,
        article: improved.article,
        articleFormat: "new-release",
      },
    });
    const afterBad = await lifecycleRepo.createContentVersion({
      contentId: content.id,
      versionNumber: 3,
      title: thin.title + " v2",
      body: thin.body,
      status: "DRAFT",
      structuredContent: {
        title: thin.title,
        summary: thin.summary,
        lead: thin.lead,
        article: thin.article,
        articleFormat: "new-release",
      },
    });

    const good = await compareContentVersionsQuality({
      repo: lifecycleRepo,
      beforeVersionId: before.id,
      afterVersionId: afterGood.id,
      writingPolicy: policy,
      formatKey: "NEW_RELEASE_SINGLE",
      formatSpec: {
        targetProductCount: { min: 1, max: 1 },
        requiredSectionOrder: ["intro", "product_sections", "cta"],
        optionalSections: [],
        ctaPolicy: { minCount: 1, maxCount: 2, preferredPositions: ["bottom"] },
        imagePolicy: { minCount: 0, enforce: false },
        rankingRequired: false,
        comparisonTableRequired: false,
        introPolicy: { maxChars: 400 },
        lengthPolicy: { minChars: 80, maxChars: 5000 },
        writingPolicy: policy,
      },
      productTitle: "Compare Product",
    });
    expect(good.requiredImprovementsMet).toBe(true);
    expect(good.patternValidation).toBe("passed");
    expect(good.genuinelyImprovedKeys.length).toBeGreaterThanOrEqual(1);
    expect(
      good.genuinelyImprovedKeys.length + good.maintainedGoodKeys.length,
    ).toBeGreaterThanOrEqual(4);

    const bad = await compareContentVersionsQuality({
      repo: lifecycleRepo,
      beforeVersionId: before.id,
      afterVersionId: afterBad.id,
      writingPolicy: policy,
      productTitle: "Compare Product",
    });
    expect(bad.patternValidation).toBe("pattern_validation_failed");
  });

  it("LLM failure falls back to deterministic features without storing body", async () => {
    const llm = new MockLLMProvider();
    llm.behavior = "non_retryable";
    const extractor = createWritingFeatureLlmExtractor({
      llm,
      repo: lifecycleRepo,
      model: "mock",
    });
    const svc = new ArticlePatternService(
      patterns,
      lifecycleRepo,
      p5,
      p6,
      { minimumSampleCount: 3, minimumDomainDiversity: 2 },
      extractor,
    );
    const config = loadConfig({ requireDatabaseUrl: false });
    const obs = await svc.observeFromUrl({
      sourceUrl: "https://live-fail.example.test/x",
      confirmExternal: true,
      config,
      mockHtml: loadFixture("single-a.html"),
    });
    expect(obs.metadata).toMatchObject({
      writingExtractionStatus: "llm_failed_fallback",
      storesFullBody: false,
    });
    expect(JSON.stringify(obs)).not.toMatch(/本作はカタログ上で確認できる新作です/);
  });
});

describe("ArticlePatternError codes", () => {
  it("exposes ArticlePatternError", () => {
    const err = new ArticlePatternError("x", "external_fetch_denied");
    expect(err.code).toBe("external_fetch_denied");
  });
});
