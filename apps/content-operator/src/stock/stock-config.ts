/**
 * Continuous APPROVED stock + JST publish slots.
 * Research soft target and WordPress future inventory are separate controls.
 * ResearchItem rows are retained assets — never pruned for generation failure.
 */

export const DEFAULT_STOCK_GENERATION_BATCH = 3;
/** Soft daily LLM generation cap (not a near-zero stop). */
export const DEFAULT_STOCK_MAX_GENERATIONS_PER_DAY = 48;
export const DEFAULT_PUBLISH_SLOT_HOURS_JST = [12, 21, 23] as const;
/** Future reservation horizon (days including today). */
export const DEFAULT_WORDPRESS_SCHEDULE_HORIZON_DAYS = 90;
/**
 * Max future creates per scheduler tick.
 * Kept aligned with generation batch to avoid DMM-open burst scheduling.
 */
export const DEFAULT_WORDPRESS_SCHEDULE_MAX_PER_TICK = 3;
/** Hard WP future inventory band (not Research soft target). */
export const DEFAULT_FUTURE_TARGET_POSTS = 45;
export const DEFAULT_FUTURE_MIN_POSTS = 30;
/** Existing WP inventory — never delete/regenerate. */
export const PROTECTED_WORDPRESS_POST_IDS = [43, 46] as const;
export const DEFAULT_LOCAL_PAGE_RESEARCH_INTERVAL_MS = 2_500;
export const DEFAULT_LOCAL_PAGE_RESEARCH_MAX_PER_RUN = 20;
/** Soft Research collection target — not a hard stop. */
export const DEFAULT_RESEARCH_SOFT_TARGET = 500;
/** Soft attempt cap before NEEDS_ENRICHMENT / RETRY_DEFERRED (never deletes ResearchItem). */
export const DEFAULT_STOCK_MAX_ATTEMPTS_BEFORE_DEFER = 5;

export function loadStockRuntimeConfig(env: NodeJS.ProcessEnv = process.env): {
  /** @deprecated informational only — not used to stop generation */
  minApprovedStock: number;
  generationBatch: number;
  maxGenerationsPerDay: number;
  publishSlotHoursJst: number[];
  scheduleHorizonDays: number;
  scheduleMaxPerTick: number;
  futureTargetPosts: number;
  futureMinPosts: number;
  stockMaxAttemptsBeforeDefer: number;
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

  const generationBatch = parsePositive(
    env.STOCK_GENERATION_BATCH_SIZE ?? env.STOCK_GENERATION_BATCH,
    DEFAULT_STOCK_GENERATION_BATCH,
  );
  const scheduleMaxRaw = parsePositive(
    env.WORDPRESS_SCHEDULE_MAX_PER_TICK,
    DEFAULT_WORDPRESS_SCHEDULE_MAX_PER_TICK,
  );
  // Never exceed generation batch — prevents DMM-open burst of futures per tick.
  const scheduleMaxPerTick = Math.min(scheduleMaxRaw, generationBatch);

  return {
    minApprovedStock: parsePositive(env.STOCK_MIN_APPROVED, 0),
    generationBatch,
    maxGenerationsPerDay: parsePositive(
      env.STOCK_MAX_GENERATIONS_PER_DAY,
      DEFAULT_STOCK_MAX_GENERATIONS_PER_DAY,
    ),
    publishSlotHoursJst: slots.length > 0 ? slots : [...DEFAULT_PUBLISH_SLOT_HOURS_JST],
    scheduleHorizonDays: parsePositive(
      env.WORDPRESS_SCHEDULE_HORIZON_DAYS,
      DEFAULT_WORDPRESS_SCHEDULE_HORIZON_DAYS,
    ),
    scheduleMaxPerTick,
    futureTargetPosts: parsePositive(env.FUTURE_TARGET_POSTS, DEFAULT_FUTURE_TARGET_POSTS),
    futureMinPosts: parsePositive(env.FUTURE_MIN_POSTS, DEFAULT_FUTURE_MIN_POSTS),
    stockMaxAttemptsBeforeDefer: parsePositive(
      env.STOCK_MAX_ATTEMPTS_BEFORE_DEFER,
      DEFAULT_STOCK_MAX_ATTEMPTS_BEFORE_DEFER,
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

/** How many new futures this tick may create given live WP future count. */
export function computeFutureReserveBudget(input: {
  currentFutureCount: number;
  futureMinPosts: number;
  futureTargetPosts: number;
  scheduleMaxPerTick: number;
}): { allow: boolean; budget: number; reason: string | null } {
  const target = Math.max(input.futureMinPosts, input.futureTargetPosts);
  const min = Math.min(input.futureMinPosts, input.futureTargetPosts);
  const maxTick = Math.max(0, input.scheduleMaxPerTick);
  if (input.currentFutureCount >= target) {
    return { allow: false, budget: 0, reason: "FUTURE_AT_OR_ABOVE_TARGET" };
  }
  const need = target - input.currentFutureCount;
  const budget = Math.min(maxTick, need);
  if (budget <= 0) {
    return { allow: false, budget: 0, reason: "FUTURE_RESERVE_BUDGET_EMPTY" };
  }
  // Below min → replenish; between min and target → climb to target. Same budget math.
  void min;
  return { allow: true, budget, reason: null };
}
