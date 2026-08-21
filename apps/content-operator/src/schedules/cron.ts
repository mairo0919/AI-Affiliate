import { CronExpressionParser } from "cron-parser";

export class CronValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronValidationError";
  }
}

const FIVE_FIELD_PATTERN = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;

/**
 * Accept only classic 5-field cron (minute hour day-of-month month day-of-week).
 * cron-parser v5 expects seconds, so we normalize by prefixing `0`.
 */
export function assertValidCronExpression(expression: string): string {
  const trimmed = expression.trim();
  if (!FIVE_FIELD_PATTERN.test(trimmed)) {
    throw new CronValidationError(
      "Invalid cron expression: expected exactly 5 fields (minute hour day month weekday)",
    );
  }

  try {
    CronExpressionParser.parse(`0 ${trimmed}`, { tz: "UTC", strict: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid cron";
    throw new CronValidationError(`Invalid cron expression: ${message}`);
  }

  return trimmed;
}

export function computeNextRunAt(input: {
  cronExpression: string;
  timezone: string;
  after: Date;
}): Date {
  const cron = assertValidCronExpression(input.cronExpression);
  try {
    const interval = CronExpressionParser.parse(`0 ${cron}`, {
      currentDate: input.after,
      tz: input.timezone,
      strict: true,
    });
    const next = interval.next().toDate();
    // Guard against identical timestamp edge cases
    if (next.getTime() <= input.after.getTime()) {
      const again = CronExpressionParser.parse(`0 ${cron}`, {
        currentDate: new Date(input.after.getTime() + 1000),
        tz: input.timezone,
        strict: true,
      });
      return again.next().toDate();
    }
    return next;
  } catch (error) {
    if (error instanceof CronValidationError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "failed to compute next run";
    throw new CronValidationError(`Failed to compute nextRunAt: ${message}`);
  }
}

export function isWithinGraceWindow(
  scheduledFor: Date,
  now: Date,
  graceMs: number,
): boolean {
  const age = now.getTime() - scheduledFor.getTime();
  return age >= 0 && age <= graceMs;
}
