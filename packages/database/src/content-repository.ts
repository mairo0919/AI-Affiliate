import type {
  ContentGenerationRun,
  ContentGenerationRunStatus,
  ContentReview,
  ContentReviewDecision,
  ContentTargetChannel,
  ContentValidationIssueType,
  ContentValidationSeverity,
  GeneratedContent,
  GeneratedContentStatus,
  GeneratedContentType,
  Prisma,
  PrismaClient,
} from "@prisma/client";

export class ContentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentStateError";
  }
}

export interface CreateGenerationRunInput {
  providerName: string;
  modelName: string;
  parameters: Record<string, unknown>;
  promptVersion: string;
  candidateCount?: number;
}

export interface CreateGeneratedContentInput {
  generationRunId?: string | null;
  contentCandidateId: string;
  researchItemId: string;
  contentType: GeneratedContentType;
  targetChannel?: ContentTargetChannel;
  status: GeneratedContentStatus;
  title: string;
  body: string;
  summary?: string | null;
  hashtags: string[];
  callToAction?: string | null;
  affiliateUrl: string;
  imageId?: string | null;
  promptVersion: string;
  generationProvider: string;
  generationModel: string;
  inputSnapshot: Record<string, unknown>;
  validationResult?: Record<string, unknown> | null;
  contentHash: string;
  version: number;
  parentContentId?: string | null;
  generatedAt: Date;
}

export interface ValidationIssueInput {
  issueType: ContentValidationIssueType;
  severity: ContentValidationSeverity;
  fieldName?: string | null;
  message: string;
  detectedValue?: string | null;
}

const APPROVABLE: GeneratedContentStatus[] = ["REVIEW_REQUIRED"];
const READYABLE: GeneratedContentStatus[] = ["APPROVED"];
const REJECTABLE: GeneratedContentStatus[] = ["REVIEW_REQUIRED", "VALIDATION_FAILED"];
const CHANGE_REQUESTABLE: GeneratedContentStatus[] = ["REVIEW_REQUIRED"];
const ARCHIVABLE: GeneratedContentStatus[] = [
  "DRAFT",
  "VALIDATION_FAILED",
  "REVIEW_REQUIRED",
  "APPROVED",
  "REJECTED",
  "READY_TO_PUBLISH",
];

export class ContentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createGenerationRun(input: CreateGenerationRunInput): Promise<ContentGenerationRun> {
    return this.prisma.contentGenerationRun.create({
      data: {
        status: "PENDING",
        providerName: input.providerName,
        modelName: input.modelName,
        parameters: input.parameters as Prisma.InputJsonValue,
        promptVersion: input.promptVersion,
        candidateCount: input.candidateCount ?? 0,
      },
    });
  }

  async startGenerationRun(id: string): Promise<ContentGenerationRun> {
    return this.prisma.contentGenerationRun.update({
      where: { id },
      data: { status: "RUNNING", startedAt: new Date() },
    });
  }

  async completeGenerationRun(
    id: string,
    counts: {
      candidateCount: number;
      generatedCount: number;
      skippedCount: number;
      errorCount: number;
    },
  ): Promise<ContentGenerationRun> {
    return this.prisma.contentGenerationRun.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        ...counts,
      },
    });
  }

  async partiallyCompleteGenerationRun(
    id: string,
    counts: {
      candidateCount: number;
      generatedCount: number;
      skippedCount: number;
      errorCount: number;
      errorMessage?: string;
    },
  ): Promise<ContentGenerationRun> {
    return this.prisma.contentGenerationRun.update({
      where: { id },
      data: {
        status: "PARTIALLY_COMPLETED",
        completedAt: new Date(),
        candidateCount: counts.candidateCount,
        generatedCount: counts.generatedCount,
        skippedCount: counts.skippedCount,
        errorCount: counts.errorCount,
        errorMessage: counts.errorMessage,
      },
    });
  }

  async failGenerationRun(id: string, errorMessage: string): Promise<ContentGenerationRun> {
    return this.prisma.contentGenerationRun.update({
      where: { id },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        completedAt: new Date(),
        errorMessage,
        errorCount: { increment: 1 },
      },
    });
  }

  async findLatestCompletedGenerationRun(): Promise<ContentGenerationRun | null> {
    return this.prisma.contentGenerationRun.findFirst({
      where: {
        status: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] },
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
    });
  }

  async createGeneratedContent(input: CreateGeneratedContentInput): Promise<GeneratedContent> {
    return this.prisma.generatedContent.create({
      data: {
        generationRunId: input.generationRunId ?? null,
        contentCandidateId: input.contentCandidateId,
        researchItemId: input.researchItemId,
        contentType: input.contentType,
        targetChannel: input.targetChannel ?? "GENERIC",
        status: input.status,
        title: input.title,
        body: input.body,
        summary: input.summary ?? null,
        hashtags: input.hashtags as Prisma.InputJsonValue,
        callToAction: input.callToAction ?? null,
        affiliateUrl: input.affiliateUrl,
        imageId: input.imageId ?? null,
        promptVersion: input.promptVersion,
        generationProvider: input.generationProvider,
        generationModel: input.generationModel,
        inputSnapshot: input.inputSnapshot as Prisma.InputJsonValue,
        validationResult: (input.validationResult ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        contentHash: input.contentHash,
        version: input.version,
        parentContentId: input.parentContentId ?? null,
        generatedAt: input.generatedAt,
      },
    });
  }

  async createContentVersion(
    parentId: string,
    input: Omit<CreateGeneratedContentInput, "version" | "parentContentId">,
  ): Promise<GeneratedContent> {
    const parent = await this.findGeneratedContentById(parentId);
    if (!parent) {
      throw new ContentStateError(`parent content not found: ${parentId}`);
    }
    if (parent.status === "PUBLISHED" || parent.status === "APPROVED") {
      // Regeneration creates a new version; parent is not overwritten.
      // Approved/published parents remain as historical records.
    }
    const latest = await this.findLatestVersionForCandidate(
      parent.contentCandidateId,
      parent.contentType,
    );
    const nextVersion = (latest?.version ?? parent.version) + 1;
    return this.createGeneratedContent({
      ...input,
      contentCandidateId: parent.contentCandidateId,
      researchItemId: parent.researchItemId,
      contentType: parent.contentType,
      version: nextVersion,
      parentContentId: parent.id,
    });
  }

  async saveValidationIssues(
    generatedContentId: string,
    issues: ValidationIssueInput[],
  ): Promise<void> {
    if (issues.length === 0) {
      return;
    }
    await this.prisma.contentValidationIssue.createMany({
      data: issues.map((issue) => ({
        generatedContentId,
        issueType: issue.issueType,
        severity: issue.severity,
        fieldName: issue.fieldName ?? null,
        message: issue.message,
        detectedValue: issue.detectedValue ?? null,
      })),
    });
  }

  async updateGeneratedContentStatus(
    id: string,
    status: GeneratedContentStatus,
    extra?: {
      validationResult?: Record<string, unknown>;
      approvedAt?: Date | null;
      rejectedAt?: Date | null;
      publishedAt?: Date | null;
    },
  ): Promise<GeneratedContent> {
    return this.prisma.generatedContent.update({
      where: { id },
      data: {
        status,
        ...(extra?.validationResult
          ? { validationResult: extra.validationResult as Prisma.InputJsonValue }
          : {}),
        ...(extra?.approvedAt !== undefined ? { approvedAt: extra.approvedAt } : {}),
        ...(extra?.rejectedAt !== undefined ? { rejectedAt: extra.rejectedAt } : {}),
        ...(extra?.publishedAt !== undefined ? { publishedAt: extra.publishedAt } : {}),
      },
    });
  }

  async findGeneratedContentById(id: string): Promise<
    | (GeneratedContent & {
        validationIssues: {
          id: string;
          issueType: ContentValidationIssueType;
          severity: ContentValidationSeverity;
          fieldName: string | null;
          message: string;
          detectedValue: string | null;
        }[];
        reviews: ContentReview[];
      })
    | null
  > {
    return this.prisma.generatedContent.findUnique({
      where: { id },
      include: {
        validationIssues: { orderBy: { createdAt: "asc" } },
        reviews: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  async listGeneratedContents(options: {
    status?: GeneratedContentStatus;
    contentType?: GeneratedContentType;
    contentCandidateId?: string;
    researchItemId?: string;
    limit?: number;
  }): Promise<GeneratedContent[]> {
    return this.prisma.generatedContent.findMany({
      where: {
        ...(options.status ? { status: options.status } : {}),
        ...(options.contentType ? { contentType: options.contentType } : {}),
        ...(options.contentCandidateId
          ? { contentCandidateId: options.contentCandidateId }
          : {}),
        ...(options.researchItemId ? { researchItemId: options.researchItemId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(options.limit ?? 50, 200)),
    });
  }

  async listContentsForReview(limit = 20): Promise<GeneratedContent[]> {
    return this.listGeneratedContents({ status: "REVIEW_REQUIRED", limit });
  }

  async approveContent(
    id: string,
    reviewer: string,
    comment?: string,
  ): Promise<GeneratedContent> {
    const content = await this.requireContent(id);
    if (!APPROVABLE.includes(content.status)) {
      throw new ContentStateError(
        `cannot approve content in status ${content.status} (VALIDATION_FAILED and others blocked)`,
      );
    }
    await this.createReview(id, "APPROVE", reviewer, comment);
    return this.updateGeneratedContentStatus(id, "APPROVED", {
      approvedAt: new Date(),
      rejectedAt: null,
    });
  }

  async rejectContent(
    id: string,
    reviewer: string,
    comment?: string,
  ): Promise<GeneratedContent> {
    const content = await this.requireContent(id);
    if (!REJECTABLE.includes(content.status)) {
      throw new ContentStateError(`cannot reject content in status ${content.status}`);
    }
    await this.createReview(id, "REJECT", reviewer, comment);
    return this.updateGeneratedContentStatus(id, "REJECTED", {
      rejectedAt: new Date(),
    });
  }

  async requestChanges(
    id: string,
    reviewer: string,
    comment?: string,
  ): Promise<GeneratedContent> {
    const content = await this.requireContent(id);
    if (!CHANGE_REQUESTABLE.includes(content.status)) {
      throw new ContentStateError(`cannot request changes in status ${content.status}`);
    }
    await this.createReview(id, "REQUEST_CHANGES", reviewer, comment);
    // Stay in REVIEW_REQUIRED until regenerated
    return content;
  }

  async markReadyToPublish(id: string): Promise<GeneratedContent> {
    const content = await this.requireContent(id);
    if (!READYABLE.includes(content.status)) {
      throw new ContentStateError(
        `cannot mark READY_TO_PUBLISH from status ${content.status}`,
      );
    }
    return this.updateGeneratedContentStatus(id, "READY_TO_PUBLISH");
  }

  async archiveContent(id: string): Promise<GeneratedContent> {
    const content = await this.requireContent(id);
    if (content.status === "PUBLISHED") {
      throw new ContentStateError("cannot archive PUBLISHED content via draft rollback");
    }
    if (!ARCHIVABLE.includes(content.status)) {
      throw new ContentStateError(`cannot archive content in status ${content.status}`);
    }
    return this.updateGeneratedContentStatus(id, "ARCHIVED");
  }

  async revertToDraft(id: string): Promise<GeneratedContent> {
    const content = await this.requireContent(id);
    if (content.status === "PUBLISHED") {
      throw new ContentStateError("PUBLISHED content cannot be reverted to DRAFT");
    }
    throw new ContentStateError(
      `revert to DRAFT is not allowed from status ${content.status}`,
    );
  }

  async findDuplicateByHash(
    contentHash: string,
    options: {
      researchItemId: string;
      contentType: GeneratedContentType;
      targetChannel: ContentTargetChannel;
      excludeId?: string;
    },
  ): Promise<GeneratedContent | null> {
    return this.prisma.generatedContent.findFirst({
      where: {
        contentHash,
        researchItemId: options.researchItemId,
        contentType: options.contentType,
        targetChannel: options.targetChannel,
        ...(options.excludeId ? { id: { not: options.excludeId } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findRecentSimilarContents(options: {
    researchItemId: string;
    contentType: GeneratedContentType;
    targetChannel: ContentTargetChannel;
    limit?: number;
    excludeId?: string;
  }): Promise<GeneratedContent[]> {
    return this.prisma.generatedContent.findMany({
      where: {
        researchItemId: options.researchItemId,
        contentType: options.contentType,
        targetChannel: options.targetChannel,
        ...(options.excludeId ? { id: { not: options.excludeId } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(options.limit ?? 20, 50)),
    });
  }

  async findLatestVersionForCandidate(
    contentCandidateId: string,
    contentType: GeneratedContentType,
  ): Promise<GeneratedContent | null> {
    return this.prisma.generatedContent.findFirst({
      where: { contentCandidateId, contentType },
      orderBy: { version: "desc" },
    });
  }

  async markCandidateContentCreated(contentCandidateId: string): Promise<void> {
    await this.prisma.contentCandidate.update({
      where: { id: contentCandidateId },
      data: { status: "CONTENT_CREATED" },
    });
  }

  /** For validation-only forbidden-text checks. Never log or return to AI providers. */
  async getResearchItemRawData(researchItemId: string): Promise<unknown> {
    const row = await this.prisma.researchItem.findUnique({
      where: { id: researchItemId },
      select: { rawData: true },
    });
    return row?.rawData ?? null;
  }

  async listCandidatesForGeneration(options: {
    candidateId?: string;
    analysisRunId?: string;
    candidateType?: string;
    minScore?: number;
    includeRequiresConfirmation?: boolean;
    limit?: number;
    contentType?: GeneratedContentType;
    skipExistingSameType?: boolean;
  }): Promise<
    Prisma.ContentCandidateGetPayload<{
      include: {
        productAnalysis: true;
        researchItem: {
          include: {
            metrics: true;
            tags: { include: { researchTag: true } };
            images: true;
          };
        };
      };
    }>[]
  > {
    const rows = await this.prisma.contentCandidate.findMany({
      where: {
        ...(options.candidateId ? { id: options.candidateId } : {}),
        ...(options.analysisRunId ? { analysisRunId: options.analysisRunId } : {}),
        ...(options.candidateType
          ? { candidateType: options.candidateType as never }
          : {}),
        status: { in: ["SELECTED", "CONTENT_CREATED", "HELD"] },
        productAnalysis: {
          eligibilityStatus: options.includeRequiresConfirmation
            ? { in: ["ELIGIBLE", "REQUIRES_CONFIRMATION"] }
            : "ELIGIBLE",
          ...(options.minScore !== undefined
            ? { totalScore: { gte: options.minScore } }
            : {}),
        },
      },
      include: {
        productAnalysis: true,
        researchItem: {
          include: {
            metrics: true,
            tags: { include: { researchTag: true } },
            images: true,
          },
        },
      },
      orderBy: [{ selectionScore: "desc" }, { rank: "asc" }],
      take: Math.max(1, Math.min(options.limit ?? 20, 200)),
    });

    if (!options.skipExistingSameType || !options.contentType) {
      return rows.filter((row) => row.productAnalysis.eligibilityStatus !== "NOT_ELIGIBLE");
    }

    const filtered = [];
    for (const row of rows) {
      if (row.productAnalysis.eligibilityStatus === "NOT_ELIGIBLE") {
        continue;
      }
      const existing = await this.findLatestVersionForCandidate(row.id, options.contentType);
      if (!existing) {
        filtered.push(row);
      }
    }
    return filtered;
  }

  private async requireContent(id: string): Promise<GeneratedContent> {
    const content = await this.prisma.generatedContent.findUnique({ where: { id } });
    if (!content) {
      throw new ContentStateError(`content not found: ${id}`);
    }
    return content;
  }

  private async createReview(
    generatedContentId: string,
    decision: ContentReviewDecision,
    reviewer: string,
    comment?: string,
  ): Promise<ContentReview> {
    return this.prisma.contentReview.create({
      data: {
        generatedContentId,
        decision,
        reviewer,
        comment: comment ?? null,
      },
    });
  }
}

export type { ContentGenerationRunStatus };
