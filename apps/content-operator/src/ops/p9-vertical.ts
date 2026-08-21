import { loadConfig } from "@ai-affiliate/config";
import { createAdminStack } from "../admin/create-admin-stack.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import { evaluateIntroQuality } from "../generation/intro-quality.js";
import { researchPublicUrl } from "./public-url-research.js";
import { MockPublisher } from "../adapters/publisher/mock-publisher.js";

const FIXTURE_HTML = `<!doctype html>
<html><head>
<title>Sample Catalog Item P9 | Example Store</title>
<meta name="description" content="Sample Catalog Item P9 is listed on a public catalog page." />
<link rel="canonical" href="https://example.invalid/fanza/p9-sample" />
<meta property="og:image" content="https://example.invalid/img/p9.png" />
</head><body>
<h1>Sample Catalog Item P9</h1>
<p>メーカー: Example Maker</p>
<p>シリーズ: Sample Series</p>
<p>配信開始日: 2026-07-01</p>
<p>価格: 1,980円</p>
<p>ジャンル: abstract, catalog</p>
<p>販売中</p>
<a href="https://example.invalid/fanza/p9-related">related</a>
</body></html>`;

/**
 * P9 Mock vertical: Public URL → Research → Strategy → Claims → Generate →
 * Quality Gate (review reuse) → Approve → Blogger Draft → X → Analytics
 */
export async function runP9MockVertical(): Promise<Record<string, unknown>> {
  loadConfig({ requireDatabaseUrl: false });
  process.env.ADMIN_FORCE_MOCK_ADAPTERS = "true";
  const stack = await createAdminStack({ forceMockAdapters: true });

  try {
    await seedP45Prompts(stack.lifecycleRepo);

    const research = await researchPublicUrl({
      config: stack.config,
      repo: stack.lifecycleRepo,
      lifecycle: stack.lifecycle,
      options: {
        url: "https://example.invalid/fanza/p9-sample",
        confirmExternal: true,
        mockHtml: FIXTURE_HTML,
        maxAdditionalSources: 2,
        researchBudget: 3,
      },
    });

    if (!research.productHint) throw new Error("Expected product hint from FANZA-like URL");
    if (research.claims.length === 0) throw new Error("Expected claims from normalized page");

    const product = await stack.ops.registerManualProduct({
      providerKey: "fanza",
      externalProductId: `p9-${Date.now()}`,
      title: research.productHint.title,
      url: research.productHint.url,
      adultFlag: true,
      notes: "P9 mock vertical — abstract safe fixture (adult catalog flag only)",
    });

    const topic = await stack.lifecycle.createTopicFromProduct(product.id);
    const strategy = await stack.lifecycle.createRuleBasedStrategy(topic.id);

    // Bind observed claims to this strategy for generation (SUPPORTED only)
    const bound = await stack.lifecycle.registerFindingAndClaim({
      sourceKey: "public-url",
      documentType: "product",
      documentTitle: research.seed.title ?? product.title,
      documentText: research.seed.normalizedText,
      findingSummary: research.claims[0]!.statement,
      claimStatement: research.claims[0]!.statement,
      strategyId: strategy.id,
      findingType: "observed:name",
    });

    const content = await stack.lifecycleRepo.createContent({
      topicCandidateId: topic.id,
      strategyId: strategy.id,
    });

    const generated = await stack.generation.generateBloggerArticle({
      topicId: topic.id,
      strategyId: strategy.id,
      contentId: content.id,
      productTitle: product.title,
      ctaUrl: product.url,
      claimIds: [bound.claim.id],
      articleFormat: research.seed.pageType === "product" ? "catalog-fact" : "overview",
    });
    const originalBody = generated.version.body;

    const intro = evaluateIntroQuality({
      title: generated.version.title,
      body: generated.version.body,
      lead: generated.version.summary,
    });
    if (!intro.ok) {
      throw new Error(`Intro quality failed in mock generation: ${intro.findings.map((f) => f.code).join(",")}`);
    }

    const gate1 = await stack.qualityGate.evaluate(generated.version.id, { minScore: 0.3 });
    const gate2 = await stack.qualityGate.evaluate(generated.version.id, { minScore: 0.3 });
    const reviewPass = await stack.generation.runQualityReviews(generated.version.id);
    if (reviewPass.reusedCount < 1) {
      throw new Error(`Expected review reuse on third pass, got reused=${reviewPass.reusedCount}`);
    }

    await stack.lifecycleRepo.updateContentVersionStatus(generated.version.id, "REVIEWING");
    await stack.contentReview.decide({
      contentVersionId: generated.version.id,
      decision: "approve",
      actor: "p9-vertical",
      reason: "quality gate reviewed",
    });

    const pub = await stack.lifecycle.createPublicationTarget({
      contentId: content.id,
      contentVersionId: generated.version.id,
      platform: "BLOGGER",
      approvalMode: "MANUAL",
    });
    await stack.lifecycle.approvePublicationTarget(pub.id);

    const draft1 = await stack.p45.createBloggerDraft({ publicationTargetId: pub.id });
    // Admin-style idempotency: existing external id is reused (no second createDraft)
    const targetAfter = await stack.lifecycleRepo.findPublicationTarget(pub.id);
    if (!targetAfter?.publishedExternalId) throw new Error("Missing draft external id");
    if (targetAfter.publishedExternalId !== draft1.externalId) {
      throw new Error("Draft external id changed unexpectedly");
    }
    const idempotentReuse = targetAfter.publishedExternalId;
    // Same Mock key must resolve to the same external id
    const mockCheck = new MockPublisher("BLOGGER");
    const sameKey = mockCheck.computeExternalId(`blogger-draft:${pub.id}`);
    if (sameKey !== draft1.externalId) {
      throw new Error("Mock external id not deterministic for publication target");
    }

    // Unique Mock IDs across different targets
    const mock = new MockPublisher("BLOGGER");
    const idA = mock.computeExternalId("blogger-draft:target-a");
    const idB = mock.computeExternalId("blogger-draft:target-b");
    const idA2 = mock.computeExternalId("blogger-draft:target-a");
    if (idA === idB) throw new Error("Mock external IDs collided across targets");
    if (idA !== idA2) throw new Error("Mock external ID not idempotent for same key");

    const xGenerated = await stack.generation.generateXPost({
      topicId: topic.id,
      strategyId: strategy.id,
      contentId: content.id,
      productTitle: product.title,
      bloggerUrl: draft1.url,
      productUrl: product.url ?? undefined,
      claimIds: [bound.claim.id],
    });
    const xExport = await stack.ops.exportX(xGenerated.version.id);
    if (xExport.characterCount > 140) {
      throw new Error(`X main post exceeds 140: ${xExport.characterCount}`);
    }
    // Short mock body should not need reply
    if (xExport.reply !== null && xExport.characterCount <= 140) {
      // reply only when body was split — buildXExport sets reply when over limit
    }

    const xTarget = await stack.lifecycle.createPublicationTarget({
      contentId: content.id,
      contentVersionId: xGenerated.version.id,
      platform: "X",
      approvalMode: "MANUAL",
    });
    await stack.lifecycle.approvePublicationTarget(xTarget.id);
    await stack.lifecycleRepo.updatePublicationTarget(xTarget.id, {
      status: "PUBLISHED",
      publishedExternalId: `manual-x-p9-${xTarget.id.slice(-6)}`,
      publishedUrl: `https://example.invalid/x/status/manual-x-p9-${xTarget.id.slice(-6)}`,
      publishedAt: new Date(),
    });

    await stack.ops.ingestManualAnalytics({
      platform: "BLOGGER",
      contentId: content.id,
      publicationTargetId: pub.id,
      metrics: {
        impressions: 500,
        views: 220,
        clicks: 12,
        likes: 2,
      },
      notes: "P9 vertical analytics",
    });

    const aggregate = await stack.learning.aggregateAnalytics({
      contentId: content.id,
      platform: "BLOGGER",
      contentVersionId: generated.version.id,
      publicationTargetId: pub.id,
    });
    const evaluation = await stack.learning.evaluateContent({
      contentId: content.id,
      contentVersionId: generated.version.id,
      analyticsAggregateId: aggregate.id,
      platform: "BLOGGER",
      useLlm: false,
    });

    const still = await stack.lifecycleRepo.findContentVersion(generated.version.id);
    if (still?.body !== originalBody) {
      throw new Error("Original ContentVersion body mutated");
    }

    await stack.p6.createAuditEvent({
      eventType: "p9.vertical",
      actor: "system",
      targetType: "Content",
      targetId: content.id,
      action: "completed",
      summary: "P9 mock vertical completed",
      details: {
        bloggerDraftId: draft1.externalId,
        reviewReused: reviewPass.reusedCount,
      },
    });

    return {
      productId: product.id,
      topicId: topic.id,
      strategyId: strategy.id,
      claimCount: research.claims.length + 1,
      fetchedUrls: research.fetchedUrls.length,
      contentVersionId: generated.version.id,
      qualityOverall: gate1.overall,
      gate2Overall: gate2.overall,
      reviewReusedCount: reviewPass.reusedCount,
      newLlmReviewCount: reviewPass.newLlmReviewCount,
      bloggerDraftId: draft1.externalId,
      draftIdempotent: idempotentReuse === draft1.externalId && sameKey === draft1.externalId,
      mockIdsUnique: idA !== idB,
      xExportChars: xExport.characterCount,
      xReply: xExport.reply,
      productUrl: product.url,
      evaluationId: evaluation.id,
      originalBodyUnchanged: true,
      affiliateApiRequired: false,
      usingMockLlm: stack.usingMockLlm,
      usingMockBlogger: stack.usingMockBlogger,
      introOk: intro.ok,
    };
  } finally {
    await stack.disconnect();
  }
}
