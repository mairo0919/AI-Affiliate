import type {
  AnalyticsAggregate,
  Evaluation,
  Experiment,
  ExperimentVariant,
  LearningRule,
  LifecycleRepository,
  P5Repository,
  StrategyFeedback,
  ContentStrategy,
} from "@ai-affiliate/database";
import type { LLMProvider } from "../adapters/types.js";
import { LLMProviderError } from "../adapters/types.js";
import { BudgetGuard } from "../generation/budget-guard.js";
import { buildAggregateFields } from "./analytics-aggregator.js";
import { evaluateDeterministically } from "./evaluation-engine.js";

export class P5LearningService {
  private readonly budget: BudgetGuard;

  constructor(
    private readonly lifecycleRepo: LifecycleRepository,
    private readonly p5: P5Repository,
    private readonly llm: LLMProvider,
  ) {
    this.budget = new BudgetGuard(lifecycleRepo);
  }

  async aggregateAnalytics(input: {
    contentId: string;
    platform: string;
    contentVersionId?: string | null;
    publicationTargetId?: string | null;
  }): Promise<AnalyticsAggregate> {
    const snapshots = await this.lifecycleRepo.listAnalyticsForContent(input.contentId);
    const filtered = snapshots.filter((s) => s.platform === input.platform);
    if (filtered.length === 0) {
      throw new Error(`No AnalyticsSnapshot for content=${input.contentId} platform=${input.platform}`);
    }

    let publishedAt: Date | null = null;
    if (input.publicationTargetId) {
      const target = await this.lifecycleRepo.findPublicationTarget(input.publicationTargetId);
      publishedAt = target?.publishedAt ?? null;
    }

    const fields = buildAggregateFields(filtered, {
      contentId: input.contentId,
      contentVersionId: input.contentVersionId ?? null,
      publicationTargetId: input.publicationTargetId ?? null,
      platform: input.platform,
      publishedAt,
    });
    return this.p5.createAnalyticsAggregate(fields);
  }

  async evaluateContent(input: {
    contentId: string;
    contentVersionId?: string | null;
    analyticsAggregateId?: string | null;
    platform?: string;
    useLlm?: boolean;
  }): Promise<Evaluation & { findings: unknown[] }> {
    const versionId =
      input.contentVersionId ??
      (await this.lifecycleRepo.findLatestContentVersion(input.contentId))?.id;
    if (!versionId) throw new Error(`No ContentVersion for content ${input.contentId}`);
    const version = await this.lifecycleRepo.findContentVersion(versionId);
    if (!version) throw new Error(`ContentVersion not found: ${versionId}`);

    let aggregate: AnalyticsAggregate | null = null;
    if (input.analyticsAggregateId) {
      aggregate = await this.p5.findAnalyticsAggregate(input.analyticsAggregateId);
    } else {
      const list = await this.p5.listAnalyticsAggregatesForContent(input.contentId);
      aggregate = list[0] ?? null;
    }

    const platform = input.platform ?? aggregate?.platform ?? "BLOGGER";
    const deterministic = evaluateDeterministically({ version, aggregate, platform });

    let llmPayload: Record<string, unknown> | null = null;
    let modelRunId: string | null = null;

    if (input.useLlm) {
      await this.budget.assertCanSpend(0.5);
      const modelRun = await this.lifecycleRepo.createModelRun({
        provider: this.llm.providerKey,
        model: "mock-llm-v1",
        taskType: "EVALUATION",
        promptIdentifier: "evaluation.content",
        promptVersion: "v1",
        status: "RUNNING",
        inputRef: version.id,
      });
      modelRunId = modelRun.id;
      try {
        const llm = await this.llm.executeTask({
          taskType: "EVALUATION",
          promptIdentifier: "evaluation.content",
          promptVersion: "v1",
          input: {
            title: version.title,
            body: version.body.slice(0, 2000),
            deterministic,
            platform,
          },
        });
        await this.lifecycleRepo.completeModelRun(modelRun.id, {
          status: "COMPLETED",
          inputTokens: llm.inputTokens,
          outputTokens: llm.outputTokens,
          estimatedCost: llm.estimatedCost,
          actualCost: llm.actualCost ?? llm.estimatedCost,
          currency: llm.currency,
          structuredOutputValid: true,
          metadata: { output: llm.output },
        });
        await this.lifecycleRepo.createCostRecord({
          provider: llm.provider,
          serviceOrModel: llm.model,
          operationType: "EVALUATION",
          relatedType: "ContentVersion",
          relatedId: version.id,
          modelRunId: modelRun.id,
          estimatedAmount: llm.estimatedCost,
          actualAmount: llm.actualCost ?? llm.estimatedCost,
          currency: llm.currency,
        });
        llmPayload = llm.output;
        // LLM may add recommendations only; scores stay deterministic-led
        if (Array.isArray(llm.output.recommendations)) {
          for (const rec of llm.output.recommendations) {
            if (typeof rec === "string") deterministic.recommendations.push(rec);
          }
        }
      } catch (error) {
        await this.lifecycleRepo.completeModelRun(modelRun.id, {
          status: "FAILED",
          errorType: error instanceof LLMProviderError ? error.errorClass : "unknown",
          errorDetail: error instanceof Error ? error.message : "evaluation llm failed",
        });
        throw error;
      }
    }

    return this.p5.createEvaluation({
      contentId: input.contentId,
      contentVersionId: version.id,
      analyticsAggregateId: aggregate?.id ?? null,
      platform,
      overallScore: deterministic.overallScore,
      seoScore: deterministic.seoScore,
      ctrScore: deterministic.ctrScore,
      contentScore: deterministic.contentScore,
      engagementScore: deterministic.engagementScore,
      ctaQuality: deterministic.ctaQuality,
      headlineQuality: deterministic.headlineQuality,
      freshness: deterministic.freshness,
      confidence: deterministic.confidence,
      evaluationReason: deterministic.evaluationReason,
      strengths: deterministic.strengths,
      weaknesses: deterministic.weaknesses,
      recommendations: deterministic.recommendations,
      deterministicPayload: deterministic.payload,
      llmPayload,
      modelRunId,
      findings: deterministic.findings,
    });
  }

  /**
   * Propose experiment variants. Does NOT mutate ContentVersion / publish.
   * Status starts as AWAITING_APPROVAL (human required).
   */
  async runExperiment(input: {
    contentId: string;
    contentVersionId?: string | null;
    name: string;
    hypothesis: string;
    platform?: string;
    variants: Array<{
      label: string;
      variantType: "title" | "cta" | "lead" | "structure" | string;
      payload: Record<string, unknown>;
    }>;
  }): Promise<Experiment & { variants: ExperimentVariant[] }> {
    await this.budget.assertCanSpend(0.3);
    const modelRun = await this.lifecycleRepo.createModelRun({
      provider: this.llm.providerKey,
      model: "mock-llm-v1",
      taskType: "EXPERIMENT",
      promptIdentifier: "experiment.propose",
      promptVersion: "v1",
      status: "RUNNING",
      inputRef: input.contentId,
    });

    const llm = await this.llm.executeTask({
      taskType: "EXPERIMENT",
      promptIdentifier: "experiment.propose",
      promptVersion: "v1",
      input: {
        name: input.name,
        hypothesis: input.hypothesis,
        variants: input.variants,
      },
    });

    await this.lifecycleRepo.completeModelRun(modelRun.id, {
      status: "COMPLETED",
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      estimatedCost: llm.estimatedCost,
      actualCost: llm.estimatedCost,
      currency: llm.currency,
      structuredOutputValid: true,
      metadata: { output: llm.output, autoPublish: false },
    });
    await this.lifecycleRepo.createCostRecord({
      provider: llm.provider,
      serviceOrModel: llm.model,
      operationType: "EXPERIMENT",
      relatedType: "Content",
      relatedId: input.contentId,
      modelRunId: modelRun.id,
      estimatedAmount: llm.estimatedCost,
      actualAmount: llm.estimatedCost,
      currency: llm.currency,
    });

    return this.p5.createExperiment({
      contentId: input.contentId,
      contentVersionId: input.contentVersionId ?? null,
      name: input.name,
      hypothesis: input.hypothesis,
      status: "AWAITING_APPROVAL",
      platform: input.platform ?? "BLOGGER",
      modelRunId: modelRun.id,
      metadata: { autoPublish: false, llmNotes: llm.output },
      variants: input.variants.map((v) => ({
        label: v.label,
        variantType: v.variantType,
        payload: v.payload,
        status: "PROPOSED",
      })),
    });
  }

  async approveExperiment(experimentId: string, approvedBy: string): Promise<Experiment> {
    const exp = await this.p5.findExperiment(experimentId);
    if (!exp) throw new Error(`Experiment not found: ${experimentId}`);
    if (exp.status !== "AWAITING_APPROVAL" && exp.status !== "DRAFT") {
      throw new Error(`Cannot approve experiment in status ${exp.status}`);
    }
    return this.p5.updateExperimentStatus(experimentId, "APPROVED", {
      approvedAt: new Date(),
      approvedBy,
    });
  }

  /**
   * Record mock/measured results. Never publishes ContentVersion changes.
   */
  async completeExperiment(input: {
    experimentId: string;
    results: Array<{
      variantLabel: string;
      metrics: Record<string, number>;
      score?: number;
      winner?: boolean;
      notes?: string;
      evaluationId?: string;
      analyticsAggregateId?: string;
    }>;
  }): Promise<Experiment> {
    const exp = await this.p5.findExperiment(input.experimentId);
    if (!exp) throw new Error(`Experiment not found: ${input.experimentId}`);
    if (exp.status !== "APPROVED" && exp.status !== "RUNNING") {
      throw new Error(
        `Experiment must be human-approved before completion (got ${exp.status}). Auto-publish is forbidden.`,
      );
    }

    await this.p5.updateExperimentStatus(input.experimentId, "RUNNING");

    for (const result of input.results) {
      const variant = exp.variants.find((v) => v.label === result.variantLabel);
      if (!variant) throw new Error(`Variant label not found: ${result.variantLabel}`);
      await this.p5.createExperimentResult({
        experimentId: exp.id,
        variantId: variant.id,
        evaluationId: result.evaluationId ?? null,
        analyticsAggregateId: result.analyticsAggregateId ?? null,
        metrics: result.metrics,
        score: result.score ?? null,
        winner: result.winner ?? false,
        notes: result.notes ?? null,
      });
    }

    return this.p5.updateExperimentStatus(input.experimentId, "COMPLETED");
  }

  async generateLearning(input: {
    evaluationIds: string[];
    experimentIds?: string[];
    activate?: boolean;
  }): Promise<LearningRule[]> {
    await this.budget.assertCanSpend(0.4);
    const evaluations = [];
    for (const id of input.evaluationIds) {
      const e = await this.p5.findEvaluation(id);
      if (e) evaluations.push(e);
    }
    if (evaluations.length === 0) throw new Error("No evaluations found for learning");

    const experiments = [];
    for (const id of input.experimentIds ?? []) {
      const e = await this.p5.findExperiment(id);
      if (e) experiments.push(e);
    }

    const modelRun = await this.lifecycleRepo.createModelRun({
      provider: this.llm.providerKey,
      model: "mock-llm-v1",
      taskType: "LEARNING",
      promptIdentifier: "learning.generate",
      promptVersion: "v1",
      status: "RUNNING",
      inputRef: evaluations[0]!.id,
    });

    const llm = await this.llm.executeTask({
      taskType: "LEARNING",
      promptIdentifier: "learning.generate",
      promptVersion: "v1",
      input: {
        evaluations: evaluations.map((e) => ({
          id: e.id,
          overallScore: e.overallScore,
          ctrScore: e.ctrScore,
          headlineQuality: e.headlineQuality,
          strengths: e.strengths,
          weaknesses: e.weaknesses,
          recommendations: e.recommendations,
        })),
        experiments: experiments.map((e) => ({
          id: e.id,
          hypothesis: e.hypothesis,
          results: e.results,
          variants: e.variants,
        })),
      },
    });

    await this.lifecycleRepo.completeModelRun(modelRun.id, {
      status: "COMPLETED",
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      estimatedCost: llm.estimatedCost,
      actualCost: llm.estimatedCost,
      currency: llm.currency,
      structuredOutputValid: true,
      metadata: { output: llm.output },
    });
    await this.lifecycleRepo.createCostRecord({
      provider: llm.provider,
      serviceOrModel: llm.model,
      operationType: "LEARNING",
      relatedType: "Evaluation",
      relatedId: evaluations[0]!.id,
      modelRunId: modelRun.id,
      estimatedAmount: llm.estimatedCost,
      actualAmount: llm.estimatedCost,
      currency: llm.currency,
    });

    // Deterministic candidate rules + optional LLM statements (always PROPOSED unless activate)
    const avgCtr =
      evaluations.reduce((s, e) => s + e.ctrScore, 0) / evaluations.length;
    const avgHeadline =
      evaluations.reduce((s, e) => s + e.headlineQuality, 0) / evaluations.length;
    const candidates: Array<{ ruleType: string; statement: string; successRate: number }> = [];

    if (avgHeadline >= 0.75) {
      candidates.push({
        ruleType: "headline",
        statement: "タイトルはおおむね40文字以内が強い傾向",
        successRate: avgHeadline,
      });
    }
    if (avgCtr >= 0.5) {
      candidates.push({
        ruleType: "format",
        statement: "明確なCTAと見出し構造がある記事はCTRが相対的に高い",
        successRate: avgCtr,
      });
    }
    const winner = experiments
      .flatMap((e) => e.results)
      .find((r) => r.winner);
    if (winner) {
      const variant = experiments.flatMap((e) => e.variants).find((v) => v.id === winner.variantId);
      if (variant) {
        candidates.push({
          ruleType: "experiment",
          statement: `Experiment winner variantType=${variant.variantType} label=${variant.label} を次回Strategyで優先検討`,
          successRate: winner.score ?? 0.7,
        });
      }
    }

    if (Array.isArray(llm.output.rules)) {
      for (const rule of llm.output.rules) {
        if (rule && typeof rule === "object" && typeof (rule as { statement?: string }).statement === "string") {
          const r = rule as { ruleType?: string; statement: string; successRate?: number };
          candidates.push({
            ruleType: r.ruleType ?? "llm",
            statement: r.statement,
            successRate: typeof r.successRate === "number" ? r.successRate : 0.5,
          });
        }
      }
    }

    if (candidates.length === 0) {
      candidates.push({
        ruleType: "general",
        statement: "サンプル不足のため暫定: 事実ベースの短い導入と単一CTAを優先する",
        successRate: 0.4,
      });
    }

    const status = input.activate ? "ACTIVE" : "PROPOSED";
    const created: LearningRule[] = [];
    for (const c of candidates) {
      created.push(
        await this.p5.createLearningRule({
          ruleType: c.ruleType,
          statement: c.statement,
          confidence: Math.min(0.95, 0.35 + evaluations.length * 0.1 + (experiments.length > 0 ? 0.1 : 0)),
          sampleCount: evaluations.length + experiments.length,
          successRate: c.successRate,
          sourceEvaluationIds: evaluations.map((e) => e.id),
          sourceExperimentIds: experiments.map((e) => e.id),
          status,
          modelRunId: modelRun.id,
          metadata: { autoRewriteForbidden: true, legacyActivate: Boolean(input.activate) },
          // P5 activate flag sets scope + synthetic approval for backward-compatible verticals.
          // P6 production path must use LearningGovernanceService instead.
          applicablePlatform: input.activate ? "BLOGGER" : null,
          applicableContentType: input.activate ? "article" : null,
          approvedBy: input.activate ? "p5-activate-flag" : null,
          approvedAt: input.activate ? new Date() : null,
          minimumSampleCount: 1,
          minimumConfidence: 0.3,
          minimumSuccessRate: 0.3,
        }),
      );
    }
    return created;
  }

  /**
   * Build strategy feedback payload and optionally create a new strategy.
   * Never mutates existing published ContentVersion bodies.
   */
  async strategyFeedback(input: {
    topicCandidateId: string;
    learningRuleIds?: string[];
    evaluationIds?: string[];
    experimentIds?: string[];
    createStrategy?: boolean;
    createStrategyFn?: (topicId: string, feedback: Record<string, unknown>) => Promise<ContentStrategy>;
  }): Promise<{ feedback: StrategyFeedback; strategy?: ContentStrategy }> {
    const rules =
      input.learningRuleIds && input.learningRuleIds.length > 0
        ? (
            await Promise.all(
              input.learningRuleIds.map(async (id) => {
                const all = await this.p5.listLearningRules();
                return all.find((r) => r.id === id) ?? null;
              }),
            )
          ).filter(Boolean)
        : (await this.p5.listLearningRules("ACTIVE")).concat(
            await this.p5.listLearningRules("PROPOSED"),
          );

    const evaluationIds = input.evaluationIds ?? [];
    const experimentIds = input.experimentIds ?? [];
    const payload = {
      learningRules: rules.map((r) => ({
        id: r!.id,
        ruleType: r!.ruleType,
        statement: r!.statement,
        confidence: r!.confidence,
        sampleCount: r!.sampleCount,
        successRate: r!.successRate,
      })),
      evaluationIds,
      experimentIds,
      instruction:
        "Use these rules only for next Strategy generation. Do not rewrite published ContentVersion bodies.",
    };

    await this.budget.assertCanSpend(0.2);
    const modelRun = await this.lifecycleRepo.createModelRun({
      provider: this.llm.providerKey,
      model: "mock-llm-v1",
      taskType: "STRATEGY_FEEDBACK",
      promptIdentifier: "strategy.feedback",
      promptVersion: "v1",
      status: "RUNNING",
      inputRef: input.topicCandidateId,
    });

    const llm = await this.llm.executeTask({
      taskType: "STRATEGY_FEEDBACK",
      promptIdentifier: "strategy.feedback",
      promptVersion: "v1",
      input: payload,
    });

    await this.lifecycleRepo.completeModelRun(modelRun.id, {
      status: "COMPLETED",
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      estimatedCost: llm.estimatedCost,
      actualCost: llm.estimatedCost,
      currency: llm.currency,
      structuredOutputValid: true,
      metadata: { output: llm.output, feedback: payload },
    });
    await this.lifecycleRepo.createCostRecord({
      provider: llm.provider,
      serviceOrModel: llm.model,
      operationType: "STRATEGY_FEEDBACK",
      relatedType: "TopicCandidate",
      relatedId: input.topicCandidateId,
      modelRunId: modelRun.id,
      estimatedAmount: llm.estimatedCost,
      actualAmount: llm.estimatedCost,
      currency: llm.currency,
    });

    let strategy: ContentStrategy | undefined;
    if (input.createStrategy && input.createStrategyFn) {
      strategy = await input.createStrategyFn(input.topicCandidateId, {
        ...payload,
        llmAssist: llm.output,
      });
    }

    const feedback = await this.p5.createStrategyFeedback({
      topicCandidateId: input.topicCandidateId,
      strategyId: strategy?.id ?? null,
      learningRuleIds: rules.map((r) => r!.id),
      evaluationIds,
      experimentIds,
      feedbackPayload: { ...payload, llmAssist: llm.output },
      modelRunId: modelRun.id,
    });

    return { feedback, strategy };
  }
}
