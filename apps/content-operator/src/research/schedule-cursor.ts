/**
 * Persist ItemList paging cursor on ResearchSchedule.parameters.startOffset.
 * Soft-target fill uses a shorter nextRun interval; steady state uses cron.
 */

import type { ScheduleParameters } from "@ai-affiliate/database";

export const DEFAULT_RESEARCH_SOFT_TARGET = 500;
/** While below soft target, schedule next page sooner than full cron (still 1 page/run). */
export const DEFAULT_RESEARCH_SOFT_FILL_INTERVAL_MS = 15 * 60_000;

export function asScheduleParameters(value: unknown): ScheduleParameters {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as ScheduleParameters;
  }
  return {};
}

export function readStartOffset(parameters: ScheduleParameters): number {
  const raw = parameters.startOffset;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return 1;
}

/**
 * Merge provider defaults with an existing schedule without resetting the paging cursor.
 */
export function mergeScheduleParametersPreservingCursor(
  defaults: ScheduleParameters,
  existing: ScheduleParameters | null | undefined,
): ScheduleParameters {
  const prior = existing ?? {};
  const preservedOffset = readStartOffset(prior);
  return {
    ...defaults,
    ...prior,
    ...defaults,
    startOffset: preservedOffset,
  };
}

export function resolveNextStartOffset(input: {
  jobNextOffset: number | null | undefined;
  hits: number;
  currentOffset: number;
  fetchedCount: number;
  researchTotal: number;
  softTarget: number;
}): { startOffset: number; wrapped: boolean; atSoftTarget: boolean } {
  const atSoftTarget = input.researchTotal >= input.softTarget;
  if (atSoftTarget) {
    return { startOffset: 1, wrapped: true, atSoftTarget: true };
  }
  if (typeof input.jobNextOffset === "number" && Number.isFinite(input.jobNextOffset) && input.jobNextOffset > 0) {
    return { startOffset: Math.floor(input.jobNextOffset), wrapped: false, atSoftTarget: false };
  }
  // Exhausted API pages (short page / null next) — wrap to newest for refresh.
  if (input.fetchedCount > 0 && input.fetchedCount < input.hits) {
    return { startOffset: 1, wrapped: true, atSoftTarget: false };
  }
  // Fallback: advance by hits from current page.
  if (input.fetchedCount > 0) {
    return {
      startOffset: input.currentOffset + input.fetchedCount,
      wrapped: false,
      atSoftTarget: false,
    };
  }
  return { startOffset: input.currentOffset, wrapped: false, atSoftTarget: false };
}

export function resolveNextRunAtAfterCollection(input: {
  now: Date;
  cronNextRunAt: Date;
  researchTotal: number;
  softTarget: number;
  softFillIntervalMs: number;
  wrapped: boolean;
}): Date {
  if (input.researchTotal >= input.softTarget || input.wrapped) {
    return input.cronNextRunAt;
  }
  const fillAt = new Date(input.now.getTime() + Math.max(60_000, input.softFillIntervalMs));
  return fillAt.getTime() < input.cronNextRunAt.getTime() ? fillAt : input.cronNextRunAt;
}

export function shouldSoftFillNow(input: {
  now: Date;
  lastRunAt: Date | null | undefined;
  nextRunAt: Date | null | undefined;
  researchTotal: number;
  softTarget: number;
  softFillIntervalMs: number;
}): boolean {
  if (input.researchTotal >= input.softTarget) return false;
  const interval = Math.max(60_000, input.softFillIntervalMs);
  const last = input.lastRunAt?.getTime() ?? 0;
  if (input.now.getTime() - last < interval) return false;
  if (input.nextRunAt && input.nextRunAt.getTime() <= input.now.getTime()) return false;
  return true;
}
