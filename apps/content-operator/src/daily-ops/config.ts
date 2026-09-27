/**
 * Multi-channel daily targets — single place for counts (do not scatter magic 1s).
 */

import type { ContentMixWeights } from "./content-mix.js";
import type { ReleaseAgeThresholds } from "./release-age.js";
import { DEFAULT_RELEASE_AGE_THRESHOLDS } from "./release-age.js";
import type { ChannelDuplicateConfig } from "./channel-duplicate.js";
import {
  DEFAULT_X_MAIN_POST_SLOT_HOUR_JST,
  DEFAULT_X_POSTS_PER_DAY,
  DEFAULT_X_POST_SLOT_HOURS_JST,
  parseXPostExtraSlotTimesJst,
  parseXPostExtraSlotsDayJst,
  parseXPostSlotHoursJst,
  type XPostExtraSlotTime,
} from "./x-post-schedule.js";

export interface DailyMultiChannelConfig {
  timezone: string;
  blogArticlesPerDay: number;
  xPostsPerDay: number;
  /** Fixed X wall-clock hours in JST (default 12, 18, 23). */
  xPostSlotHoursJst: number[];
  /** MAIN X slot hour JST (default 23). Other standard hours are SECONDARY. */
  xMainPostSlotHourJst: number;
  /**
   * One calendar day only (YYYY-MM-DD JST). Extra HH:MM slots apply solely on this day
   * and never leak into later days' schedule calculation.
   */
  xPostExtraSlotsDayJst: string | null;
  xPostExtraSlotTimesJst: XPostExtraSlotTime[];
  /**
   * Separate EXTRA quota for `xPostExtraSlotsDayJst` (does not consume `xPostsPerDay`).
   * Defaults to the number of configured extra times (0 when no extra day).
   */
  xExtraPostsBudget: number;
  /** Hard cap for STANDARD + EXTRA on an extra day (default = regular + extra). */
  xHardCapPerDay: number;
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
  /** X auto: allow DIRECT_AFFILIATE (default false — WP_TRAFFIC only). */
  allowDirectAffiliateRoute: boolean;
  /** X auto: allow COMBINED (default false). */
  allowCombinedRoute: boolean;
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

/** Allow 0 (e.g. DAILY_BLOG_ARTICLES=0 to run X-only daily-ops without blog generation). */
function parseNonNegativeInt(v: string | undefined, fallback: number): number {
  if (v == null || v.trim() === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
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
  const blogArticlesPerDay = parseNonNegativeInt(
    env.DAILY_BLOG_ARTICLES,
    parsePositiveInt(env.BLOG_DAILY_ARTICLES_PER_RUN, 1),
  );
  const xPostSlotHoursJst = parseXPostSlotHoursJst(
    env.X_POST_SLOTS_JST,
    DEFAULT_X_POST_SLOT_HOURS_JST,
  );
  const xMainPostSlotHourJst = parsePositiveInt(
    env.X_MAIN_POST_SLOT_HOUR_JST,
    DEFAULT_X_MAIN_POST_SLOT_HOUR_JST,
  );
  const xPostExtraSlotsDayJst = parseXPostExtraSlotsDayJst(env.X_POST_EXTRA_SLOTS_DAY_JST);
  const xPostExtraSlotTimesJst = parseXPostExtraSlotTimesJst(env.X_POST_EXTRA_SLOTS_TIMES_JST);
  // Regular daily X budget capped by standard slot count (start: max 2).
  // Date-scoped extras use a separate budget and do not consume xPostsPerDay.
  const xPostsPerDay = Math.min(
    parsePositiveInt(env.DAILY_X_POSTS, DEFAULT_X_POSTS_PER_DAY),
    Math.max(1, xPostSlotHoursJst.length),
  );
  const xExtraPostsBudget =
    xPostExtraSlotsDayJst && xPostExtraSlotTimesJst.length > 0
      ? Math.min(
          parsePositiveInt(env.X_POST_EXTRA_POSTS, xPostExtraSlotTimesJst.length),
          xPostExtraSlotTimesJst.length,
        )
      : 0;
  const xHardCapPerDay = parsePositiveInt(
    env.X_POST_HARD_CAP_PER_DAY,
    xPostsPerDay + xExtraPostsBudget,
  );
  return {
    timezone: env.DAILY_OPS_TIMEZONE?.trim() || env.BLOG_DAILY_TIMEZONE?.trim() || "Asia/Tokyo",
    blogArticlesPerDay,
    xPostsPerDay,
    xPostSlotHoursJst,
    xMainPostSlotHourJst,
    xPostExtraSlotsDayJst,
    xPostExtraSlotTimesJst,
    xExtraPostsBudget,
    xHardCapPerDay,
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
    allowDirectAffiliateRoute: parseBool(env.X_ALLOW_DIRECT_AFFILIATE_ROUTE, false),
    allowCombinedRoute: parseBool(env.X_ALLOW_COMBINED_ROUTE, false),
  };
}

/** Minimum publications implied by targets (blog + x). */
export function minimumDailyPublications(config: DailyMultiChannelConfig): number {
  return config.blogArticlesPerDay + config.xPostsPerDay;
}
