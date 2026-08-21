import type { ResearchItemForAnalysis } from "@ai-affiliate/database";

export const SCORING_VERSION = "scoring-v1";
export const ELIGIBILITY_VERSION = "eligibility-v1";
export const SELECTION_VERSION = "selection-v1";

export interface ScoreWeights {
  popularity: number;
  trend: number;
  review: number;
  price: number;
  freshness: number;
  dataQuality: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  popularity: 25,
  trend: 25,
  review: 15,
  price: 10,
  freshness: 15,
  dataQuality: 10,
};

export interface ScoreComponentResult {
  score: number | null;
  available: boolean;
  inputs: Record<string, unknown>;
  calculationVersion: string;
  reasons: string[];
}

export interface MetricSeries {
  type: string;
  points: Array<{ value: number; recordedAt: Date }>;
}

export interface AnalysisContext {
  item: ResearchItemForAnalysis;
  metricsByType: Map<string, MetricSeries>;
  tagsByType: Map<string, string[]>;
  genrePrices: number[];
  now: Date;
  weights: ScoreWeights;
}

export function buildMetricIndex(item: ResearchItemForAnalysis): Map<string, MetricSeries> {
  const map = new Map<string, MetricSeries>();
  for (const metric of item.metrics) {
    const canonical = canonicalizeMetricType(metric.metricType);
    const existing = map.get(canonical) ?? { type: canonical, points: [] };
    existing.points.push({ value: metric.value, recordedAt: metric.recordedAt });
    map.set(canonical, existing);
  }
  for (const series of map.values()) {
    series.points.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  }
  return map;
}

export function canonicalizeMetricType(type: string): string {
  switch (type) {
    case "ranking":
    case "ranking_position":
      return "rankingPosition";
    case "review_count":
      return "reviewCount";
    case "review_average":
    case "review_avg":
      return "reviewAverage";
    case "discount_rate":
      return "discountRate";
    case "list_price":
      return "listPrice";
    default:
      return type;
  }
}

export function buildTagIndex(item: ResearchItemForAnalysis): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const link of item.tags) {
    const type = link.researchTag.type;
    const list = map.get(type) ?? [];
    list.push(link.researchTag.name);
    map.set(type, list);
  }
  return map;
}

export function latestMetric(
  metrics: Map<string, MetricSeries>,
  type: string,
): number | undefined {
  const series = metrics.get(canonicalizeMetricType(type));
  if (!series || series.points.length === 0) {
    return undefined;
  }
  return series.points[series.points.length - 1]?.value;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
