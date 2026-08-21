import type {
  AdminSession,
  AdminUser,
  ApprovalDecision,
  FileUploadReference,
  PrismaClient,
  ProviderMappingProfile,
  SystemSetting,
} from "@prisma/client";
import { Prisma } from "@prisma/client";

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export class AdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findUserByEmail(email: string): Promise<AdminUser | null> {
    return this.prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
  }

  async findUserById(id: string): Promise<AdminUser | null> {
    return this.prisma.adminUser.findUnique({ where: { id } });
  }

  async createUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    role: string;
  }): Promise<AdminUser> {
    return this.prisma.adminUser.create({
      data: {
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        role: input.role,
      },
    });
  }

  async upsertUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    role: string;
  }): Promise<AdminUser> {
    return this.prisma.adminUser.upsert({
      where: { email: input.email.toLowerCase() },
      create: {
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        role: input.role,
        active: true,
      },
      update: {
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        role: input.role,
        active: true,
      },
    });
  }

  async touchLogin(userId: string): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AdminSession> {
    return this.prisma.adminSession.create({ data: input });
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<(AdminSession & { user: AdminUser }) | null> {
    return this.prisma.adminSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.adminSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async listSettings(): Promise<SystemSetting[]> {
    return this.prisma.systemSetting.findMany({ orderBy: { key: "asc" } });
  }

  async getSetting(key: string): Promise<SystemSetting | null> {
    return this.prisma.systemSetting.findUnique({ where: { key } });
  }

  async upsertSetting(input: {
    key: string;
    value: unknown;
    description?: string | null;
    updatedBy?: string | null;
  }): Promise<SystemSetting> {
    return this.prisma.systemSetting.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        value: jsonValue(input.value),
        description: input.description ?? null,
        updatedBy: input.updatedBy ?? null,
      },
      update: {
        value: jsonValue(input.value),
        description: input.description ?? undefined,
        updatedBy: input.updatedBy ?? null,
      },
    });
  }

  async listMappingProfiles(): Promise<ProviderMappingProfile[]> {
    return this.prisma.providerMappingProfile.findMany({ orderBy: { profileKey: "asc" } });
  }

  async upsertMappingProfile(input: {
    profileKey: string;
    provider: string;
    label: string;
    isSample: boolean;
    columnMapping: Record<string, string>;
    statusMapping: Record<string, string>;
    currencyMapping: Record<string, string>;
    dateFormat: string;
    notes?: string | null;
  }): Promise<ProviderMappingProfile> {
    return this.prisma.providerMappingProfile.upsert({
      where: { profileKey: input.profileKey },
      create: {
        profileKey: input.profileKey,
        provider: input.provider,
        label: input.label,
        isSample: input.isSample,
        columnMapping: jsonValue(input.columnMapping),
        statusMapping: jsonValue(input.statusMapping),
        currencyMapping: jsonValue(input.currencyMapping),
        dateFormat: input.dateFormat,
        notes: input.notes ?? null,
      },
      update: {
        provider: input.provider,
        label: input.label,
        isSample: input.isSample,
        columnMapping: jsonValue(input.columnMapping),
        statusMapping: jsonValue(input.statusMapping),
        currencyMapping: jsonValue(input.currencyMapping),
        dateFormat: input.dateFormat,
        notes: input.notes ?? null,
      },
    });
  }

  async createApprovalDecision(input: {
    targetType: string;
    targetId: string;
    decision: string;
    reason?: string | null;
    actorUserId: string;
    actorEmail: string;
    correlationId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<ApprovalDecision> {
    return this.prisma.approvalDecision.create({
      data: {
        targetType: input.targetType,
        targetId: input.targetId,
        decision: input.decision,
        reason: input.reason ?? null,
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        correlationId: input.correlationId ?? null,
        metadata: input.metadata ? jsonValue(input.metadata) : undefined,
      },
    });
  }

  async createFileUploadRef(input: {
    purpose: string;
    fileName?: string | null;
    contentType?: string | null;
    byteLength?: number | null;
    fileHash: string;
    retention?: string;
    previewMeta?: Record<string, unknown> | null;
    createdBy?: string | null;
    expiresAt?: Date | null;
  }): Promise<FileUploadReference> {
    return this.prisma.fileUploadReference.create({
      data: {
        purpose: input.purpose,
        fileName: input.fileName ?? null,
        contentType: input.contentType ?? null,
        byteLength: input.byteLength ?? null,
        fileHash: input.fileHash,
        retention: input.retention ?? "ephemeral",
        previewMeta: input.previewMeta ? jsonValue(input.previewMeta) : undefined,
        createdBy: input.createdBy ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    });
  }

  async dashboardCounts() {
    const prisma = this.prisma;
    const [
      awaitingContentApprovals,
      awaitingPublicationApprovals,
      unmatchedAttributions,
      awaitingLearningRules,
      openRuleConflicts,
      awaitingExperiments,
      awaitingLinkReplacements,
      manualReviewJobs,
      failedJobs,
      bloggerDraftPending,
      xExportPending,
      monetizationGroups,
      spentToday,
      budget,
    ] = await Promise.all([
      prisma.contentVersion.count({ where: { status: "REVIEWING" } }),
      prisma.publicationTarget.count({
        where: { status: { in: ["AWAITING_APPROVAL", "DRAFT"] } },
      }),
      prisma.analyticsAttribution.count({
        where: { status: { in: ["unmatched", "awaiting_review", "partially_matched"] } },
      }),
      prisma.learningRule.count({
        where: { status: { in: ["PROPOSED", "AWAITING_APPROVAL"] } },
      }),
      prisma.learningRuleConflict.count({ where: { status: "manual_review_required" } }),
      prisma.experiment.count({
        where: { status: { in: ["DRAFT", "AWAITING_APPROVAL", "PROPOSED"] } },
      }),
      prisma.linkReplacementEvent.count({
        where: { status: { in: ["PROPOSED", "AWAITING_APPROVAL"] } },
      }),
      prisma.operationJob.count({ where: { status: "MANUAL_REVIEW_REQUIRED" } }),
      prisma.operationJob.count({ where: { status: "FAILED" } }),
      prisma.publicationTarget.count({
        where: { platform: "BLOGGER", status: { in: ["APPROVED", "SCHEDULED"] } },
      }),
      prisma.publicationTarget.count({
        where: { platform: "X", status: { in: ["APPROVED", "SCHEDULED"] } },
      }),
      prisma.content.groupBy({ by: ["monetizationStatus"], _count: { _all: true } }),
      prisma.costRecord.aggregate({
        where: {
          recordedAt: { gte: new Date(new Date().toISOString().slice(0, 10)) },
        },
        _sum: { actualAmount: true, estimatedAmount: true },
      }),
      prisma.budgetSetting.findFirst({
        where: { enabled: true, currency: "JPY" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const monetizationCounts: Record<string, number> = {};
    for (const g of monetizationGroups) {
      monetizationCounts[g.monetizationStatus] = g._count._all;
    }

    return {
      awaitingContentApprovals,
      awaitingPublicationApprovals,
      unmatchedAttributions,
      awaitingLearningRules,
      openRuleConflicts,
      awaitingExperiments,
      awaitingLinkReplacements,
      manualReviewJobs,
      failedJobs,
      bloggerDraftPending,
      xExportPending,
      monetizationCounts,
      budget: {
        currency: budget?.currency ?? "JPY",
        spentToday: spentToday._sum.actualAmount ?? spentToday._sum.estimatedAmount ?? 0,
        hardLimit: budget?.hardLimit ?? null,
      },
    };
  }
}
