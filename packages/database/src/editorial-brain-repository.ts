import type { EditorialBrainRun, EditorialExperience, Prisma, PrismaClient } from "@prisma/client";

export type CreateEditorialBrainRunInput = {
  channel: string;
  mode?: string;
  status?: string;
  topicId?: string | null;
  strategyId?: string | null;
  contentId?: string | null;
  contentVersionId?: string | null;
  formatKey?: string | null;
  contentType?: string | null;
  structurePatternId?: string | null;
  editorialPatternId?: string | null;
  claimProfile?: string | null;
  selectedClaimIds?: unknown;
  retrievedExperienceIds?: unknown;
  corePlan?: unknown;
  channelPlan?: unknown;
  generatorModelRunIds?: unknown;
  validatorResults?: unknown;
  reviewResult?: unknown;
  repairAttempts?: unknown;
  brainDecision?: string | null;
  legacyDecision?: string | null;
  finalDecision?: string | null;
  failureCodes?: unknown;
  publishRef?: string | null;
  performanceRef?: string | null;
  errorDetail?: string | null;
  metadata?: unknown;
};

export type CompleteEditorialBrainRunInput = {
  status?: string;
  contentId?: string | null;
  contentVersionId?: string | null;
  generatorModelRunIds?: unknown;
  validatorResults?: unknown;
  reviewResult?: unknown;
  repairAttempts?: unknown;
  brainDecision?: string | null;
  legacyDecision?: string | null;
  finalDecision?: string | null;
  failureCodes?: unknown;
  publishRef?: string | null;
  performanceRef?: string | null;
  errorDetail?: string | null;
  metadata?: unknown;
  corePlan?: unknown;
  channelPlan?: unknown;
  retrievedExperienceIds?: unknown;
  selectedClaimIds?: unknown;
};

export type CreateEditorialExperienceInput = {
  scope: string;
  channel: string;
  formatKey?: string | null;
  contentType?: string | null;
  claimProfile?: string | null;
  structurePatternId?: string | null;
  editorialPatternId?: string | null;
  planSummary?: unknown;
  validatorSummary?: unknown;
  reviewSummary?: unknown;
  failureCodes?: unknown;
  outcome?: string | null;
  sourceType: string;
  confidence?: number;
  sampleEvidence?: number;
  brainRunId?: string | null;
  contentVersionId?: string | null;
  modelRunIds?: unknown;
  performanceRef?: string | null;
  lesson?: unknown;
  metadata?: unknown;
};

export type RetrieveEditorialExperienceQuery = {
  scope?: string | null;
  channel?: string | null;
  formatKey?: string | null;
  contentType?: string | null;
  claimProfile?: string | null;
  structurePatternId?: string | null;
  editorialPatternId?: string | null;
  failureCodes?: string[];
  limit?: number;
};

export class EditorialBrainRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createBrainRun(input: CreateEditorialBrainRunInput): Promise<EditorialBrainRun> {
    return this.prisma.editorialBrainRun.create({
      data: {
        channel: input.channel,
        mode: input.mode ?? "SHADOW",
        status: input.status ?? "RUNNING",
        topicId: input.topicId ?? null,
        strategyId: input.strategyId ?? null,
        contentId: input.contentId ?? null,
        contentVersionId: input.contentVersionId ?? null,
        formatKey: input.formatKey ?? null,
        contentType: input.contentType ?? null,
        structurePatternId: input.structurePatternId ?? null,
        editorialPatternId: input.editorialPatternId ?? null,
        claimProfile: input.claimProfile ?? null,
        selectedClaimIds: (input.selectedClaimIds as Prisma.InputJsonValue) ?? undefined,
        retrievedExperienceIds: (input.retrievedExperienceIds as Prisma.InputJsonValue) ?? undefined,
        corePlan: (input.corePlan as Prisma.InputJsonValue) ?? undefined,
        channelPlan: (input.channelPlan as Prisma.InputJsonValue) ?? undefined,
        generatorModelRunIds: (input.generatorModelRunIds as Prisma.InputJsonValue) ?? undefined,
        validatorResults: (input.validatorResults as Prisma.InputJsonValue) ?? undefined,
        reviewResult: (input.reviewResult as Prisma.InputJsonValue) ?? undefined,
        repairAttempts: (input.repairAttempts as Prisma.InputJsonValue) ?? undefined,
        brainDecision: input.brainDecision ?? null,
        legacyDecision: input.legacyDecision ?? null,
        finalDecision: input.finalDecision ?? null,
        failureCodes: (input.failureCodes as Prisma.InputJsonValue) ?? undefined,
        publishRef: input.publishRef ?? null,
        performanceRef: input.performanceRef ?? null,
        errorDetail: input.errorDetail ?? null,
        metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }

  async completeBrainRun(
    id: string,
    input: CompleteEditorialBrainRunInput,
  ): Promise<EditorialBrainRun> {
    return this.prisma.editorialBrainRun.update({
      where: { id },
      data: {
        status: input.status ?? "COMPLETED",
        contentId: input.contentId === undefined ? undefined : input.contentId,
        contentVersionId:
          input.contentVersionId === undefined ? undefined : input.contentVersionId,
        generatorModelRunIds:
          input.generatorModelRunIds === undefined
            ? undefined
            : (input.generatorModelRunIds as Prisma.InputJsonValue),
        validatorResults:
          input.validatorResults === undefined
            ? undefined
            : (input.validatorResults as Prisma.InputJsonValue),
        reviewResult:
          input.reviewResult === undefined
            ? undefined
            : (input.reviewResult as Prisma.InputJsonValue),
        repairAttempts:
          input.repairAttempts === undefined
            ? undefined
            : (input.repairAttempts as Prisma.InputJsonValue),
        brainDecision: input.brainDecision === undefined ? undefined : input.brainDecision,
        legacyDecision: input.legacyDecision === undefined ? undefined : input.legacyDecision,
        finalDecision: input.finalDecision === undefined ? undefined : input.finalDecision,
        failureCodes:
          input.failureCodes === undefined
            ? undefined
            : (input.failureCodes as Prisma.InputJsonValue),
        publishRef: input.publishRef === undefined ? undefined : input.publishRef,
        performanceRef: input.performanceRef === undefined ? undefined : input.performanceRef,
        errorDetail: input.errorDetail === undefined ? undefined : input.errorDetail,
        metadata:
          input.metadata === undefined ? undefined : (input.metadata as Prisma.InputJsonValue),
        corePlan: input.corePlan === undefined ? undefined : (input.corePlan as Prisma.InputJsonValue),
        channelPlan:
          input.channelPlan === undefined ? undefined : (input.channelPlan as Prisma.InputJsonValue),
        retrievedExperienceIds:
          input.retrievedExperienceIds === undefined
            ? undefined
            : (input.retrievedExperienceIds as Prisma.InputJsonValue),
        selectedClaimIds:
          input.selectedClaimIds === undefined
            ? undefined
            : (input.selectedClaimIds as Prisma.InputJsonValue),
        completedAt: new Date(),
      },
    });
  }

  async findBrainRun(id: string): Promise<EditorialBrainRun | null> {
    return this.prisma.editorialBrainRun.findUnique({ where: { id } });
  }

  async findLatestBrainRunByContentVersion(
    contentVersionId: string,
  ): Promise<EditorialBrainRun | null> {
    return this.prisma.editorialBrainRun.findFirst({
      where: { contentVersionId },
      orderBy: { createdAt: "desc" },
    });
  }

  async listExperiencesByBrainRun(brainRunId: string): Promise<EditorialExperience[]> {
    return this.prisma.editorialExperience.findMany({
      where: { brainRunId },
      orderBy: { createdAt: "asc" },
    });
  }

  async listExperiencesByIds(ids: string[]): Promise<EditorialExperience[]> {
    if (ids.length === 0) return [];
    return this.prisma.editorialExperience.findMany({
      where: { id: { in: ids } },
    });
  }

  async createExperience(input: CreateEditorialExperienceInput): Promise<EditorialExperience> {
    return this.prisma.editorialExperience.create({
      data: {
        scope: input.scope,
        channel: input.channel,
        formatKey: input.formatKey ?? null,
        contentType: input.contentType ?? null,
        claimProfile: input.claimProfile ?? null,
        structurePatternId: input.structurePatternId ?? null,
        editorialPatternId: input.editorialPatternId ?? null,
        planSummary: (input.planSummary as Prisma.InputJsonValue) ?? undefined,
        validatorSummary: (input.validatorSummary as Prisma.InputJsonValue) ?? undefined,
        reviewSummary: (input.reviewSummary as Prisma.InputJsonValue) ?? undefined,
        failureCodes: (input.failureCodes as Prisma.InputJsonValue) ?? undefined,
        outcome: input.outcome ?? null,
        sourceType: input.sourceType,
        confidence: input.confidence ?? 0.3,
        sampleEvidence: input.sampleEvidence ?? 1,
        brainRunId: input.brainRunId ?? null,
        contentVersionId: input.contentVersionId ?? null,
        modelRunIds: (input.modelRunIds as Prisma.InputJsonValue) ?? undefined,
        performanceRef: input.performanceRef ?? null,
        lesson: (input.lesson as Prisma.InputJsonValue) ?? undefined,
        metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }

  async listExperiencesForRetrieval(
    query: RetrieveEditorialExperienceQuery,
  ): Promise<EditorialExperience[]> {
    const limit = Math.max(1, Math.min(80, (query.limit ?? 8) * 4));
    const or: Prisma.EditorialExperienceWhereInput[] = [];
    if (query.scope === "CORE") {
      or.push({ scope: "CORE" });
    } else if (query.channel) {
      or.push({ scope: "CORE" });
      or.push({ scope: "CHANNEL", channel: query.channel });
    } else if (query.scope) {
      or.push({ scope: query.scope });
    }

    const and: Prisma.EditorialExperienceWhereInput[] = [];
    if (or.length) and.push({ OR: or });
    // Soft filters — ranking happens in-app; allow broader recall
    const softOr: Prisma.EditorialExperienceWhereInput[] = [];
    if (query.formatKey) softOr.push({ formatKey: query.formatKey });
    if (query.claimProfile) softOr.push({ claimProfile: query.claimProfile });
    if (query.structurePatternId) softOr.push({ structurePatternId: query.structurePatternId });
    if (softOr.length) and.push({ OR: softOr });

    return this.prisma.editorialExperience.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: [{ createdAt: "desc" }],
      take: limit,
    });
  }
}
