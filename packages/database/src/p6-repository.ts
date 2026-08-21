import type {
  AffiliateResult,
  AnalyticsAttribution,
  AnalyticsImportBatch,
  AnalyticsImportRow,
  AuditEvent,
  LearningRule,
  LearningRuleApplication,
  LearningRuleConflict,
  OperationCheckpoint,
  OperationJob,
  PrismaClient,
} from "@prisma/client";
import { Prisma } from "@prisma/client";

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
function jsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export class P6Repository {
  constructor(private readonly prisma: PrismaClient) {}

  // --- Analytics import ---
  async findImportBatchByHash(hash: string): Promise<AnalyticsImportBatch | null> {
    return this.prisma.analyticsImportBatch.findUnique({ where: { sourceFileHash: hash } });
  }

  async createImportBatch(input: {
    source: string;
    platform?: string | null;
    format: string;
    sourceFileHash?: string | null;
    fileName?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<AnalyticsImportBatch> {
    return this.prisma.analyticsImportBatch.create({
      data: {
        source: input.source,
        platform: input.platform ?? null,
        format: input.format,
        sourceFileHash: input.sourceFileHash ?? null,
        fileName: input.fileName ?? null,
        metadata: jsonOrNull(input.metadata ?? null),
        status: "RUNNING",
      },
    });
  }

  async updateImportBatch(
    id: string,
    data: Partial<{
      status: string;
      rowCount: number;
      acceptedCount: number;
      duplicateCount: number;
      rejectedCount: number;
      unmatchedCount: number;
      validationIssues: unknown;
      metadata: Record<string, unknown> | null;
    }>,
  ): Promise<AnalyticsImportBatch> {
    return this.prisma.analyticsImportBatch.update({
      where: { id },
      data: {
        status: data.status,
        rowCount: data.rowCount,
        acceptedCount: data.acceptedCount,
        duplicateCount: data.duplicateCount,
        rejectedCount: data.rejectedCount,
        unmatchedCount: data.unmatchedCount,
        validationIssues:
          data.validationIssues !== undefined ? jsonOrNull(data.validationIssues) : undefined,
        metadata: data.metadata !== undefined ? jsonOrNull(data.metadata) : undefined,
      },
    });
  }

  async createImportRow(input: {
    batchId: string;
    rowIndex: number;
    rowHash: string;
    externalPublicationId?: string | null;
    measuredAt?: Date | null;
    rawMetrics: Record<string, unknown>;
    normalizedMetrics?: Record<string, number> | null;
    unit?: string | null;
    attributionWindowHours?: number | null;
    duplicateStatus?: string;
    validationIssues?: unknown;
    attributionStatus?: string;
    snapshotId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<AnalyticsImportRow> {
    return this.prisma.analyticsImportRow.create({
      data: {
        batchId: input.batchId,
        rowIndex: input.rowIndex,
        rowHash: input.rowHash,
        externalPublicationId: input.externalPublicationId ?? null,
        measuredAt: input.measuredAt ?? null,
        rawMetrics: toJson(input.rawMetrics),
        normalizedMetrics: jsonOrNull(input.normalizedMetrics ?? null),
        unit: input.unit ?? null,
        attributionWindowHours: input.attributionWindowHours ?? null,
        duplicateStatus: input.duplicateStatus ?? "unique",
        validationIssues: jsonOrNull(input.validationIssues ?? null),
        attributionStatus: input.attributionStatus ?? "unmatched",
        snapshotId: input.snapshotId ?? null,
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async updateImportRow(
    id: string,
    data: Partial<{
      attributionStatus: string;
      snapshotId: string | null;
      duplicateStatus: string;
    }>,
  ): Promise<AnalyticsImportRow> {
    return this.prisma.analyticsImportRow.update({ where: { id }, data });
  }

  async listUnmatchedImportRows(limit = 50): Promise<AnalyticsImportRow[]> {
    return this.prisma.analyticsImportRow.findMany({
      where: { attributionStatus: { in: ["unmatched", "awaiting_review", "partially_matched"] } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async findImportRow(id: string): Promise<AnalyticsImportRow | null> {
    return this.prisma.analyticsImportRow.findUnique({ where: { id } });
  }

  async createAttribution(input: {
    importRowId?: string | null;
    snapshotId?: string | null;
    status: string;
    confidence: number;
    matchReason: string;
    publicationRecordId?: string | null;
    publicationTargetId?: string | null;
    contentVersionId?: string | null;
    contentId?: string | null;
    productLinkId?: string | null;
    experimentVariantId?: string | null;
    platformAccount?: string | null;
    candidates?: unknown;
    reviewedBy?: string | null;
    reviewedAt?: Date | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<AnalyticsAttribution> {
    return this.prisma.analyticsAttribution.create({
      data: {
        importRowId: input.importRowId ?? null,
        snapshotId: input.snapshotId ?? null,
        status: input.status,
        confidence: input.confidence,
        matchReason: input.matchReason,
        publicationRecordId: input.publicationRecordId ?? null,
        publicationTargetId: input.publicationTargetId ?? null,
        contentVersionId: input.contentVersionId ?? null,
        contentId: input.contentId ?? null,
        productLinkId: input.productLinkId ?? null,
        experimentVariantId: input.experimentVariantId ?? null,
        platformAccount: input.platformAccount ?? null,
        candidates: jsonOrNull(input.candidates ?? null),
        reviewedBy: input.reviewedBy ?? null,
        reviewedAt: input.reviewedAt ?? null,
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async updateAttribution(
    id: string,
    data: Partial<{
      status: string;
      confidence: number;
      matchReason: string;
      publicationRecordId: string | null;
      publicationTargetId: string | null;
      contentVersionId: string | null;
      contentId: string | null;
      productLinkId: string | null;
      experimentVariantId: string | null;
      reviewedBy: string | null;
      reviewedAt: Date | null;
      candidates: unknown;
    }>,
  ): Promise<AnalyticsAttribution> {
    return this.prisma.analyticsAttribution.update({
      where: { id },
      data: {
        ...data,
        candidates: data.candidates !== undefined ? jsonOrNull(data.candidates) : undefined,
      },
    });
  }

  async findAttributionByImportRow(importRowId: string): Promise<AnalyticsAttribution | null> {
    return this.prisma.analyticsAttribution.findFirst({
      where: { importRowId },
      orderBy: { createdAt: "desc" },
    });
  }

  // --- Affiliate results ---
  async upsertAffiliateResult(input: {
    provider: string;
    transactionId?: string | null;
    clickedAt?: Date | null;
    convertedAt?: Date | null;
    productId?: string | null;
    productMatchKey?: string | null;
    normalUrl?: string | null;
    affiliateUrl?: string | null;
    orderAmount?: number | null;
    commissionAmount?: number | null;
    currency?: string;
    status?: string;
    cancelled?: boolean;
    contentId?: string | null;
    attributionMetadata?: Record<string, unknown> | null;
    importBatchId?: string | null;
    sourceFileHash?: string | null;
    rowHash?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<AffiliateResult> {
    if (input.transactionId) {
      return this.prisma.affiliateResult.upsert({
        where: {
          provider_transactionId: {
            provider: input.provider,
            transactionId: input.transactionId,
          },
        },
        create: {
          provider: input.provider,
          transactionId: input.transactionId,
          clickedAt: input.clickedAt ?? null,
          convertedAt: input.convertedAt ?? null,
          productId: input.productId ?? null,
          productMatchKey: input.productMatchKey ?? null,
          normalUrl: input.normalUrl ?? null,
          affiliateUrl: input.affiliateUrl ?? null,
          orderAmount: input.orderAmount ?? null,
          commissionAmount: input.commissionAmount ?? null,
          currency: input.currency ?? "JPY",
          status: input.status ?? "pending",
          cancelled: input.cancelled ?? false,
          contentId: input.contentId ?? null,
          attributionMetadata: jsonOrNull(input.attributionMetadata ?? null),
          importBatchId: input.importBatchId ?? null,
          sourceFileHash: input.sourceFileHash ?? null,
          rowHash: input.rowHash ?? null,
          metadata: jsonOrNull(input.metadata ?? null),
        },
        update: {
          orderAmount: input.orderAmount ?? undefined,
          commissionAmount: input.commissionAmount ?? undefined,
          status: input.status ?? undefined,
          cancelled: input.cancelled ?? undefined,
          attributionMetadata: input.attributionMetadata
            ? toJson(input.attributionMetadata)
            : undefined,
        },
      });
    }
    return this.prisma.affiliateResult.create({
      data: {
        provider: input.provider,
        transactionId: null,
        clickedAt: input.clickedAt ?? null,
        convertedAt: input.convertedAt ?? null,
        productId: input.productId ?? null,
        productMatchKey: input.productMatchKey ?? null,
        normalUrl: input.normalUrl ?? null,
        affiliateUrl: input.affiliateUrl ?? null,
        orderAmount: input.orderAmount ?? null,
        commissionAmount: input.commissionAmount ?? null,
        currency: input.currency ?? "JPY",
        status: input.status ?? "pending",
        cancelled: input.cancelled ?? false,
        contentId: input.contentId ?? null,
        attributionMetadata: jsonOrNull(input.attributionMetadata ?? null),
        importBatchId: input.importBatchId ?? null,
        sourceFileHash: input.sourceFileHash ?? null,
        rowHash: input.rowHash ?? null,
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  // --- Learning governance ---
  async findLearningRule(id: string): Promise<LearningRule | null> {
    return this.prisma.learningRule.findUnique({ where: { id } });
  }

  async listLearningRules(filter?: {
    status?: string | string[];
    platform?: string;
  }): Promise<LearningRule[]> {
    const status = filter?.status;
    return this.prisma.learningRule.findMany({
      where: {
        status: Array.isArray(status) ? { in: status } : status,
        ...(filter?.platform
          ? {
              OR: [{ applicablePlatform: filter.platform }, { applicablePlatform: null }],
            }
          : {}),
      },
      orderBy: [{ confidence: "desc" }, { sampleCount: "desc" }],
    });
  }

  async updateLearningRule(
    id: string,
    data: Record<string, unknown>,
  ): Promise<LearningRule> {
    return this.prisma.learningRule.update({
      where: { id },
      data: data as Prisma.LearningRuleUpdateInput,
    });
  }

  async createLearningRuleApplication(input: {
    strategyId: string;
    learningRuleId: string;
    applicationType: string;
    appliedField?: string | null;
    promptVersion?: string | null;
    modelRunId?: string | null;
    applicationReason?: string | null;
  }): Promise<LearningRuleApplication> {
    return this.prisma.learningRuleApplication.create({
      data: {
        strategyId: input.strategyId,
        learningRuleId: input.learningRuleId,
        applicationType: input.applicationType,
        appliedField: input.appliedField ?? null,
        promptVersion: input.promptVersion ?? null,
        modelRunId: input.modelRunId ?? null,
        applicationReason: input.applicationReason ?? null,
      },
    });
  }

  async listApplicationsForStrategy(strategyId: string): Promise<LearningRuleApplication[]> {
    return this.prisma.learningRuleApplication.findMany({
      where: { strategyId },
      orderBy: { createdAt: "asc" },
    });
  }

  async createLearningRuleConflict(input: {
    ruleAId: string;
    ruleBId: string;
    conflictType: string;
    reason: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<LearningRuleConflict> {
    return this.prisma.learningRuleConflict.upsert({
      where: {
        ruleAId_ruleBId_conflictType: {
          ruleAId: input.ruleAId,
          ruleBId: input.ruleBId,
          conflictType: input.conflictType,
        },
      },
      create: {
        ruleAId: input.ruleAId,
        ruleBId: input.ruleBId,
        conflictType: input.conflictType,
        reason: input.reason,
        status: "manual_review_required",
        metadata: jsonOrNull(input.metadata ?? null),
      },
      update: {
        reason: input.reason,
        status: "manual_review_required",
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async listOpenConflicts(): Promise<LearningRuleConflict[]> {
    return this.prisma.learningRuleConflict.findMany({
      where: { status: "manual_review_required" },
      orderBy: { createdAt: "desc" },
    });
  }

  async resolveConflict(
    conflictId: string,
    data: {
      status: string;
      resolution: string;
      resolvedBy: string;
      resolvedAt: Date;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<LearningRuleConflict> {
    return this.prisma.learningRuleConflict.update({
      where: { id: conflictId },
      data: {
        status: data.status,
        resolution: data.resolution,
        resolvedBy: data.resolvedBy,
        resolvedAt: data.resolvedAt,
        metadata: jsonOrNull(data.metadata ?? null),
      },
    });
  }

  async listOperationJobs(filter?: {
    status?: string | string[];
    take?: number;
    skip?: number;
  }): Promise<OperationJob[]> {
    return this.prisma.operationJob.findMany({
      where: filter?.status
        ? { status: Array.isArray(filter.status) ? { in: filter.status } : filter.status }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: filter?.take ?? 50,
      skip: filter?.skip ?? 0,
    });
  }

  async listAuditEvents(filter?: {
    actor?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    relatedJobId?: string;
    from?: Date;
    to?: Date;
    take?: number;
    skip?: number;
  }): Promise<AuditEvent[]> {
    return this.prisma.auditEvent.findMany({
      where: {
        actor: filter?.actor,
        action: filter?.action,
        targetType: filter?.targetType,
        targetId: filter?.targetId,
        relatedJobId: filter?.relatedJobId,
        createdAt:
          filter?.from || filter?.to
            ? { gte: filter.from, lte: filter.to }
            : undefined,
      },
      orderBy: { createdAt: "desc" },
      take: filter?.take ?? 50,
      skip: filter?.skip ?? 0,
    });
  }

  // --- Operation jobs ---
  async findOperationJobByIdempotency(key: string): Promise<OperationJob | null> {
    return this.prisma.operationJob.findUnique({ where: { idempotencyKey: key } });
  }

  async findOperationJob(id: string): Promise<
    (OperationJob & { checkpoints: OperationCheckpoint[] }) | null
  > {
    return this.prisma.operationJob.findUnique({
      where: { id },
      include: { checkpoints: { orderBy: { createdAt: "asc" } } },
    });
  }

  async createOperationJob(input: {
    cycleType: string;
    idempotencyKey?: string | null;
    payload: Record<string, unknown>;
    maxAttempts?: number;
  }): Promise<OperationJob> {
    return this.prisma.operationJob.create({
      data: {
        cycleType: input.cycleType,
        idempotencyKey: input.idempotencyKey ?? null,
        payload: toJson(input.payload),
        maxAttempts: input.maxAttempts ?? 3,
        status: "PENDING",
      },
    });
  }

  async updateOperationJob(
    id: string,
    data: Partial<{
      status: string;
      result: Record<string, unknown> | null;
      error: string | null;
      errorClass: string | null;
      retryable: boolean;
      attempts: number;
      operatorJobId: string | null;
      startedAt: Date | null;
      completedAt: Date | null;
    }>,
  ): Promise<OperationJob> {
    return this.prisma.operationJob.update({
      where: { id },
      data: {
        status: data.status,
        result: data.result !== undefined ? jsonOrNull(data.result) : undefined,
        error: data.error,
        errorClass: data.errorClass,
        retryable: data.retryable,
        attempts: data.attempts,
        operatorJobId: data.operatorJobId,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
      },
    });
  }

  async upsertCheckpoint(input: {
    operationJobId: string;
    stepKey: string;
    status: string;
    reusableRefs?: Record<string, unknown> | null;
    output?: Record<string, unknown> | null;
    error?: string | null;
  }): Promise<OperationCheckpoint> {
    return this.prisma.operationCheckpoint.upsert({
      where: {
        operationJobId_stepKey: {
          operationJobId: input.operationJobId,
          stepKey: input.stepKey,
        },
      },
      create: {
        operationJobId: input.operationJobId,
        stepKey: input.stepKey,
        status: input.status,
        reusableRefs: jsonOrNull(input.reusableRefs ?? null),
        output: jsonOrNull(input.output ?? null),
        error: input.error ?? null,
      },
      update: {
        status: input.status,
        reusableRefs: jsonOrNull(input.reusableRefs ?? null),
        output: jsonOrNull(input.output ?? null),
        error: input.error ?? null,
      },
    });
  }

  async createAuditEvent(input: {
    eventType: string;
    actor: string;
    targetType: string;
    targetId: string;
    action: string;
    summary: string;
    details?: Record<string, unknown> | null;
    relatedJobId?: string | null;
  }): Promise<AuditEvent> {
    const safeDetails = scrubSecrets(input.details ?? null);
    return this.prisma.auditEvent.create({
      data: {
        eventType: input.eventType,
        actor: input.actor,
        targetType: input.targetType,
        targetId: input.targetId,
        action: input.action,
        summary: input.summary,
        details: jsonOrNull(safeDetails),
        relatedJobId: input.relatedJobId ?? null,
      },
    });
  }

  /** Publication lookup helpers for attribution */
  async findPublicationTargetsByExternalId(externalId: string) {
    return this.prisma.publicationTarget.findMany({
      where: { publishedExternalId: externalId },
      take: 10,
    });
  }

  async findPublicationRecordsByExternalId(externalId: string) {
    return this.prisma.publicationRecord.findMany({
      where: { externalId },
      take: 10,
    });
  }
}

const SECRET_KEY_RE = /(api[_-]?key|secret|token|password|authorization|refresh)/i;

function scrubSecrets(
  details: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!details) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = scrubSecrets(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
