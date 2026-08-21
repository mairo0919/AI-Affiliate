import type { AppConfig } from "@ai-affiliate/config";
import {
  LifecycleRepository,
  P5Repository,
  type ContentStrategy,
} from "@ai-affiliate/database";
import { MockAffiliateProvider } from "../adapters/affiliate/mock-affiliate-provider.js";
import { MockLLMProvider } from "../adapters/llm/mock-llm-provider.js";
import { MockPublisher } from "../adapters/publisher/mock-publisher.js";
import { NoopNotificationAdapter } from "../adapters/types.js";
import { ContentLifecycleService } from "../lifecycle/lifecycle-service.js";
import { OpsService } from "../ops/ops-service.js";
import { P5LearningService } from "./p5-service.js";

export function createP5Stack(input: {
  lifecycleRepo: LifecycleRepository;
  p5Repo: P5Repository;
  config: AppConfig;
}): {
  learning: P5LearningService;
  lifecycle: ContentLifecycleService;
  ops: OpsService;
} {
  const llm = new MockLLMProvider();
  const publishers = {
    BLOGGER: new MockPublisher("BLOGGER"),
    X: new MockPublisher("X"),
  };
  const lifecycle = new ContentLifecycleService({
    repo: input.lifecycleRepo,
    affiliate: new MockAffiliateProvider(),
    llm,
    publishers,
    notifications: new NoopNotificationAdapter(),
    linkPolicy: {
      preferredAffiliateProvider: input.config.preferredAffiliateProvider,
      futureAspProviders: input.config.linkFutureAspProviders,
    },
  });
  const ops = new OpsService({
    repo: input.lifecycleRepo,
    lifecycle,
    publishers,
    queueConfig: {
      targetPerDay: input.config.publicationTargetPerDay,
      maximumPerDay: input.config.publicationMaximumPerDay,
      minimumIntervalMinutes: 0,
      pauseWhenNoQualifiedContent: true,
    },
    linkPolicy: {
      preferredAffiliateProvider: input.config.preferredAffiliateProvider,
      futureAspProviders: input.config.linkFutureAspProviders,
    },
  });
  const learning = new P5LearningService(input.lifecycleRepo, input.p5Repo, llm);
  return { learning, lifecycle, ops };
}

export async function runP5MockVertical(input: {
  lifecycleRepo: LifecycleRepository;
  p5Repo: P5Repository;
  config: AppConfig;
}): Promise<{
  contentId: string;
  contentVersionId: string;
  aggregateId: string;
  evaluationId: string;
  experimentId: string;
  learningRuleIds: string[];
  strategyFeedbackId: string;
  nextStrategyId: string;
  originalBodyUnchanged: boolean;
}> {
  const { learning, lifecycle, ops } = createP5Stack(input);

  const product = await ops.registerManualProduct({
    providerKey: "fanza",
    externalProductId: "p5-manual-1",
    title: "Sample Catalog Item P5",
    url: "https://example.invalid/fanza/p5-manual-1",
  });
  const topic = await lifecycle.createTopicFromProduct(product.id);
  const strategy = await lifecycle.createRuleBasedStrategy(topic.id);
  const research = await ops.registerPublicUrlResearch({
    url: "https://example.invalid/notes/p5-1",
    summary: "Sample Catalog Item P5 is listed as available.",
    claimStatement: "Sample Catalog Item P5 is listed as available in a public catalog.",
    strategyId: strategy.id,
  });

  const blogger = await ops.generateChannelContent({
    topicId: topic.id,
    strategyId: strategy.id,
    channel: "BLOGGER",
    productTitle: product.title,
    productUrl: product.url,
    claimStatements: [research.claim.statement],
    claimId: research.claim.id,
  });
  await lifecycle.runMockReview(blogger.version.id);
  const originalBody = blogger.version.body;

  const target = await lifecycle.createPublicationTarget({
    contentId: blogger.content.id,
    contentVersionId: blogger.version.id,
    platform: "BLOGGER",
    approvalMode: "DRAFT_ONLY",
    targetFormat: "article",
  });
  await lifecycle.approvePublicationTarget(target.id);
  const drafted = await ops.mockDraft(target.id);

  await ops.ingestManualAnalytics({
    platform: "BLOGGER",
    contentId: blogger.content.id,
    publicationTargetId: drafted.id,
    metrics: {
      impressions: 1200,
      views: 800,
      clicks: 48,
      likes: 12,
      comments: 3,
      article_open: 90,
      read_time: 95,
      external_click: 40,
    },
    notes: "P5 mock analytics",
  });

  const aggregate = await learning.aggregateAnalytics({
    contentId: blogger.content.id,
    platform: "BLOGGER",
    contentVersionId: blogger.version.id,
    publicationTargetId: drafted.id,
  });

  const evaluation = await learning.evaluateContent({
    contentId: blogger.content.id,
    contentVersionId: blogger.version.id,
    analyticsAggregateId: aggregate.id,
    platform: "BLOGGER",
    useLlm: true,
  });

  const experiment = await learning.runExperiment({
    contentId: blogger.content.id,
    contentVersionId: blogger.version.id,
    name: "Title A/B",
    hypothesis: "短いタイトルの方が CTR が高い",
    platform: "BLOGGER",
    variants: [
      {
        label: "A",
        variantType: "title",
        payload: { title: `${product.title} の概要` },
      },
      {
        label: "B",
        variantType: "title",
        payload: { title: `${product.title}｜要点まとめ` },
      },
    ],
  });

  await learning.approveExperiment(experiment.id, "operator");
  await learning.completeExperiment({
    experimentId: experiment.id,
    results: [
      {
        variantLabel: "A",
        metrics: { ctr: 0.03, clicks: 30 },
        score: 0.55,
        winner: false,
        evaluationId: evaluation.id,
        analyticsAggregateId: aggregate.id,
      },
      {
        variantLabel: "B",
        metrics: { ctr: 0.05, clicks: 48 },
        score: 0.72,
        winner: true,
        evaluationId: evaluation.id,
        analyticsAggregateId: aggregate.id,
      },
    ],
  });

  const rules = await learning.generateLearning({
    evaluationIds: [evaluation.id],
    experimentIds: [experiment.id],
    activate: true,
  });

  const { feedback, strategy: nextStrategy } = await learning.strategyFeedback({
    topicCandidateId: topic.id,
    learningRuleIds: rules.map((r) => r.id),
    evaluationIds: [evaluation.id],
    experimentIds: [experiment.id],
    createStrategy: true,
    createStrategyFn: (topicId, fb) =>
      lifecycle.createRuleBasedStrategy(topicId, { learningFeedback: fb }),
  });

  const still = await input.lifecycleRepo.findContentVersion(blogger.version.id);
  if (!nextStrategy) throw new Error("Expected next strategy from feedback");

  return {
    contentId: blogger.content.id,
    contentVersionId: blogger.version.id,
    aggregateId: aggregate.id,
    evaluationId: evaluation.id,
    experimentId: experiment.id,
    learningRuleIds: rules.map((r) => r.id),
    strategyFeedbackId: feedback.id,
    nextStrategyId: nextStrategy.id,
    originalBodyUnchanged: still?.body === originalBody,
  };
}

export type { ContentStrategy };
