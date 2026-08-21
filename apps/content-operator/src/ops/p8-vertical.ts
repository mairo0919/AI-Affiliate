import { loadConfig } from "@ai-affiliate/config";
import { createAdminStack } from "../admin/create-admin-stack.js";
import { enrichProposedRule } from "../ops-p6/learning-governance.js";

/**
 * P8 Mock vertical: Research→…→Blogger Draft→X Export→manual register→Analytics→Learning
 * No real external APIs. Ensures non-destructive ContentVersion + draft idempotency.
 */
export async function runP8MockVertical(): Promise<Record<string, unknown>> {
  loadConfig({ requireDatabaseUrl: false });
  process.env.ADMIN_FORCE_MOCK_ADAPTERS = "true";
  const stack = await createAdminStack({ forceMockAdapters: true });

  try {
    const topic = await stack.lifecycleRepo.createTopicCandidate({
      title: "P8 Ops Vertical Topic",
      summary: "safe abstract fixture for production wiring",
      formatCategory: "ARTICLE",
      metadata: { source: "p8-vertical" },
    });
    const strategy = await stack.lifecycleRepo.createStrategy({
      topicCandidateId: topic.id,
      objective: "P8 assisted ops",
      targetAudience: "adult readers (abstract fixture)",
      userIntent: "research",
      formatCategory: "ARTICLE",
      formatKey: "blogger-article",
      angle: "comparison",
      primaryChannel: "BLOGGER",
      candidateChannels: ["BLOGGER", "X"],
      requiredClaims: [],
      requiredResearch: [],
      successMetrics: {},
      riskFlags: [],
    });
    const content = await stack.lifecycleRepo.createContent({
      topicCandidateId: topic.id,
      strategyId: strategy.id,
    });
    const claim = await stack.lifecycleRepo.createClaim({
      statement: "Sample catalog item is listed on a public product page",
      claimType: "FACT",
      status: "SUPPORTED",
      strategyId: strategy.id,
      confidence: 0.9,
    });
    await stack.lifecycleRepo.addClaimSource({
      claimId: claim.id,
      supportType: "official",
      excerptOrSummary: "Public product page listing",
      sourceLocation: "https://example.invalid/fanza/p8-sample",
    });

    const productUrl = "https://example.invalid/fanza/p8-sample";
    const generated = await stack.generation.generateBloggerArticle({
      topicId: topic.id,
      strategyId: strategy.id,
      contentId: content.id,
      productTitle: "Sample Catalog Item P8",
      ctaUrl: productUrl,
      claimIds: [claim.id],
    });
    const originalBody = generated.version.body;

    const gate = await stack.qualityGate.evaluate(generated.version.id, {
      minScore: 0.3,
    });

    // Comparison against synthetic research peers (no copy)
    await stack.contentComparison.compare({
      contentVersionId: generated.version.id,
      competitors: [
        {
          id: "peer-1",
          title: "Peer overview A",
          excerpt: "Short peer excerpt",
          metrics: {
            title: "Peer overview A",
            headings: ["Intro", "Details"],
            sectionCount: 2,
            articleLength: Math.max(200, generated.version.body.length + 100),
            linkCount: 2,
            hasFaq: true,
            hasListOrTable: true,
          },
        },
      ],
    });

    // Ensure REVIEWING for human approve
    await stack.lifecycleRepo.updateContentVersionStatus(generated.version.id, "REVIEWING");
    await stack.contentReview.decide({
      contentVersionId: generated.version.id,
      decision: "approve",
      actor: "p8-vertical",
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
    // Idempotent second call via Admin semantics: existing external id
    const again = await stack.lifecycleRepo.findPublicationTarget(pub.id);
    if (!again?.publishedExternalId) throw new Error("Expected draft external id");
    const draft2External = again.publishedExternalId;
    if (draft2External !== draft1.externalId) {
      throw new Error("Draft idempotency broken — external id changed");
    }

    const xGenerated = await stack.generation.generateXPost({
      topicId: topic.id,
      strategyId: strategy.id,
      contentId: content.id,
      productTitle: "Sample Catalog Item P8",
      bloggerUrl: draft1.url,
      productUrl,
      claimIds: [claim.id],
    });
    const xExport = await stack.ops.exportX(xGenerated.version.id);

    // Manual publication registration (X)
    const xTarget = await stack.lifecycle.createPublicationTarget({
      contentId: content.id,
      contentVersionId: xGenerated.version.id,
      platform: "X",
      approvalMode: "MANUAL",
    });
    await stack.lifecycle.approvePublicationTarget(xTarget.id);
    await stack.lifecycleRepo.updatePublicationTarget(xTarget.id, {
      status: "PUBLISHED",
      publishedExternalId: "manual-x-p8",
      publishedUrl: "https://example.invalid/x/status/manual-x-p8",
      publishedAt: new Date(),
    });

    // CSV import path (may be unmatched if Mock external ids collide historically)
    const measuredAt = new Date().toISOString();
    const csv = [
      "externalId,platform,measuredAt,impressions,views,clicks,likes",
      `${draft1.externalId},BLOGGER,${measuredAt},800,400,20,3`,
    ].join("\n");
    const imported = await stack.analytics.importContent({
      format: "csv",
      content: csv,
      platform: "BLOGGER",
      fileName: `p8-${content.id}-${Date.now()}.csv`,
    });
    // Guarantee snapshot for this content (same pattern as P5 vertical)
    await stack.ops.ingestManualAnalytics({
      platform: "BLOGGER",
      contentId: content.id,
      publicationTargetId: pub.id,
      metrics: {
        impressions: 800,
        views: 400,
        clicks: 20,
        likes: 3,
        article_open: 50,
        read_time: 80,
        external_click: 15,
      },
      notes: "P8 vertical analytics",
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
    const rules = await stack.learning.generateLearning({
      evaluationIds: [evaluation.id],
      activate: false,
    });
    const rule = rules[0]!;
    await enrichProposedRule(stack.p6, rule.id, {
      platform: "BLOGGER",
      contentType: "article",
      minimumSampleCount: 1,
      minimumConfidence: 0.3,
      minimumSuccessRate: 0.3,
    });
    await stack.governance.approve(rule.id, "p8-vertical");
    await stack.governance.activate(rule.id, "p8-vertical");

    const next = await stack.strategyFeedback.generate({
      topicCandidateId: topic.id,
      platform: "BLOGGER",
      contentType: "article",
      evaluationIds: [evaluation.id],
    });

    const still = await stack.lifecycleRepo.findContentVersion(generated.version.id);
    if (still?.body !== originalBody) {
      throw new Error("Original ContentVersion body mutated");
    }

    return {
      contentId: content.id,
      contentVersionId: generated.version.id,
      qualityOverall: gate.overall,
      recommendedAction: gate.recommendedAction,
      bloggerDraftId: draft1.externalId,
      draftIdempotent: true,
      xExportChars: xExport.characterCount,
      xMainPost: xExport.mainPost.slice(0, 40),
      importBatchId: imported.batch.id,
      evaluationId: evaluation.id,
      learningRuleId: rule.id,
      nextStrategyId: next.strategy.id,
      originalBodyUnchanged: true,
      usingMockLlm: stack.usingMockLlm,
      usingMockBlogger: stack.usingMockBlogger,
    };
  } finally {
    await stack.disconnect();
  }
}
