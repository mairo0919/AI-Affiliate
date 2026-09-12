/**
 * Ensure multi-ASP system ResearchSchedule rows exist for enabled providers.
 * Operator-created schedules are left untouched. Credential gaps only skip at run time.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { ScheduleParameters, ScheduleRepository } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { computeNextRunAt } from "../schedules/cron.js";
import {
  findResearchProviderDescriptor,
  systemResearchScheduleName,
} from "../adapters/affiliate/research-availability.js";

export interface EnsureCollectionSchedulesResult {
  ensured: string[];
  paused: string[];
  skipped: string[];
}

function fanzaParameters(config: AppConfig): ScheduleParameters {
  return {
    service: config.fanzaDefaultService,
    floor: config.fanzaDefaultFloor,
    hits: config.fanzaDefaultHits,
    sort: config.researchFanzaSort,
    maxPages: config.researchFanzaMaxPages,
    maxItems: config.researchFanzaMaxItems,
    startOffset: 1,
    continueOnItemError: true,
  };
}

function parametersForProvider(providerKey: string, config: AppConfig): ScheduleParameters {
  if (providerKey === "fanza") return fanzaParameters(config);
  if (providerKey === "mock") {
    return {
      maxPages: 1,
      maxItems: 10,
      hits: 10,
      startOffset: 1,
      continueOnItemError: true,
    };
  }
  return { maxPages: 1, startOffset: 1, continueOnItemError: true };
}

/**
 * Providers that should have a system auto schedule when collection is enabled.
 * Only scheduleable+implemented adapters; future ASPs appear here when adapters land.
 */
export function listAutoScheduleProviderKeys(config: AppConfig): string[] {
  if (!config.researchCollectionEnabled) return [];
  const requested = config.researchEnabledProviders.map((p) => p.trim().toLowerCase()).filter(Boolean);
  const keys = requested.length > 0 ? requested : ["fanza"];
  return keys.filter((key) => {
    const d = findResearchProviderDescriptor(key);
    return Boolean(d?.scheduleable && d.implemented);
  });
}

export async function ensureResearchCollectionSchedules(input: {
  schedules: ScheduleRepository;
  config: AppConfig;
  logger: Logger;
  now?: () => Date;
}): Promise<EnsureCollectionSchedulesResult> {
  const now = input.now ?? (() => new Date());
  const result: EnsureCollectionSchedulesResult = { ensured: [], paused: [], skipped: [] };
  const wanted = new Set(listAutoScheduleProviderKeys(input.config));

  // Pause system schedules for providers no longer enabled / collection disabled.
  const catalogKeys = ["fanza", "mock"] as const;
  for (const key of catalogKeys) {
    const name = systemResearchScheduleName(key);
    const existing = await input.schedules.findScheduleByName(name);
    if (!existing) continue;
    if (!wanted.has(key) && existing.isActive) {
      await input.schedules.pauseSchedule(existing.id);
      result.paused.push(key);
      input.logger.info(`research auto-schedule paused provider=${key}`);
    }
  }

  for (const key of wanted) {
    const name = systemResearchScheduleName(key);
    const cron = input.config.researchCollectionCron;
    const timezone = input.config.researchCollectionTimezone;
    const parameters = parametersForProvider(key, input.config);
    const nextRunAt = computeNextRunAt({
      cronExpression: cron,
      timezone,
      after: now(),
    });

    const existing = await input.schedules.findScheduleByName(name);
    if (!existing) {
      await input.schedules.createSchedule({
        name,
        providerName: key,
        scheduleType: "CRON",
        cronExpression: cron,
        timezone,
        parameters,
        isActive: true,
        // First create: run on the next due tick immediately (not wait for next cron wall clock).
        nextRunAt: now(),
      });
      result.ensured.push(key);
      input.logger.info(`research auto-schedule created provider=${key} cron=${cron} nextRun=now`);
      continue;
    }

    // Never-run OR recent collection failure with empty Research: catch up immediately.
    // (A failed first ItemList run advances lastRunAt but may save 0 items due to tx timeout.)
    const neverRan = existing.lastRunAt == null;
    const failedAndEmpty =
      existing.consecutiveFailureCount > 0 &&
      (existing.nextRunAt == null || existing.nextRunAt.getTime() > now().getTime());
    const needsCatchUp = neverRan || failedAndEmpty;
    const nextRunAtResolved = needsCatchUp
      ? now()
      : existing.nextRunAt && existing.nextRunAt.getTime() > now().getTime()
        ? existing.nextRunAt
        : nextRunAt;

    await input.schedules.updateSchedule(existing.id, {
      providerName: key,
      scheduleType: "CRON",
      cronExpression: cron,
      timezone,
      parameters,
      isActive: true,
      nextRunAt: nextRunAtResolved,
    });
    result.ensured.push(key);
    if (needsCatchUp) {
      input.logger.info(
        `research auto-schedule catch-up provider=${key} reason=${neverRan ? "never_ran" : "failed_pending"} nextRun=now`,
      );
    }
  }

  return result;
}
