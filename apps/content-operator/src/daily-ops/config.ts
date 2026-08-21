/**
 * Multi-channel daily targets — single place for counts (do not scatter magic 1s).
 */

import type { ContentMixWeights } from "./content-mix.js";
import type { ReleaseAgeThresholds } from "./release-age.js";
import { DEFAULT_RELEASE_AGE_THRESHOLDS } from "./release-age.js";
import type { ChannelDuplicateConfig } from "./channel-duplicate.js";

export interface DailyMultiChannelConfig {
  timezone: string;
  blogArticlesPerDay: number;
  xPostsPerDay: number;
  /** When ranking fires: replace one blog article vs add extra. */
  rankingMode: "REPLACE_BLOG_ARTICLE" | "ADDITIONAL_BLOG_ARTICLE";
  mixWeights: ContentMixWeights;
  releaseAge: ReleaseAgeThresholds;
  channelDuplicate: ChannelDuplicateConfig;
  rankingEnabled: boolean;
  rankingEveryNBlogArticles: number | null;
  rankingMinDaysBetween: number | null;
  dryRun: boolean;
  enabled: boolean;
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
  if (!v?.trim()) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseFloatDef(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadDailyMultiChannelConfig(
  env: NodeJS.ProcessEnv = process.env,
): DailyMultiChannelConfig {
  const blogArticlesPerDay = parsePositiveInt(env.DAILY_BLOG_ARTICLES, parsePositiveInt(env.BLOG_DAILY_ARTICLES_PER_RUN, 1));
  const xPostsPerDay = parsePositiveInt(env.DAILY_X_POSTS, 1);
  return {
    timezone: env.DAILY_OPS_TIMEZONE?.trim() || env.BLOG_DAILY_TIMEZONE?.trim() || "Asia/Tokyo",
    blogArticlesPerDay,
    xPostsPerDay,
    rankingMode:
      (env.DAILY_RANKING_MODE ?? "REPLACE_BLOG_ARTICLE").trim().toUpperCase() === "ADDITIONAL_BLOG_ARTICLE"
        ? "ADDITIONAL_BLOG_ARTICLE"
        : "REPLACE_BLOG_ARTICLE",
    mixWeights: {
      recent: parseFloatDef(env.DAILY_MIX_WEIGHT_RECENT, 0.3),
      mid: parseFloatDef(env.DAILY_MIX_WEIGHT_MID, 0.3),
      older: parseFloatDef(env.DAILY_MIX_WEIGHT_OLDER, 0.3),
      ranking: parseFloatDef(env.DAILY_MIX_WEIGHT_RANKING, 0.1),
    },
    releaseAge: {
      recentMaxDays: parsePositiveInt(env.DAILY_AGE_RECENT_MAX_DAYS, DEFAULT_RELEASE_AGE_THRESHOLDS.recentMaxDays),
      olderMinDays: parsePositiveInt(env.DAILY_AGE_OLDER_MIN_DAYS, DEFAULT_RELEASE_AGE_THRESHOLDS.olderMinDays),
    },
    channelDuplicate: {
      sameProductCooldownDays: parsePositiveInt(env.DAILY_CHANNEL_PRODUCT_COOLDOWN_DAYS, 14),
      sameBodyCooldownDays: parsePositiveInt(env.DAILY_X_BODY_COOLDOWN_DAYS, 7),
    },
    rankingEnabled: parseBool(env.DAILY_RANKING_ENABLED, parseBool(env.BLOG_DAILY_RANKING_ENABLED, false)),
    rankingEveryNBlogArticles: parseOptionalPositiveInt(
      env.DAILY_RANKING_EVERY_N_BLOG_ARTICLES ?? env.BLOG_DAILY_RANKING_EVERY_N_PRODUCTS,
    ),
    rankingMinDaysBetween: parseOptionalPositiveInt(
      env.DAILY_RANKING_MIN_DAYS ?? env.BLOG_DAILY_RANKING_MIN_DAYS,
    ),
    dryRun: parseBool(env.DAILY_OPS_DRY_RUN, true),
    enabled: parseBool(env.DAILY_OPS_ENABLED, false),
  };
}

/** Minimum publications implied by targets (blog + x). */
export function minimumDailyPublications(config: DailyMultiChannelConfig): number {
  return config.blogArticlesPerDay + config.xPostsPerDay;
}
