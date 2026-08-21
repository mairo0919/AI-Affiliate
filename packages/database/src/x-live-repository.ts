import type {
  PrismaClient,
  XApiBudgetPeriodType,
  XApiBudgetStatus,
  XApiCredentialStatus,
  XApiUsageSource,
  XOAuthSessionStatus,
} from "@prisma/client";
import { Prisma } from "@prisma/client";

export class XLiveRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findCredentialByAccountId(accountId: string) {
    return this.prisma.xApiCredential.findUnique({ where: { accountId } });
  }

  async findActiveCredential() {
    return this.prisma.xApiCredential.findFirst({
      where: { status: { in: ["ACTIVE", "REFRESH_REQUIRED"] } },
      orderBy: { updatedAt: "desc" },
    });
  }

  async upsertCredential(data: {
    accountId: string;
    status: XApiCredentialStatus;
    encryptedAccessToken: string | null;
    encryptedRefreshToken: string | null;
    accessTokenExpiresAt: Date | null;
    refreshTokenExpiresAt?: Date | null;
    scopes: string[];
    encryptionKeyVersion: string;
    authorizedAt?: Date | null;
    lastRefreshedAt?: Date | null;
    lastRefreshFailedAt?: Date | null;
    lastRefreshErrorCode?: string | null;
    revokedAt?: Date | null;
    bumpTokenVersion?: boolean;
  }) {
    const existing = await this.findCredentialByAccountId(data.accountId);
    if (!existing) {
      return this.prisma.xApiCredential.create({
        data: {
          accountId: data.accountId,
          status: data.status,
          encryptedAccessToken: data.encryptedAccessToken,
          encryptedRefreshToken: data.encryptedRefreshToken,
          accessTokenExpiresAt: data.accessTokenExpiresAt,
          refreshTokenExpiresAt: data.refreshTokenExpiresAt ?? null,
          scopes: data.scopes,
          encryptionKeyVersion: data.encryptionKeyVersion,
          authorizedAt: data.authorizedAt ?? new Date(),
          lastRefreshedAt: data.lastRefreshedAt ?? null,
          lastRefreshFailedAt: data.lastRefreshFailedAt ?? null,
          lastRefreshErrorCode: data.lastRefreshErrorCode ?? null,
          revokedAt: data.revokedAt ?? null,
        },
      });
    }
    return this.prisma.xApiCredential.update({
      where: { accountId: data.accountId },
      data: {
        status: data.status,
        encryptedAccessToken: data.encryptedAccessToken,
        encryptedRefreshToken: data.encryptedRefreshToken,
        accessTokenExpiresAt: data.accessTokenExpiresAt,
        refreshTokenExpiresAt: data.refreshTokenExpiresAt ?? undefined,
        scopes: data.scopes,
        encryptionKeyVersion: data.encryptionKeyVersion,
        authorizedAt: data.authorizedAt ?? undefined,
        lastRefreshedAt: data.lastRefreshedAt ?? undefined,
        lastRefreshFailedAt: data.lastRefreshFailedAt ?? undefined,
        lastRefreshErrorCode: data.lastRefreshErrorCode ?? undefined,
        revokedAt: data.revokedAt ?? undefined,
        ...(data.bumpTokenVersion ? { tokenVersion: { increment: 1 } } : {}),
      },
    });
  }

  async updateCredentialStatus(
    accountId: string,
    status: XApiCredentialStatus,
    extra?: {
      lastRefreshFailedAt?: Date | null;
      lastRefreshErrorCode?: string | null;
      revokedAt?: Date | null;
      lastRefreshedAt?: Date | null;
    },
  ) {
    return this.prisma.xApiCredential.update({
      where: { accountId },
      data: {
        status,
        lastRefreshFailedAt: extra?.lastRefreshFailedAt,
        lastRefreshErrorCode: extra?.lastRefreshErrorCode,
        revokedAt: extra?.revokedAt,
        lastRefreshedAt: extra?.lastRefreshedAt,
      },
    });
  }

  async createOAuthSession(data: {
    stateHash: string;
    encryptedCodeVerifier: string;
    callbackUrl: string;
    requestedScopes: string[];
    expiresAt: Date;
  }) {
    return this.prisma.xOAuthSession.create({
      data: {
        stateHash: data.stateHash,
        encryptedCodeVerifier: data.encryptedCodeVerifier,
        callbackUrl: data.callbackUrl,
        requestedScopes: data.requestedScopes,
        expiresAt: data.expiresAt,
        status: "PENDING",
      },
    });
  }

  async findOAuthSessionByStateHash(stateHash: string) {
    return this.prisma.xOAuthSession.findUnique({ where: { stateHash } });
  }

  async consumeOAuthSession(
    id: string,
    expectedStatus: XOAuthSessionStatus = "PENDING",
  ) {
    try {
      return await this.prisma.xOAuthSession.update({
        where: { id, status: expectedStatus },
        data: { status: "CONSUMED", consumedAt: new Date() },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        return null;
      }
      throw error;
    }
  }

  async failOAuthSession(id: string, status: XOAuthSessionStatus = "FAILED") {
    return this.prisma.xOAuthSession.update({
      where: { id },
      data: { status },
    });
  }

  async createRequestLog(data: {
    requestType: string;
    endpointKey: string;
    accountId?: string | null;
    publicationId?: string | null;
    xPostId?: string | null;
    method: string;
    result: string;
    statusCode?: number | null;
    attemptCount?: number;
    rateLimitRemaining?: number | null;
    rateLimitResetAt?: Date | null;
    estimatedCost?: number | null;
    billingUnit?: string | null;
    responseSize?: number | null;
    durationMs?: number | null;
    errorCode?: string | null;
  }) {
    return this.prisma.xApiRequestLog.create({
      data: {
        requestType: data.requestType,
        endpointKey: data.endpointKey,
        accountId: data.accountId ?? null,
        publicationId: data.publicationId ?? null,
        xPostId: data.xPostId ?? null,
        method: data.method,
        result: data.result,
        statusCode: data.statusCode ?? null,
        attemptCount: data.attemptCount ?? 1,
        rateLimitRemaining: data.rateLimitRemaining ?? null,
        rateLimitResetAt: data.rateLimitResetAt ?? null,
        estimatedCost: data.estimatedCost ?? null,
        billingUnit: data.billingUnit ?? null,
        responseSize: data.responseSize ?? null,
        durationMs: data.durationMs ?? null,
        errorCode: data.errorCode ?? null,
      },
    });
  }

  async sumEstimatedCostSince(since: Date, accountId?: string | null) {
    const agg = await this.prisma.xApiRequestLog.aggregate({
      where: {
        createdAt: { gte: since },
        ...(accountId ? { accountId } : {}),
        estimatedCost: { not: null },
      },
      _sum: { estimatedCost: true },
      _count: { _all: true },
    });
    return {
      estimatedCost: agg._sum.estimatedCost ?? 0,
      requestCount: agg._count._all,
    };
  }

  async createUsageSnapshot(data: {
    accountId?: string | null;
    periodStart: Date;
    periodEnd: Date;
    writeRequestCount: number;
    readRequestCount: number;
    resourceReadCount: number;
    analyticsRequestCount: number;
    estimatedCost?: number | null;
    reportedCost?: number | null;
    currency: string;
    source: XApiUsageSource;
    capturedAt?: Date;
  }) {
    return this.prisma.xApiUsageSnapshot.create({
      data: {
        accountId: data.accountId ?? null,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        writeRequestCount: data.writeRequestCount,
        readRequestCount: data.readRequestCount,
        resourceReadCount: data.resourceReadCount,
        analyticsRequestCount: data.analyticsRequestCount,
        estimatedCost: data.estimatedCost ?? null,
        reportedCost: data.reportedCost ?? null,
        currency: data.currency,
        source: data.source,
        capturedAt: data.capturedAt ?? new Date(),
      },
    });
  }

  async latestUsageSnapshot(accountId?: string | null) {
    return this.prisma.xApiUsageSnapshot.findFirst({
      where: accountId ? { accountId } : {},
      orderBy: { capturedAt: "desc" },
    });
  }

  async findBudget(accountId: string | null, periodType: XApiBudgetPeriodType) {
    const now = new Date();
    return this.prisma.xApiBudgetControl.findFirst({
      where: {
        accountId,
        periodType,
        periodStartedAt: { lte: now },
        periodEndsAt: { gt: now },
      },
      orderBy: { periodStartedAt: "desc" },
    });
  }

  async upsertBudget(data: {
    accountId: string | null;
    periodType: XApiBudgetPeriodType;
    softLimit: number;
    hardLimit: number;
    currentEstimatedUsage: number;
    currentReportedUsage?: number | null;
    currency: string;
    status: XApiBudgetStatus;
    reason?: string | null;
    updatedBy?: string | null;
    periodStartedAt: Date;
    periodEndsAt: Date;
  }) {
    const existing = await this.prisma.xApiBudgetControl.findFirst({
      where: {
        accountId: data.accountId,
        periodType: data.periodType,
        periodStartedAt: data.periodStartedAt,
      },
    });
    if (existing) {
      return this.prisma.xApiBudgetControl.update({
        where: { id: existing.id },
        data: {
          softLimit: data.softLimit,
          hardLimit: data.hardLimit,
          currentEstimatedUsage: data.currentEstimatedUsage,
          currentReportedUsage: data.currentReportedUsage ?? undefined,
          currency: data.currency,
          status: data.status,
          reason: data.reason ?? undefined,
          updatedBy: data.updatedBy ?? undefined,
          periodEndsAt: data.periodEndsAt,
        },
      });
    }
    return this.prisma.xApiBudgetControl.create({ data });
  }

  async listBudgets(accountId?: string | null) {
    return this.prisma.xApiBudgetControl.findMany({
      where: accountId ? { accountId } : {},
      orderBy: [{ periodType: "asc" }, { periodStartedAt: "desc" }],
      take: 20,
    });
  }

  async countRequestLogs(options: {
    since: Date;
    endpointKey?: string;
    result?: string;
  }) {
    return this.prisma.xApiRequestLog.count({
      where: {
        createdAt: { gte: options.since },
        ...(options.endpointKey ? { endpointKey: options.endpointKey } : {}),
        ...(options.result ? { result: options.result } : {}),
      },
    });
  }

  async latestRateLimit(endpointKey?: string) {
    return this.prisma.xApiRequestLog.findFirst({
      where: {
        ...(endpointKey ? { endpointKey } : {}),
        rateLimitRemaining: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
