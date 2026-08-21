import type { AppConfig } from "@ai-affiliate/config";
import type {
  ResearchSchedule,
  ResearchScheduleRun,
  ScheduleRepository,
} from "@ai-affiliate/database";
import { classifyErrorType, isRetryableError } from "../jobs/errors.js";
import type { NotificationService } from "../notifications/notification-service.js";
import { computeNextRetryAt } from "./backoff.js";

export interface RetryDecision {
  retryScheduled: boolean;
  nextRetryAt: Date | null;
  exhausted: boolean;
  errorType: string;
}

export function decideRetry(input: {
  config: AppConfig;
  run: ResearchScheduleRun;
  error: unknown;
  errorType?: string;
  now: Date;
  random?: () => number;
}): RetryDecision {
  const errorType = input.errorType ?? classifyErrorType(input.error);
  if (!input.config.researchRetryEnabled) {
    return { retryScheduled: false, nextRetryAt: null, exhausted: false, errorType };
  }
  if (!isRetryableError(input.error) && !isRetryableByType(errorType)) {
    return { retryScheduled: false, nextRetryAt: null, exhausted: false, errorType };
  }

  const maxAttempts = input.run.maxRetryAttempts ?? input.config.researchRetryMaxAttempts;
  const nextAttempt = input.run.retryAttempt + 1;
  if (nextAttempt > maxAttempts) {
    return { retryScheduled: false, nextRetryAt: null, exhausted: true, errorType };
  }

  const nextRetryAt = computeNextRetryAt({
    retryAttempt: input.run.retryAttempt,
    baseDelaySeconds: input.config.researchRetryBaseDelaySeconds,
    maxDelaySeconds: input.config.researchRetryMaxDelaySeconds,
    now: input.now,
    random: input.random,
  });

  return { retryScheduled: true, nextRetryAt, exhausted: false, errorType };
}

function isRetryableByType(errorType: string): boolean {
  return [
    "RateLimit",
    "Timeout",
    "Network",
    "Lock",
    "Database",
    "HttpError",
  ].includes(errorType);
}

export async function applyRetryAndNotify(input: {
  schedules: ScheduleRepository;
  notifications?: NotificationService | null;
  config: AppConfig;
  schedule: ResearchSchedule;
  run: ResearchScheduleRun;
  job?: {
    id?: string | null;
    fetchedCount?: number;
    savedCount?: number;
    updatedCount?: number;
    errorCount?: number;
  } | null;
  error: unknown;
  errorMessage: string;
  previousFailureCount: number;
  autoPaused: boolean;
  now: Date;
  random?: () => number;
}): Promise<RetryDecision> {
  const decision = decideRetry({
    config: input.config,
    run: input.run,
    error: input.error,
    now: input.now,
    random: input.random,
  });

  if (decision.retryScheduled && decision.nextRetryAt) {
    await input.schedules.scheduleNextRetry({
      runId: input.run.id,
      nextRetryAt: decision.nextRetryAt,
      maxRetryAttempts: input.run.maxRetryAttempts ?? input.config.researchRetryMaxAttempts,
      errorType: decision.errorType,
      errorMessage: input.errorMessage,
    });
  }

  if (!input.notifications) {
    return decision;
  }

  const contextBase = {
    schedule: input.schedule,
    run: input.run,
    job: input.job,
    errorType: decision.errorType,
    errorMessage: input.errorMessage,
    retryScheduled: decision.retryScheduled,
    nextRetryAt: decision.nextRetryAt,
    retryAttempt: input.run.retryAttempt,
  };

  if (decision.retryScheduled && input.run.retryAttempt === 0) {
    await input.notifications.emitEvent("RETRY_SCHEDULED", contextBase);
  } else if (decision.exhausted) {
    await input.notifications.emitEvent("RETRY_EXHAUSTED", contextBase);
  } else if (!decision.retryScheduled && input.run.retryAttempt === 0) {
    // Non-retryable first failure
    await input.notifications.emitEvent("SCHEDULE_FAILED", contextBase);
  }
  // Intermediate retry failures: no notification (frequency control)

  if (input.autoPaused) {
    await input.notifications.emitEvent("SCHEDULE_AUTO_PAUSED", contextBase);
  }

  return decision;
}

export async function notifySuccess(input: {
  notifications?: NotificationService | null;
  schedule: ResearchSchedule;
  run: ResearchScheduleRun;
  job?: {
    id?: string | null;
    fetchedCount?: number;
    savedCount?: number;
    updatedCount?: number;
    errorCount?: number;
  } | null;
  previousFailureCount: number;
  partiallyCompleted: boolean;
}): Promise<void> {
  if (!input.notifications) {
    return;
  }
  if (input.partiallyCompleted) {
    await input.notifications.emitEvent("SCHEDULE_PARTIALLY_COMPLETED", {
      schedule: input.schedule,
      run: input.run,
      job: input.job,
      retryAttempt: input.run.retryAttempt,
    });
  }
  if (input.previousFailureCount >= 1) {
    await input.notifications.emitEvent("SCHEDULE_RECOVERED", {
      schedule: input.schedule,
      run: input.run,
      job: input.job,
      retryAttempt: input.run.retryAttempt,
    });
  }
}
