import { randomUUID } from "node:crypto";
import type {
  Prisma,
  PrismaClient,
  ResearchSchedule,
  ResearchScheduleRun,
  ResearchScheduleRunStatus,
  ResearchScheduleTriggerType,
  ResearchScheduleType,
} from "@prisma/client";
import { LockError } from "./job-repository.js";

export const DEFAULT_SCHEDULE_LOCK_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_SCHEDULE_GRACE_MS = 15 * 60 * 1000;
export const DEFAULT_SCHEDULER_BATCH_SIZE = 20;

export interface ScheduleParameters {
  service?: string;
  floor?: string;
  keyword?: string;
  sort?: string;
  hits?: number;
  startOffset?: number;
  maxPages?: number;
  maxItems?: number;
  fromDate?: string;
  toDate?: string;
  dryRun?: boolean;
  continueOnItemError?: boolean;
  [key: string]: unknown;
}

export interface CreateScheduleInput {
  name: string;
  providerName: string;
  scheduleType: ResearchScheduleType;
  cronExpression?: string | null;
  timezone?: string;
  parameters: ScheduleParameters;
  isActive?: boolean;
  nextRunAt?: Date | null;
}

export interface UpdateScheduleInput {
  name?: string;
  providerName?: string;
  scheduleType?: ResearchScheduleType;
  cronExpression?: string | null;
  timezone?: string;
  parameters?: ScheduleParameters;
  isActive?: boolean;
  nextRunAt?: Date | null;
}

export interface RecordScheduleRunInput {
  scheduleId: string;
  triggerType: ResearchScheduleTriggerType;
  scheduledFor?: Date | null;
  jobId?: string | null;
  status?: ResearchScheduleRunStatus;
  startedAt?: Date | null;
  errorMessage?: string | null;
  errorType?: string | null;
  retryOfRunId?: string | null;
  rootRunId?: string | null;
  retryAttempt?: number;
  maxRetryAttempts?: number | null;
  nextRetryAt?: Date | null;
}

export interface CompleteScheduleRunInput {
  runId: string;
  status: Extract<
    ResearchScheduleRunStatus,
    "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED" | "SKIPPED"
  >;
  jobId?: string | null;
  errorMessage?: string | null;
  errorType?: string | null;
  nextRetryAt?: Date | null;
  maxRetryAttempts?: number | null;
  completedAt?: Date;
}

export class ScheduleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createSchedule(input: CreateScheduleInput): Promise<ResearchSchedule> {
    return this.prisma.researchSchedule.create({
      data: {
        name: input.name,
        providerName: input.providerName,
        scheduleType: input.scheduleType,
        cronExpression: input.cronExpression ?? null,
        timezone: input.timezone ?? "Asia/Tokyo",
        parameters: input.parameters as Prisma.InputJsonValue,
        isActive: input.isActive ?? true,
        nextRunAt: input.nextRunAt ?? null,
      },
    });
  }

  async updateSchedule(id: string, input: UpdateScheduleInput): Promise<ResearchSchedule> {
    const existing = await this.requireActiveSchedule(id);
    return this.prisma.researchSchedule.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        providerName: input.providerName,
        scheduleType: input.scheduleType,
        cronExpression: input.cronExpression === undefined ? undefined : input.cronExpression,
        timezone: input.timezone,
        parameters:
          input.parameters === undefined
            ? undefined
            : (input.parameters as Prisma.InputJsonValue),
        isActive: input.isActive,
        nextRunAt: input.nextRunAt === undefined ? undefined : input.nextRunAt,
      },
    });
  }

  /** Soft-delete so run history remains intact. */
  async deleteSchedule(id: string): Promise<ResearchSchedule> {
    const existing = await this.requireActiveSchedule(id);
    return this.prisma.researchSchedule.update({
      where: { id: existing.id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        nextRunAt: null,
      },
    });
  }

  async pauseSchedule(id: string): Promise<ResearchSchedule> {
    const existing = await this.requireActiveSchedule(id);
    return this.prisma.researchSchedule.update({
      where: { id: existing.id },
      data: { isActive: false },
    });
  }

  async resumeSchedule(id: string, nextRunAt?: Date | null): Promise<ResearchSchedule> {
    const existing = await this.requireActiveSchedule(id);
    return this.prisma.researchSchedule.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        ...(nextRunAt !== undefined ? { nextRunAt } : {}),
      },
    });
  }

  async findScheduleById(id: string, options?: { includeDeleted?: boolean }): Promise<ResearchSchedule | null> {
    const schedule = await this.prisma.researchSchedule.findUnique({ where: { id } });
    if (!schedule) {
      return null;
    }
    if (!options?.includeDeleted && schedule.deletedAt) {
      return null;
    }
    return schedule;
  }

  /** Latest non-deleted schedule with the given stable name (system auto schedules). */
  async findScheduleByName(name: string): Promise<ResearchSchedule | null> {
    return this.prisma.researchSchedule.findFirst({
      where: { name, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  async listSchedules(options?: {
    includeDeleted?: boolean;
    includeInactive?: boolean;
    limit?: number;
  }): Promise<ResearchSchedule[]> {
    const limit = Math.max(1, Math.min(options?.limit ?? 100, 200));
    return this.prisma.researchSchedule.findMany({
      where: {
        ...(options?.includeDeleted ? {} : { deletedAt: null }),
        ...(options?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ nextRunAt: "asc" }, { createdAt: "desc" }],
      take: limit,
    });
  }

  /**
   * Schedules whose nextRunAt is due (nextRunAt <= now).
   * Caller applies grace-window skip for very stale nextRunAt values.
   */
  async findDueSchedules(
    now: Date = new Date(),
    limit: number = DEFAULT_SCHEDULER_BATCH_SIZE,
  ): Promise<ResearchSchedule[]> {
    return this.prisma.researchSchedule.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        scheduleType: "CRON",
        nextRunAt: { lte: now },
      },
      orderBy: { nextRunAt: "asc" },
      take: Math.max(1, Math.min(limit, DEFAULT_SCHEDULER_BATCH_SIZE)),
    });
  }

  async updateNextRunAt(id: string, nextRunAt: Date | null): Promise<ResearchSchedule> {
    return this.prisma.researchSchedule.update({
      where: { id },
      data: { nextRunAt },
    });
  }

  async recordScheduleRun(input: RecordScheduleRunInput): Promise<ResearchScheduleRun> {
    const created = await this.prisma.researchScheduleRun.create({
      data: {
        scheduleId: input.scheduleId,
        triggerType: input.triggerType,
        scheduledFor: input.scheduledFor ?? null,
        jobId: input.jobId ?? null,
        status: input.status ?? "PENDING",
        startedAt: input.startedAt ?? null,
        errorMessage: input.errorMessage ?? null,
        errorType: input.errorType ?? null,
        retryOfRunId: input.retryOfRunId ?? null,
        rootRunId: input.rootRunId ?? null,
        retryAttempt: input.retryAttempt ?? 0,
        maxRetryAttempts: input.maxRetryAttempts ?? null,
        nextRetryAt: input.nextRetryAt ?? null,
      },
    });
    if (!created.rootRunId) {
      return this.prisma.researchScheduleRun.update({
        where: { id: created.id },
        data: { rootRunId: created.id },
      });
    }
    return created;
  }

  async completeScheduleRun(input: CompleteScheduleRunInput): Promise<ResearchScheduleRun> {
    return this.prisma.researchScheduleRun.update({
      where: { id: input.runId },
      data: {
        status: input.status,
        jobId: input.jobId === undefined ? undefined : input.jobId,
        errorMessage: input.errorMessage === undefined ? undefined : input.errorMessage,
        errorType: input.errorType === undefined ? undefined : input.errorType,
        nextRetryAt: input.nextRetryAt === undefined ? undefined : input.nextRetryAt,
        maxRetryAttempts:
          input.maxRetryAttempts === undefined ? undefined : input.maxRetryAttempts,
        completedAt: input.completedAt ?? new Date(),
      },
    });
  }

  async failScheduleRun(runId: string, errorMessage: string, jobId?: string | null): Promise<ResearchScheduleRun> {
    return this.completeScheduleRun({
      runId,
      status: "FAILED",
      errorMessage,
      jobId,
    });
  }

  async incrementFailureCount(id: string): Promise<ResearchSchedule> {
    return this.prisma.researchSchedule.update({
      where: { id },
      data: { consecutiveFailureCount: { increment: 1 } },
    });
  }

  async resetFailureCount(id: string): Promise<ResearchSchedule> {
    return this.prisma.researchSchedule.update({
      where: { id },
      data: { consecutiveFailureCount: 0 },
    });
  }

  async markScheduleAfterRun(input: {
    scheduleId: string;
    lastRunAt: Date;
    lastJobId?: string | null;
    nextRunAt?: Date | null;
    resetFailures?: boolean;
    incrementFailures?: boolean;
    deactivate?: boolean;
  }): Promise<ResearchSchedule> {
    const data: Prisma.ResearchScheduleUpdateInput = {
      lastRunAt: input.lastRunAt,
      lastJobId: input.lastJobId === undefined ? undefined : input.lastJobId,
      nextRunAt: input.nextRunAt === undefined ? undefined : input.nextRunAt,
    };
    if (input.resetFailures) {
      data.consecutiveFailureCount = 0;
    } else if (input.incrementFailures) {
      data.consecutiveFailureCount = { increment: 1 };
    }
    if (input.deactivate) {
      data.isActive = false;
    }
    return this.prisma.researchSchedule.update({
      where: { id: input.scheduleId },
      data,
    });
  }

  async findRunByScheduleAndScheduledFor(
    scheduleId: string,
    scheduledFor: Date,
  ): Promise<ResearchScheduleRun | null> {
    return this.prisma.researchScheduleRun.findFirst({
      where: { scheduleId, scheduledFor },
    });
  }

  async findActiveRunForSchedule(scheduleId: string): Promise<ResearchScheduleRun | null> {
    return this.prisma.researchScheduleRun.findFirst({
      where: {
        scheduleId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async listRunsForSchedule(scheduleId: string, limit = 20): Promise<ResearchScheduleRun[]> {
    return this.prisma.researchScheduleRun.findMany({
      where: { scheduleId },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 100)),
    });
  }

  async findRunById(id: string): Promise<ResearchScheduleRun | null> {
    return this.prisma.researchScheduleRun.findUnique({ where: { id } });
  }

  async findDueRetries(
    now: Date = new Date(),
    limit: number = DEFAULT_SCHEDULER_BATCH_SIZE,
  ): Promise<ResearchScheduleRun[]> {
    return this.prisma.researchScheduleRun.findMany({
      where: {
        status: "FAILED",
        nextRetryAt: { lte: now, not: null },
      },
      orderBy: { nextRetryAt: "asc" },
      take: Math.max(1, Math.min(limit, DEFAULT_SCHEDULER_BATCH_SIZE)),
    });
  }

  async listPendingRetries(limit = 50): Promise<ResearchScheduleRun[]> {
    return this.prisma.researchScheduleRun.findMany({
      where: {
        status: "FAILED",
        nextRetryAt: { not: null },
      },
      orderBy: { nextRetryAt: "asc" },
      take: Math.max(1, Math.min(limit, 100)),
    });
  }

  async findActiveRetryForRoot(rootRunId: string): Promise<ResearchScheduleRun | null> {
    return this.prisma.researchScheduleRun.findFirst({
      where: {
        OR: [{ rootRunId }, { id: rootRunId }],
        status: { in: ["PENDING", "RUNNING"] },
        triggerType: "RETRY",
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async clearNextRetryAt(runId: string): Promise<ResearchScheduleRun> {
    return this.prisma.researchScheduleRun.update({
      where: { id: runId },
      data: { nextRetryAt: null },
    });
  }

  async setRootRunId(runId: string, rootRunId: string): Promise<ResearchScheduleRun> {
    return this.prisma.researchScheduleRun.update({
      where: { id: runId },
      data: { rootRunId },
    });
  }

  async scheduleNextRetry(input: {
    runId: string;
    nextRetryAt: Date;
    maxRetryAttempts: number;
    errorType?: string | null;
    errorMessage?: string | null;
  }): Promise<ResearchScheduleRun> {
    return this.prisma.researchScheduleRun.update({
      where: { id: input.runId },
      data: {
        nextRetryAt: input.nextRetryAt,
        maxRetryAttempts: input.maxRetryAttempts,
        errorType: input.errorType === undefined ? undefined : input.errorType,
        errorMessage: input.errorMessage === undefined ? undefined : input.errorMessage,
      },
    });
  }

  async acquireScheduleLock(
    scheduleId: string,
    ttlMs: number = DEFAULT_SCHEDULE_LOCK_TTL_MS,
  ): Promise<string> {
    const ownerToken = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.researchScheduleLock.findUnique({ where: { scheduleId } });
      if (existing) {
        if (existing.expiresAt > now) {
          throw new LockError("Another process holds an active lock for this schedule");
        }
        await tx.researchScheduleLock.delete({ where: { scheduleId } });
      }
      await tx.researchScheduleLock.create({
        data: {
          scheduleId,
          ownerToken,
          acquiredAt: now,
          expiresAt,
        },
      });
    });

    return ownerToken;
  }

  async releaseScheduleLock(scheduleId: string, ownerToken: string): Promise<void> {
    await this.prisma.researchScheduleLock.deleteMany({
      where: { scheduleId, ownerToken },
    });
  }

  private async requireActiveSchedule(id: string): Promise<ResearchSchedule> {
    const schedule = await this.prisma.researchSchedule.findUnique({ where: { id } });
    if (!schedule || schedule.deletedAt) {
      throw new Error(`Schedule not found: ${id}`);
    }
    return schedule;
  }
}
