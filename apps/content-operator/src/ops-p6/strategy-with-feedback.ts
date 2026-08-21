import type {
  ContentStrategy,
  LifecycleRepository,
  P5Repository,
  P6Repository,
} from "@ai-affiliate/database";
import type { LLMProvider } from "../adapters/types.js";
import { PromptService } from "../generation/prompt-service.js";
import { BudgetGuard } from "../generation/budget-guard.js";
import { LearningGovernanceService } from "./learning-governance.js";

/**
 * Formal Strategy generation via PromptDefinition strategy.assist + ACTIVE LearningRules.
 * LearningRules never outrank Claim/Policy — they are proposal material only.
 */
export class StrategyWithFeedbackService {
  private readonly prompts: PromptService;
  private readonly budget: BudgetGuard;
  private readonly governance: LearningGovernanceService;

  constructor(
    private readonly lifecycle: LifecycleRepository,
    private readonly p5: P5Repository,
    private readonly p6: P6Repository,
    private readonly llm: LLMProvider,
  ) {
    this.prompts = new PromptService(lifecycle);
    this.budget = new BudgetGuard(lifecycle);
    this.governance = new LearningGovernanceService(p5, p6);
  }

  async generate(input: {
    topicCandidateId: string;
    platform?: string;
    contentType?: string;
    genre?: string;
    provider?: string;
    evaluationIds?: string[];
    experimentIds?: string[];
    budgetConstraints?: Record<string, unknown>;
    publicationConstraints?: Record<string, unknown>;
  }): Promise<{
    strategy: ContentStrategy;
    appliedRuleIds: string[];
    modelRunId: string;
    promptVersion: string;
  }> {
    const topic = await this.lifecycle.findTopicCandidate(input.topicCandidateId);
    if (!topic) throw new Error(`TopicCandidate not found: ${input.topicCandidateId}`);

    await this.budget.assertCanSpend(0.5);

    let prompt;
    try {
      prompt = await this.prompts.getPrompt("strategy.assist", "v1");
    } catch {
      // Fallback seed-less environments: upsert minimal prompt
      prompt = await this.lifecycle.upsertPromptDefinition({
        identifier: "strategy.assist",
        version: "v1",
        taskType: "STRATEGY",
        body: "Assist strategy for topic {{topicTitle}} platform={{platform}}",
        systemInstruction:
          "Return JSON strategy hints. LearningRules are proposals only; never override Claim or Policy constraints.",
        inputTemplate:
          "topic={{topicTitle}}; platform={{platform}}; rules={{activeLearningRules}}; evaluations={{historicalEvaluations}}",
        enabled: true,
        metadata: { p6: true },
      });
    }

    const activeRules = await this.governance.listInjectableRules({
      platform: input.platform ?? "BLOGGER",
      contentType: input.contentType ?? "article",
      genre: input.genre,
      provider: input.provider,
    });

    const historicalEvaluations = [];
    for (const id of input.evaluationIds ?? []) {
      const e = await this.p5.findEvaluation(id);
      if (e) {
        historicalEvaluations.push({
          id: e.id,
          overallScore: e.overallScore,
          ctrScore: e.ctrScore,
          weaknesses: e.weaknesses,
          recommendations: e.recommendations,
        });
      }
    }

    const structuredInput = {
      currentTopic: { id: topic.id, title: topic.title },
      platform: input.platform ?? "BLOGGER",
      contentType: input.contentType ?? "article",
      genre: input.genre ?? null,
      provider: input.provider ?? null,
      historicalEvaluations,
      activeLearningRules: activeRules.map((r) => ({
        id: r.id,
        ruleType: r.ruleType,
        statement: r.statement,
        confidence: r.confidence,
        sampleCount: r.sampleCount,
        successRate: r.successRate,
        priorityBelowClaimAndPolicy: true,
      })),
      relevantExperiments: input.experimentIds ?? [],
      knownFailures: historicalEvaluations.flatMap((e) =>
        Array.isArray(e.weaknesses) ? e.weaknesses : [],
      ),
      budgetConstraints: input.budgetConstraints ?? {},
      publicationConstraints: {
        autoPublishForbidden: true,
        bloggerDraftOnly: true,
        ...(input.publicationConstraints ?? {}),
      },
    };

    const rendered = this.prompts.render(prompt, {
      topicTitle: topic.title,
      platform: structuredInput.platform,
      activeLearningRules: structuredInput.activeLearningRules,
      historicalEvaluations: structuredInput.historicalEvaluations,
    });

    const modelRun = await this.lifecycle.createModelRun({
      provider: this.llm.providerKey,
      model: "strategy-assist",
      taskType: "STRATEGY",
      promptIdentifier: prompt.identifier,
      promptVersion: prompt.version,
      status: "RUNNING",
      inputRef: topic.id,
      metadata: { structuredInput },
    });

    const llm = await this.llm.executeTask({
      taskType: "STRATEGY",
      promptIdentifier: prompt.identifier,
      promptVersion: prompt.version,
      systemInstruction: rendered.systemInstruction,
      userPrompt: rendered.userPrompt,
      input: structuredInput,
      outputSchema: rendered.outputSchema,
    });

    await this.lifecycle.completeModelRun(modelRun.id, {
      status: "COMPLETED",
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      estimatedCost: llm.estimatedCost,
      actualCost: llm.estimatedCost,
      currency: llm.currency,
      structuredOutputValid: true,
      metadata: { output: llm.output },
    });
    await this.lifecycle.createCostRecord({
      provider: llm.provider,
      serviceOrModel: llm.model,
      operationType: "STRATEGY",
      relatedType: "TopicCandidate",
      relatedId: topic.id,
      modelRunId: modelRun.id,
      estimatedAmount: llm.estimatedCost,
      actualAmount: llm.estimatedCost,
      currency: llm.currency,
    });

    const ruleHints = activeRules
      .slice(0, 3)
      .map((r) => r.statement)
      .join("; ");

    const strategy = await this.lifecycle.createStrategy({
      topicCandidateId: topic.id,
      objective: "Introduce catalog item with compliant affiliate disclosure",
      targetAudience: "Japanese adult catalog browsers",
      userIntent: "compare and understand sample catalog item",
      formatCategory: "ARTICLE",
      formatKey: "blogger-article",
      angle: ruleHints
        ? `neutral catalog overview | learning: ${ruleHints}`.slice(0, 500)
        : "neutral catalog overview",
      primaryChannel: "BLOGGER",
      candidateChannels: ["BLOGGER", "X"],
      affiliateIntent: "soft-cta",
      ctaPolicy: activeRules.some((r) => r.ruleType === "cta" || /CTA/.test(r.statement))
        ? "single-cta-preferred"
        : "disclosure-required",
      requiredClaims: ["catalog-availability"],
      requiredResearch: ["source-document"],
      successMetrics: ["publish-complete", "ctr", "engagement"],
      riskFlags: ["adult-content", "learning-rules-are-proposals-only"],
      status: "READY",
      confidence: 0.85,
      modelRunId: modelRun.id,
    });

    for (const rule of activeRules) {
      await this.p6.createLearningRuleApplication({
        strategyId: strategy.id,
        learningRuleId: rule.id,
        applicationType: "strategy_prompt_injection",
        appliedField: rule.ruleType === "cta" ? "ctaPolicy" : "angle",
        promptVersion: prompt.version,
        modelRunId: modelRun.id,
        applicationReason: `ACTIVE rule in scope for ${structuredInput.platform}/${structuredInput.contentType}`,
      });
    }

    await this.p5.createStrategyFeedback({
      topicCandidateId: topic.id,
      strategyId: strategy.id,
      learningRuleIds: activeRules.map((r) => r.id),
      evaluationIds: input.evaluationIds ?? [],
      experimentIds: input.experimentIds ?? [],
      feedbackPayload: structuredInput,
      modelRunId: modelRun.id,
    });

    await this.p6.createAuditEvent({
      eventType: "strategy.generate",
      actor: "system",
      targetType: "ContentStrategy",
      targetId: strategy.id,
      action: "generate_with_feedback",
      summary: `Injected ${activeRules.length} ACTIVE LearningRules via strategy.assist`,
      details: { promptVersion: prompt.version, ruleIds: activeRules.map((r) => r.id) },
      relatedJobId: modelRun.id,
    });

    return {
      strategy,
      appliedRuleIds: activeRules.map((r) => r.id),
      modelRunId: modelRun.id,
      promptVersion: prompt.version,
    };
  }
}
