import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  LifecycleRepository,
  P5Repository,
  P6Repository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { CsvAnalyticsImportAdapter, JsonAnalyticsImportAdapter } from "./analytics-import-adapter.js";
import { AnalyticsImportService } from "./analytics-import-service.js";
import { LearningGovernanceService, enrichProposedRule } from "./learning-governance.js";
import { classifyError } from "./orchestration-service.js";
import { runP6MockVertical } from "./cli-handlers.js";
import { MockAffiliateProvider } from "../adapters/affiliate/mock-affiliate-provider.js";
import { MockLLMProvider } from "../adapters/llm/mock-llm-provider.js";
import { MockPublisher } from "../adapters/publisher/mock-publisher.js";
import { NoopNotificationAdapter } from "../adapters/types.js";
import { ContentLifecycleService } from "../lifecycle/lifecycle-service.js";
import { OpsService } from "../ops/ops-service.js";
import { OrchestrationService } from "./orchestration-service.js";
import { StrategyWithFeedbackService } from "./strategy-with-feedback.js";

loadConfig({ requireDatabaseUrl: false });
const database = createDatabaseClient();
const lifecycleRepo = new LifecycleRepository(database.prisma);
const p5 = new P5Repository(database.prisma);
const p6 = new P6Repository(database.prisma);

describe("P6 analytics adapters", () => {
  it("parses CSV and JSON and flags missing metrics", () => {
    const csv = new CsvAnalyticsImportAdapter("BLOGGER").parse(
      "externalId,impressions,clicks\next-1,100,5\nbad,,\n",
    );
    expect(csv[0]?.normalizedMetrics.impressions).toBe(100);
    expect(csv[1]?.validationIssues).toContain("missing_metrics");

    const json = new JsonAnalyticsImportAdapter("X").parse(
      JSON.stringify([{ externalId: "x1", views: 10, clicks: 1, weird_col: 3 }]),
    );
    expect(json[0]?.normalizedMetrics.views).toBe(10);
    expect(json[0]?.normalizedMetrics.weird_col).toBe(3);
  });
});

describe("P6 retry classification", () => {
  it("classifies retryable vs non-retryable", () => {
    expect(classifyError(new Error("timeout while fetching")).retryable).toBe(true);
    expect(classifyError(new Error("missing approval")).retryable).toBe(false);
  });
});

describe("P6 learning governance", () => {
  beforeAll(async () => {
    await database.connect();
  });
  afterAll(async () => {
    await database.disconnect();
  });
  beforeEach(async () => {
    await database.prisma.learningRuleApplication.deleteMany();
    await database.prisma.learningRuleConflict.deleteMany();
    await database.prisma.learningRule.deleteMany();
    await database.prisma.auditEvent.deleteMany();
  });

  it("blocks ACTIVE without approval/scope and supports approve→activate→suspend", async () => {
    const gov = new LearningGovernanceService(p5, p6);
    const rule = await p5.createLearningRule({
      ruleType: "headline",
      statement: "タイトルはおおむね40文字以内が強い傾向",
      confidence: 0.8,
      sampleCount: 3,
      successRate: 0.7,
      sourceEvaluationIds: ["e1"],
      status: "PROPOSED",
    });
    await enrichProposedRule(p6, rule.id, {
      platform: "BLOGGER",
      contentType: "article",
      minimumSampleCount: 1,
      minimumConfidence: 0.5,
      minimumSuccessRate: 0.4,
    });

    await expect(gov.activate(rule.id, "op")).rejects.toThrow(/approval/i);
    await gov.approve(rule.id, "op");
    const active = await gov.activate(rule.id, "op");
    expect(active.status).toBe("ACTIVE");
    const suspended = await gov.suspend(rule.id, "op", "temporary");
    expect(suspended.status).toBe("SUSPENDED");
  });

  it("detects title length conflicts", async () => {
    const gov = new LearningGovernanceService(p5, p6);
    const a = await p5.createLearningRule({
      ruleType: "headline",
      statement: "タイトルは40文字以内が強い",
      confidence: 0.9,
      sampleCount: 10,
      successRate: 0.8,
      sourceEvaluationIds: [],
      status: "ACTIVE",
      applicablePlatform: "BLOGGER",
      applicableContentType: "article",
      approvedBy: "op",
      approvedAt: new Date(),
    });
    const b = await p5.createLearningRule({
      ruleType: "headline",
      statement: "タイトルは長めの60文字が良い",
      confidence: 0.5,
      sampleCount: 2,
      successRate: 0.5,
      sourceEvaluationIds: [],
      status: "PROPOSED",
      applicablePlatform: "BLOGGER",
      applicableContentType: "article",
    });
    void a;
    void b;
    const conflicts = await gov.detectConflicts();
    expect(conflicts.length).toBeGreaterThan(0);
  });
});

describe("P6 import + vertical", () => {
  beforeAll(async () => {
    await database.connect();
  });
  afterAll(async () => {
    await database.disconnect();
  });
  beforeEach(async () => {
    await database.prisma.auditEvent.deleteMany();
    await database.prisma.operationCheckpoint.deleteMany();
    await database.prisma.operationJob.deleteMany();
    await database.prisma.learningRuleApplication.deleteMany();
    await database.prisma.learningRuleConflict.deleteMany();
    await database.prisma.strategyFeedback.deleteMany();
    await database.prisma.learningRule.deleteMany();
    await database.prisma.experimentResult.deleteMany();
    await database.prisma.experimentVariant.deleteMany();
    await database.prisma.experiment.deleteMany();
    await database.prisma.evaluationFinding.deleteMany();
    await database.prisma.evaluation.deleteMany();
    await database.prisma.analyticsAggregate.deleteMany();
    await database.prisma.analyticsAttribution.deleteMany();
    await database.prisma.analyticsImportRow.deleteMany();
    await database.prisma.analyticsImportBatch.deleteMany();
    await database.prisma.affiliateResult.deleteMany();
    await database.prisma.analyticsSnapshot.deleteMany();
    await database.prisma.linkReplacementEvent.deleteMany();
    await database.prisma.productLinkUsage.deleteMany();
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
  });

  it("rejects duplicate file import without destroying snapshots", async () => {
    const importer = new AnalyticsImportService(lifecycleRepo, p6);
    const csv = "externalId,impressions,clicks\nunmatched-ext,10,1\n";
    const first = await importer.importContent({
      format: "csv",
      content: csv,
      platform: "BLOGGER",
      fileName: "dup.csv",
    });
    const second = await importer.importContent({
      format: "csv",
      content: csv,
      platform: "BLOGGER",
      fileName: "dup.csv",
    });
    expect(first.duplicateFile).toBe(false);
    expect(second.duplicateFile).toBe(true);
    expect(second.batch.id).toBe(first.batch.id);
  });

  it("runs P6 vertical with resume and strategy rule applications", async () => {
    const config = loadConfig({ requireDatabaseUrl: false });
    const llm = new MockLLMProvider();
    const publishers = {
      BLOGGER: new MockPublisher("BLOGGER"),
      X: new MockPublisher("X"),
    };
    const lifecycle = new ContentLifecycleService({
      repo: lifecycleRepo,
      affiliate: new MockAffiliateProvider(),
      llm,
      publishers,
      notifications: new NoopNotificationAdapter(),
      linkPolicy: {
        preferredAffiliateProvider: config.preferredAffiliateProvider,
        futureAspProviders: config.linkFutureAspProviders,
      },
    });
    const ops = new OpsService({
      repo: lifecycleRepo,
      lifecycle,
      publishers,
      queueConfig: {
        targetPerDay: 2,
        maximumPerDay: 3,
        minimumIntervalMinutes: 0,
        pauseWhenNoQualifiedContent: true,
      },
      linkPolicy: {
        preferredAffiliateProvider: config.preferredAffiliateProvider,
        futureAspProviders: config.linkFutureAspProviders,
      },
    });
    const orchestration = new OrchestrationService(lifecycleRepo, p5, p6, lifecycle, ops, llm);
    const summary = await runP6MockVertical({
      orchestration,
      analytics: orchestration.analytics,
      governance: orchestration.governance,
      strategy: new StrategyWithFeedbackService(lifecycleRepo, p5, p6, llm),
      lifecycle,
      lifecycleRepo,
      p5,
      p6,
    });
    expect(summary.originalBodyUnchanged).toBe(true);
    expect(summary.duplicateReimport).toBe(true);
    expect(summary.blockedWithoutApproval).toBe(true);
    expect(summary.learningRuleStatus).toBe("ACTIVE");
    expect(Number(summary.appliedRuleCount)).toBeGreaterThan(0);
  });
});
