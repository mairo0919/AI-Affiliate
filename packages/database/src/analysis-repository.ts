import type {
  AnalysisRun,
  AnalysisRunStatus,
  AnalysisType,
  ContentCandidate,
  ContentCandidateType,
  ContentTargetChannel,
  EligibilityStatus,
  Prisma,
  PrismaClient,
  ProductAnalysis,
} from "@prisma/client";

export interface CreateAnalysisRunInput {
  analysisType: AnalysisType;
  parameters: Record<string, unknown>;
  scoringVersion?: string;
  eligibilityVersion?: string;
  selectionVersion?: string;
}

export interface SaveProductAnalysisInput {
  analysisRunId: string;
  researchItemId: string;
  totalScore: number;
  popularityScore: number | null;
  trendScore: number | null;
  reviewScore: number | null;
  priceScore: number | null;
  freshnessScore: number | null;
  dataQualityScore: number;
  eligibilityStatus: EligibilityStatus;
  exclusionReasons: string[];
  scoreBreakdown: Record<string, unknown>;
  analyzedAt: Date;
}

export interface CreateContentCandidateInput {
  analysisRunId: string;
  researchItemId: string;
  productAnalysisId: string;
  candidateType: ContentCandidateType;
  rank: number;
  selectionScore: number;
  selectionReasons: string[];
  targetChannel?: ContentTargetChannel;
  status?: "SELECTED" | "HELD" | "REJECTED";
}

export class AnalysisRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createAnalysisRun(input: CreateAnalysisRunInput): Promise<AnalysisRun> {
    return this.prisma.analysisRun.create({
      data: {
        analysisType: input.analysisType,
        status: "PENDING",
        parameters: input.parameters as Prisma.InputJsonValue,
        scoringVersion: input.scoringVersion ?? "scoring-v1",
        eligibilityVersion: input.eligibilityVersion ?? "eligibility-v1",
        selectionVersion: input.selectionVersion ?? "selection-v1",
      },
    });
  }

  async startAnalysisRun(id: string): Promise<AnalysisRun> {
    return this.prisma.analysisRun.update({
      where: { id },
      data: { status: "RUNNING", startedAt: new Date() },
    });
  }

  async completeAnalysisRun(
    id: string,
    counts: {
      analyzedItemCount: number;
      selectedItemCount: number;
      errorCount: number;
    },
  ): Promise<AnalysisRun> {
    return this.prisma.analysisRun.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        ...counts,
      },
    });
  }

  async partiallyCompleteAnalysisRun(
    id: string,
    counts: {
      analyzedItemCount: number;
      selectedItemCount: number;
      errorCount: number;
      errorMessage?: string;
    },
  ): Promise<AnalysisRun> {
    return this.prisma.analysisRun.update({
      where: { id },
      data: {
        status: "PARTIALLY_COMPLETED",
        completedAt: new Date(),
        analyzedItemCount: counts.analyzedItemCount,
        selectedItemCount: counts.selectedItemCount,
        errorCount: counts.errorCount,
        errorMessage: counts.errorMessage,
      },
    });
  }

  async failAnalysisRun(id: string, errorMessage: string): Promise<AnalysisRun> {
    return this.prisma.analysisRun.update({
      where: { id },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        completedAt: new Date(),
        errorMessage,
      },
    });
  }

  async saveProductAnalysis(input: SaveProductAnalysisInput): Promise<ProductAnalysis> {
    return this.prisma.productAnalysis.create({
      data: {
        analysisRunId: input.analysisRunId,
        researchItemId: input.researchItemId,
        totalScore: input.totalScore,
        popularityScore: input.popularityScore,
        trendScore: input.trendScore,
        reviewScore: input.reviewScore,
        priceScore: input.priceScore,
        freshnessScore: input.freshnessScore,
        dataQualityScore: input.dataQualityScore,
        eligibilityStatus: input.eligibilityStatus,
        exclusionReasons: input.exclusionReasons as Prisma.InputJsonValue,
        scoreBreakdown: input.scoreBreakdown as Prisma.InputJsonValue,
        analyzedAt: input.analyzedAt,
      },
    });
  }

  async upsertProductAnalysis(input: SaveProductAnalysisInput): Promise<ProductAnalysis> {
    return this.prisma.productAnalysis.upsert({
      where: {
        analysisRunId_researchItemId: {
          analysisRunId: input.analysisRunId,
          researchItemId: input.researchItemId,
        },
      },
      create: {
        analysisRunId: input.analysisRunId,
        researchItemId: input.researchItemId,
        totalScore: input.totalScore,
        popularityScore: input.popularityScore,
        trendScore: input.trendScore,
        reviewScore: input.reviewScore,
        priceScore: input.priceScore,
        freshnessScore: input.freshnessScore,
        dataQualityScore: input.dataQualityScore,
        eligibilityStatus: input.eligibilityStatus,
        exclusionReasons: input.exclusionReasons as Prisma.InputJsonValue,
        scoreBreakdown: input.scoreBreakdown as Prisma.InputJsonValue,
        analyzedAt: input.analyzedAt,
      },
      update: {
        totalScore: input.totalScore,
        popularityScore: input.popularityScore,
        trendScore: input.trendScore,
        reviewScore: input.reviewScore,
        priceScore: input.priceScore,
        freshnessScore: input.freshnessScore,
        dataQualityScore: input.dataQualityScore,
        eligibilityStatus: input.eligibilityStatus,
        exclusionReasons: input.exclusionReasons as Prisma.InputJsonValue,
        scoreBreakdown: input.scoreBreakdown as Prisma.InputJsonValue,
        analyzedAt: input.analyzedAt,
      },
    });
  }

  async createContentCandidate(input: CreateContentCandidateInput): Promise<ContentCandidate> {
    return this.prisma.contentCandidate.create({
      data: {
        analysisRunId: input.analysisRunId,
        researchItemId: input.researchItemId,
        productAnalysisId: input.productAnalysisId,
        candidateType: input.candidateType,
        rank: input.rank,
        selectionScore: input.selectionScore,
        selectionReasons: input.selectionReasons as Prisma.InputJsonValue,
        targetChannel: input.targetChannel ?? "GENERIC",
        status: input.status ?? "SELECTED",
      },
    });
  }

  async createContentCandidates(inputs: CreateContentCandidateInput[]): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }
    const result = await this.prisma.contentCandidate.createMany({
      data: inputs.map((input) => ({
        analysisRunId: input.analysisRunId,
        researchItemId: input.researchItemId,
        productAnalysisId: input.productAnalysisId,
        candidateType: input.candidateType,
        rank: input.rank,
        selectionScore: input.selectionScore,
        selectionReasons: input.selectionReasons as Prisma.InputJsonValue,
        targetChannel: input.targetChannel ?? "GENERIC",
        status: input.status ?? "SELECTED",
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async listProductAnalyses(
    analysisRunId: string,
    options?: { limit?: number },
  ): Promise<ProductAnalysis[]> {
    return this.prisma.productAnalysis.findMany({
      where: { analysisRunId },
      orderBy: { totalScore: "desc" },
      take: Math.max(1, Math.min(options?.limit ?? 100, 1000)),
    });
  }

  async listContentCandidates(options: {
    analysisRunId?: string;
    candidateType?: ContentCandidateType;
    limit?: number;
  }): Promise<ContentCandidate[]> {
    return this.prisma.contentCandidate.findMany({
      where: {
        ...(options.analysisRunId ? { analysisRunId: options.analysisRunId } : {}),
        ...(options.candidateType ? { candidateType: options.candidateType } : {}),
      },
      orderBy: [{ candidateType: "asc" }, { rank: "asc" }],
      take: Math.max(1, Math.min(options.limit ?? 50, 200)),
    });
  }

  async findLatestAnalysisForItem(researchItemId: string): Promise<ProductAnalysis | null> {
    return this.prisma.productAnalysis.findFirst({
      where: { researchItemId },
      orderBy: { analyzedAt: "desc" },
    });
  }

  async findAnalysisRunById(id: string): Promise<AnalysisRun | null> {
    return this.prisma.analysisRun.findUnique({ where: { id } });
  }

  async listAnalysisRuns(limit = 20): Promise<AnalysisRun[]> {
    return this.prisma.analysisRun.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 100)),
    });
  }

  async findLatestCompletedRun(now: Date = new Date()): Promise<AnalysisRun | null> {
    void now;
    return this.prisma.analysisRun.findFirst({
      where: { status: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] as AnalysisRunStatus[] } },
      orderBy: { completedAt: "desc" },
    });
  }

  async withTransaction<T>(fn: (repo: AnalysisRepository) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const scoped = new AnalysisRepository(tx as unknown as PrismaClient);
      return fn(scoped);
    });
  }
}
