import type {
  ContentCandidateType,
  ProductAnalysis,
  ResearchItemForAnalysis,
} from "@ai-affiliate/database";
import { latestMetric, buildTagIndex, buildMetricIndex, SELECTION_VERSION } from "./types.js";
import type { ScoreComponentResult } from "./types.js";

export interface DiversityLimits {
  maxPerActress: number;
  maxPerMaker: number;
  maxPerSeries: number;
}

export interface ScoredItem {
  item: ResearchItemForAnalysis;
  analysis: {
    id?: string;
    researchItemId: string;
    totalScore: number;
    popularityScore: number | null;
    trendScore: number | null;
    reviewScore: number | null;
    priceScore: number | null;
    freshnessScore: number | null;
    dataQualityScore: number;
    eligibilityStatus: ProductAnalysis["eligibilityStatus"];
    breakdown: Record<string, ScoreComponentResult>;
  };
}

export interface SelectedCandidate {
  researchItemId: string;
  productAnalysisId: string;
  candidateType: ContentCandidateType;
  rank: number;
  selectionScore: number;
  selectionReasons: string[];
}

export interface SelectionOptions {
  candidateTypes: ContentCandidateType[];
  perTypeLimit: number;
  overallLimit: number;
  minimumScore: number;
  includeRequiresConfirmation: boolean;
  diversity: DiversityLimits;
}

export function selectCandidates(
  scored: ScoredItem[],
  options: SelectionOptions,
): SelectedCandidate[] {
  const eligiblePool = scored.filter((entry) => {
    if (entry.analysis.eligibilityStatus === "NOT_ELIGIBLE") {
      return false;
    }
    if (
      entry.analysis.eligibilityStatus === "REQUIRES_CONFIRMATION" &&
      !options.includeRequiresConfirmation
    ) {
      return false;
    }
    // Never promote NOT_ALLOWED-only items (already NOT_ELIGIBLE) or without analysis id when saving
    return entry.analysis.totalScore >= options.minimumScore;
  });

  const selected: SelectedCandidate[] = [];
  const typeSets = new Map<ContentCandidateType, Set<string>>();

  for (const type of options.candidateTypes) {
    typeSets.set(type, new Set());
    const ranked = rankForType(eligiblePool, type);
    const picked = applyDiversity(ranked, options.diversity, options.perTypeLimit);
    for (let i = 0; i < picked.length; i += 1) {
      const entry = picked[i]!;
      if (selected.length >= options.overallLimit) {
        break;
      }
      const set = typeSets.get(type)!;
      if (set.has(entry.item.id)) {
        continue;
      }
      set.add(entry.item.id);
      selected.push({
        researchItemId: entry.item.id,
        productAnalysisId: entry.analysis.id ?? "",
        candidateType: type,
        rank: i + 1,
        selectionScore: scoreForType(entry, type),
        selectionReasons: entry.selectionReasons,
      });
    }
  }

  return selected;
}

function scoreForType(entry: ScoredItem & { selectionReasons?: string[] }, type: ContentCandidateType): number {
  switch (type) {
    case "TRENDING":
      return entry.analysis.trendScore ?? 0;
    case "HIGH_RATING":
      return entry.analysis.reviewScore ?? 0;
    case "NEW_RELEASE":
      return entry.analysis.freshnessScore ?? 0;
    case "DISCOUNT": {
      const metrics = buildMetricIndex(entry.item);
      return latestMetric(metrics, "discountRate") ?? entry.analysis.priceScore ?? 0;
    }
    case "RANKING":
    case "EDITORIAL":
    default:
      return entry.analysis.totalScore;
  }
}

function rankForType(
  pool: ScoredItem[],
  type: ContentCandidateType,
): Array<ScoredItem & { selectionReasons: string[] }> {
  const filtered = pool.filter((entry) => {
    switch (type) {
      case "TRENDING":
        return (
          entry.analysis.trendScore !== null &&
          entry.analysis.breakdown.trend?.available === true &&
          (entry.analysis.trendScore ?? 0) > 0
        );
      case "HIGH_RATING":
        return entry.analysis.reviewScore !== null;
      case "NEW_RELEASE":
        return entry.analysis.freshnessScore !== null;
      case "DISCOUNT": {
        const metrics = buildMetricIndex(entry.item);
        const discount = latestMetric(metrics, "discountRate");
        return discount !== undefined && discount > 0;
      }
      case "RANKING":
      case "EDITORIAL":
      default:
        return entry.analysis.eligibilityStatus === "ELIGIBLE" || entry.analysis.totalScore > 0;
    }
  });

  return filtered
    .map((entry) => ({
      ...entry,
      selectionReasons: [`TYPE_${type}`, `SELECTION_${SELECTION_VERSION}`],
    }))
    .sort((a, b) => scoreForType(b, type) - scoreForType(a, type));
}

function applyDiversity(
  ranked: Array<ScoredItem & { selectionReasons: string[] }>,
  limits: DiversityLimits,
  limit: number,
): Array<ScoredItem & { selectionReasons: string[] }> {
  const strict = pickWithLimits(ranked, limits, limit);
  if (strict.length >= Math.min(limit, ranked.length)) {
    return strict;
  }

  // Relax gradually
  const relaxedLimits: DiversityLimits = {
    maxPerActress: limits.maxPerActress * 2,
    maxPerMaker: limits.maxPerMaker * 2,
    maxPerSeries: limits.maxPerSeries * 2,
  };
  const relaxed = pickWithLimits(ranked, relaxedLimits, limit);
  return relaxed.map((entry) => ({
    ...entry,
    selectionReasons: [...entry.selectionReasons, "DIVERSITY_RELAXED"],
  }));
}

function pickWithLimits(
  ranked: Array<ScoredItem & { selectionReasons: string[] }>,
  limits: DiversityLimits,
  limit: number,
): Array<ScoredItem & { selectionReasons: string[] }> {
  const actressCount = new Map<string, number>();
  const makerCount = new Map<string, number>();
  const seriesCount = new Map<string, number>();
  const picked: Array<ScoredItem & { selectionReasons: string[] }> = [];

  for (const entry of ranked) {
    if (picked.length >= limit) {
      break;
    }
    const tags = buildTagIndex(entry.item);
    const actress = tags.get("actress")?.[0];
    const maker = tags.get("maker")?.[0];
    const series = tags.get("series")?.[0];

    if (actress && (actressCount.get(actress) ?? 0) >= limits.maxPerActress) {
      continue;
    }
    if (maker && (makerCount.get(maker) ?? 0) >= limits.maxPerMaker) {
      continue;
    }
    if (series && (seriesCount.get(series) ?? 0) >= limits.maxPerSeries) {
      continue;
    }

    picked.push(entry);
    if (actress) actressCount.set(actress, (actressCount.get(actress) ?? 0) + 1);
    if (maker) makerCount.set(maker, (makerCount.get(maker) ?? 0) + 1);
    if (series) seriesCount.set(series, (seriesCount.get(series) ?? 0) + 1);
  }

  return picked;
}
