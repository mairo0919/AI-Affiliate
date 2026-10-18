export type LlmSafetyLimits = {
  /** Calendar month (UTC, same as OpenAI billing). The binding limit; the daily caps only spread it out. */
  globalMonthlyUsd: number;
  globalDailyUsd: number;
  gpt41DailyUsd: number;
  xWriterDailyUsd: number;
  logicalCallLimit: number;
  /**
   * Window for logicalCallLimit. Older calls no longer count, so a work that hit the limit
   * can be tried again later instead of being blocked forever. Budgets still cap spend.
   */
  logicalCallWindowMs?: number;
  httpRetryLimit: number;
  absoluteTickCap: number;
  /** New WP articles per tick. Normal batch is 3, plus a small retry buffer. Not the X cap. */
  wpArticleTickCap: number;
  staleRequestMs: number;
  rateLimitOpenAfter: number;
  timeoutOpenAfter: number;
  serverErrorOpenAfter: number;
  halfOpenAfterMs: number;
};

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Code defaults are the safe side. Production env is not changed by this module. */
export function loadLlmSafetyLimits(env: NodeJS.ProcessEnv = process.env): LlmSafetyLimits {
  return {
    globalMonthlyUsd: positive(env.GLOBAL_MONTHLY_LLM_BUDGET_USD, 10),
    globalDailyUsd: positive(env.GLOBAL_DAILY_LLM_BUDGET_USD, 0.5),
    gpt41DailyUsd: positive(env.GPT41_DAILY_BUDGET_USD, 0.2),
    xWriterDailyUsd: positive(env.X_WRITER_DAILY_BUDGET_USD, 0.2),
    logicalCallLimit: positive(env.LLM_LOGICAL_CALL_LIMIT, 5),
    logicalCallWindowMs: positive(env.LLM_LOGICAL_CALL_WINDOW_MS, 3 * 24 * 60 * 60 * 1000),
    httpRetryLimit: positive(env.LLM_HTTP_RETRY_LIMIT, 2),
    absoluteTickCap: positive(env.LLM_ABSOLUTE_TICK_CAP, 12),
    wpArticleTickCap: positive(env.WP_ARTICLE_TICK_CAP, 5),
    staleRequestMs: positive(env.LLM_STALE_REQUEST_MS, 15 * 60 * 1000),
    rateLimitOpenAfter: positive(env.LLM_RATE_LIMIT_OPEN_AFTER, 5),
    timeoutOpenAfter: positive(env.LLM_TIMEOUT_OPEN_AFTER, 5),
    serverErrorOpenAfter: positive(env.LLM_SERVER_ERROR_OPEN_AFTER, 5),
    halfOpenAfterMs: positive(env.LLM_CIRCUIT_HALF_OPEN_MS, 10 * 60 * 1000),
  };
}
