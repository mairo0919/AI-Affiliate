import type {
  Prisma,
  PrismaClient,
  XContentVariant,
  XOptimizationApplication,
  XOptimizationDimension,
  XOptimizationFinding,
  XOptimizationFindingType,
  XOptimizationPriority,
  XOptimizationRecommendation,
  XOptimizationRecommendationStatus,
  XOptimizationRun,
  XStrategyConfidenceLevel,
} from "@prisma/client";

export class XOptimizationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XOptimizationStateError";
  }
}

export class XOptimizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createRun(input: {
    evaluationWindowHours: number;
    parameters: Record<string, unknown>;
    optimizationVersion?: string;
    metricVersion?: string;
  }): Promise<XOptimizationRun> {
    return this.prisma.xOptimizationRun.create({
      data: {
        status: "PENDING",
        evaluationWindowHours: input.evaluationWindowHours,
        parameters: input.parameters as Prisma.InputJsonValue,
        optimizationVersion: input.optimizationVersion ?? "x-optimization-v1",
        metricVersion: input.metricVersion ?? "x-optimization-metrics-v1",
      },
    });
  }

  async startRun(id: string): Promise<XOptimizationRun> {
    return this.prisma.xOptimizationRun.update({
      where: { id },
      data: { status: "RUNNING", startedAt: new Date() },
    });
  }

  async completeRun(
    id: string,
    counts: {
      analyzedPublicationCount: number;
      generatedRecommendationCount: number;
      errorCount: number;
      status?: "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED";
      errorMessage?: string;
    },
  ): Promise<XOptimizationRun> {
    return this.prisma.xOptimizationRun.update({
      where: { id },
      data: {
        status: counts.status ?? (counts.errorCount > 0 ? "PARTIALLY_COMPLETED" : "COMPLETED"),
        completedAt: new Date(),
        analyzedPublicationCount: counts.analyzedPublicationCount,
        generatedRecommendationCount: counts.generatedRecommendationCount,
        errorCount: counts.errorCount,
        errorMessage: counts.errorMessage,
        ...(counts.status === "FAILED" ? { failedAt: new Date() } : {}),
      },
    });
  }

  async findLatestCompletedRun(): Promise<XOptimizationRun | null> {
    return this.prisma.xOptimizationRun.findFirst({
      where: { status: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] }, completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
    });
  }

  async listRuns(limit = 20): Promise<XOptimizationRun[]> {
    return this.prisma.xOptimizationRun.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 100)),
    });
  }

  async findRunById(id: string): Promise<XOptimizationRun | null> {
    return this.prisma.xOptimizationRun.findUnique({ where: { id } });
  }

  async createFinding(input: {
    optimizationRunId: string;
    dimension: XOptimizationDimension;
    segmentKey: string;
    currentVariant: string;
    comparedVariant: string;
    currentSampleCount: number;
    comparedSampleCount: number;
    currentScore: number | null;
    comparedScore: number | null;
    scoreDifference: number | null;
    confidenceLevel: XStrategyConfidenceLevel;
    statisticalResult?: Record<string, unknown> | null;
    supportingMetrics?: Record<string, unknown> | null;
    dataLimitations?: Record<string, unknown> | null;
    findingType: XOptimizationFindingType;
  }): Promise<XOptimizationFinding> {
    return this.prisma.xOptimizationFinding.create({
      data: {
        optimizationRunId: input.optimizationRunId,
        dimension: input.dimension,
        segmentKey: input.segmentKey,
        currentVariant: input.currentVariant,
        comparedVariant: input.comparedVariant,
        currentSampleCount: input.currentSampleCount,
        comparedSampleCount: input.comparedSampleCount,
        currentScore: input.currentScore,
        comparedScore: input.comparedScore,
        scoreDifference: input.scoreDifference,
        confidenceLevel: input.confidenceLevel,
        statisticalResult: (input.statisticalResult ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        supportingMetrics: (input.supportingMetrics ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        dataLimitations: (input.dataLimitations ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        findingType: input.findingType,
      },
    });
  }

  async listFindings(options: {
    optimizationRunId?: string;
    limit?: number;
  }): Promise<XOptimizationFinding[]> {
    return this.prisma.xOptimizationFinding.findMany({
      where: options.optimizationRunId
        ? { optimizationRunId: options.optimizationRunId }
        : {},
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(options.limit ?? 50, 200)),
    });
  }

  async createRecommendation(input: {
    optimizationRunId: string;
    findingId?: string | null;
    dimension: XOptimizationDimension;
    currentValue: string;
    recommendedValue: string;
    rationale: string;
    expectedImpact?: Record<string, unknown> | null;
    confidenceLevel: XStrategyConfidenceLevel;
    requiredSampleSize: number;
    expiresAt: Date;
    priority?: XOptimizationPriority;
    status?: XOptimizationRecommendationStatus;
  }): Promise<XOptimizationRecommendation> {
    return this.prisma.xOptimizationRecommendation.create({
      data: {
        optimizationRunId: input.optimizationRunId,
        findingId: input.findingId ?? null,
        dimension: input.dimension,
        currentValue: input.currentValue,
        recommendedValue: input.recommendedValue,
        rationale: input.rationale,
        expectedImpact: (input.expectedImpact ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        confidenceLevel: input.confidenceLevel,
        requiredSampleSize: input.requiredSampleSize,
        expiresAt: input.expiresAt,
        priority: input.priority ?? "MEDIUM",
        status: input.status ?? "REVIEW_REQUIRED",
      },
    });
  }

  async listRecommendations(options: {
    status?: XOptimizationRecommendationStatus;
    dimension?: XOptimizationDimension;
    limit?: number;
  }): Promise<XOptimizationRecommendation[]> {
    return this.prisma.xOptimizationRecommendation.findMany({
      where: {
        ...(options.status ? { status: options.status } : {}),
        ...(options.dimension ? { dimension: options.dimension } : {}),
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: Math.max(1, Math.min(options.limit ?? 50, 200)),
    });
  }

  async findRecommendationById(id: string): Promise<XOptimizationRecommendation | null> {
    return this.prisma.xOptimizationRecommendation.findUnique({ where: { id } });
  }

  async countActiveRecommendations(): Promise<number> {
    return this.prisma.xOptimizationRecommendation.count({
      where: { status: { in: ["REVIEW_REQUIRED", "APPROVED", "PROPOSED"] } },
    });
  }

  async approveRecommendation(
    id: string,
    reviewer: string,
    comment?: string,
  ): Promise<XOptimizationRecommendation> {
    const row = await this.requireRecommendation(id);
    if (row.status !== "REVIEW_REQUIRED" && row.status !== "PROPOSED") {
      throw new XOptimizationStateError(`cannot approve recommendation in status ${row.status}`);
    }
    return this.prisma.xOptimizationRecommendation.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        rejectedAt: null,
        reviewer,
        reviewComment: comment ?? null,
      },
    });
  }

  async rejectRecommendation(
    id: string,
    reviewer: string,
    comment?: string,
  ): Promise<XOptimizationRecommendation> {
    const row = await this.requireRecommendation(id);
    if (row.status !== "REVIEW_REQUIRED" && row.status !== "PROPOSED") {
      throw new XOptimizationStateError(`cannot reject recommendation in status ${row.status}`);
    }
    return this.prisma.xOptimizationRecommendation.update({
      where: { id },
      data: {
        status: "REJECTED",
        rejectedAt: new Date(),
        reviewer,
        reviewComment: comment ?? null,
      },
    });
  }

  async expireRecommendation(id: string): Promise<XOptimizationRecommendation> {
    return this.prisma.xOptimizationRecommendation.update({
      where: { id },
      data: { status: "EXPIRED" },
    });
  }

  async updateRecommendationPriority(
    id: string,
    priority: XOptimizationPriority,
  ): Promise<XOptimizationRecommendation> {
    await this.requireRecommendation(id);
    return this.prisma.xOptimizationRecommendation.update({
      where: { id },
      data: { priority },
    });
  }

  async expireDueRecommendations(now: Date): Promise<number> {
    const result = await this.prisma.xOptimizationRecommendation.updateMany({
      where: {
        status: { in: ["REVIEW_REQUIRED", "PROPOSED", "APPROVED"] },
        expiresAt: { lt: now },
      },
      data: { status: "EXPIRED" },
    });
    return result.count;
  }

  async markRecommendationApplied(id: string): Promise<XOptimizationRecommendation> {
    return this.prisma.xOptimizationRecommendation.update({
      where: { id },
      data: { status: "APPLIED" },
    });
  }

  async createApplication(input: {
    recommendationId: string;
    sourcePublicationId?: string | null;
    generatedContentId?: string | null;
    targetPublicationId?: string | null;
    experimentId?: string | null;
    appliedValue: string;
    status?: "PREPARED" | "APPLIED" | "EVALUATING" | "COMPLETED" | "CANCELLED" | "FAILED";
    result?: Record<string, unknown> | null;
  }): Promise<XOptimizationApplication> {
    return this.prisma.xOptimizationApplication.create({
      data: {
        recommendationId: input.recommendationId,
        sourcePublicationId: input.sourcePublicationId ?? null,
        generatedContentId: input.generatedContentId ?? null,
        targetPublicationId: input.targetPublicationId ?? null,
        experimentId: input.experimentId ?? null,
        appliedValue: input.appliedValue,
        status: input.status ?? "PREPARED",
        appliedAt: input.status === "APPLIED" || input.status === "EVALUATING" ? new Date() : null,
        result: (input.result ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async updateApplication(
    id: string,
    data: {
      status?: "PREPARED" | "APPLIED" | "EVALUATING" | "COMPLETED" | "CANCELLED" | "FAILED";
      result?: Record<string, unknown> | null;
      targetPublicationId?: string | null;
      experimentId?: string | null;
      generatedContentId?: string | null;
    },
  ): Promise<XOptimizationApplication> {
    return this.prisma.xOptimizationApplication.update({
      where: { id },
      data: {
        status: data.status,
        targetPublicationId: data.targetPublicationId ?? undefined,
        experimentId: data.experimentId ?? undefined,
        generatedContentId: data.generatedContentId ?? undefined,
        result: (data.result ?? undefined) as Prisma.InputJsonValue | undefined,
        completedAt: data.status === "COMPLETED" ? new Date() : undefined,
        appliedAt:
          data.status === "APPLIED" || data.status === "EVALUATING" ? new Date() : undefined,
      },
    });
  }

  async listApplications(options: {
    recommendationId?: string;
    limit?: number;
  }): Promise<XOptimizationApplication[]> {
    return this.prisma.xOptimizationApplication.findMany({
      where: options.recommendationId ? { recommendationId: options.recommendationId } : {},
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(options.limit ?? 50, 200)),
    });
  }

  async findApplicationById(id: string): Promise<XOptimizationApplication | null> {
    return this.prisma.xOptimizationApplication.findUnique({ where: { id } });
  }

  async hasRecentApplication(
    recommendationId: string,
    withinDays: number,
  ): Promise<boolean> {
    const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
    const count = await this.prisma.xOptimizationApplication.count({
      where: {
        recommendationId,
        createdAt: { gte: since },
        status: { in: ["PREPARED", "APPLIED", "EVALUATING", "COMPLETED"] },
      },
    });
    return count > 0;
  }

  async countActiveExperimentsForDimension(dimension: string): Promise<number> {
    return this.prisma.xPublicationExperiment.count({
      where: {
        status: "RUNNING",
        strategyVariants: {
          path: ["optimizationDimension"],
          equals: dimension,
        },
      },
    });
  }

  async upsertContentVariant(input: {
    generatedContentId?: string | null;
    publicationId?: string | null;
    contentAngle?: string | null;
    postFormat?: string | null;
    postingTimeBucket?: string | null;
    weekday?: string | null;
    hashtagSet?: string | null;
    urlPlacement?: string | null;
    disclosurePlacement?: string | null;
    ctaStyle?: string | null;
    informationDensity?: string | null;
    titleWeightedLength?: number | null;
    bodyWeightedLength?: number | null;
    featureSnapshot: Record<string, unknown>;
  }): Promise<XContentVariant> {
    if (input.publicationId) {
      const existing = await this.prisma.xContentVariant.findFirst({
        where: { publicationId: input.publicationId },
      });
      if (existing) {
        return this.prisma.xContentVariant.update({
          where: { id: existing.id },
          data: {
            ...this.variantData(input),
            featureSnapshot: input.featureSnapshot as Prisma.InputJsonValue,
          },
        });
      }
    }
    return this.prisma.xContentVariant.create({
      data: {
        ...this.variantData(input),
        featureSnapshot: input.featureSnapshot as Prisma.InputJsonValue,
      },
    });
  }

  async listVariants(options: {
    publicationId?: string;
    generatedContentId?: string;
    limit?: number;
  }): Promise<XContentVariant[]> {
    return this.prisma.xContentVariant.findMany({
      where: {
        ...(options.publicationId ? { publicationId: options.publicationId } : {}),
        ...(options.generatedContentId
          ? { generatedContentId: options.generatedContentId }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(options.limit ?? 50, 200)),
    });
  }

  async findVariantById(id: string): Promise<XContentVariant | null> {
    return this.prisma.xContentVariant.findUnique({ where: { id } });
  }

  private variantData(input: {
    generatedContentId?: string | null;
    publicationId?: string | null;
    contentAngle?: string | null;
    postFormat?: string | null;
    postingTimeBucket?: string | null;
    weekday?: string | null;
    hashtagSet?: string | null;
    urlPlacement?: string | null;
    disclosurePlacement?: string | null;
    ctaStyle?: string | null;
    informationDensity?: string | null;
    titleWeightedLength?: number | null;
    bodyWeightedLength?: number | null;
  }) {
    return {
      generatedContentId: input.generatedContentId ?? null,
      publicationId: input.publicationId ?? null,
      contentAngle: input.contentAngle ?? null,
      postFormat: input.postFormat ?? null,
      postingTimeBucket: input.postingTimeBucket ?? null,
      weekday: input.weekday ?? null,
      hashtagSet: input.hashtagSet ?? null,
      urlPlacement: input.urlPlacement ?? null,
      disclosurePlacement: input.disclosurePlacement ?? null,
      ctaStyle: input.ctaStyle ?? null,
      informationDensity: input.informationDensity ?? null,
      titleWeightedLength: input.titleWeightedLength ?? null,
      bodyWeightedLength: input.bodyWeightedLength ?? null,
    };
  }

  private async requireRecommendation(id: string): Promise<XOptimizationRecommendation> {
    const row = await this.findRecommendationById(id);
    if (!row) {
      throw new XOptimizationStateError(`recommendation not found: ${id}`);
    }
    return row;
  }
}
