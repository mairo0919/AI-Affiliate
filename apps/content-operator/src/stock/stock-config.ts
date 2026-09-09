/**
 * Continuous APPROVED stock + JST publish slots.
 * Generation rate is independent of WordPress publish rate.
 */

export const DEFAULT_STOCK_MIN_APPROVED = 9;
export const DEFAULT_STOCK_GENERATION_BATCH = 3;
export const DEFAULT_PUBLISH_SLOT_HOURS_JST = [12, 21, 23] as const;
/** Existing WP inventory — never delete/regenerate. */
export const PROTECTED_WORDPRESS_POST_IDS = [43, 46] as const;
export const DEFAULT_LOCAL_PAGE_RESEARCH_INTERVAL_MS = 2_500;
export const DEFAULT_LOCAL_PAGE_RESEARCH_MAX_PER_RUN = 12;

export function loadStockRuntimeConfig(env: NodeJS.ProcessEnv = process.env): {
  minApprovedStock: number;
  generationBatch: number;
  publishSlotHoursJst: number[];
  protectedWpPostIds: number[];
  localPageResearchIntervalMs: number;
  localPageResearchMaxPerRun: number;
  stockGenerationEnabled: boolean;
  stockPublishSchedulerEnabled: boolean;
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
    minApprovedStock: parsePositive(env.STOCK_MIN_APPROVED, DEFAULT_STOCK_MIN_APPROVED),
    generationBatch: parsePositive(env.STOCK_GENERATION_BATCH, DEFAULT_STOCK_GENERATION_BATCH),
    publishSlotHoursJst: slots.length > 0 ? slots : [...DEFAULT_PUBLISH_SLOT_HOURS_JST],
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
    stockGenerationEnabled: parseBool(env.STOCK_GENERATION_ENABLED, true),
    stockPublishSchedulerEnabled: parseBool(env.STOCK_PUBLISH_SCHEDULER_ENABLED, true),
  };
}
