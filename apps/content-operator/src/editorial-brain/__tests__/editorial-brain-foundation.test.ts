import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  EditorialBrainRepository,
  LifecycleRepository,
  cleanupLifecycleTablesForTests,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { MockLLMProvider } from "../../adapters/llm/mock-llm-provider.js";
import { ContentGenerationService } from "../../generation/content-generation-service.js";
import { seedP45Prompts } from "../../generation/p45-service.js";
import type { StructurePattern } from "../../article-pattern/structure-pattern.js";
import type { ResolveActiveFormat } from "../../article-pattern/resolve-active-format.js";
import { DEFAULT_SINGLE_WRITING_POLICY, type ArticleFormatSpec } from "../../article-pattern/types.js";
import {
  buildClaimProfileFingerprint,
  buildCoreEditorialPlan,
  buildBlogChannelPlan,
  buildXChannelPlan,
  channelExtensionBoundaryContract,
  experienceMustNotMutateLearningRules,
  ensureChannelModulesRegistered,
  getChannelModule,
  listRegisteredChannels,
  rankExperienceScore,
  registerChannelModule,
  reviewArtifactShadow,
  retrieveExperiences,
  EditorialBrainShadowService,
  EDITORIAL_FAILURE_CODES,
} from "../index.js";

loadConfig({ requireDatabaseUrl: false });
const database = createDatabaseClient();
const repo = new LifecycleRepository(database.prisma);
const brainRepo = new EditorialBrainRepository(database.prisma);

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
  },
};

const MINIMAL_SP: StructurePattern = {
  patternId: "sp_1_5cuvr3",
  label: "sparse_interest_cta",
  sampleCount: 1,
  sourceObservationIds: [],
  sourceDomains: [],
  fingerprint: "brain-test",
  imageLayout: {
    heroPosition: "before_lead",
    auxiliaryPosition: "none",
    preferredImageCount: 1,
  },
  constraints: {
    forbidSummaryRestatement: true,
    forbidCatalogDump: true,
    preferFewHeadings: true,
    maxSections: 3,
    forbidCatalogHeadings: true,
    claimUsage: "selective",
    maxClaimsSuggested: 4,
  },
  blocks: [
    {
      order: 1,
      role: "hook",
      approxChars: 100,
      paragraphCountHint: 1,
      heading: false,
      usesList: false,
      usesImage: true,
      imageSlot: "hero",
      claimPurpose: "strongest_interest_driver",
      allowOmitIfClaimsScarce: false,
      generation: {
        readerFunction: "open",
        transitionFunction: "none_start",
        claimKindsPreferred: ["trait_or_scene"],
        claimKindsAvoid: ["availability"],
        maxNewClaims: 2,
        forbidRestatePriorClaims: true,
        listPurpose: "none",
        avoidCatalogMetadata: true,
        avoidMetaEvaluationPhrases: true,
        preferShortParagraphs: true,
      },
    },
    {
      order: 2,
      role: "interest_development",
      approxChars: 200,
      paragraphCountHint: 1,
      heading: false,
      usesList: false,
      usesImage: false,
      imageSlot: "none",
      claimPurpose: "develop_interest_from_traits",
      allowOmitIfClaimsScarce: false,
      generation: {
        readerFunction: "develop",
        transitionFunction: "deepen",
        claimKindsPreferred: ["trait_or_scene"],
        claimKindsAvoid: ["availability"],
        maxNewClaims: 3,
        forbidRestatePriorClaims: true,
        listPurpose: "none",
        avoidCatalogMetadata: true,
        avoidMetaEvaluationPhrases: true,
        preferShortParagraphs: true,
      },
    },
    {
      order: 3,
      role: "cta_bridge",
      approxChars: 80,
      paragraphCountHint: 1,
      heading: false,
      usesList: false,
      usesImage: false,
      imageSlot: "none",
      claimPurpose: "cta_motive",
      allowOmitIfClaimsScarce: true,
      generation: {
        readerFunction: "bridge",
        transitionFunction: "bridge",
        claimKindsPreferred: [],
        claimKindsAvoid: [],
        maxNewClaims: 0,
        forbidRestatePriorClaims: true,
        listPurpose: "none",
        avoidCatalogMetadata: true,
        avoidMetaEvaluationPhrases: true,
        preferShortParagraphs: true,
      },
    },
  ],
};

function resolveWith(pattern: StructurePattern | null): ResolveActiveFormat {
  return async () =>
    pattern
      ? {
          formatId: "fmt-brain",
          formatKey: "NEW_RELEASE_SINGLE",
          spec: SPEC,
          structurePatterns: [pattern],
          editorialPatterns: [],
        }
      : null;
}

describe("Editorial Brain Foundation", () => {
  beforeAll(async () => {
    await database.connect();
  });
  afterAll(async () => {
    await database.disconnect();
  });
  beforeEach(async () => {
    await cleanupLifecycleTablesForTests(database.prisma);
    await seedP45Prompts(repo);
    ensureChannelModulesRegistered();
  });

  it("registers BLOG and X only; extension boundary forbids Core rewrite for 3rd channel", () => {
    expect(listRegisteredChannels().sort()).toEqual(["BLOG", "X"]);
    expect(channelExtensionBoundaryContract()).toEqual({
      requiresCoreRewriteForNewChannel: false,
      addNewModuleOnly: true,
      coreTouchesAllowedOnlyForNewSharedConcepts: true,
    });
    // Boundary: can register another module id without Core code existing for TikTok
    registerChannelModule({
      channel: "X", // re-register allowed
      buildChannelPlan: getChannelModule("X").buildChannelPlan,
    });
  });

  it("failure taxonomy SSOT has no product-specific codes", () => {
    expect(EDITORIAL_FAILURE_CODES).toContain("REPETITION");
    expect(EDITORIAL_FAILURE_CODES).toContain("INFORMATION_GAIN_LOW");
    expect(EDITORIAL_FAILURE_CODES.join(",")).not.toMatch(/mina|v6|福原/i);
  });

  it("LearningRule is not mutated by Experience helpers", () => {
    expect(experienceMustNotMutateLearningRules()).toEqual({
      autoPromote: false,
      writesLearningRule: false,
    });
  });

  it("Core planner is deterministic and length is not a quality goal", () => {
    const claims = [
      { id: "a", statement: "超敏感な反応とベロキスシーンが公開されている。", kind: "trait_or_scene" },
      { id: "b", statement: "出演者Aがクレジットされている。", kind: "performer" },
      { id: "c", statement: "シリーズXに属する。", kind: "series" },
    ];
    const plan = buildCoreEditorialPlan({
      channel: "BLOG",
      formatKey: "NEW_RELEASE_SINGLE",
      contentType: "blogger-article",
      availableClaims: claims,
      selectedClaims: claims,
      openingClaimIds: ["a"],
      hookClaimIds: ["a"],
      developmentClaimIds: ["b", "c"],
      structurePatternId: "sp_1",
      editorialPatternId: "ed_1",
    });
    expect(plan.informationGainTarget).toBeGreaterThan(0);
    expect(plan.scarcityMode).toBe(false);
    expect(plan.softLengthGuidance).toBeUndefined();
    expect(plan.claimAllocation.filter((x) => x.role === "opening").map((x) => x.claimId)).toEqual([
      "a",
    ]);
  });

  it("BLOG and X channel plans are separated; X does not require blog body", () => {
    const core = buildCoreEditorialPlan({
      channel: "BLOG",
      formatKey: "NEW_RELEASE_SINGLE",
      contentType: "blogger-article",
      availableClaims: [{ id: "a", statement: "事実A", kind: "trait_or_scene" }],
      selectedClaims: [{ id: "a", statement: "事実A", kind: "trait_or_scene" }],
      openingClaimIds: ["a"],
      hookClaimIds: ["a"],
      developmentClaimIds: [],
      structurePatternId: null,
      editorialPatternId: null,
    });
    const blog = buildBlogChannelPlan(core);
    const x = buildXChannelPlan({ ...core, channel: "X" });
    expect(blog.channel).toBe("BLOG");
    expect(x.channel).toBe("X");
    expect(x.specifics.requiresBlogBody).toBe(false);
    expect(blog.specifics.omitCtaBridge).toBe(true); // scarcity / no development
  });

  it("long high-value → PASS; short low-value → FAIL (length not sole judge)", () => {
    const claims = [
      { id: "c1", statement: "超敏感の反応が連続する展開と潮吹きが公開されている。", kind: "trait_or_scene" },
      { id: "c2", statement: "ベロキスを含む展開が公開されている。", kind: "trait_or_scene" },
      { id: "c3", statement: "出演者Aがクレジットされている。", kind: "performer" },
      { id: "c4", statement: "メーカーBの作品である。", kind: "maker" },
    ];
    const core = buildCoreEditorialPlan({
      channel: "BLOG",
      formatKey: "NEW_RELEASE_SINGLE",
      contentType: "blogger-article",
      availableClaims: claims,
      selectedClaims: claims,
      openingClaimIds: ["c1"],
      hookClaimIds: ["c1"],
      developmentClaimIds: ["c2", "c3"],
      structurePatternId: null,
      editorialPatternId: null,
    });

    const longHigh = reviewArtifactShadow({
      corePlan: core,
      claimStatements: claims,
      artifact: {
        channel: "BLOG",
        title: "超敏感が候補になる理由",
        summary: "候補判断向けの短いメモ。",
        lead: "超敏感の反応が連続する展開と潮吹きが公開されている点を先に置く。",
        sections: [
          {
            paragraphs: [
              "ベロキスを含む展開が公開されている。",
              "出演者Aがクレジットされている事実を進める。",
            ],
            lists: [],
          },
        ],
        bodyText: "x",
      },
    });
    expect(longHigh.lengthWasNotSoleJudge).toBe(true);
    expect(longHigh.metrics.bodyUnits).toBeGreaterThan(80);
    expect(longHigh.decision).toBe("PASS");

    const shortLow = reviewArtifactShadow({
      corePlan: core,
      claimStatements: claims,
      artifact: {
        channel: "BLOG",
        title: "紹介",
        summary: "本作品について紹介します。",
        lead: "おすすめです。",
        sections: [
          {
            paragraphs: ["ぜひチェックして詳しく確認できます。より深く理解できます。"],
            lists: [],
          },
        ],
        bodyText: "短",
      },
    });
    expect(shortLow.metrics.bodyUnits).toBeLessThan(longHigh.metrics.bodyUnits);
    expect(shortLow.decision).not.toBe("PASS");
    expect(shortLow.failures.map((f) => f.code)).toEqual(
      expect.arrayContaining(["INFORMATION_GAIN_LOW"]),
    );
  });

  it("detects semantic repetition / unsupported inference / filler / catalog narration", () => {
    const claims = [
      { id: "c1", statement: "顔面ビンタと連続展開が公開されている。", kind: "trait_or_scene" },
    ];
    const core = buildCoreEditorialPlan({
      channel: "BLOG",
      formatKey: "NEW_RELEASE_SINGLE",
      contentType: "blogger-article",
      availableClaims: claims,
      selectedClaims: claims,
      openingClaimIds: ["c1"],
      hookClaimIds: ["c1"],
      developmentClaimIds: [],
      structurePatternId: null,
      editorialPatternId: null,
    });
    const review = reviewArtifactShadow({
      corePlan: core,
      claimStatements: claims,
      artifact: {
        channel: "BLOG",
        title: "t",
        summary: "s",
        lead: "顔面ビンタと連続展開が目立つ。",
        sections: [
          {
            paragraphs: [
              "顔面ビンタと連続展開を再説明し、シリーズ名はX、出演者としてA、プールを舞台にした展開が楽しめます。",
            ],
            lists: [],
          },
        ],
        bodyText: "",
      },
    });
    const codes = review.failures.map((f) => f.code);
    expect(codes).toEqual(
      expect.arrayContaining(["UNSUPPORTED_INFERENCE", "CATALOG_NARRATION", "EVALUATIVE_INFERENCE"]),
    );
  });

  it("retrieval: CORE usable by both; CHANNEL X not applied as BLOG rule; low confidence downranked", async () => {
    const profile = buildClaimProfileFingerprint([{ kind: "trait_or_scene" }], {
      formatKey: "NEW_RELEASE_SINGLE",
      contentType: "blogger-article",
    });
    const coreExp = await brainRepo.createExperience({
      scope: "CORE",
      channel: "BLOG",
      formatKey: "NEW_RELEASE_SINGLE",
      contentType: "blogger-article",
      claimProfile: profile,
      sourceType: "BRAIN_REVIEW",
      confidence: 0.8,
      sampleEvidence: 5,
      outcome: "PASS",
      failureCodes: ["UNSUPPORTED_INFERENCE"],
    });
    const xOnly = await brainRepo.createExperience({
      scope: "CHANNEL",
      channel: "X",
      formatKey: "NEW_RELEASE_SINGLE",
      contentType: "x-post",
      claimProfile: profile,
      sourceType: "BRAIN_REVIEW",
      confidence: 0.9,
      sampleEvidence: 10,
      outcome: "PASS",
      failureCodes: ["TEMPLATE_FATIGUE"],
    });
    const low = await brainRepo.createExperience({
      scope: "CHANNEL",
      channel: "BLOG",
      formatKey: "NEW_RELEASE_SINGLE",
      contentType: "blogger-article",
      claimProfile: profile,
      sourceType: "BRAIN_REVIEW",
      confidence: 0.1,
      sampleEvidence: 1,
      outcome: "PASS",
    });

    const blogHits = await retrieveExperiences(brainRepo, {
      channel: "BLOG",
      formatKey: "NEW_RELEASE_SINGLE",
      contentType: "blogger-article",
      claimProfile: profile,
      limit: 10,
    });
    expect(blogHits.hits.some((h) => h.id === coreExp.id)).toBe(true);
    expect(blogHits.hits.some((h) => h.id === xOnly.id)).toBe(false);

    const xHits = await retrieveExperiences(brainRepo, {
      channel: "X",
      formatKey: "NEW_RELEASE_SINGLE",
      contentType: "x-post",
      claimProfile: profile,
      limit: 10,
    });
    expect(xHits.hits.some((h) => h.id === coreExp.id)).toBe(true);
    expect(xHits.hits.some((h) => h.id === xOnly.id)).toBe(true);

    const lowScore = rankExperienceScore({
      scope: "CHANNEL",
      channel: "BLOG",
      queryChannel: "BLOG",
      formatKey: "NEW_RELEASE_SINGLE",
      queryFormatKey: "NEW_RELEASE_SINGLE",
      claimProfile: profile,
      queryClaimProfile: profile,
      structurePatternId: null,
      queryStructurePatternId: null,
      editorialPatternId: null,
      queryEditorialPatternId: null,
      confidence: 0.1,
      sampleEvidence: 1,
      createdAt: new Date(),
    });
    const highScore = rankExperienceScore({
      scope: "CHANNEL",
      channel: "BLOG",
      queryChannel: "BLOG",
      formatKey: "NEW_RELEASE_SINGLE",
      queryFormatKey: "NEW_RELEASE_SINGLE",
      claimProfile: profile,
      queryClaimProfile: profile,
      structurePatternId: null,
      queryStructurePatternId: null,
      editorialPatternId: null,
      queryEditorialPatternId: null,
      confidence: 0.9,
      sampleEvidence: 5,
      createdAt: new Date(),
    });
    expect(lowScore).toBeLessThan(highScore);
    void low;
  });

  it("production BLOG path records BrainRun + Experience in SHADOW without changing legacy authority", async () => {
    const topic = await repo.createTopicCandidate({
      title: "Brain Topic",
      status: "READY",
    });
    const strategy = await repo.createStrategy({
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
    const claim = await repo.createClaim({
      statement: "超敏感な反応と大量の潮吹きシーンが公開されている。",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    const claim2 = await repo.createClaim({
      statement: "ベロキスを含む展開が公開されている。",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });

    const generation = new ContentGenerationService(
      repo,
      new MockLLMProvider(),
      { generation: "mock", review: "mock", revision: "mock" },
      resolveWith(MINIMAL_SP),
    );
    const generated = await generation.generateBloggerArticle({
      topicId: topic.id,
      strategyId: strategy.id,
      productTitle: "【Brain】ベロキシーン収録 テスト女優B 超敏感潮吹きドキュメント",
      ctaUrl: "https://example.invalid/p",
      claimIds: [claim.id, claim2.id],
    });
    expect(generated.version.id).toBeTruthy();

    const runs = await database.prisma.editorialBrainRun.findMany({
      where: { contentVersionId: generated.version.id },
    });
    expect(runs.length).toBe(1);
    expect(runs[0]!.mode).toBe("SHADOW");
    expect(runs[0]!.channel).toBe("BLOG");
    expect(runs[0]!.legacyDecision).toBe("GENERATED_OK");
    expect(runs[0]!.brainDecision).toBeTruthy();
    expect(String(runs[0]!.finalDecision)).toMatch(/LEGACY:GENERATED_OK\|BRAIN_SHADOW:/);
    expect(runs[0]!.corePlan).toBeTruthy();
    expect(runs[0]!.channelPlan).toBeTruthy();
    expect(runs[0]!.generatorModelRunIds).toEqual([generated.modelRunId]);

    const exps = await database.prisma.editorialExperience.findMany({
      where: { brainRunId: runs[0]!.id },
    });
    expect(exps.length).toBeGreaterThanOrEqual(1);

    // LearningRule unchanged / not auto-created
    const rules = await database.prisma.learningRule.findMany();
    expect(rules).toEqual([]);
  });

  it("production X path does not require blog body and records BrainRun", async () => {
    const topic = await repo.createTopicCandidate({
      title: "X Brain Topic",
      status: "READY",
    });
    const strategy = await repo.createStrategy({
      topicCandidateId: topic.id,
      objective: "test",
      targetAudience: "readers",
      userIntent: "info",
      formatCategory: "ARTICLE",
      formatKey: "NEW_RELEASE_SINGLE",
      angle: "test",
      primaryChannel: "X",
      candidateChannels: ["X"],
      status: "READY",
    });
    const claim = await repo.createClaim({
      statement: "公開されている具体シーンがある。",
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.9,
      strategyId: strategy.id,
    });
    const generation = new ContentGenerationService(repo, new MockLLMProvider(), {
      generation: "mock",
      review: "mock",
      revision: "mock",
    });
    const generated = await generation.generateXPost({
      topicId: topic.id,
      strategyId: strategy.id,
      productTitle: "Sample Product",
      productUrl: "https://example.invalid/p",
      // intentionally no bloggerUrl — Blog body not required
      claimIds: [claim.id],
    });
    const structured = generated.version.structuredContent as {
      channel?: string;
      posts?: unknown[];
    };
    expect(structured.channel).toBe("X");
    expect(Array.isArray(structured.posts)).toBe(true);

    const runs = await database.prisma.editorialBrainRun.findMany({
      where: { contentVersionId: generated.version.id },
    });
    expect(runs.length).toBe(1);
    expect(runs[0]!.channel).toBe("X");
    expect(runs[0]!.mode).toBe("SHADOW");
  });

  it("shadow observe supports claim scarcity and abundance plans", async () => {
    const shadow = new EditorialBrainShadowService(brainRepo);
    const scarce = await shadow.observeGeneration({
      channel: "BLOG",
      contentType: "blogger-article",
      formatKey: "NEW_RELEASE_SINGLE",
      availableClaims: [{ id: "1", statement: "事実1", kind: "trait_or_scene" }],
      selectedClaims: [{ id: "1", statement: "事実1", kind: "trait_or_scene" }],
      openingClaimIds: ["1"],
      hookClaimIds: ["1"],
      developmentClaimIds: [],
      generatorModelRunIds: ["mr1"],
      legacyDecision: "GENERATED_OK",
      artifact: {
        channel: "BLOG",
        title: "t",
        summary: "事実1の短メモ",
        lead: "事実1を先に置く。",
        sections: [{ paragraphs: ["公開事実の位置づけだけを残す。"], lists: [] }],
        bodyText: "事実1",
      },
      claimStatements: [{ id: "1", statement: "事実1" }],
    });
    expect(scarce.corePlan.scarcityMode).toBe(true);

    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      statement: `公開事実${i}が確認できる。`,
      kind: i % 2 === 0 ? "trait_or_scene" : "performer",
    }));
    const abundant = await shadow.observeGeneration({
      channel: "BLOG",
      contentType: "blogger-article",
      formatKey: "NEW_RELEASE_SINGLE",
      availableClaims: many,
      selectedClaims: many,
      openingClaimIds: ["c0"],
      hookClaimIds: ["c0", "c1"],
      developmentClaimIds: ["c2", "c3", "c4"],
      generatorModelRunIds: ["mr2"],
      legacyDecision: "GENERATED_OK",
      artifact: {
        channel: "BLOG",
        title: "t",
        summary: "複数の公開事実メモ",
        lead: "公開事実0が確認できる点を先に置く。",
        sections: [
          {
            paragraphs: [
              "公開事実2が確認できる。公開事実3が確認できる。公開事実4が確認できる。",
            ],
            lists: [],
          },
        ],
        bodyText: "",
      },
      claimStatements: many,
    });
    expect(abundant.corePlan.developmentDepth).toBe("rich");
  });
});
