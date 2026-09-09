import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { ArticlePatternService } from "./article-pattern-service.js";
import { createResolveActiveFormat } from "./resolve-active-format.js";
import type { ArticleFormatSpec } from "./types.js";
import { DEFAULT_SINGLE_WRITING_POLICY } from "./types.js";

loadConfig({ requireDatabaseUrl: false });
const database = createDatabaseClient();
const lifecycleRepo = new LifecycleRepository(database.prisma);
const p5 = new P5Repository(database.prisma);
const p6 = new P6Repository(database.prisma);
const patterns = new ArticlePatternRepository(database.prisma);

const SPEC: ArticleFormatSpec = {
  targetProductCount: { min: 1, max: 1 },
  requiredSectionOrder: ["intro", "product_sections", "cta"],
  optionalSections: [],
  ctaPolicy: { minCount: 1, maxCount: 1, preferredPositions: ["bottom"] },
  imagePolicy: { minCount: 0, enforce: false },
  rankingRequired: false,
  comparisonTableRequired: false,
  introPolicy: { maxChars: 200 },
  lengthPolicy: { minChars: 80, maxChars: 4000 },
  writingPolicy: {
    ...DEFAULT_SINGLE_WRITING_POLICY,
    requireEditorialValue: true,
    recommendationRequired: true,
    forbidGenericPraise: true,
  },
};

describe("ACTIVE Format → Generation wiring (SSOT resolveActiveFormat)", () => {
  beforeAll(async () => {
    await database.connect();
  });
  afterAll(async () => {
    await database.disconnect();
  });
  beforeEach(async () => {
    await cleanupLifecycleTablesForTests(database.prisma);
    await seedP45Prompts(lifecycleRepo);
  });

  function service() {
    return new ArticlePatternService(patterns, lifecycleRepo, p5, p6, {
      minimumSampleCount: 3,
      minimumDomainDiversity: 2,
    });
  }

  async function activateNewReleaseSingle(svc: ArticlePatternService) {
    const format = await patterns.createFormat({
      formatKey: "NEW_RELEASE_SINGLE",
      displayName: "NRS",
      formatCategory: "ARTICLE",
      status: "PROPOSED",
      spec: SPEC as unknown as object,
      sampleExternal: 3,
      domainDiversity: 3,
      confidence: 0.9,
    });
    await svc.approveFormat(format.id, "tester");
    return svc.activateFormat(format.id, "tester");
  }

  it("Case1: Strategy NEW_RELEASE_SINGLE + ACTIVE → generate receives FormatSpec/writingPolicy", async () => {
    const svc = service();
    const active = await activateNewReleaseSingle(svc);
    const resolve = createResolveActiveFormat(svc);
    const llm = new MockLLMProvider();
    const generation = new ContentGenerationService(
      lifecycleRepo,
      llm,
      { generation: "mock", review: "mock", revision: "mock" },
      resolve,
    );
    const topic = await lifecycleRepo.createTopicCandidate({
      title: "Wire Product",
      status: "READY",
    });
    const strategy = await lifecycleRepo.createStrategy({
      topicCandidateId: topic.id,
      objective: "test",
      targetAudience: "readers",
      userIntent: "info",
      formatCategory: "ARTICLE",
      formatKey: "NEW_RELEASE_SINGLE",
      angle: "test",
      primaryChannel: "BLOGGER",
      candidateChannels: ["BLOGGER"],
      status: "READY",
    });
    const claim = await lifecycleRepo.createClaim({
      statement: "小島みなみの激ピストン騎乗位で連続絶頂するシーンが収録されている",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    const claimPerformer = await lifecycleRepo.createClaim({
      statement: "小島みなみ",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    const claimQty = await lifecycleRepo.createClaim({
      statement: "8時間ベスト",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    const spy = vi.spyOn(llm, "executeTask");
    const generated = await generation.generateBloggerArticle({
      topicId: topic.id,
      strategyId: strategy.id,
      productTitle: "Wire Product",
      ctaUrl: "https://example.invalid/p",
      claimIds: [claimPerformer.id, claim.id, claimQty.id],
    });
    expect(generated.version.id).toBeTruthy();
    const callInput = spy.mock.calls[0]?.[0]?.input as {
      writingPolicy?: Record<string, unknown>;
      articleFormat?: string;
    };
    expect(callInput.articleFormat).toBe("NEW_RELEASE_SINGLE");
    expect(callInput.writingPolicy).toMatchObject({
      requireEditorialValue: true,
      recommendationRequired: true,
      forbidGenericPraise: true,
    });
    const modelRun = await lifecycleRepo.findModelRun(generated.modelRunId);
    expect(modelRun?.metadata).toMatchObject({
      formatKey: "NEW_RELEASE_SINGLE",
      formatId: active.id,
      writingPolicyApplied: true,
    });
  });



  it("Case4: blogger-article does not resolve to ACTIVE NEW_RELEASE_SINGLE", async () => {
    const svc = service();
    await activateNewReleaseSingle(svc);
    const resolve = createResolveActiveFormat(svc);
    expect(await resolve("blogger-article")).toBeNull();
    expect(await resolve("new-release")).toBeNull();
    const hit = await resolve("NEW_RELEASE_SINGLE");
    expect(hit?.formatKey).toBe("NEW_RELEASE_SINGLE");

    const llm = new MockLLMProvider();
    const generation = new ContentGenerationService(
      lifecycleRepo,
      llm,
      { generation: "mock", review: "mock", revision: "mock" },
      resolve,
    );
    const topic = await lifecycleRepo.createTopicCandidate({
      title: "Legacy Product",
      status: "READY",
    });
    const strategy = await lifecycleRepo.createStrategy({
      topicCandidateId: topic.id,
      objective: "test",
      targetAudience: "readers",
      userIntent: "info",
      formatCategory: "ARTICLE",
      formatKey: "blogger-article",
      angle: "test",
      primaryChannel: "BLOGGER",
      candidateChannels: ["BLOGGER"],
      status: "READY",
    });
    const claim = await lifecycleRepo.createClaim({
      statement: "松本いちかのアナル舐めと中出しシーンが収録されている",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    const claimPerformer = await lifecycleRepo.createClaim({
      statement: "松本いちか",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    const claimQty = await lifecycleRepo.createClaim({
      statement: "8時間ベスト",
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
      claimIds: [claimPerformer.id, claim.id, claimQty.id],
    });
    const modelRun = await lifecycleRepo.findModelRun(generated.modelRunId);
    expect(modelRun?.metadata).toMatchObject({
      writingPolicyApplied: false,
      formatId: null,
    });
  });

  it("Case5: ACTIVE Format absent → legacy generate still works (no writingPolicy required)", async () => {
    const llm = new MockLLMProvider();
    const generation = new ContentGenerationService(
      lifecycleRepo,
      llm,
      { generation: "mock", review: "mock", revision: "mock" },
      createResolveActiveFormat(service()),
    );
    const topic = await lifecycleRepo.createTopicCandidate({
      title: "Fallback Product",
      status: "READY",
    });
    const strategy = await lifecycleRepo.createStrategy({
      topicCandidateId: topic.id,
      objective: "test",
      targetAudience: "readers",
      userIntent: "info",
      formatCategory: "ARTICLE",
      formatKey: "blogger-article",
      angle: "test",
      primaryChannel: "BLOGGER",
      candidateChannels: ["BLOGGER"],
      status: "READY",
    });
    const claim = await lifecycleRepo.createClaim({
      statement: "小島みなみの追撃ピストンでエビ反り絶頂する内容",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    const claimPerformer = await lifecycleRepo.createClaim({
      statement: "小島みなみ",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    const claimQty = await lifecycleRepo.createClaim({
      statement: "8時間ベスト",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    const generated = await generation.generateBloggerArticle({
      topicId: topic.id,
      strategyId: strategy.id,
      productTitle: "Fallback Product",
      ctaUrl: "https://example.invalid/p",
      claimIds: [claimPerformer.id, claim.id, claimQty.id],
    });
    expect(generated.version.id).toBeTruthy();
  });

  it("setStrategyFormatKey binds ACTIVE NEW_RELEASE_SINGLE without regen", async () => {
    const svc = service();
    const active = await activateNewReleaseSingle(svc);
    const topic = await lifecycleRepo.createTopicCandidate({
      title: "Bind Product",
      status: "READY",
    });
    const strategy = await lifecycleRepo.createStrategy({
      topicCandidateId: topic.id,
      objective: "old",
      targetAudience: "readers",
      userIntent: "info",
      formatCategory: "ARTICLE",
      formatKey: "blogger-article",
      angle: "legacy",
      primaryChannel: "BLOGGER",
      candidateChannels: ["BLOGGER"],
      status: "READY",
    });
    const result = await svc.setStrategyFormatKey(strategy.id, "NEW_RELEASE_SINGLE");
    expect(result.strategy.formatKey).toBe("NEW_RELEASE_SINGLE");
    expect(result.strategy.objective).toBe("old");
    expect(result.format.id).toBe(active.id);
  });

});
