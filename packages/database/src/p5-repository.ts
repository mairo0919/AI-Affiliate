import type {
  AnalyticsAggregate,
  Evaluation,
  EvaluationFinding,
  Experiment,
  ExperimentResult,
  ExperimentVariant,
  LearningRule,
  PrismaClient,
  StrategyFeedback,
} from "@prisma/client";
import { Prisma } from "@prisma/client";

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function jsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export interface CreateAnalyticsAggregateInput {
  contentId?: string | null;
  contentVersionId?: string | null;
  publicationTargetId?: string | null;
  platform: string;
  windowStart: Date;
  windowEnd: Date;
  impressions?: number | null;
  views?: number | null;
  clicks?: number | null;
  ctr?: number | null;
  engagement?: number | null;
  likes?: number | null;
  reposts?: number | null;
  comments?: number | null;
  bookmarks?: number | null;
  articleOpens?: number | null;
  readTimeSeconds?: number | null;
  externalClicks?: number | null;
  publicationAgeHours?: number | null;
  sampleSnapshotCount?: number;
  normalizedMetrics: Record<string, number>;
  platformMetrics?: Record<string, unknown> | null;
  sourceSnapshotIds: string[];
  metadata?: Record<string, unknown> | null;
}

export interface CreateEvaluationInput {
  contentId: string;
  contentVersionId?: string | null;
  analyticsAggregateId?: string | null;
  platform?: string | null;
  overallScore: number;
  seoScore: number;
  ctrScore: number;
  contentScore: number;
  engagementScore: number;
  ctaQuality: number;
  headlineQuality: number;
  freshness: number;
  confidence: number;
  evaluationReason: string;
  strengths: unknown[];
  weaknesses: unknown[];
  recommendations: unknown[];
  deterministicPayload?: Record<string, unknown> | null;
  llmPayload?: Record<string, unknown> | null;
  modelRunId?: string | null;
  status?: string;
  findings?: Array<{
    category: string;
    severity: string;
    code: string;
    message: string;
    evidence?: Record<string, unknown> | null;
  }>;
}

export interface CreateExperimentInput {
  contentId: string;
  contentVersionId?: string | null;
  name: string;
  hypothesis: string;
  status?: string;
  platform?: string | null;
  metadata?: Record<string, unknown> | null;
  modelRunId?: string | null;
  variants: Array<{
    label: string;
    variantType: string;
    payload: Record<string, unknown>;
    contentVersionId?: string | null;
    status?: string;
  }>;
}

export interface CreateExperimentResultInput {
  experimentId: string;
  variantId: string;
  evaluationId?: string | null;
  analyticsAggregateId?: string | null;
  metrics: Record<string, number>;
  score?: number | null;
  winner?: boolean;
  notes?: string | null;
  completedAt?: Date | null;
}

export interface CreateLearningRuleInput {
  ruleType: string;
  statement: string;
  confidence: number;
  sampleCount: number;
  successRate?: number | null;
  sourceEvaluationIds: string[];
  sourceExperimentIds?: string[] | null;
  status?: string;
  metadata?: Record<string, unknown> | null;
  modelRunId?: string | null;
  minimumSampleCount?: number;
  minimumConfidence?: number;
  minimumSuccessRate?: number;
  applicablePlatform?: string | null;
  applicableContentType?: string | null;
  applicableGenre?: string | null;
  applicableProvider?: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  supersedesRuleId?: string | null;
}

export interface CreateStrategyFeedbackInput {
  topicCandidateId?: string | null;
  strategyId?: string | null;
  learningRuleIds: string[];
  evaluationIds: string[];
  experimentIds: string[];
  feedbackPayload: Record<string, unknown>;
  modelRunId?: string | null;
}

export class P5Repository {
  constructor(private readonly prisma: PrismaClient) {}

  async createAnalyticsAggregate(input: CreateAnalyticsAggregateInput): Promise<AnalyticsAggregate> {
    return this.prisma.analyticsAggregate.create({
      data: {
        contentId: input.contentId ?? null,
        contentVersionId: input.contentVersionId ?? null,
        publicationTargetId: input.publicationTargetId ?? null,
        platform: input.platform,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        impressions: input.impressions ?? null,
        views: input.views ?? null,
        clicks: input.clicks ?? null,
        ctr: input.ctr ?? null,
        engagement: input.engagement ?? null,
        likes: input.likes ?? null,
        reposts: input.reposts ?? null,
        comments: input.comments ?? null,
        bookmarks: input.bookmarks ?? null,
        articleOpens: input.articleOpens ?? null,
        readTimeSeconds: input.readTimeSeconds ?? null,
        externalClicks: input.externalClicks ?? null,
        publicationAgeHours: input.publicationAgeHours ?? null,
        sampleSnapshotCount: input.sampleSnapshotCount ?? 0,
        normalizedMetrics: toJson(input.normalizedMetrics),
        platformMetrics: jsonOrNull(input.platformMetrics ?? null),
        sourceSnapshotIds: toJson(input.sourceSnapshotIds),
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async findAnalyticsAggregate(id: string): Promise<AnalyticsAggregate | null> {
    return this.prisma.analyticsAggregate.findUnique({ where: { id } });
  }

  async listAnalyticsAggregatesForContent(contentId: string): Promise<AnalyticsAggregate[]> {
    return this.prisma.analyticsAggregate.findMany({
      where: { contentId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createEvaluation(input: CreateEvaluationInput): Promise<Evaluation & { findings: EvaluationFinding[] }> {
    return this.prisma.evaluation.create({
      data: {
        contentId: input.contentId,
        contentVersionId: input.contentVersionId ?? null,
        analyticsAggregateId: input.analyticsAggregateId ?? null,
        platform: input.platform ?? null,
        overallScore: input.overallScore,
        seoScore: input.seoScore,
        ctrScore: input.ctrScore,
        contentScore: input.contentScore,
        engagementScore: input.engagementScore,
        ctaQuality: input.ctaQuality,
        headlineQuality: input.headlineQuality,
        freshness: input.freshness,
        confidence: input.confidence,
        evaluationReason: input.evaluationReason,
        strengths: toJson(input.strengths),
        weaknesses: toJson(input.weaknesses),
        recommendations: toJson(input.recommendations),
        deterministicPayload: jsonOrNull(input.deterministicPayload ?? null),
        llmPayload: jsonOrNull(input.llmPayload ?? null),
        modelRunId: input.modelRunId ?? null,
        status: input.status ?? "COMPLETED",
        findings: input.findings
          ? {
              create: input.findings.map((f) => ({
                category: f.category,
                severity: f.severity,
                code: f.code,
                message: f.message,
                evidence: jsonOrNull(f.evidence ?? null),
              })),
            }
          : undefined,
      },
      include: { findings: true },
    });
  }

  async findEvaluation(id: string): Promise<(Evaluation & { findings: EvaluationFinding[] }) | null> {
    return this.prisma.evaluation.findUnique({
      where: { id },
      include: { findings: true },
    });
  }

  async listEvaluationsForContent(contentId: string): Promise<Evaluation[]> {
    return this.prisma.evaluation.findMany({
      where: { contentId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createExperiment(input: CreateExperimentInput): Promise<
    Experiment & { variants: ExperimentVariant[] }
  > {
    return this.prisma.experiment.create({
      data: {
        contentId: input.contentId,
        contentVersionId: input.contentVersionId ?? null,
        name: input.name,
        hypothesis: input.hypothesis,
        status: input.status ?? "DRAFT",
        platform: input.platform ?? null,
        metadata: jsonOrNull(input.metadata ?? null),
        modelRunId: input.modelRunId ?? null,
        variants: {
          create: input.variants.map((v) => ({
            label: v.label,
            variantType: v.variantType,
            payload: toJson(v.payload),
            contentVersionId: v.contentVersionId ?? null,
            status: v.status ?? "PROPOSED",
          })),
        },
      },
      include: { variants: true },
    });
  }

  async findExperiment(id: string): Promise<
    (Experiment & { variants: ExperimentVariant[]; results: ExperimentResult[] }) | null
  > {
    return this.prisma.experiment.findUnique({
      where: { id },
      include: { variants: true, results: true },
    });
  }

  async updateExperimentStatus(
    id: string,
    status: string,
    extra?: { approvedAt?: Date | null; approvedBy?: string | null },
  ): Promise<Experiment> {
    return this.prisma.experiment.update({
      where: { id },
      data: {
        status,
        approvedAt: extra?.approvedAt,
        approvedBy: extra?.approvedBy,
      },
    });
  }

  async createExperimentResult(input: CreateExperimentResultInput): Promise<ExperimentResult> {
    return this.prisma.experimentResult.create({
      data: {
        experimentId: input.experimentId,
        variantId: input.variantId,
        evaluationId: input.evaluationId ?? null,
        analyticsAggregateId: input.analyticsAggregateId ?? null,
        metrics: toJson(input.metrics),
        score: input.score ?? null,
        winner: input.winner ?? false,
        notes: input.notes ?? null,
        completedAt: input.completedAt ?? new Date(),
      },
    });
  }

  async createLearningRule(input: CreateLearningRuleInput): Promise<LearningRule> {
    return this.prisma.learningRule.create({
      data: {
        ruleType: input.ruleType,
        statement: input.statement,
        confidence: input.confidence,
        sampleCount: input.sampleCount,
        successRate: input.successRate ?? null,
        sourceEvaluationIds: toJson(input.sourceEvaluationIds),
        sourceExperimentIds: jsonOrNull(input.sourceExperimentIds ?? null),
        status: input.status ?? "PROPOSED",
        metadata: jsonOrNull(input.metadata ?? null),
        modelRunId: input.modelRunId ?? null,
        minimumSampleCount: input.minimumSampleCount ?? 1,
        minimumConfidence: input.minimumConfidence ?? 0.5,
        minimumSuccessRate: input.minimumSuccessRate ?? 0.4,
        applicablePlatform: input.applicablePlatform ?? null,
        applicableContentType: input.applicableContentType ?? null,
        applicableGenre: input.applicableGenre ?? null,
        applicableProvider: input.applicableProvider ?? null,
        approvedBy: input.approvedBy ?? null,
        approvedAt: input.approvedAt ?? null,
        supersedesRuleId: input.supersedesRuleId ?? null,
      },
    });
  }

  async listLearningRules(status?: string): Promise<LearningRule[]> {
    return this.prisma.learningRule.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ confidence: "desc" }, { sampleCount: "desc" }],
    });
  }

  async updateLearningRuleStatus(id: string, status: string): Promise<LearningRule> {
    return this.prisma.learningRule.update({
      where: { id },
      data: { status },
    });
  }

  async createStrategyFeedback(input: CreateStrategyFeedbackInput): Promise<StrategyFeedback> {
    return this.prisma.strategyFeedback.create({
      data: {
        topicCandidateId: input.topicCandidateId ?? null,
        strategyId: input.strategyId ?? null,
        learningRuleIds: toJson(input.learningRuleIds),
        evaluationIds: toJson(input.evaluationIds),
        experimentIds: toJson(input.experimentIds),
        feedbackPayload: toJson(input.feedbackPayload),
        modelRunId: input.modelRunId ?? null,
      },
    });
  }

  async listStrategyFeedbackForTopic(topicCandidateId: string): Promise<StrategyFeedback[]> {
    return this.prisma.strategyFeedback.findMany({
      where: { topicCandidateId },
      orderBy: { createdAt: "desc" },
    });
  }
}
