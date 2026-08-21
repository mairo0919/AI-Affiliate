import type {
  Prisma,
  PrismaClient,
  XExperimentAllocationMethod,
  XExperimentStatus,
  XPublication,
  XPublicationExperiment,
  XPublicationPost,
  XPublicationStatus,
  XPublicationStrategyType,
  XStrategyConfidenceLevel,
  XStrategyPerformance,
  XPostMetricSnapshot,
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

export class XPublicationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XPublicationStateError";
  }
}

export interface CreatePublicationPostInput {
  sequence: number;
  role: "ROOT" | "REPLY" | "RELATED_LINK" | "CTA" | "HUB";
  body: string;
  weightedLength: number;
  bodyHash?: string | null;
  replyToSequence?: number | null;
  relatedPublicationId?: string | null;
}

export interface CreatePublicationInput {
  generatedContentId: string;
  contentCandidateId: string;
  researchItemId: string;
  strategyType: XPublicationStrategyType;
  strategyVersion?: string;
  experimentGroup?: string | null;
  scheduledAt?: Date | null;
  status?: XPublicationStatus;
  idempotencyKey?: string;
  posts: CreatePublicationPostInput[];
}

export type PublicationWithPosts = XPublication & { posts: XPublicationPost[] };

const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;

export class XPublicationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  buildIdempotencyKey(parts: {
    generatedContentId: string;
    strategyType: string;
    scheduledAt?: Date | null;
  }): string {
    const raw = [
      parts.generatedContentId,
      parts.strategyType,
      parts.scheduledAt?.toISOString() ?? "immediate",
    ].join("|");
    return createHash("sha256").update(raw).digest("hex");
  }

  async createPublication(input: CreatePublicationInput): Promise<PublicationWithPosts> {
    const idempotencyKey =
      input.idempotencyKey ??
      this.buildIdempotencyKey({
        generatedContentId: input.generatedContentId,
        strategyType: input.strategyType,
        scheduledAt: input.scheduledAt,
      });

    const existing = await this.prisma.xPublication.findUnique({
      where: { idempotencyKey },
      include: { posts: { orderBy: { sequence: "asc" } } },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.xPublication.create({
      data: {
        generatedContentId: input.generatedContentId,
        contentCandidateId: input.contentCandidateId,
        researchItemId: input.researchItemId,
        strategyType: input.strategyType,
        strategyVersion: input.strategyVersion ?? "x-strategy-v1",
        experimentGroup: input.experimentGroup ?? null,
        scheduledAt: input.scheduledAt ?? null,
        status: input.status ?? (input.scheduledAt ? "SCHEDULED" : "DRAFT"),
        idempotencyKey,
        posts: {
          create: input.posts.map((post) => ({
            sequence: post.sequence,
            role: post.role,
            body: post.body,
            bodyHash: post.bodyHash ?? null,
            weightedLength: post.weightedLength,
            replyToSequence: post.replyToSequence ?? null,
            relatedPublicationId: post.relatedPublicationId ?? null,
            status: "PENDING",
          })),
        },
      },
      include: { posts: { orderBy: { sequence: "asc" } } },
    });
  }

  async findById(id: string): Promise<PublicationWithPosts | null> {
    return this.prisma.xPublication.findUnique({
      where: { id },
      include: { posts: { orderBy: { sequence: "asc" } } },
    });
  }

  async list(options: {
    status?: XPublicationStatus;
    strategyType?: XPublicationStrategyType;
    limit?: number;
  }): Promise<PublicationWithPosts[]> {
    return this.prisma.xPublication.findMany({
      where: {
        ...(options.status ? { status: options.status } : {}),
        ...(options.strategyType ? { strategyType: options.strategyType } : {}),
      },
      include: { posts: { orderBy: { sequence: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(options.limit ?? 50, 200)),
    });
  }

  async schedule(id: string, scheduledAt: Date): Promise<PublicationWithPosts> {
    const pub = await this.requirePublication(id);
    if (pub.status === "PUBLISHED" || pub.status === "PUBLISHING") {
      throw new XPublicationStateError(`cannot schedule publication in status ${pub.status}`);
    }
    if (pub.status === "CANCELLED" || pub.status === "DELETED") {
      throw new XPublicationStateError(`cannot schedule publication in status ${pub.status}`);
    }
    // BLOCKED may be rescheduled after guard conditions clear
    return this.prisma.xPublication.update({
      where: { id },
      data: {
        status: "SCHEDULED",
        scheduledAt,
        nextRetryAt: null,
        lastErrorType: null,
        lastErrorMessage: null,
      },
      include: { posts: { orderBy: { sequence: "asc" } } },
    });
  }

  async cancel(id: string): Promise<PublicationWithPosts> {
    const pub = await this.requirePublication(id);
    if (pub.status === "PUBLISHED" || pub.status === "PUBLISHING") {
      throw new XPublicationStateError(`cannot cancel publication in status ${pub.status}`);
    }
    await this.prisma.xPublicationPost.updateMany({
      where: { publicationId: id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "CANCELLED" },
    });
    return this.prisma.xPublication.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: { posts: { orderBy: { sequence: "asc" } } },
    });
  }

  async listDueForPublish(now: Date, limit = 20): Promise<PublicationWithPosts[]> {
    return this.prisma.xPublication.findMany({
      where: {
        OR: [
          { status: "SCHEDULED", scheduledAt: { lte: now } },
          { status: "PARTIALLY_PUBLISHED", nextRetryAt: { lte: now } },
          { status: "FAILED", nextRetryAt: { lte: now } },
        ],
      },
      include: { posts: { orderBy: { sequence: "asc" } } },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      take: Math.max(1, Math.min(limit, 100)),
    });
  }

  async acquireLock(
    publicationId: string,
    ownerId: string,
    ttlMs = DEFAULT_LOCK_TTL_MS,
  ): Promise<boolean> {
    const lockKey = `x-pub:${publicationId}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    await this.prisma.xPublicationLock.deleteMany({
      where: { lockKey, expiresAt: { lt: now } },
    });
    try {
      await this.prisma.xPublicationLock.create({
        data: { publicationId, lockKey, ownerId, expiresAt },
      });
      return true;
    } catch {
      return false;
    }
  }

  async releaseLock(publicationId: string, ownerId: string): Promise<void> {
    await this.prisma.xPublicationLock.deleteMany({
      where: { publicationId, ownerId },
    });
  }

  async markPublishing(id: string): Promise<PublicationWithPosts> {
    return this.prisma.xPublication.update({
      where: { id },
      data: {
        status: "PUBLISHING",
        publishingStartedAt: new Date(),
        attemptCount: { increment: 1 },
      },
      include: { posts: { orderBy: { sequence: "asc" } } },
    });
  }

  async markPostPublishing(postId: string): Promise<XPublicationPost> {
    return this.prisma.xPublicationPost.update({
      where: { id: postId },
      data: { status: "PUBLISHING", attemptCount: { increment: 1 } },
    });
  }

  async markPostPublished(
    postId: string,
    data: { xPostId: string; xPostUrl?: string | null; publishedAt: Date },
  ): Promise<XPublicationPost> {
    return this.prisma.xPublicationPost.update({
      where: { id: postId },
      data: {
        status: "PUBLISHED",
        xPostId: data.xPostId,
        xPostUrl: data.xPostUrl ?? null,
        publishedAt: data.publishedAt,
        lastErrorType: null,
        lastErrorMessage: null,
      },
    });
  }

  async markPostFailed(
    postId: string,
    errorType: string,
    errorMessage: string,
  ): Promise<XPublicationPost> {
    return this.prisma.xPublicationPost.update({
      where: { id: postId },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        lastErrorType: errorType,
        lastErrorMessage: errorMessage,
      },
    });
  }

  async markPostSkipped(postId: string, reason: string): Promise<XPublicationPost> {
    return this.prisma.xPublicationPost.update({
      where: { id: postId },
      data: {
        status: "SKIPPED",
        lastErrorType: "Skipped",
        lastErrorMessage: reason,
      },
    });
  }

  async setRootFields(
    id: string,
    data: {
      rootPostId?: string | null;
      rootPostUrl?: string | null;
      conversationId?: string | null;
      accountId?: string | null;
    },
  ): Promise<void> {
    await this.prisma.xPublication.update({
      where: { id },
      data: {
        rootPostId: data.rootPostId ?? undefined,
        rootPostUrl: data.rootPostUrl ?? undefined,
        conversationId: data.conversationId ?? undefined,
        accountId: data.accountId ?? undefined,
      },
    });
  }

  async completePublication(
    id: string,
    data: {
      status: "PUBLISHED" | "PUBLISHED_UNVERIFIED" | "PARTIALLY_PUBLISHED" | "FAILED";
      rootPostId?: string | null;
      rootPostUrl?: string | null;
      conversationId?: string | null;
      accountId?: string | null;
      errorType?: string | null;
      errorMessage?: string | null;
      nextRetryAt?: Date | null;
    },
  ): Promise<PublicationWithPosts> {
    return this.prisma.xPublication.update({
      where: { id },
      data: {
        status: data.status,
        rootPostId: data.rootPostId ?? undefined,
        rootPostUrl: data.rootPostUrl ?? undefined,
        conversationId: data.conversationId ?? undefined,
        accountId: data.accountId ?? undefined,
        lastErrorType: data.errorType ?? null,
        lastErrorMessage: data.errorMessage ?? null,
        nextRetryAt: data.nextRetryAt ?? null,
        publishedAt:
          data.status === "PUBLISHED" || data.status === "PUBLISHED_UNVERIFIED"
            ? new Date()
            : undefined,
        failedAt: data.status === "FAILED" ? new Date() : undefined,
      },
      include: { posts: { orderBy: { sequence: "asc" } } },
    });
  }

  async listPublishedWithPosts(options: {
    since?: Date;
    limit?: number;
  }): Promise<PublicationWithPosts[]> {
    return this.prisma.xPublication.findMany({
      where: {
        status: { in: ["PUBLISHED", "PUBLISHED_UNVERIFIED", "PARTIALLY_PUBLISHED"] },
        ...(options.since ? { publishedAt: { gte: options.since } } : {}),
      },
      include: { posts: { orderBy: { sequence: "asc" } } },
      orderBy: { publishedAt: "desc" },
      take: Math.max(1, Math.min(options.limit ?? 100, 500)),
    });
  }

  async findRelatedPublications(options: {
    excludeResearchItemId: string;
    lookbackDays: number;
    limit?: number;
  }): Promise<PublicationWithPosts[]> {
    const since = new Date(Date.now() - options.lookbackDays * 24 * 60 * 60 * 1000);
    return this.prisma.xPublication.findMany({
      where: {
        status: "PUBLISHED",
        rootPostUrl: { not: null },
        researchItemId: { not: options.excludeResearchItemId },
        publishedAt: { gte: since },
      },
      include: { posts: { orderBy: { sequence: "asc" } } },
      orderBy: { publishedAt: "desc" },
      take: Math.max(1, Math.min(options.limit ?? 50, 100)),
    });
  }

  async hasMetricForWindow(
    xPostId: string,
    windowMinutes: number,
  ): Promise<boolean> {
    const count = await this.prisma.xPostMetricSnapshot.count({
      where: { xPostId, collectionWindowMinutes: windowMinutes },
    });
    return count > 0;
  }

  async saveMetricSnapshot(input: {
    publicationId: string;
    publicationPostId?: string | null;
    xPostId: string;
    measuredAt: Date;
    impressionCount: number | null;
    likeCount: number | null;
    replyCount: number | null;
    repostCount: number | null;
    quoteCount: number | null;
    bookmarkCount: number | null;
    urlClickCount: number | null;
    profileClickCount: number | null;
    detailExpandCount: number | null;
    mediaViewCount: number | null;
    followerCountAtMeasurement: number | null;
    rawMetricAvailability: Record<string, unknown>;
    source: string;
    collectionWindowMinutes?: number | null;
    metricsVersion?: string;
  }): Promise<XPostMetricSnapshot> {
    try {
      return await this.prisma.xPostMetricSnapshot.create({
        data: {
          publicationId: input.publicationId,
          publicationPostId: input.publicationPostId ?? null,
          xPostId: input.xPostId,
          measuredAt: input.measuredAt,
          impressionCount: input.impressionCount,
          likeCount: input.likeCount,
          replyCount: input.replyCount,
          repostCount: input.repostCount,
          quoteCount: input.quoteCount,
          bookmarkCount: input.bookmarkCount,
          urlClickCount: input.urlClickCount,
          profileClickCount: input.profileClickCount,
          detailExpandCount: input.detailExpandCount,
          mediaViewCount: input.mediaViewCount,
          followerCountAtMeasurement: input.followerCountAtMeasurement,
          rawMetricAvailability: input.rawMetricAvailability as Prisma.InputJsonValue,
          source: input.source,
          collectionWindowMinutes: input.collectionWindowMinutes ?? null,
          metricsVersion: input.metricsVersion ?? "x-metrics-v1",
        },
      });
    } catch (error) {
      // unique(xPostId, measuredAt) — treat as idempotent skip
      const existing = await this.prisma.xPostMetricSnapshot.findFirst({
        where: { xPostId: input.xPostId, measuredAt: input.measuredAt },
      });
      if (existing) return existing;
      throw error;
    }
  }

  async listMetricSnapshots(options: {
    publicationId?: string;
    limit?: number;
  }): Promise<XPostMetricSnapshot[]> {
    return this.prisma.xPostMetricSnapshot.findMany({
      where: options.publicationId ? { publicationId: options.publicationId } : {},
      orderBy: { measuredAt: "desc" },
      take: Math.max(1, Math.min(options.limit ?? 50, 200)),
    });
  }

  async saveStrategyPerformance(input: {
    strategyType: XPublicationStrategyType;
    strategyVersion: string;
    evaluationWindowHours: number;
    sampleCount: number;
    eligibleSampleCount: number;
    averageImpressions: number | null;
    medianImpressions: number | null;
    averageEngagementRate: number | null;
    medianEngagementRate: number | null;
    averageUrlClickRate: number | null;
    averageProfileClickRate: number | null;
    averageReplyContinuationRate: number | null;
    confidenceLevel: XStrategyConfidenceLevel;
    score: number | null;
    recommendedStrategy?: XPublicationStrategyType | null;
    supportingMetrics?: Record<string, unknown> | null;
    dataLimitations?: Record<string, unknown> | null;
    calculatedAt: Date;
    parameters: Record<string, unknown>;
  }): Promise<XStrategyPerformance> {
    return this.prisma.xStrategyPerformance.create({
      data: {
        strategyType: input.strategyType,
        strategyVersion: input.strategyVersion,
        evaluationWindowHours: input.evaluationWindowHours,
        sampleCount: input.sampleCount,
        eligibleSampleCount: input.eligibleSampleCount,
        averageImpressions: input.averageImpressions,
        medianImpressions: input.medianImpressions,
        averageEngagementRate: input.averageEngagementRate,
        medianEngagementRate: input.medianEngagementRate,
        averageUrlClickRate: input.averageUrlClickRate,
        averageProfileClickRate: input.averageProfileClickRate,
        averageReplyContinuationRate: input.averageReplyContinuationRate,
        confidenceLevel: input.confidenceLevel,
        score: input.score,
        recommendedStrategy: input.recommendedStrategy ?? null,
        supportingMetrics: (input.supportingMetrics ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        dataLimitations: (input.dataLimitations ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        calculatedAt: input.calculatedAt,
        parameters: input.parameters as Prisma.InputJsonValue,
      },
    });
  }

  async listLatestStrategyPerformances(limit = 20): Promise<XStrategyPerformance[]> {
    return this.prisma.xStrategyPerformance.findMany({
      orderBy: { calculatedAt: "desc" },
      take: Math.max(1, Math.min(limit, 100)),
    });
  }

  async createExperiment(input: {
    name: string;
    strategyVariants: unknown;
    allocationMethod?: XExperimentAllocationMethod;
    minimumSampleSize?: number;
    evaluationWindowHours?: number;
  }): Promise<XPublicationExperiment> {
    return this.prisma.xPublicationExperiment.create({
      data: {
        name: input.name,
        strategyVariants: input.strategyVariants as Prisma.InputJsonValue,
        allocationMethod: input.allocationMethod ?? "ROUND_ROBIN",
        minimumSampleSize: input.minimumSampleSize ?? 30,
        evaluationWindowHours: input.evaluationWindowHours ?? 72,
        status: "DRAFT",
      },
    });
  }

  async listExperiments(limit = 20): Promise<XPublicationExperiment[]> {
    return this.prisma.xPublicationExperiment.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 100)),
    });
  }

  async findExperimentById(id: string): Promise<XPublicationExperiment | null> {
    return this.prisma.xPublicationExperiment.findUnique({ where: { id } });
  }

  async findRunningExperiment(): Promise<XPublicationExperiment | null> {
    return this.prisma.xPublicationExperiment.findFirst({
      where: { status: "RUNNING" },
      orderBy: { startedAt: "desc" },
    });
  }

  async updateExperimentStatus(
    id: string,
    status: XExperimentStatus,
    extra?: { result?: Record<string, unknown>; startedAt?: Date; endedAt?: Date },
  ): Promise<XPublicationExperiment> {
    return this.prisma.xPublicationExperiment.update({
      where: { id },
      data: {
        status,
        ...(extra?.result ? { result: extra.result as Prisma.InputJsonValue } : {}),
        ...(extra?.startedAt ? { startedAt: extra.startedAt } : {}),
        ...(extra?.endedAt ? { endedAt: extra.endedAt } : {}),
      },
    });
  }

  async incrementExperimentCursor(id: string): Promise<number> {
    const updated = await this.prisma.xPublicationExperiment.update({
      where: { id },
      data: { allocationCursor: { increment: 1 } },
    });
    return updated.allocationCursor;
  }

  async countByStrategy(strategyType: XPublicationStrategyType): Promise<number> {
    return this.prisma.xPublication.count({
      where: {
        strategyType,
        status: { in: ["PUBLISHED", "PARTIALLY_PUBLISHED", "SCHEDULED", "PUBLISHING"] },
      },
    });
  }

  newOwnerId(): string {
    return randomUUID();
  }

  private async requirePublication(id: string): Promise<XPublication> {
    const pub = await this.prisma.xPublication.findUnique({ where: { id } });
    if (!pub) {
      throw new XPublicationStateError(`publication not found: ${id}`);
    }
    return pub;
  }
}
