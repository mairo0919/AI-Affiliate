import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import { MockLLMProvider } from "../adapters/llm/mock-llm-provider.js";
import { LLMProviderError } from "../adapters/types.js";
import { MockPublisher } from "../adapters/publisher/mock-publisher.js";
import { BloggerApiPublisher } from "../adapters/publisher/blogger-api-publisher.js";
import { validateClaimsAgainstArticle } from "./claim-validator.js";
import { formatBloggerHtml } from "./blogger-formatter.js";
import { createP45Stack, seedP45Prompts } from "./p45-service.js";
import { parseBloggerArticle } from "./structured-article.js";
import { containsInternalLinkMarkers } from "../publication/public-body-sanitizer.js";
import { XCharacterCounter } from "../x/character-counter.js";

loadConfig({ requireDatabaseUrl: false });
const database = createDatabaseClient();
const repo = new LifecycleRepository(database.prisma);

describe("P4.5 LLM mock behaviors", () => {
  it("records structured blogger output and cost-like usage", async () => {
    const llm = new MockLLMProvider();
    const result = await llm.executeTask({
      taskType: "GENERATION_BLOGGER",
      promptIdentifier: "blogger.generate",
      input: { productTitle: "Sample Catalog Item", supportedClaimIds: ["c1"] },
    });
    expect(result.structuredOutputValid).toBe(true);
    expect(result.output.title).toContain("Sample Catalog Item");
    expect(result.metadata).not.toHaveProperty("apiKey");
  });

  it("classifies timeout / retryable / non-retryable / policy refusal", async () => {
    const llm = new MockLLMProvider();
    llm.behavior = "timeout";
    await expect(
      llm.executeTask({ taskType: "GENERATION_BLOGGER", promptIdentifier: "blogger.generate", input: {} }),
    ).rejects.toMatchObject({ errorClass: "timeout" } satisfies Partial<LLMProviderError>);

    llm.behavior = "policy_refusal";
    const refused = await llm.executeTask({
      taskType: "GENERATION_BLOGGER",
      promptIdentifier: "blogger.generate",
      input: {},
    });
    expect(refused.errorClass).toBe("policy_refusal");
  });
});

describe("P4.5 claim + formatter + x length", () => {
  it("rejects unsupported superlatives and blocked claim reuse", () => {
    const article = parseBloggerArticle({
      title: "t",
      summary: "s",
      lead: "l",
      sections: [{ heading: "h", paragraphs: ["絶対に稼げる"] }],
      cta: { label: "x", url: null },
      sourceReferences: [],
      seoTitle: "t",
      metaDescription: "m",
      labels: [],
      warnings: [],
      usedClaimIds: ["c1"],
      usedProductLinkIds: [],
    });
    const result = validateClaimsAgainstArticle({
      article,
      claims: [
        {
          id: "c1",
          statement: "blocked statement sample text here",
          claimType: "FACT",
          status: "UNSUPPORTED",
          confidence: 0.1,
          freshnessScore: null,
          classification: "third_party",
          firstObservedAt: new Date(),
          lastVerifiedAt: null,
          expiresAt: null,
          strategyId: null,
          researchFindingId: null,
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      bodyText: structuredBody(article),
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "UNSUPPORTED_SUPERLATIVE")).toBe(true);
  });

  it("formats blogger HTML with disclosure and CTA", () => {
    const html = formatBloggerHtml({
      title: "t",
      lead: "lead",
      sections: [{ heading: "概要", paragraphs: ["本文"] }],
      cta: { label: "商品ページ", url: "https://example.invalid/fanza/x" },
    });
    expect(html).toContain("アフィリエイト");
    expect(html).toContain("18歳未満");
    expect(html).toContain("https://example.invalid/fanza/x");
    expect(containsInternalLinkMarkers(html)).toBe(false);
  });

  it("validates X weighted length deterministically", () => {
    const counter = new XCharacterCounter();
    const body = "あ".repeat(40) + " https://example.invalid/x";
    expect(counter.count(body).weightedLength).toBeLessThanOrEqual(140);
    expect(() => counter.assertWithinLimit(body, 140)).not.toThrow();
    expect(() => counter.assertWithinLimit("あ".repeat(200), 140)).toThrow();
  });
});

describe("P4.5 Blogger publisher safety", () => {
  it("refuses api calls without credentials and blocks direct publish by default", () => {
    const api = new BloggerApiPublisher({
      mode: "api",
      allowExternal: true,
      allowDirectPublish: false,
      defaultPublishMode: "draft",
      apiBaseUrl: "https://example.invalid",
      tokenUrl: "https://example.invalid/token",
    });
    expect(() => api.assertCanCallApi("createDraft")).toThrow(/Missing Blogger credentials/);
    expect(() => api.assertCanCallApi("publish")).toThrow(/Direct Blogger publish is disabled/);
  });

  it("mock publisher createDraft does not call external network", async () => {
    const mock = new MockPublisher("BLOGGER");
    const prepared = await mock.prepare({
      contentVersionId: "v1",
      title: "t",
      body: "<p>body</p>",
      metadata: { mode: "draft" },
    });
    const draft = await mock.createDraft!({ prepared });
    expect(draft.status).toBe("DRAFT");
    expect(draft.externalId).toContain("draft");
  });
});

describe("P4.5 mock vertical slice", () => {
  beforeAll(async () => {
    await database.connect();
  });
  afterAll(async () => {
    await database.disconnect();
  });
  beforeEach(async () => {
    await database.prisma.linkReplacementEvent.deleteMany();
    await database.prisma.productLinkUsage.deleteMany();
    await database.prisma.analyticsSnapshot.deleteMany();
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
    await database.prisma.policyRule.deleteMany({
      where: { ruleIdentifier: "affiliate-disclosure-required-p45" },
    });
    await seedP45Prompts(repo);
    await repo.createPolicyRule({
      policyType: "disclosure",
      scope: "content",
      ruleIdentifier: "affiliate-disclosure-required-p45",
      severity: "WARNING",
      condition: { check: "disclosure" },
      resultOnMatch: "WARNING",
      message: "disclosure",
    });
  });

  it("runs LLM generate → review → approve → mock blogger draft → x export without external APIs", async () => {
    const config = loadConfig({ requireDatabaseUrl: false });
    const { p45 } = createP45Stack({ repo, config: { ...config, llmMode: "mock", bloggerMode: "mock" } });
    const summary = await p45.runP45MockVertical();
    expect(summary.bloggerDraftId).toContain("draft");
    expect(summary.reviewOverall).not.toBe("failed");
    expect(summary.xExportBody.length).toBeGreaterThan(0);
    expect(containsInternalLinkMarkers(summary.xExportBody)).toBe(false);
    expect(summary.claimIds.length).toBeGreaterThanOrEqual(2);

    const version = await repo.findContentVersion(summary.bloggerVersionId);
    expect(version?.modelRunId).toBeTruthy();
    expect(version?.structuredContent).toBeTruthy();

    const revised = await p45.generation.reviseContentVersion({
      contentVersionId: summary.bloggerVersionId,
      mode: "partial_revision",
      rationale: "tighten lead",
      productTitle: "Sample Catalog Item P45",
      ctaUrl: "https://example.invalid/fanza/p45-manual-1",
    });
    expect(revised.version.id).not.toBe(summary.bloggerVersionId);
    expect(revised.version.parentVersionId).toBe(summary.bloggerVersionId);
    const original = await repo.findContentVersion(summary.bloggerVersionId);
    expect(original?.body).toBe(version?.body);

    const costs = await database.prisma.costRecord.findMany();
    expect(costs.length).toBeGreaterThan(0);
  });
});

function structuredBody(article: ReturnType<typeof parseBloggerArticle>): string {
  return [article.lead, ...article.sections.flatMap((s) => s.paragraphs)].join("\n");
}
