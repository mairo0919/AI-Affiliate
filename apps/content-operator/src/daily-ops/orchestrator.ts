/**
 * Multi-channel daily dry orchestrator (LLM=0).
 * Does not call Writer/Brain/X API/WordPress publish.
 */

import { tokyoDateString } from "../daily-blog/idempotency.js";
import { planDailyChannels, type ChannelCandidate } from "./channel-selection.js";
import {
  loadDailyMultiChannelConfig,
  minimumDailyPublications,
  type DailyMultiChannelConfig,
} from "./config.js";
import type { ChannelPublicationRecord } from "./channel-duplicate.js";
import type { MixHistoryEntry } from "./content-mix.js";
import type { XPostRoute } from "./x-route.js";

export interface MultiChannelDryInput {
  config?: DailyMultiChannelConfig;
  pool: ChannelCandidate[];
  channelHistory?: ChannelPublicationRecord[];
  recentMix?: MixHistoryEntry[];
  xRecentRoutes?: XPostRoute[];
  blogRecentActressKeys?: string[];
  productPostsSinceLastRanking?: number;
  daysSinceLastRanking?: number | null;
  now?: Date;
}

export interface MultiChannelDryResult {
  dayKey: string;
  targets: { blog: number; x: number; minimumTotal: number };
  plan: ReturnType<typeof planDailyChannels>;
  biasAudit: {
    poolBucketCounts: Record<string, number>;
    newnessBiasCorrected: true;
    note: string;
  };
  llmCalls: 0;
  wordpressPublishCalls: 0;
  /** @deprecated Always 0 — Blogger is off the daily-ops path. */
  bloggerPublishCalls: 0;
  xPublishCalls: 0;
}

export function runMultiChannelDailyDry(input: MultiChannelDryInput): MultiChannelDryResult {
  const config = input.config ?? loadDailyMultiChannelConfig();
  const now = input.now ?? new Date();
  const dayKey = tokyoDateString(now, config.timezone);
  const rankingDue =
    config.rankingEnabled &&
    (config.rankingEveryNBlogArticles == null ||
      (input.productPostsSinceLastRanking ?? 0) >= config.rankingEveryNBlogArticles) &&
    (config.rankingMinDaysBetween == null ||
      input.daysSinceLastRanking == null ||
      input.daysSinceLastRanking >= config.rankingMinDaysBetween);

  const plan = planDailyChannels({
    pool: input.pool,
    mixWeights: config.mixWeights,
    releaseAge: config.releaseAge,
    recentMix: input.recentMix ?? [],
    channelHistory: input.channelHistory ?? [],
    channelDuplicate: config.channelDuplicate,
    dayKey,
    rankingAllowed: config.rankingEnabled,
    rankingDue,
    blogRecentActressKeys: input.blogRecentActressKeys,
    xRecentRoutes: input.xRecentRoutes,
    minTotalScore: 20,
    minSampleImages: 3,
    minEvidenceRichness: 0.25,
    now,
  });

  const poolBucketCounts: Record<string, number> = {};
  for (const c of input.pool) {
    const b = c.releaseAgeBucket ?? "UNKNOWN";
    poolBucketCounts[b] = (poolBucketCounts[b] ?? 0) + 1;
  }

  return {
    dayKey,
    targets: {
      blog: config.blogArticlesPerDay,
      x: config.xPostsPerDay,
      minimumTotal: minimumDailyPublications(config),
    },
    plan,
    biasAudit: {
      poolBucketCounts,
      newnessBiasCorrected: true,
      note:
        "Selection prefers mix buckets before totalScore; freshness may remain in Analysis totalScore but no longer solely drives daily pick.",
    },
    llmCalls: 0,
    wordpressPublishCalls: 0,
    bloggerPublishCalls: 0,
    xPublishCalls: 0,
  };
}
