/**
 * Continuous APPROVED stock + JST publish slots.
 * Generation rate is independent of WordPress publish rate.
 * 9 / 101 are NOT hard caps — continuous Research + Generate + future schedule.
 */

export const DEFAULT_STOCK_GENERATION_BATCH = 3;
/** Soft daily LLM generation cap (not a near-zero stop). */
export const DEFAULT_STOCK_MAX_GENERATIONS_PER_DAY = 48;
export const DEFAULT_PUBLISH_SLOT_HOURS_JST = [12, 21, 23] as const;
/** Future reservation horizon (days including today). */
export const DEFAULT_WORDPRESS_SCHEDULE_HORIZON_DAYS = 90;
/** Max future creates per scheduler tick (WP API rate / timeout control). */
export const DEFAULT_WORDPRESS_SCHEDULE_MAX_PER_TICK = 15;
/** Existing WP inventory — never delete/regenerate. */
export const PROTECTED_WORDPRESS_POST_IDS = [43, 46] as const;
export const DEFAULT_LOCAL_PAGE_RESEARCH_INTERVAL_MS = 2_500;
export const DEFAULT_LOCAL_PAGE_RESEARCH_MAX_PER_RUN = 20;
/** Soft Research collection target — not a hard stop. */
export const DEFAULT_RESEARCH_SOFT_TARGET = 500;

export function loadStockRuntimeConfig(env: NodeJS.ProcessEnv = process.env): {
  /** @deprecated informational only — not used to stop generation */
  minApprovedStock: number;
  generationBatch: number;
  maxGenerationsPerDay: number;
  publishSlotHoursJst: number[];
  scheduleHorizonDays: number;
  scheduleMaxPerTick: number;
  protectedWpPostIds: number[];
  localPageResearchIntervalMs: number;
  localPageResearchMaxPerRun: number;
  researchSoftTarget: number;
  stockGenerationEnabled: boolean;
  stockPublishSchedulerEnabled: boolean;
  /** Local FANZA page Research in scheduler ticks (Mac/ops; skipped when external research off). */
  localPageResearchInScheduler: boolean;
} {
  const parsePositive = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  const parseBool = (raw: string | undefined, fallback: boolean) => {
    if (raw == null || raw.trim() === "") return fallback;
    return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
  };
  const slots = (env.WP_PUBLISH_SLOTS_JST ?? "12,21,23")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 23);
  const protectedIds = (env.WORDPRESS_PROTECTED_POST_IDS ?? "43,46")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  return {
    minApprovedStock: parsePositive(env.STOCK_MIN_APPROVED, 0),
    generationBatch: parsePositive(
      env.STOCK_GENERATION_BATCH_SIZE ?? env.STOCK_GENERATION_BATCH,
      DEFAULT_STOCK_GENERATION_BATCH,
    ),
    maxGenerationsPerDay: parsePositive(
      env.STOCK_MAX_GENERATIONS_PER_DAY,
      DEFAULT_STOCK_MAX_GENERATIONS_PER_DAY,
    ),
    publishSlotHoursJst: slots.length > 0 ? slots : [...DEFAULT_PUBLISH_SLOT_HOURS_JST],
    scheduleHorizonDays: parsePositive(
      env.WORDPRESS_SCHEDULE_HORIZON_DAYS,
      DEFAULT_WORDPRESS_SCHEDULE_HORIZON_DAYS,
    ),
    scheduleMaxPerTick: parsePositive(
      env.WORDPRESS_SCHEDULE_MAX_PER_TICK,
      DEFAULT_WORDPRESS_SCHEDULE_MAX_PER_TICK,
    ),
    protectedWpPostIds:
      protectedIds.length > 0 ? protectedIds : [...PROTECTED_WORDPRESS_POST_IDS],
    localPageResearchIntervalMs: parsePositive(
      env.LOCAL_PAGE_RESEARCH_INTERVAL_MS,
      DEFAULT_LOCAL_PAGE_RESEARCH_INTERVAL_MS,
    ),
    localPageResearchMaxPerRun: parsePositive(
      env.LOCAL_PAGE_RESEARCH_MAX_PER_RUN,
      DEFAULT_LOCAL_PAGE_RESEARCH_MAX_PER_RUN,
    ),
    researchSoftTarget: parsePositive(env.RESEARCH_SOFT_TARGET, DEFAULT_RESEARCH_SOFT_TARGET),
    stockGenerationEnabled: parseBool(env.STOCK_GENERATION_ENABLED, true),
    stockPublishSchedulerEnabled: parseBool(env.STOCK_PUBLISH_SCHEDULER_ENABLED, true),
    // Default false: Railway uses provider schedules (ItemList). Mac ops enables via env/CLI.
    localPageResearchInScheduler: parseBool(env.STOCK_LOCAL_PAGE_RESEARCH_IN_SCHEDULER, false),
  };
}
