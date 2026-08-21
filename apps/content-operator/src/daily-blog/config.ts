/**
 * Daily blog auto-publish config — all cadence values from env, no hardcoded clock times.
 */

export interface DailyBlogEnvConfig {
  enabled: boolean;
  dryRun: boolean;
  timezone: string;
  /** Cron expression for ResearchSchedule / runner — not embedded schedule clock in code. */
  cronExpression: string | null;
  articlesPerRun: number;
  maxLlmProductsPerRun: number;
  maxLlmCallsPerRun: number;
  maxCandidatesToScan: number;
  minTotalScore: number;
  minSampleImages: number;
  minEvidenceRichness: number;
  injectArticleJsonLd: boolean;
  rankingEnabled: boolean;
  rankingEveryNProductPosts: number | null;
  rankingMinDaysBetween: number | null;
  rankingAllowedTypes: string[];
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

function parsePositiveInt(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseOptionalPositiveInt(v: string | undefined): number | null {
  if (!v || !v.trim()) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseFloatDefault(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseUnit(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

export function loadDailyBlogEnvConfig(
  env: NodeJS.ProcessEnv = process.env,
): DailyBlogEnvConfig {
  return {
    enabled: parseBool(env.BLOG_DAILY_AUTO_PUBLISH_ENABLED, false),
    dryRun: parseBool(env.BLOG_DAILY_DRY_RUN, true),
    timezone: env.BLOG_DAILY_TIMEZONE?.trim() || env.PUBLICATION_TIMEZONE?.trim() || "Asia/Tokyo",
    cronExpression: env.BLOG_DAILY_CRON?.trim() || null,
    articlesPerRun: parsePositiveInt(env.BLOG_DAILY_ARTICLES_PER_RUN, 1),
    maxLlmProductsPerRun: parsePositiveInt(env.BLOG_DAILY_MAX_LLM_PRODUCTS, 1),
    maxLlmCallsPerRun: parsePositiveInt(env.BLOG_DAILY_MAX_LLM_CALLS, 1),
    maxCandidatesToScan: parsePositiveInt(env.BLOG_DAILY_MAX_CANDIDATES_SCAN, 30),
    minTotalScore: parseFloatDefault(env.BLOG_DAILY_MIN_TOTAL_SCORE, 35),
    minSampleImages: parsePositiveInt(env.BLOG_DAILY_MIN_SAMPLE_IMAGES, 3),
    minEvidenceRichness: parseUnit(env.BLOG_DAILY_MIN_EVIDENCE_RICHNESS, 0.3),
    injectArticleJsonLd: parseBool(env.BLOG_DAILY_INJECT_ARTICLE_JSONLD, false),
    rankingEnabled: parseBool(env.BLOG_DAILY_RANKING_ENABLED, false),
    rankingEveryNProductPosts: parseOptionalPositiveInt(env.BLOG_DAILY_RANKING_EVERY_N_PRODUCTS),
    rankingMinDaysBetween: parseOptionalPositiveInt(env.BLOG_DAILY_RANKING_MIN_DAYS),
    rankingAllowedTypes: (env.BLOG_DAILY_RANKING_TYPES ?? "POPULAR,NEW_RELEASE")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
