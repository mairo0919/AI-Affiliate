import { createHash } from "node:crypto";
import type {
  Prisma,
  PrismaClient,
  ResearchNotification,
  ResearchNotificationAttempt,
  ResearchNotificationChannelType,
  ResearchNotificationEventType,
  ResearchNotificationStatus,
} from "@prisma/client";

export const DEFAULT_NOTIFICATION_BATCH_SIZE = 50;
export const DEFAULT_SENDING_STALE_MS = 10 * 60 * 1000;

export interface CreateNotificationInput {
  eventType: ResearchNotificationEventType;
  providerName?: string | null;
  scheduleId?: string | null;
  scheduleRunId?: string | null;
  researchJobId?: string | null;
  channelType: ResearchNotificationChannelType;
  deduplicationKey: string;
  title: string;
  message: string;
  payload: Record<string, unknown>;
}

export function buildNotificationDeduplicationKey(parts: {
  eventType: string;
  scheduleId?: string | null;
  scheduleRunId?: string | null;
  researchJobId?: string | null;
  retryAttempt?: number | null;
}): string {
  const stable = {
    eventType: parts.eventType,
    scheduleId: parts.scheduleId ?? "",
    scheduleRunId: parts.scheduleRunId ?? "",
    researchJobId: parts.researchJobId ?? "",
    retryAttempt: parts.retryAttempt ?? 0,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export class NotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createNotification(input: CreateNotificationInput): Promise<ResearchNotification> {
    return this.prisma.researchNotification.create({
      data: {
        eventType: input.eventType,
        providerName: input.providerName ?? null,
        scheduleId: input.scheduleId ?? null,
        scheduleRunId: input.scheduleRunId ?? null,
        researchJobId: input.researchJobId ?? null,
        channelType: input.channelType,
        deduplicationKey: input.deduplicationKey,
        title: input.title,
        message: input.message,
        payload: input.payload as Prisma.InputJsonValue,
        status: "PENDING",
      },
    });
  }

  async createNotificationIfAbsent(
    input: CreateNotificationInput,
  ): Promise<{ notification: ResearchNotification; created: boolean }> {
    const existing = await this.prisma.researchNotification.findUnique({
      where: { deduplicationKey: input.deduplicationKey },
    });
    if (existing) {
      return { notification: existing, created: false };
    }
    try {
      const notification = await this.createNotification(input);
      return { notification, created: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Unique constraint|unique/i.test(message)) {
        const again = await this.prisma.researchNotification.findUniqueOrThrow({
          where: { deduplicationKey: input.deduplicationKey },
        });
        return { notification: again, created: false };
      }
      throw error;
    }
  }

  async findById(id: string): Promise<ResearchNotification | null> {
    return this.prisma.researchNotification.findUnique({ where: { id } });
  }

  async listNotifications(options?: {
    status?: ResearchNotificationStatus;
    limit?: number;
  }): Promise<ResearchNotification[]> {
    return this.prisma.researchNotification.findMany({
      where: options?.status ? { status: options.status } : undefined,
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(options?.limit ?? 50, 200)),
    });
  }

  async listPendingNotifications(
    now: Date = new Date(),
    limit: number = DEFAULT_NOTIFICATION_BATCH_SIZE,
    staleSendingMs: number = DEFAULT_SENDING_STALE_MS,
  ): Promise<ResearchNotification[]> {
    const staleBefore = new Date(now.getTime() - staleSendingMs);
    return this.prisma.researchNotification.findMany({
      where: {
        OR: [
          { status: "PENDING" },
          { status: "SENDING", lastAttemptAt: { lt: staleBefore } },
          { status: "SENDING", lastAttemptAt: null, updatedAt: { lt: staleBefore } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: Math.max(1, Math.min(limit, DEFAULT_NOTIFICATION_BATCH_SIZE)),
    });
  }

  /**
   * Atomically claim a notification for sending. Returns null if already claimed.
   */
  async markSending(id: string, now: Date = new Date()): Promise<ResearchNotification | null> {
    const staleBefore = new Date(now.getTime() - DEFAULT_SENDING_STALE_MS);
    const updated = await this.prisma.researchNotification.updateMany({
      where: {
        id,
        OR: [
          { status: "PENDING" },
          { status: "FAILED" },
          { status: "SENDING", lastAttemptAt: { lt: staleBefore } },
          { status: "SENDING", lastAttemptAt: null, updatedAt: { lt: staleBefore } },
        ],
      },
      data: {
        status: "SENDING",
        lastAttemptAt: now,
      },
    });
    if (updated.count === 0) {
      return null;
    }
    return this.prisma.researchNotification.findUniqueOrThrow({ where: { id } });
  }

  async markSent(id: string, now: Date = new Date()): Promise<ResearchNotification> {
    return this.prisma.researchNotification.update({
      where: { id },
      data: {
        status: "SENT",
        sentAt: now,
        failedAt: null,
        errorMessage: null,
      },
    });
  }

  async markFailed(id: string, errorMessage: string, now: Date = new Date()): Promise<ResearchNotification> {
    return this.prisma.researchNotification.update({
      where: { id },
      data: {
        status: "FAILED",
        failedAt: now,
        errorMessage,
      },
    });
  }

  async markSkipped(id: string, errorMessage: string): Promise<ResearchNotification> {
    return this.prisma.researchNotification.update({
      where: { id },
      data: {
        status: "SKIPPED",
        errorMessage,
        failedAt: new Date(),
      },
    });
  }

  async recordAttempt(input: {
    notificationId: string;
    attemptNumber: number;
    status: ResearchNotificationStatus;
    httpStatus?: number | null;
    errorType?: string | null;
    errorMessage?: string | null;
    startedAt: Date;
    completedAt?: Date | null;
  }): Promise<ResearchNotificationAttempt> {
    await this.prisma.researchNotification.update({
      where: { id: input.notificationId },
      data: {
        attemptCount: input.attemptNumber,
        lastAttemptAt: input.completedAt ?? input.startedAt,
      },
    });
    return this.prisma.researchNotificationAttempt.create({
      data: {
        notificationId: input.notificationId,
        attemptNumber: input.attemptNumber,
        status: input.status,
        httpStatus: input.httpStatus ?? null,
        errorType: input.errorType ?? null,
        errorMessage: input.errorMessage ?? null,
        startedAt: input.startedAt,
        completedAt: input.completedAt ?? null,
      },
    });
  }

  async listAttempts(notificationId: string): Promise<ResearchNotificationAttempt[]> {
    return this.prisma.researchNotificationAttempt.findMany({
      where: { notificationId },
      orderBy: { attemptNumber: "asc" },
    });
  }
}
