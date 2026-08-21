import { loadConfig } from "@ai-affiliate/config";
import {
  LifecycleRepository,
  P5Repository,
  P6Repository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { MockAffiliateProvider } from "../adapters/affiliate/mock-affiliate-provider.js";
import { MockLLMProvider } from "../adapters/llm/mock-llm-provider.js";
import { MockPublisher } from "../adapters/publisher/mock-publisher.js";
import { NoopNotificationAdapter } from "../adapters/types.js";
import { ContentLifecycleService } from "../lifecycle/lifecycle-service.js";
import { OpsService } from "../ops/ops-service.js";
import { AnalyticsImportService } from "./analytics-import-service.js";
import { AffiliateResultImportService } from "./affiliate-result-import.js";
import { LearningGovernanceService, enrichProposedRule } from "./learning-governance.js";
import { OrchestrationService } from "./orchestration-service.js";
import { StrategyWithFeedbackService } from "./strategy-with-feedback.js";

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    flags[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return flags;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function withP6<T>(
  run: (ctx: {
    orchestration: OrchestrationService;
    analytics: AnalyticsImportService;
    governance: LearningGovernanceService;
    strategy: StrategyWithFeedbackService;
    affiliate: AffiliateResultImportService;
    lifecycle: ContentLifecycleService;
    lifecycleRepo: LifecycleRepository;
    p5: P5Repository;
    p6: P6Repository;
  }) => Promise<T>,
): Promise<T> {
  const config = loadConfig({ requireDatabaseUrl: false });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const lifecycleRepo = new LifecycleRepository(database.prisma);
    const p5 = new P5Repository(database.prisma);
    const p6 = new P6Repository(database.prisma);
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
        targetPerDay: config.publicationTargetPerDay,
        maximumPerDay: config.publicationMaximumPerDay,
        minimumIntervalMinutes: 0,
        pauseWhenNoQualifiedContent: true,
      },
      linkPolicy: {
        preferredAffiliateProvider: config.preferredAffiliateProvider,
        futureAspProviders: config.linkFutureAspProviders,
      },
    });
    const orchestration = new OrchestrationService(lifecycleRepo, p5, p6, lifecycle, ops, llm);
    return await run({
      orchestration,
      analytics: orchestration.analytics,
      governance: orchestration.governance,
      strategy: orchestration.strategyFeedback,
      affiliate: new AffiliateResultImportService(p6),
      lifecycle,
      lifecycleRepo,
      p5,
      p6,
    });
  } finally {
    await database.disconnect();
  }
}

export async function runAnalyticsImportCsv(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const content = flags.content ?? flags.file;
  if (!content) {
    console.error("Usage: analytics:import-csv -- --content=<csv>|--file=<path-content>");
    process.exitCode = 1;
    return;
  }
  const fs = await import("node:fs/promises");
  const body = flags.file ? await fs.readFile(flags.file, "utf8") : content;
  await withP6(async ({ analytics }) => {
    printJson(
      await analytics.importContent({
        format: "csv",
        content: body,
        platform: flags.platform ?? "BLOGGER",
        fileName: flags.file ?? "cli.csv",
      }),
    );
  });
}

export async function runAnalyticsImportJson(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const content = flags.content ?? flags.file;
  if (!content) {
    console.error("Usage: analytics:import-json -- --content=<json>|--file=<path>");
    process.exitCode = 1;
    return;
  }
  const fs = await import("node:fs/promises");
  const body = flags.file ? await fs.readFile(flags.file, "utf8") : content;
  await withP6(async ({ analytics }) => {
    printJson(
      await analytics.importContent({
        format: "json",
        content: body,
        platform: flags.platform ?? "BLOGGER",
        fileName: flags.file ?? "cli.json",
      }),
    );
  });
}

export async function runAnalyticsListUnmatched(): Promise<void> {
  await withP6(async ({ analytics }) => printJson(await analytics.listUnmatched()));
}

export async function runAnalyticsMatch(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["row-id"] || !flags["content-id"]) {
    console.error(
      "Usage: analytics:match -- --row-id= --content-id= [--target-id=] [--by=operator]",
    );
    process.exitCode = 1;
    return;
  }
  await withP6(async ({ analytics }) => {
    printJson(
      await analytics.matchRow({
        importRowId: flags["row-id"]!,
        contentId: flags["content-id"]!,
        publicationTargetId: flags["target-id"],
        reviewedBy: flags.by ?? "operator",
      }),
    );
  });
}

export async function runAnalyticsRejectMatch(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["row-id"]) {
    console.error("Usage: analytics:reject-match -- --row-id= [--reason=] [--by=operator]");
    process.exitCode = 1;
    return;
  }
  await withP6(async ({ analytics }) => {
    printJson(
      await analytics.rejectMatch(
        flags["row-id"]!,
        flags.by ?? "operator",
        flags.reason ?? "rejected_by_operator",
      ),
    );
  });
}

export async function runAffiliateResultsImport(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const content = flags.content ?? flags.file;
  if (!content) {
    console.error("Usage: affiliate-results:import -- --content=<json>|--file=<path>");
    process.exitCode = 1;
    return;
  }
  const fs = await import("node:fs/promises");
  const body = flags.file ? await fs.readFile(flags.file, "utf8") : content;
  await withP6(async ({ affiliate }) => {
    printJson(await affiliate.importJson(body, flags.provider ?? "future-affiliate"));
  });
}

export async function runLearningList(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  await withP6(async ({ governance }) => printJson(await governance.list(flags.status)));
}

export async function runLearningApprove(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["rule-id"]) {
    console.error("Usage: learning:approve -- --rule-id= [--by=operator]");
    process.exitCode = 1;
    return;
  }
  await withP6(async ({ governance }) => {
    printJson(await governance.approve(flags["rule-id"]!, flags.by ?? "operator"));
  });
}

export async function runLearningActivate(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["rule-id"]) {
    console.error("Usage: learning:activate -- --rule-id= [--by=operator]");
    process.exitCode = 1;
    return;
  }
  await withP6(async ({ governance }) => {
    printJson(await governance.activate(flags["rule-id"]!, flags.by ?? "operator"));
  });
}

export async function runLearningSuspend(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["rule-id"]) {
    console.error("Usage: learning:suspend -- --rule-id= [--reason=] [--by=operator]");
    process.exitCode = 1;
    return;
  }
  await withP6(async ({ governance }) => {
    printJson(
      await governance.suspend(
        flags["rule-id"]!,
        flags.by ?? "operator",
        flags.reason ?? "suspended",
      ),
    );
  });
}

export async function runLearningDeactivate(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["rule-id"]) {
    console.error("Usage: learning:deactivate -- --rule-id= [--reason=] [--by=operator]");
    process.exitCode = 1;
    return;
  }
  await withP6(async ({ governance }) => {
    printJson(
      await governance.deactivate(
        flags["rule-id"]!,
        flags.by ?? "operator",
        flags.reason ?? "deactivated",
      ),
    );
  });
}

export async function runLearningConflicts(): Promise<void> {
  await withP6(async ({ governance }) => {
    await governance.detectConflicts();
    printJson(await governance.listConflicts());
  });
}

export async function runStrategyGenerateWithFeedback(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["topic-id"]) {
    console.error("Usage: strategy:generate-with-feedback -- --topic-id= [--platform=BLOGGER]");
    process.exitCode = 1;
    return;
  }
  await withP6(async ({ strategy }) => {
    printJson(
      await strategy.generate({
        topicCandidateId: flags["topic-id"]!,
        platform: flags.platform ?? "BLOGGER",
        contentType: flags["content-type"] ?? "article",
        evaluationIds: flags["evaluation-ids"]?.split(",").filter(Boolean),
        experimentIds: flags["experiment-ids"]?.split(",").filter(Boolean),
      }),
    );
  });
}

export async function runOpsRunCycle(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.cycle || !flags["idempotency-key"]) {
    console.error(
      "Usage: ops:run-cycle -- --cycle=daily_ops --idempotency-key=... [--human-approved=true]",
    );
    process.exitCode = 1;
    return;
  }
  await withP6(async ({ orchestration }) => {
    printJson(
      await orchestration.runCycle({
        cycleType: flags.cycle!,
        idempotencyKey: flags["idempotency-key"]!,
        payload: {
          humanApproved: flags["human-approved"] === "true",
          stopForHumanApproval: flags["stop-for-approval"] !== "false",
          activateLearning: flags["activate-learning"] === "true",
          actor: flags.by ?? "operator",
          productTitle: flags["product-title"],
        },
      }),
    );
  });
}

export async function runOpsResumeJob(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["job-id"]) {
    console.error("Usage: ops:resume-job -- --job-id= [--human-approved=true]");
    process.exitCode = 1;
    return;
  }
  await withP6(async ({ orchestration, p6 }) => {
    if (flags["human-approved"] === "true") {
      const job = await p6.findOperationJob(flags["job-id"]!);
      if (job) {
        await p6.updateOperationJob(job.id, {
          status: "PENDING",
        });
        // merge approval into payload via raw prisma update of payload
        const database = createDatabaseClient();
        // payload merge handled by setting checkpoint and re-running with updated payload:
        await database.connect();
        try {
          await database.prisma.operationJob.update({
            where: { id: job.id },
            data: {
              status: "PENDING",
              payload: {
                ...((job.payload as Record<string, unknown>) ?? {}),
                humanApproved: true,
                stopForHumanApproval: true,
                activateLearning: flags["activate-learning"] === "true",
              },
            },
          });
        } finally {
          await database.disconnect();
        }
      }
    }
    printJson(await orchestration.resumeJob(flags["job-id"]!));
  });
}

export async function runOpsJobStatus(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["job-id"]) {
    console.error("Usage: ops:job-status -- --job-id=");
    process.exitCode = 1;
    return;
  }
  await withP6(async ({ orchestration }) => {
    printJson(await orchestration.jobStatus(flags["job-id"]!));
  });
}

export async function runP6Vertical(): Promise<void> {
  await withP6(async (ctx) => {
    printJson(await runP6MockVertical(ctx));
  });
}

export async function runP6MockVertical(ctx: {
  orchestration: OrchestrationService;
  analytics: AnalyticsImportService;
  governance: LearningGovernanceService;
  strategy: StrategyWithFeedbackService;
  lifecycle: ContentLifecycleService;
  lifecycleRepo: LifecycleRepository;
  p5: P5Repository;
  p6: P6Repository;
}): Promise<Record<string, unknown>> {
  const { orchestration, analytics, governance, strategy, lifecycle, lifecycleRepo, p5, p6 } = ctx;

  // 1) Partial daily ops stopping for human approval
  const partial = await orchestration.runCycle({
    cycleType: "daily_ops",
    idempotencyKey: `p6-vertical-${Date.now()}`,
    payload: {
      stopForHumanApproval: true,
      humanApproved: false,
      productTitle: "Sample Catalog Item P6",
      productUrl: "https://example.invalid/fanza/p6-vertical",
      externalProductId: `p6-v-${Date.now()}`,
    },
  });
  if (partial.status !== "MANUAL_REVIEW_REQUIRED") {
    throw new Error(`Expected MANUAL_REVIEW_REQUIRED, got ${partial.status}`);
  }

  // 2) Resume after human approval
  const database = createDatabaseClient();
  await database.connect();
  try {
    await database.prisma.operationJob.update({
      where: { id: partial.id },
      data: {
        status: "PENDING",
        payload: {
          ...((partial.payload as Record<string, unknown>) ?? {}),
          humanApproved: true,
          activateLearning: false,
        },
      },
    });
  } finally {
    await database.disconnect();
  }

  const completed = await orchestration.resumeJob(partial.id);
  if (completed.status !== "COMPLETED") {
    throw new Error(`Expected COMPLETED after resume, got ${completed.status}: ${completed.error}`);
  }

  const refs = (completed.result as { refs?: Record<string, string> } | null)?.refs ?? {};
  const contentId = refs.contentId;
  const contentVersionId = refs.contentVersionId;
  const externalId = refs.externalId;
  if (!contentId || !contentVersionId || !externalId) {
    throw new Error("Missing refs from completed job");
  }

  const original = await lifecycleRepo.findContentVersion(contentVersionId);
  const originalBody = original?.body;

  // 3) Dedicated CSV import + match path (idempotent re-import)
  const csv = [
    "externalId,platform,measuredAt,impressions,views,clicks,likes,external_click,read_time",
    `${externalId},BLOGGER,2026-07-31T01:00:00.000Z,2000,1100,80,25,55,120`,
  ].join("\n");
  const imported = await analytics.importContent({
    format: "csv",
    content: csv,
    platform: "BLOGGER",
    fileName: `p6-vertical-${externalId}.csv`,
  });
  const reimport = await analytics.importContent({
    format: "csv",
    content: csv,
    platform: "BLOGGER",
    fileName: `p6-vertical-${externalId}.csv`,
  });
  if (!reimport.duplicateFile) throw new Error("Expected duplicate file protection");

  const aggregate = await orchestration.learning.aggregateAnalytics({
    contentId,
    platform: "BLOGGER",
    contentVersionId,
    publicationTargetId: refs.publicationTargetId,
  });
  const evaluation = await orchestration.learning.evaluateContent({
    contentId,
    contentVersionId,
    analyticsAggregateId: aggregate.id,
    platform: "BLOGGER",
    useLlm: false,
  });

  const rules = await orchestration.learning.generateLearning({
    evaluationIds: [evaluation.id],
    activate: false,
  });
  const rule = rules[0]!;
  await enrichProposedRule(p6, rule.id, {
    platform: "BLOGGER",
    contentType: "article",
    minimumSampleCount: 1,
    minimumConfidence: 0.3,
    minimumSuccessRate: 0.3,
  });

  // Threshold / approval gates
  let blockedWithoutApproval = false;
  try {
    await governance.activate(rule.id, "operator");
  } catch {
    blockedWithoutApproval = true;
  }
  if (!blockedWithoutApproval) throw new Error("ACTIVE without approval should fail");

  await governance.approve(rule.id, "operator");
  const active = await governance.activate(rule.id, "operator");
  if (active.status !== "ACTIVE") throw new Error("Expected ACTIVE");

  await governance.detectConflicts();

  const generated = await strategy.generate({
    topicCandidateId: refs.topicId!,
    platform: "BLOGGER",
    contentType: "article",
    evaluationIds: [evaluation.id],
  });
  const applications = await p6.listApplicationsForStrategy(generated.strategy.id);
  if (applications.length < 1) throw new Error("Expected LearningRuleApplication rows");

  const still = await lifecycleRepo.findContentVersion(contentVersionId);
  void lifecycle;
  void p5;
  void imported;

  return {
    operationJobId: completed.id,
    resumedFrom: partial.id,
    importBatchId: imported.batch.id,
    duplicateReimport: reimport.duplicateFile,
    aggregateId: aggregate.id,
    evaluationId: evaluation.id,
    learningRuleId: active.id,
    learningRuleStatus: active.status,
    blockedWithoutApproval,
    nextStrategyId: generated.strategy.id,
    appliedRuleCount: applications.length,
    originalBodyUnchanged: still?.body === originalBody,
    contentId,
  };
}
