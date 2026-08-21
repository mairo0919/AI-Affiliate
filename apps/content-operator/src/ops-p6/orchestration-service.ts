import type {
  LifecycleRepository,
  P5Repository,
  P6Repository,
} from "@ai-affiliate/database";
import type { LLMProvider } from "../adapters/types.js";
import { BudgetBlockedError } from "../generation/budget-guard.js";
import { ContentLifecycleService } from "../lifecycle/lifecycle-service.js";
import { OpsService } from "../ops/ops-service.js";
import { P5LearningService } from "../learning/p5-service.js";
import { AnalyticsImportService } from "./analytics-import-service.js";
import { LearningGovernanceService, enrichProposedRule } from "./learning-governance.js";
import { StrategyWithFeedbackService } from "./strategy-with-feedback.js";

export type RetryClass = "retryable" | "non_retryable";

export function classifyError(error: unknown): { retryable: boolean; errorClass: string } {
  if (error instanceof BudgetBlockedError || (error as { code?: string })?.code === "BUDGET_BLOCKED") {
    return { retryable: false, errorClass: "BUDGET_BLOCKED" };
  }
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    /timeout|econnreset|econnrefused|rate.?limit|lock conflict|temporar|deadlock|503|429/.test(
      lower,
    )
  ) {
    return { retryable: true, errorClass: "retryable" };
  }
  if (
    /invalid config|auth|schema|policy block|unsupported claim|missing approval|malformed|forbidden|cannot approve|conflict/i.test(
      message,
    )
  ) {
    return { retryable: false, errorClass: "non_retryable" };
  }
  return { retryable: false, errorClass: "non_retryable" };
}

const DAILY_STEPS = [
  "research",
  "topic",
  "strategy",
  "claim",
  "generate_blogger",
  "review",
  "await_human_approval",
  "blogger_draft",
  "x_export",
  "analytics_import",
  "aggregate",
  "evaluation",
  "learning_propose",
  "strategy_feedback",
] as const;

export class OrchestrationService {
  readonly analytics: AnalyticsImportService;
  readonly governance: LearningGovernanceService;
  readonly strategyFeedback: StrategyWithFeedbackService;
  readonly learning: P5LearningService;

  constructor(
    private readonly lifecycleRepo: LifecycleRepository,
    private readonly p5: P5Repository,
    private readonly p6: P6Repository,
    private readonly lifecycle: ContentLifecycleService,
    private readonly ops: OpsService,
    llm: LLMProvider,
  ) {
    this.analytics = new AnalyticsImportService(lifecycleRepo, p6);
    this.governance = new LearningGovernanceService(p5, p6);
    this.strategyFeedback = new StrategyWithFeedbackService(lifecycleRepo, p5, p6, llm);
    this.learning = new P5LearningService(lifecycleRepo, p5, llm);
  }

  async runCycle(input: {
    cycleType: string;
    idempotencyKey: string;
    payload?: Record<string, unknown>;
    resumeJobId?: string;
  }) {
    if (input.resumeJobId) {
      return this.resumeJob(input.resumeJobId);
    }

    const existing = await this.p6.findOperationJobByIdempotency(input.idempotencyKey);
    if (existing && ["COMPLETED", "MANUAL_REVIEW_REQUIRED"].includes(existing.status)) {
      return existing;
    }
    if (existing && existing.status === "FAILED" && existing.retryable) {
      return this.resumeJob(existing.id);
    }

    const job =
      existing ??
      (await this.p6.createOperationJob({
        cycleType: input.cycleType,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload ?? {},
      }));

    return this.executeJob(job.id);
  }

  async resumeJob(jobId: string) {
    const job = await this.p6.findOperationJob(jobId);
    if (!job) throw new Error(`OperationJob not found: ${jobId}`);
    if (job.status === "COMPLETED") return job;
    return this.executeJob(jobId);
  }

  async jobStatus(jobId: string) {
    return this.p6.findOperationJob(jobId);
  }

  private async executeJob(jobId: string) {
    let job = await this.p6.findOperationJob(jobId);
    if (!job) throw new Error(`OperationJob not found: ${jobId}`);

    await this.p6.updateOperationJob(jobId, {
      status: "RUNNING",
      startedAt: job.startedAt ?? new Date(),
      attempts: job.attempts + 1,
    });

    const done = new Set(
      (job.checkpoints ?? [])
        .filter((c) => c.status === "COMPLETED")
        .map((c) => c.stepKey),
    );
    const refs: Record<string, string> = {};
    for (const c of job.checkpoints ?? []) {
      const r = c.reusableRefs as Record<string, string> | null;
      if (r) Object.assign(refs, r);
    }

    try {
      if (job.cycleType === "daily_ops" || job.cycleType === "full_pipeline") {
        await this.runDailyOps(jobId, done, refs, (job.payload as Record<string, unknown>) ?? {});
      } else if (job.cycleType === "analytics_import") {
        await this.runAnalyticsOnly(jobId, done, refs, (job.payload as Record<string, unknown>) ?? {});
      } else if (job.cycleType === "evaluation") {
        await this.runEvaluationOnly(jobId, done, refs, (job.payload as Record<string, unknown>) ?? {});
      } else if (job.cycleType === "learning") {
        await this.runLearningOnly(jobId, done, refs, (job.payload as Record<string, unknown>) ?? {});
      } else {
        throw Object.assign(new Error(`Unknown cycleType: ${job.cycleType}`), {
          nonRetryable: true,
        });
      }

      job = (await this.p6.findOperationJob(jobId))!;
      if (job.status === "MANUAL_REVIEW_REQUIRED") return job;

      return this.p6.updateOperationJob(jobId, {
        status: "COMPLETED",
        completedAt: new Date(),
        result: { refs },
        error: null,
        errorClass: null,
        retryable: false,
      });
    } catch (error) {
      if ((error as { manualReview?: boolean }).manualReview) {
        return (await this.p6.findOperationJob(jobId))!;
      }
      const classified = classifyError(error);
      await this.p6.createAuditEvent({
        eventType: "operation.job",
        actor: "system",
        targetType: "OperationJob",
        targetId: jobId,
        action: "failed",
        summary: error instanceof Error ? error.message : "job failed",
        details: { retryable: classified.retryable, errorClass: classified.errorClass },
        relatedJobId: jobId,
      });
      return this.p6.updateOperationJob(jobId, {
        status: "FAILED",
        error: error instanceof Error ? error.message : String(error),
        errorClass: classified.errorClass,
        retryable: classified.retryable,
        completedAt: classified.retryable ? null : new Date(),
      });
    }
  }

  private async checkpoint(
    jobId: string,
    stepKey: string,
    refs: Record<string, string>,
    output?: Record<string, unknown>,
  ) {
    await this.p6.upsertCheckpoint({
      operationJobId: jobId,
      stepKey,
      status: "COMPLETED",
      reusableRefs: refs,
      output: output ?? null,
    });
  }

  private async runDailyOps(
    jobId: string,
    done: Set<string>,
    refs: Record<string, string>,
    payload: Record<string, unknown>,
  ) {
    const stopForApproval = payload.stopForHumanApproval !== false;

    if (!done.has("research") || !done.has("topic")) {
      const product = refs.productId
        ? { id: refs.productId, title: String(payload.productTitle ?? "Sample Catalog Item P6") }
        : await this.ops.registerManualProduct({
            providerKey: "fanza",
            externalProductId: String(payload.externalProductId ?? `p6-${jobId.slice(-6)}`),
            title: String(payload.productTitle ?? "Sample Catalog Item P6"),
            url: String(payload.productUrl ?? "https://example.invalid/fanza/p6-1"),
          });
      refs.productId = product.id;
      const topic = refs.topicId
        ? { id: refs.topicId }
        : await this.lifecycle.createTopicFromProduct(product.id);
      refs.topicId = topic.id;
      await this.checkpoint(jobId, "research", refs, { productId: product.id });
      await this.checkpoint(jobId, "topic", refs, { topicId: topic.id });
      done.add("research");
      done.add("topic");
    }

    if (!done.has("strategy")) {
      const strategy = refs.strategyId
        ? { id: refs.strategyId }
        : await this.lifecycle.createRuleBasedStrategy(refs.topicId!);
      refs.strategyId = strategy.id;
      await this.checkpoint(jobId, "strategy", refs);
      done.add("strategy");
    }

    if (!done.has("claim")) {
      if (!refs.claimId) {
        const research = await this.ops.registerPublicUrlResearch({
          url: "https://example.invalid/notes/p6-claim",
          summary: "Sample Catalog Item P6 is listed as available.",
          claimStatement: "Sample Catalog Item P6 is listed as available in a public catalog.",
          strategyId: refs.strategyId!,
        });
        refs.claimId = research.claim.id;
      }
      await this.checkpoint(jobId, "claim", refs);
      done.add("claim");
    }

    if (!done.has("generate_blogger")) {
      if (!refs.contentId) {
        const blogger = await this.ops.generateChannelContent({
          topicId: refs.topicId!,
          strategyId: refs.strategyId!,
          channel: "BLOGGER",
          productTitle: String(payload.productTitle ?? "Sample Catalog Item P6"),
          productUrl: String(payload.productUrl ?? "https://example.invalid/fanza/p6-1"),
          claimId: refs.claimId,
        });
        refs.contentId = blogger.content.id;
        refs.contentVersionId = blogger.version.id;
      }
      await this.checkpoint(jobId, "generate_blogger", refs);
      done.add("generate_blogger");
    }

    if (!done.has("review")) {
      if (refs.contentVersionId) {
        await this.lifecycle.runMockReview(refs.contentVersionId);
      }
      await this.checkpoint(jobId, "review", refs);
      done.add("review");
    }

    if (!done.has("await_human_approval")) {
      if (stopForApproval && payload.humanApproved !== true) {
        await this.p6.upsertCheckpoint({
          operationJobId: jobId,
          stepKey: "await_human_approval",
          status: "MANUAL_REVIEW_REQUIRED",
          reusableRefs: refs,
          output: { waitingFor: "human_publication_approval" },
        });
        await this.p6.updateOperationJob(jobId, {
          status: "MANUAL_REVIEW_REQUIRED",
          result: { refs, waitingFor: "human_publication_approval" },
        });
        await this.p6.createAuditEvent({
          eventType: "operation.job",
          actor: "system",
          targetType: "OperationJob",
          targetId: jobId,
          action: "manual_review_required",
          summary: "Stopped before publication for human approval",
          relatedJobId: jobId,
        });
        const err = new Error("Human approval required before publication steps");
        (err as { manualReview?: boolean }).manualReview = true;
        throw err;
      }
      await this.checkpoint(jobId, "await_human_approval", refs, { approved: true });
      done.add("await_human_approval");
    }

    if (!done.has("blogger_draft")) {
      if (!refs.publicationTargetId) {
        const target = await this.lifecycle.createPublicationTarget({
          contentId: refs.contentId!,
          contentVersionId: refs.contentVersionId!,
          platform: "BLOGGER",
          approvalMode: "DRAFT_ONLY",
        });
        await this.lifecycle.approvePublicationTarget(target.id);
        const drafted = await this.ops.mockDraft(target.id);
        refs.publicationTargetId = drafted.id;
        refs.externalId = drafted.publishedExternalId ?? `mock-blogger-draft-${drafted.id.slice(-4)}`;
      }
      await this.checkpoint(jobId, "blogger_draft", refs);
      done.add("blogger_draft");
    }

    if (!done.has("x_export")) {
      if (!refs.xContentId) {
        const x = await this.ops.generateChannelContent({
          topicId: refs.topicId!,
          strategyId: refs.strategyId!,
          channel: "X",
          productTitle: String(payload.productTitle ?? "Sample Catalog Item P6"),
          productUrl: String(payload.productUrl ?? "https://example.invalid/fanza/p6-1"),
          claimId: refs.claimId,
        });
        refs.xContentId = x.content.id;
        refs.xVersionId = x.version.id;
        await this.ops.exportX(x.version.id);
      }
      await this.checkpoint(jobId, "x_export", refs);
      done.add("x_export");
    }

    if (!done.has("analytics_import")) {
      const csv =
        typeof payload.analyticsCsv === "string"
          ? payload.analyticsCsv
          : [
              "externalId,platform,measuredAt,impressions,views,clicks,likes,external_click",
              `${refs.externalId},BLOGGER,2026-07-30T12:00:00.000Z,1500,900,60,20,45`,
            ].join("\n");
      const imported = await this.analytics.importContent({
        format: "csv",
        content: csv,
        platform: "BLOGGER",
        fileName: `ops-${jobId}.csv`,
      });
      refs.importBatchId = imported.batch.id;

      // If auto-attribution missed, bind known PublicationTarget from this job (human-equivalent).
      if (refs.contentId && refs.externalId) {
        const unmatched = await this.analytics.listUnmatched();
        for (const row of unmatched) {
          if (row.externalPublicationId === refs.externalId) {
            await this.analytics.matchRow({
              importRowId: row.id,
              contentId: refs.contentId,
              publicationTargetId: refs.publicationTargetId,
              reviewedBy: "orchestration",
            });
          }
        }
      }

      const snaps = refs.contentId
        ? await this.lifecycleRepo.listAnalyticsForContent(refs.contentId)
        : [];
      if (snaps.length === 0 && refs.contentId) {
        await this.ops.ingestManualAnalytics({
          platform: "BLOGGER",
          contentId: refs.contentId,
          publicationTargetId: refs.publicationTargetId,
          metrics: {
            impressions: 1500,
            views: 900,
            clicks: 60,
            likes: 20,
            external_click: 45,
          },
          notes: "orchestration fallback metrics (import unmatched)",
        });
      }

      await this.checkpoint(jobId, "analytics_import", refs, {
        duplicateFile: imported.duplicateFile,
      });
      done.add("analytics_import");
    }

    if (!done.has("aggregate")) {
      const aggregate = await this.learning.aggregateAnalytics({
        contentId: refs.contentId!,
        platform: "BLOGGER",
        contentVersionId: refs.contentVersionId,
        publicationTargetId: refs.publicationTargetId,
      });
      refs.aggregateId = aggregate.id;
      await this.checkpoint(jobId, "aggregate", refs);
      done.add("aggregate");
    }

    if (!done.has("evaluation")) {
      const evaluation = await this.learning.evaluateContent({
        contentId: refs.contentId!,
        contentVersionId: refs.contentVersionId,
        analyticsAggregateId: refs.aggregateId,
        platform: "BLOGGER",
        useLlm: false,
      });
      refs.evaluationId = evaluation.id;
      await this.checkpoint(jobId, "evaluation", refs);
      done.add("evaluation");
    }

    if (!done.has("learning_propose")) {
      const rules = await this.learning.generateLearning({
        evaluationIds: [refs.evaluationId!],
        activate: false,
      });
      const first = rules[0];
      if (first) {
        await enrichProposedRule(this.p6, first.id, {
          platform: "BLOGGER",
          contentType: "article",
          minimumSampleCount: 1,
          minimumConfidence: 0.3,
          minimumSuccessRate: 0.3,
        });
        refs.learningRuleId = first.id;
      }
      await this.checkpoint(jobId, "learning_propose", refs);
      done.add("learning_propose");
    }

    if (!done.has("strategy_feedback")) {
      if (refs.learningRuleId && payload.activateLearning === true) {
        await this.governance.approve(refs.learningRuleId, String(payload.actor ?? "operator"));
        await this.governance.activate(refs.learningRuleId, String(payload.actor ?? "operator"));
        const generated = await this.strategyFeedback.generate({
          topicCandidateId: refs.topicId!,
          platform: "BLOGGER",
          contentType: "article",
          evaluationIds: refs.evaluationId ? [refs.evaluationId] : [],
        });
        refs.nextStrategyId = generated.strategy.id;
      } else {
        const fb = await this.learning.strategyFeedback({
          topicCandidateId: refs.topicId!,
          learningRuleIds: refs.learningRuleId ? [refs.learningRuleId] : [],
          evaluationIds: refs.evaluationId ? [refs.evaluationId] : [],
          createStrategy: false,
        });
        refs.strategyFeedbackId = fb.feedback.id;
      }
      await this.checkpoint(jobId, "strategy_feedback", refs);
      done.add("strategy_feedback");
    }

    void DAILY_STEPS;
  }

  private async runAnalyticsOnly(
    jobId: string,
    done: Set<string>,
    refs: Record<string, string>,
    payload: Record<string, unknown>,
  ) {
    if (done.has("analytics_import")) return;
    const content = String(payload.content ?? "");
    const format = (payload.format as "csv" | "json") ?? "csv";
    const imported = await this.analytics.importContent({
      format,
      content,
      platform: String(payload.platform ?? "BLOGGER"),
      fileName: String(payload.fileName ?? "import"),
    });
    refs.importBatchId = imported.batch.id;
    await this.checkpoint(jobId, "analytics_import", refs);
  }

  private async runEvaluationOnly(
    jobId: string,
    done: Set<string>,
    refs: Record<string, string>,
    payload: Record<string, unknown>,
  ) {
    if (done.has("evaluation")) return;
    const contentId = String(payload.contentId ?? refs.contentId ?? "");
    if (!contentId) throw new Error("contentId required for evaluation cycle");
    const evaluation = await this.learning.evaluateContent({
      contentId,
      platform: String(payload.platform ?? "BLOGGER"),
      useLlm: false,
    });
    refs.evaluationId = evaluation.id;
    await this.checkpoint(jobId, "evaluation", refs);
  }

  private async runLearningOnly(
    jobId: string,
    done: Set<string>,
    refs: Record<string, string>,
    payload: Record<string, unknown>,
  ) {
    if (done.has("learning_propose")) return;
    const evaluationIds = String(payload.evaluationIds ?? refs.evaluationId ?? "")
      .split(",")
      .filter(Boolean);
    const rules = await this.learning.generateLearning({ evaluationIds, activate: false });
    refs.learningRuleId = rules[0]?.id ?? "";
    await this.checkpoint(jobId, "learning_propose", refs);
  }
}
