import type { Logger } from "@ai-affiliate/shared";
import type {
  NotificationSendResult,
  PreparedResearchNotification,
  ResearchNotificationProvider,
} from "./types.js";

export class ConsoleNotificationProvider implements ResearchNotificationProvider {
  readonly channelType = "CONSOLE" as const;

  constructor(private readonly logger: Logger) {}

  async send(notification: PreparedResearchNotification): Promise<NotificationSendResult> {
    const payload = notification.payload;
    const schedule = asRecord(payload.schedule);
    const run = asRecord(payload.run);
    const job = asRecord(payload.job);
    const error = asRecord(payload.error);
    const retry = asRecord(payload.retry);

    const lines = [
      `[notification] eventType=${notification.eventType}`,
      `scheduleId=${stringOrNull(schedule?.id)}`,
      `scheduleName=${stringOrNull(schedule?.name)}`,
      `runId=${stringOrNull(run?.id)}`,
      `jobId=${stringOrNull(job?.id)}`,
      `status=${stringOrNull(run?.status)}`,
      `errorType=${stringOrNull(error?.type)}`,
      `retryAttempt=${numberOrNull(run?.retryAttempt)}`,
      `nextRetryAt=${stringOrNull(retry?.nextRetryAt)}`,
      `fetchedCount=${numberOrNull(job?.fetchedCount)}`,
      `savedCount=${numberOrNull(job?.savedCount)}`,
      `updatedCount=${numberOrNull(job?.updatedCount)}`,
      `errorCount=${numberOrNull(job?.errorCount)}`,
    ];
    this.logger.info(lines.join(" "));
    return { ok: true };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function stringOrNull(value: unknown): string {
  return typeof value === "string" ? value : "null";
}

function numberOrNull(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "null";
}
