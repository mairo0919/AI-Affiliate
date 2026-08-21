import type { Prisma, PrismaClient, ResearchJob, ResearchJobStatus, ResearchJobType } from "@prisma/client";

export class JobStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobStateError";
  }
}

export class LockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockError";
  }
}

export interface CreateJobInput {
  providerName: string;
  jobType: ResearchJobType;
  parameters: Prisma.InputJsonValue;
  currentOffset?: number;
  nextOffset?: number | null;
  resumedFromJobId?: string;
}

export interface ProgressUpdate {
  currentOffset?: number | null;
  nextOffset?: number | null;
  fetchedCount?: number;
  mappedCount?: number;
  savedCount?: number;
  updatedCount?: number;
  skippedCount?: number;
  errorCount?: number;
  pagesProcessed?: number;
  lastHeartbeatAt?: Date;
}

export interface RecordJobErrorInput {
  jobId: string;
  providerName: string;
  stage: string;
  externalId?: string;
  offset?: number;
  errorType: string;
  message: string;
  retryable?: boolean;
}

const TERMINAL: ReadonlySet<ResearchJobStatus> = new Set([
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "FAILED",
  "CANCELLED",
]);

function assertTransition(from: ResearchJobStatus, to: ResearchJobStatus): void {
  if (from === to) {
    return;
  }
  if (TERMINAL.has(from)) {
    throw new JobStateError(`Invalid job transition: ${from} -> ${to}`);
  }
  if (from === "PENDING" && (to === "RUNNING" || to === "CANCELLED" || to === "FAILED")) {
    return;
  }
  if (
    from === "RUNNING" &&
    (to === "COMPLETED" ||
      to === "PARTIALLY_COMPLETED" ||
      to === "FAILED" ||
      to === "CANCELLED")
  ) {
    return;
  }
  throw new JobStateError(`Invalid job transition: ${from} -> ${to}`);
}

export const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;

export class JobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createJob(input: CreateJobInput): Promise<ResearchJob> {
    return this.prisma.researchJob.create({
      data: {
        providerName: input.providerName,
        jobType: input.jobType,
        status: "PENDING",
        parameters: input.parameters,
        currentOffset: input.currentOffset,
        nextOffset: input.nextOffset ?? undefined,
        resumedFromJobId: input.resumedFromJobId,
      },
    });
  }

  async startJob(jobId: string): Promise<ResearchJob> {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.researchJob.findUniqueOrThrow({ where: { id: jobId } });
      assertTransition(job.status, "RUNNING");
      const now = new Date();
      return tx.researchJob.update({
        where: { id: jobId },
        data: {
          status: "RUNNING",
          startedAt: now,
          lastHeartbeatAt: now,
        },
      });
    });
  }

  async updateProgress(jobId: string, progress: ProgressUpdate): Promise<ResearchJob> {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.researchJob.findUniqueOrThrow({ where: { id: jobId } });
      if (job.status !== "RUNNING") {
        throw new JobStateError(`Cannot update progress for job in status ${job.status}`);
      }
      return tx.researchJob.update({
        where: { id: jobId },
        data: {
          currentOffset: progress.currentOffset ?? undefined,
          nextOffset: progress.nextOffset === undefined ? undefined : progress.nextOffset,
          fetchedCount: progress.fetchedCount,
          mappedCount: progress.mappedCount,
          savedCount: progress.savedCount,
          updatedCount: progress.updatedCount,
          skippedCount: progress.skippedCount,
          errorCount: progress.errorCount,
          pagesProcessed: progress.pagesProcessed,
          lastHeartbeatAt: progress.lastHeartbeatAt ?? new Date(),
        },
      });
    });
  }

  async completeJob(jobId: string): Promise<ResearchJob> {
    return this.finishJob(jobId, "COMPLETED");
  }

  async partiallyCompleteJob(jobId: string, errorMessage?: string): Promise<ResearchJob> {
    return this.finishJob(jobId, "PARTIALLY_COMPLETED", errorMessage);
  }

  async failJob(jobId: string, errorMessage: string): Promise<ResearchJob> {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.researchJob.findUniqueOrThrow({ where: { id: jobId } });
      assertTransition(job.status, "FAILED");
      const now = new Date();
      return tx.researchJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          failedAt: now,
          completedAt: now,
          errorMessage,
          lastHeartbeatAt: now,
        },
      });
    });
  }

  async cancelJob(jobId: string): Promise<ResearchJob> {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.researchJob.findUniqueOrThrow({ where: { id: jobId } });
      if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "PARTIALLY_COMPLETED") {
        throw new JobStateError(`Cannot cancel job in status ${job.status}`);
      }
      if (job.status === "CANCELLED") {
        return job;
      }
      if (job.status === "PENDING") {
        assertTransition(job.status, "CANCELLED");
        return tx.researchJob.update({
          where: { id: jobId },
          data: {
            status: "CANCELLED",
            cancelRequested: true,
            completedAt: new Date(),
          },
        });
      }
      // RUNNING: request cancel; runner will stop at page boundary
      return tx.researchJob.update({
        where: { id: jobId },
        data: { cancelRequested: true },
      });
    });
  }

  async markCancelled(jobId: string): Promise<ResearchJob> {
    return this.finishJob(jobId, "CANCELLED");
  }

  async isCancelRequested(jobId: string): Promise<boolean> {
    const job = await this.prisma.researchJob.findUniqueOrThrow({ where: { id: jobId } });
    return job.cancelRequested || job.status === "CANCELLED";
  }

  async recordJobError(input: RecordJobErrorInput): Promise<void> {
    await this.prisma.researchJobError.create({
      data: {
        jobId: input.jobId,
        providerName: input.providerName,
        stage: input.stage,
        externalId: input.externalId,
        offset: input.offset,
        errorType: input.errorType,
        message: input.message,
        retryable: input.retryable ?? false,
      },
    });
  }

  async acquireLock(
    lockKey: string,
    jobId: string,
    ttlMs: number = DEFAULT_LOCK_TTL_MS,
  ): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.researchJobLock.findUnique({ where: { lockKey } });
      if (existing) {
        if (existing.expiresAt > now && existing.jobId !== jobId) {
          throw new LockError("Another job holds an active lock for this key");
        }
        await tx.researchJobLock.delete({ where: { lockKey } });
      }

      await tx.researchJobLock.create({
        data: {
          lockKey,
          jobId,
          acquiredAt: now,
          expiresAt,
        },
      });
    });
  }

  async refreshLock(lockKey: string, jobId: string, ttlMs: number = DEFAULT_LOCK_TTL_MS): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const updated = await this.prisma.researchJobLock.updateMany({
      where: { lockKey, jobId },
      data: { expiresAt, updatedAt: now },
    });
    if (updated.count === 0) {
      throw new LockError("Failed to refresh lock: lock not held by this job");
    }
  }

  async releaseLock(lockKey: string, jobId: string): Promise<void> {
    await this.prisma.researchJobLock.deleteMany({
      where: { lockKey, jobId },
    });
  }

  async findJobById(jobId: string): Promise<ResearchJob | null> {
    return this.prisma.researchJob.findUnique({ where: { id: jobId } });
  }

  async listRecentJobs(limit = 20): Promise<ResearchJob[]> {
    return this.prisma.researchJob.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 100)),
    });
  }

  async findLatestJobError(jobId: string): Promise<{
    errorType: string;
    message: string;
    retryable: boolean;
  } | null> {
    const error = await this.prisma.researchJobError.findFirst({
      where: { jobId },
      orderBy: { createdAt: "desc" },
    });
    if (!error) {
      return null;
    }
    return {
      errorType: error.errorType,
      message: error.message,
      retryable: error.retryable,
    };
  }

  private async finishJob(
    jobId: string,
    status: "COMPLETED" | "PARTIALLY_COMPLETED" | "CANCELLED",
    errorMessage?: string,
  ): Promise<ResearchJob> {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.researchJob.findUniqueOrThrow({ where: { id: jobId } });
      assertTransition(job.status, status);
      const now = new Date();
      return tx.researchJob.update({
        where: { id: jobId },
        data: {
          status,
          completedAt: now,
          lastHeartbeatAt: now,
          errorMessage: errorMessage ?? job.errorMessage,
        },
      });
    });
  }
}

export function buildLockKey(parts: {
  providerName: string;
  service?: string;
  floor?: string;
  keyword?: string;
  sort?: string;
  fromDate?: string;
  toDate?: string;
}): string {
  const normalized = {
    providerName: parts.providerName,
    service: parts.service ?? "",
    floor: parts.floor ?? "",
    keyword: parts.keyword ?? "",
    sort: parts.sort ?? "",
    fromDate: parts.fromDate ?? "",
    toDate: parts.toDate ?? "",
  };
  // Stable key order
  return JSON.stringify(normalized);
}
