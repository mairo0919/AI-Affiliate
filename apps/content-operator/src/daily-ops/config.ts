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
  /**
   * Review authority for daily-ops blog path.
   * - manual (default): generation leaves REVIEWING; no publication until ContentReviewService
   * - auto: ContentReviewService.decide(approve) after quality gates, then publication
   */
  reviewPolicy: "manual" | "auto";
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
    mixWeights: (() => {
      const hasNew =
        env.DAILY_MIX_WEIGHT_SINGLE != null ||
        env.DAILY_MIX_WEIGHT_POPULAR != null ||
        env.DAILY_MIX_WEIGHT_PERFORMER != null ||
        env.DAILY_MIX_WEIGHT_NEW_RELEASE != null ||
        env.DAILY_MIX_WEIGHT_OLDER_TITLE != null;
      if (hasNew) {
        return {
          singleProduct: parseFloatDef(env.DAILY_MIX_WEIGHT_SINGLE, 0.25),
          popularRanking: parseFloatDef(env.DAILY_MIX_WEIGHT_POPULAR, 0.15),
          performerRanking: parseFloatDef(env.DAILY_MIX_WEIGHT_PERFORMER, 0.15),
          newRelease: parseFloatDef(env.DAILY_MIX_WEIGHT_NEW_RELEASE, 0.25),
          olderTitle: parseFloatDef(env.DAILY_MIX_WEIGHT_OLDER_TITLE, 0.2),
        };
      }
      // Legacy env → R72 weights
      return {
        singleProduct: parseFloatDef(env.DAILY_MIX_WEIGHT_MID, 0.25),
        popularRanking: parseFloatDef(env.DAILY_MIX_WEIGHT_RANKING, 0.15),
        performerRanking: 0.15,
        newRelease: parseFloatDef(env.DAILY_MIX_WEIGHT_RECENT, 0.25),
        olderTitle: parseFloatDef(env.DAILY_MIX_WEIGHT_OLDER, 0.2),
      };
    })(),
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
    reviewPolicy:
      (env.DAILY_OPS_REVIEW_POLICY ?? "manual").trim().toLowerCase() === "auto"
        ? "auto"
        : "manual",
  };
}

/** Minimum publications implied by targets (blog + x). */
export function minimumDailyPublications(config: DailyMultiChannelConfig): number {
  return config.blogArticlesPerDay + config.xPostsPerDay;
}
