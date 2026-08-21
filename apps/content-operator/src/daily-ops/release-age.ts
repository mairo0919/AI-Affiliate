/**
 * Release-age mix buckets — CORRECT newness bias without "retro year" taxonomy.
 * Threshold days are configurable; no product/actress rules.
 */

export type ReleaseAgeBucket = "RECENT" | "MID" | "OLDER" | "UNKNOWN";

export interface ReleaseAgeThresholds {
  /** ageDays < recentMaxDays → RECENT */
  recentMaxDays: number;
  /** recentMaxDays <= ageDays < olderMinDays → MID */
  olderMinDays: number;
}

export const DEFAULT_RELEASE_AGE_THRESHOLDS: ReleaseAgeThresholds = {
  recentMaxDays: 60,
  olderMinDays: 365,
};

export function ageDaysFromPublishedAt(
  publishedAt: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!publishedAt) return null;
  const d = typeof publishedAt === "string" ? new Date(publishedAt) : publishedAt;
  if (Number.isNaN(d.getTime())) return null;
  return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
}

export function classifyReleaseAge(
  ageDays: number | null,
  thresholds: ReleaseAgeThresholds = DEFAULT_RELEASE_AGE_THRESHOLDS,
): ReleaseAgeBucket {
  if (ageDays == null || !Number.isFinite(ageDays) || ageDays < 0) return "UNKNOWN";
  if (ageDays < thresholds.recentMaxDays) return "RECENT";
  if (ageDays < thresholds.olderMinDays) return "MID";
  return "OLDER";
}

/** Soft demotion only — never exclude OLDER solely for age. */
export function freshnessBiasNote(totalScore: number, freshnessScore: number | null): string {
  if (freshnessScore == null) return "no_freshness_component";
  if (freshnessScore > 0 && totalScore > 0 && freshnessScore / totalScore > 0.35) {
    return "total_score_freshness_heavy";
  }
  return "freshness_component_moderate";
}
