/**
 * Independent Blog vs X candidate selection from a shared FANZA pool.
 * Content mix slots steer selection; Writer format stays NEW_RELEASE_SINGLE.
 */

import {
  selectDailyProductCandidate,
  type DailyCandidateScore,
  type DailySelectionResult,
} from "../daily-blog/selection.js";
import { isBlockedOnChannel, type ChannelPublicationRecord, type ChannelDuplicateConfig } from "./channel-duplicate.js";
import {
  chooseContentMixSlot,
  slotToAgeBucket,
  slotToSortMode,
  type ContentMixSlot,
  type ContentMixWeights,
  type MixHistoryEntry,
} from "./content-mix.js";
import { classifyReleaseAge, type ReleaseAgeThresholds } from "./release-age.js";
import { chooseXPostRoute, type XPostRoute, type XRouteDecision } from "./x-route.js";

export type ChannelCandidate = DailyCandidateScore & {
  publishedBlogUrl?: string | null;
};

export interface ChannelSelectionInput {
  pool: ChannelCandidate[];
  mixWeights: ContentMixWeights;
  releaseAge: ReleaseAgeThresholds;
  /** Blog mix history (preferred); falls back to recentMix */
  recentBlogMix?: MixHistoryEntry[];
  /** X mix history (preferred); falls back to recentMix */
  recentXMix?: MixHistoryEntry[];
  /** @deprecated use recentBlogMix / recentXMix */
  recentMix?: MixHistoryEntry[];
  channelHistory: ChannelPublicationRecord[];
  channelDuplicate: ChannelDuplicateConfig;
  dayKey: string;
  blogRecentActressKeys?: string[];
  blogRecentMakerKeys?: string[];
  blogRecentSeriesKeys?: string[];
  xRecentActressKeys?: string[];
  xRecentRoutes?: XPostRoute[];
  minTotalScore: number;
  minSampleImages: number;
  minEvidenceRichness: number;
  now?: Date;
  /** @deprecated ranking cadence folded into mix weights — ignored */
  rankingAllowed?: boolean;
  rankingDue?: boolean;
}

export interface ChannelDayPlan {
  /** Blog mix slot (primary) */
  mixSlot: ContentMixSlot;
  mixReason: string;
  blogMixSlot: ContentMixSlot;
  xMixSlot: ContentMixSlot;
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
    sameMixSlotAsBlog: boolean;
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

function pickForSlot(
  pool: ChannelCandidate[],
  slot: ContentMixSlot,
  opts: {
    minTotalScore: number;
    minSampleImages: number;
    minEvidenceRichness: number;
    recentActressKeys: string[];
    recentMakerKeys: string[];
    recentSeriesKeys: string[];
  },
): DailySelectionResult {
  return selectDailyProductCandidate(pool, {
    articlesPerRun: 1,
    minTotalScore: opts.minTotalScore,
    minSampleImages: opts.minSampleImages,
    minEvidenceRichness: opts.minEvidenceRichness,
    recentActressKeys: opts.recentActressKeys,
    recentMakerKeys: opts.recentMakerKeys,
    recentSeriesKeys: opts.recentSeriesKeys,
    preferAgeBucket: slotToAgeBucket(slot),
    sortMode: slotToSortMode(slot),
  });
}

export function planDailyChannels(input: ChannelSelectionInput): ChannelDayPlan {
  const now = input.now ?? new Date();
  const annotated = annotateBuckets(input.pool, input.releaseAge, now);
  const blogHistory = (input.recentBlogMix ?? input.recentMix ?? []).map((m) => m.slot);
  const xHistory = (input.recentXMix ?? input.recentMix ?? []).map((m) => m.slot);

  const blogMix = chooseContentMixSlot({
    weights: input.mixWeights,
    recentSlots: blogHistory,
    dayKey: input.dayKey,
    channelSalt: "BLOG",
  });

  // Soft avoid same type as Blog today — do not hard-force difference
  const xMix = chooseContentMixSlot({
    weights: input.mixWeights,
    recentSlots: xHistory,
    dayKey: input.dayKey,
    channelSalt: "X",
    excludeSlot: blogMix.slot,
  });

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
  const blogSelection = pickForSlot(blogPool, blogMix.slot, {
    minTotalScore: input.minTotalScore,
    minSampleImages: input.minSampleImages,
    minEvidenceRichness: input.minEvidenceRichness,
    recentActressKeys: input.blogRecentActressKeys ?? [],
    recentMakerKeys: input.blogRecentMakerKeys ?? [],
    recentSeriesKeys: input.blogRecentSeriesKeys ?? [],
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

  const blogCid = blogSelection.selected?.canonicalId ?? null;
  const xPool = annotated.filter((c) => {
    if (blogCid && c.canonicalId === blogCid) return false; // soft: prefer different product same day
    const b = isBlockedOnChannel({
      channel: "X",
      canonicalId: c.canonicalId,
      history: input.channelHistory,
      config: input.channelDuplicate,
      now,
    });
    return !b.blocked;
  });

  let xSelection = pickForSlot(xPool, xMix.slot, {
    minTotalScore: input.minTotalScore,
    minSampleImages: Math.min(1, input.minSampleImages),
    minEvidenceRichness: Math.min(0.2, input.minEvidenceRichness),
    recentActressKeys: input.xRecentActressKeys ?? [],
    recentMakerKeys: [],
    recentSeriesKeys: [],
  });

  // If soft-exclude emptied X pool, fall back allowing same product
  if (!xSelection.selected && blogCid) {
    const xPoolAllowSame = annotated.filter((c) => {
      const b = isBlockedOnChannel({
        channel: "X",
        canonicalId: c.canonicalId,
        history: input.channelHistory,
        config: input.channelDuplicate,
        now,
      });
      return !b.blocked;
    });
    xSelection = pickForSlot(xPoolAllowSame, xMix.slot, {
      minTotalScore: input.minTotalScore,
      minSampleImages: Math.min(1, input.minSampleImages),
      minEvidenceRichness: Math.min(0.2, input.minEvidenceRichness),
      recentActressKeys: input.xRecentActressKeys ?? [],
      recentMakerKeys: [],
      recentSeriesKeys: [],
    });
  }

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
      preferBlogTrafficHint:
        blogMix.slot === "POPULAR_RANKING" || blogMix.slot === "PERFORMER_RANKING",
      recentRoutes: input.xRecentRoutes,
    });
  }

  return {
    mixSlot: blogMix.slot,
    mixReason: `blog=${blogMix.reason};x=${xMix.reason}`,
    blogMixSlot: blogMix.slot,
    xMixSlot: xMix.slot,
    blog: { selection: blogSelection, blocked: blogBlocked, blockReason: blogBlockReason },
    x: {
      selection: xSelection,
      route,
      blocked: xBlocked,
      blockReason: xBlockReason,
      sameProductAsBlog:
        Boolean(blogSelection.selected && xSelection.selected) &&
        blogSelection.selected!.canonicalId === xSelection.selected!.canonicalId,
      sameMixSlotAsBlog: blogMix.slot === xMix.slot,
    },
  };
}
