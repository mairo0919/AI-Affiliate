/**
 * Daily candidate selection — CORRECTED against newness-only bias.
 * Mix bucket first (when provided), then evidence/score within bucket.
 * Older titles are never excluded solely for age.
 */

export interface DailyCandidateScore {
  researchItemId: string;
  canonicalId: string;
  totalScore: number;
  popularityScore: number | null;
  trendScore: number | null;
  freshnessScore: number | null;
  dataQualityScore: number | null;
  reviewScore: number | null;
  pageEvidenceRichness: number; // 0..1
  sampleImageCount: number;
  actressKey: string | null;
  makerKey: string | null;
  seriesKey: string | null;
  affiliateUrl: string | null;
  title: string;
  publishedAt?: string | null;
  /** Precomputed age bucket when available */
  releaseAgeBucket?: "RECENT" | "MID" | "OLDER" | "UNKNOWN";
}

export interface DailySelectionConfig {
  articlesPerRun: number;
  minTotalScore: number;
  minSampleImages: number;
  minEvidenceRichness: number;
  /** Soft diversity: skip if same actress/maker/series as last N published. */
  recentActressKeys: string[];
  recentMakerKeys: string[];
  recentSeriesKeys: string[];
  /**
   * When set, prefer this release-age bucket. If empty after filters, fall back
   * to full pool (never fail closed just because bucket is thin).
   */
  preferAgeBucket?: "RECENT" | "MID" | "OLDER" | "UNKNOWN" | null;
  /**
   * Deterministic sort overlay for content mix:
   * - popularity: Analysis popularityScore first (POPULAR_RANKING)
   * - performer: under-represented actress first, then score (PERFORMER_RANKING)
   * LLM never invents ranks.
   */
  sortMode?: "default" | "popularity" | "performer";
}

export interface DailySelectionResult {
  selected: DailyCandidateScore | null;
  reason: string;
  considered: number;
  skippedDiversity: number;
  skippedEvidence: number;
  bucketUsed: string | null;
  fellBackFromBucket: boolean;
}

function sortWithinBucket(a: DailyCandidateScore, b: DailyCandidateScore): number {
  // Prefer evidence & non-freshness signals; do not sort by freshnessScore alone.
  const aCore =
    (a.popularityScore ?? 0) +
    (a.trendScore ?? 0) +
    (a.reviewScore ?? 0) +
    (a.dataQualityScore ?? 0);
  const bCore =
    (b.popularityScore ?? 0) +
    (b.trendScore ?? 0) +
    (b.reviewScore ?? 0) +
    (b.dataQualityScore ?? 0);
  const ev = b.pageEvidenceRichness - a.pageEvidenceRichness;
  if (Math.abs(ev) > 0.05) return ev;
  if (Math.abs(bCore - aCore) > 1e-6) return bCore - aCore;
  return b.totalScore - a.totalScore;
}

function sortByPopularity(a: DailyCandidateScore, b: DailyCandidateScore): number {
  const pop = (b.popularityScore ?? 0) - (a.popularityScore ?? 0);
  if (Math.abs(pop) > 1e-6) return pop;
  if (Math.abs(b.totalScore - a.totalScore) > 1e-6) return b.totalScore - a.totalScore;
  return a.canonicalId.localeCompare(b.canonicalId);
}

function sortPerformerFirst(
  pool: DailyCandidateScore[],
  recentActressKeys: string[],
): DailyCandidateScore[] {
  const recent = new Set(recentActressKeys.filter(Boolean));
  const byActress = new Map<string, DailyCandidateScore[]>();
  const noActress: DailyCandidateScore[] = [];
  for (const c of pool) {
    if (!c.actressKey) {
      noActress.push(c);
      continue;
    }
    const list = byActress.get(c.actressKey) ?? [];
    list.push(c);
    byActress.set(c.actressKey, list);
  }
  for (const [, list] of byActress) list.sort(sortByPopularity);

  const actressKeys = [...byActress.keys()].sort((a, b) => {
    const aRecent = recent.has(a) ? 1 : 0;
    const bRecent = recent.has(b) ? 1 : 0;
    if (aRecent !== bRecent) return aRecent - bRecent;
    const aTop = byActress.get(a)![0]!;
    const bTop = byActress.get(b)![0]!;
    return sortByPopularity(aTop, bTop);
  });

  const out: DailyCandidateScore[] = [];
  for (const key of actressKeys) {
    out.push(...(byActress.get(key) ?? []));
  }
  out.push(...noActress.sort(sortByPopularity));
  return out;
}

export function selectDailyProductCandidate(
  pool: DailyCandidateScore[],
  config: DailySelectionConfig,
): DailySelectionResult {
  const base = pool.filter((c) => c.totalScore >= config.minTotalScore);
  let bucketUsed: string | null = null;
  let fellBackFromBucket = false;
  let working = base;

  if (config.preferAgeBucket) {
    const matched = base.filter((c) => (c.releaseAgeBucket ?? "UNKNOWN") === config.preferAgeBucket);
    if (matched.length > 0) {
      working = matched;
      bucketUsed = config.preferAgeBucket;
    } else {
      fellBackFromBucket = true;
      bucketUsed = `fallback_from_${config.preferAgeBucket}`;
    }
  }

  const ranked =
    config.sortMode === "popularity"
      ? working.slice().sort(sortByPopularity)
      : config.sortMode === "performer"
        ? sortPerformerFirst(working, config.recentActressKeys)
        : working.slice().sort(sortWithinBucket);

  let skippedDiversity = 0;
  let skippedEvidence = 0;
  for (const c of ranked) {
    if (c.sampleImageCount < config.minSampleImages || c.pageEvidenceRichness < config.minEvidenceRichness) {
      skippedEvidence += 1;
      continue;
    }
    if (c.actressKey && config.recentActressKeys.includes(c.actressKey)) {
      skippedDiversity += 1;
      continue;
    }
    if (c.makerKey && config.recentMakerKeys.includes(c.makerKey)) {
      skippedDiversity += 1;
      continue;
    }
    if (c.seriesKey && config.recentSeriesKeys.includes(c.seriesKey)) {
      skippedDiversity += 1;
      continue;
    }
    return {
      selected: c,
      reason: `bucket=${bucketUsed};core_rank;score=${c.totalScore};evidence=${c.pageEvidenceRichness}`,
      considered: ranked.length,
      skippedDiversity,
      skippedEvidence,
      bucketUsed,
      fellBackFromBucket,
    };
  }

  for (const c of ranked) {
    if (c.sampleImageCount < config.minSampleImages || c.pageEvidenceRichness < config.minEvidenceRichness) {
      continue;
    }
    return {
      selected: c,
      reason: `fallback_without_diversity;bucket=${bucketUsed};score=${c.totalScore}`,
      considered: ranked.length,
      skippedDiversity,
      skippedEvidence,
      bucketUsed,
      fellBackFromBucket,
    };
  }

  return {
    selected: null,
    reason: "no_eligible_candidate",
    considered: ranked.length,
    skippedDiversity,
    skippedEvidence,
    bucketUsed,
    fellBackFromBucket,
  };
}
