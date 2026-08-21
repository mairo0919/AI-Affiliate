/**
 * Ranking article slot planning — configurable cadence, no hardcoded weekday/ratio.
 * Rank order is always deterministic data; LLM never invents ranks.
 */

export type RankingType =
  | "POPULAR"
  | "NEW_RELEASE"
  | "PERFORMER"
  | "GENRE"
  | "SERIES"
  | "MAKER"
  | "PERIOD";

export interface RankingPlanConfig {
  /** Enable ranking articles in the mix (default false until data proven). */
  enabled: boolean;
  /** Insert ranking at most every N product posts (null = never by count). */
  everyNProductPosts: number | null;
  /** Minimum days between ranking posts (null = ignore). */
  minDaysBetweenRanking: number | null;
  /** Allowed types that have real source data. */
  allowedTypes: RankingType[];
}

export interface RankingSlotDecision {
  useRanking: boolean;
  rankingType: RankingType | null;
  reason: string;
}

export interface RankingSnapshotFingerprint {
  rankingType: RankingType;
  periodKey: string;
  productIdsSorted: string[];
}

export function rankingSnapshotKey(fp: RankingSnapshotFingerprint): string {
  return ["rank-snap", fp.rankingType, fp.periodKey, fp.productIdsSorted.join(",")].join(":");
}

export function isNearDuplicateRanking(
  next: RankingSnapshotFingerprint,
  previous: RankingSnapshotFingerprint | null,
  maxUnchangedRatio = 0.85,
): boolean {
  if (!previous) return false;
  if (previous.rankingType !== next.rankingType) return false;
  if (previous.periodKey === next.periodKey) {
    const a = new Set(previous.productIdsSorted);
    const b = next.productIdsSorted;
    if (b.length === 0) return true;
    const overlap = b.filter((id) => a.has(id)).length;
    return overlap / b.length >= maxUnchangedRatio;
  }
  return false;
}

export function decideRankingSlot(input: {
  config: RankingPlanConfig;
  productPostsSinceLastRanking: number;
  daysSinceLastRanking: number | null;
  preferredType?: RankingType | null;
}): RankingSlotDecision {
  const { config } = input;
  if (!config.enabled) {
    return { useRanking: false, rankingType: null, reason: "ranking_disabled" };
  }
  if (config.allowedTypes.length === 0) {
    return { useRanking: false, rankingType: null, reason: "no_allowed_ranking_types" };
  }
  if (
    config.minDaysBetweenRanking != null &&
    input.daysSinceLastRanking != null &&
    input.daysSinceLastRanking < config.minDaysBetweenRanking
  ) {
    return { useRanking: false, rankingType: null, reason: "min_days_not_elapsed" };
  }
  if (
    config.everyNProductPosts != null &&
    input.productPostsSinceLastRanking < config.everyNProductPosts
  ) {
    return { useRanking: false, rankingType: null, reason: "product_quota_not_met" };
  }
  const type =
    input.preferredType && config.allowedTypes.includes(input.preferredType)
      ? input.preferredType
      : config.allowedTypes[0]!;
  return { useRanking: true, rankingType: type, reason: "ranking_slot_open" };
}

/** Writer contract: ranks are frozen facts. */
export interface RankingWriterItem {
  rank: number;
  canonicalId: string;
  title: string;
  affiliateUrl: string;
  performerNames: string[];
  officialFacts: string[];
}

export function freezeRankingItems(items: RankingWriterItem[]): RankingWriterItem[] {
  return items
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((it, i) => ({ ...it, rank: i + 1 }));
}
