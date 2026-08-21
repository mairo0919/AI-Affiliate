/**
 * Independent Blog vs X candidate selection from a shared FANZA pool.
 */

import {
  selectDailyProductCandidate,
  type DailyCandidateScore,
  type DailySelectionResult,
} from "../daily-blog/selection.js";
import { isBlockedOnChannel, type ChannelPublicationRecord, type ChannelDuplicateConfig } from "./channel-duplicate.js";
import { chooseContentMixSlot, slotToAgeBucket, type ContentMixSlot, type ContentMixWeights, type MixHistoryEntry } from "./content-mix.js";
import { classifyReleaseAge, type ReleaseAgeThresholds } from "./release-age.js";
import { chooseXPostRoute, type XPostRoute, type XRouteDecision } from "./x-route.js";

export type ChannelCandidate = DailyCandidateScore & {
  publishedBlogUrl?: string | null;
};

export interface ChannelSelectionInput {
  pool: ChannelCandidate[];
  mixWeights: ContentMixWeights;
  releaseAge: ReleaseAgeThresholds;
  recentMix: MixHistoryEntry[];
  channelHistory: ChannelPublicationRecord[];
  channelDuplicate: ChannelDuplicateConfig;
  dayKey: string;
  rankingAllowed: boolean;
  rankingDue: boolean;
  blogRecentActressKeys?: string[];
  blogRecentMakerKeys?: string[];
  blogRecentSeriesKeys?: string[];
  xRecentActressKeys?: string[];
  xRecentRoutes?: XPostRoute[];
  minTotalScore: number;
  minSampleImages: number;
  minEvidenceRichness: number;
  now?: Date;
}

export interface ChannelDayPlan {
  mixSlot: ContentMixSlot;
  mixReason: string;
  blog: {
    selection: DailySelectionResult;
    blocked: boolean;
    blockReason: string | null;
  };
  x: {
    selection: DailySelectionResult;
    route: XRouteDecision | null;
    blocked: boolean;
    blockReason: string | null;
    sameProductAsBlog: boolean;
  };
}

function annotateBuckets(
  pool: ChannelCandidate[],
  thresholds: ReleaseAgeThresholds,
  now: Date,
): ChannelCandidate[] {
  return pool.map((c) => {
    if (c.releaseAgeBucket) return c;
    const age =
      c.publishedAt != null
        ? (now.getTime() - new Date(c.publishedAt).getTime()) / 86400000
        : null;
    return {
      ...c,
      releaseAgeBucket: classifyReleaseAge(age, thresholds),
    };
  });
}

export function planDailyChannels(input: ChannelSelectionInput): ChannelDayPlan {
  const now = input.now ?? new Date();
  const annotated = annotateBuckets(input.pool, input.releaseAge, now);
  const mix = chooseContentMixSlot({
    weights: input.mixWeights,
    recentSlots: input.recentMix.map((m) => m.slot),
    rankingAllowed: input.rankingAllowed,
    rankingDue: input.rankingDue,
    dayKey: input.dayKey,
  });
  const preferBucket = slotToAgeBucket(mix.slot);

  // Blog selection
  const blogPool = annotated.filter((c) => {
    const b = isBlockedOnChannel({
      channel: "BLOG",
      canonicalId: c.canonicalId,
      history: input.channelHistory,
      config: input.channelDuplicate,
      now,
    });
    return !b.blocked;
  });
  const blogSelection = selectDailyProductCandidate(blogPool, {
    articlesPerRun: 1,
    minTotalScore: input.minTotalScore,
    minSampleImages: input.minSampleImages,
    minEvidenceRichness: input.minEvidenceRichness,
    recentActressKeys: input.blogRecentActressKeys ?? [],
    recentMakerKeys: input.blogRecentMakerKeys ?? [],
    recentSeriesKeys: input.blogRecentSeriesKeys ?? [],
    preferAgeBucket: mix.slot === "RANKING" ? null : preferBucket,
  });

  let blogBlocked = false;
  let blogBlockReason: string | null = null;
  if (blogSelection.selected) {
    const b = isBlockedOnChannel({
      channel: "BLOG",
      canonicalId: blogSelection.selected.canonicalId,
      history: input.channelHistory,
      config: input.channelDuplicate,
      now,
    });
    blogBlocked = b.blocked;
    blogBlockReason = b.reason;
  }

  // X selection — independent; may equal blog product
  const xPool = annotated.filter((c) => {
    const b = isBlockedOnChannel({
      channel: "X",
      canonicalId: c.canonicalId,
      history: input.channelHistory,
      config: input.channelDuplicate,
      now,
    });
    return !b.blocked;
  });
  const xSelection = selectDailyProductCandidate(xPool, {
    articlesPerRun: 1,
    minTotalScore: input.minTotalScore,
    minSampleImages: Math.min(1, input.minSampleImages), // X needs at least some media feasibility signal
    minEvidenceRichness: Math.min(0.2, input.minEvidenceRichness),
    recentActressKeys: input.xRecentActressKeys ?? [],
    recentMakerKeys: [],
    recentSeriesKeys: [],
    // X mix: slight preference for RECENT when blog took OLDER (soft), else independent mix bucket
    preferAgeBucket:
      blogSelection.selected?.releaseAgeBucket === "OLDER" ? "RECENT" : preferBucket === "OLDER" ? "MID" : preferBucket,
  });

  let xBlocked = false;
  let xBlockReason: string | null = null;
  let route: XRouteDecision | null = null;
  if (xSelection.selected) {
    const b = isBlockedOnChannel({
      channel: "X",
      canonicalId: xSelection.selected.canonicalId,
      history: input.channelHistory,
      config: input.channelDuplicate,
      now,
    });
    xBlocked = b.blocked;
    xBlockReason = b.reason;
    const affiliate = xSelection.selected.affiliateUrl ?? "";
    const fromPool = annotated.find((c) => c.canonicalId === xSelection.selected!.canonicalId);
    route = chooseXPostRoute({
      affiliateUrl: affiliate,
      publishedBlogUrl: fromPool?.publishedBlogUrl,
      preferBlogTrafficHint: mix.slot === "RANKING",
      recentRoutes: input.xRecentRoutes,
    });
  }

  return {
    mixSlot: mix.slot,
    mixReason: mix.reason,
    blog: { selection: blogSelection, blocked: blogBlocked, blockReason: blogBlockReason },
    x: {
      selection: xSelection,
      route,
      blocked: xBlocked,
      blockReason: xBlockReason,
      sameProductAsBlog:
        Boolean(blogSelection.selected && xSelection.selected) &&
        blogSelection.selected!.canonicalId === xSelection.selected!.canonicalId,
    },
  };
}
