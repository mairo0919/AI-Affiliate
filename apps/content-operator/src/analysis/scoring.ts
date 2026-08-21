import type { AnalysisContext, ScoreComponentResult } from "./types.js";
import { SCORING_VERSION, clamp, latestMetric } from "./types.js";

export function scorePopularity(context: AnalysisContext): ScoreComponentResult {
  const max = context.weights.popularity;
  const ranking = latestMetric(context.metricsByType, "rankingPosition");
  const reviewCount = latestMetric(context.metricsByType, "reviewCount");
  const collectPoints = context.metricsByType.get("rankingPosition")?.points.length
    ?? context.item.metrics.length;

  const inputs: Record<string, unknown> = {
    rankingPosition: ranking ?? null,
    reviewCount: reviewCount ?? null,
    metricPointCount: collectPoints,
  };

  if (ranking === undefined && reviewCount === undefined) {
    return {
      score: null,
      available: false,
      inputs,
      calculationVersion: SCORING_VERSION,
      reasons: ["NO_POPULARITY_SIGNALS"],
    };
  }

  let score = 0;
  let parts = 0;
  if (ranking !== undefined) {
    // rank 1 → max, rank 100+ → low
    score += clamp(max * (1 - Math.log10(Math.max(1, ranking)) / 2), 0, max);
    parts += 1;
  }
  if (reviewCount !== undefined) {
    score += clamp(max * (Math.log10(reviewCount + 1) / 4), 0, max);
    parts += 1;
  }
  const normalized = parts > 0 ? score / parts : 0;
  return {
    score: clamp(normalized, 0, max),
    available: true,
    inputs,
    calculationVersion: SCORING_VERSION,
    reasons: [],
  };
}

export function scoreTrend(context: AnalysisContext): ScoreComponentResult {
  const max = context.weights.trend;
  const ranking = context.metricsByType.get("rankingPosition")?.points ?? [];
  const reviews = context.metricsByType.get("reviewCount")?.points ?? [];
  const averages = context.metricsByType.get("reviewAverage")?.points ?? [];
  const discounts = context.metricsByType.get("discountRate")?.points ?? [];
  const metricPoints = Math.max(ranking.length, reviews.length, averages.length, discounts.length);

  const inputs: Record<string, unknown> = { metricPoints };

  if (metricPoints < 2) {
    return {
      score: null,
      available: false,
      inputs,
      calculationVersion: SCORING_VERSION,
      reasons: ["INSUFFICIENT_HISTORY"],
    };
  }

  let score = 0;
  let signals = 0;

  if (ranking.length >= 2) {
    const first = ranking[0]!.value;
    const last = ranking[ranking.length - 1]!.value;
    const improvement = first - last; // lower rank number is better
    inputs.rankingDelta = improvement;
    score += clamp((improvement / Math.max(1, first)) * max, 0, max);
    signals += 1;
  }
  if (reviews.length >= 2) {
    const first = reviews[0]!.value;
    const last = reviews[reviews.length - 1]!.value;
    const growth = last - first;
    inputs.reviewCountDelta = growth;
    score += clamp((growth / Math.max(1, first)) * max, 0, max);
    signals += 1;
  }
  if (averages.length >= 2) {
    const first = averages[0]!.value;
    const last = averages[averages.length - 1]!.value;
    inputs.reviewAverageDelta = last - first;
    score += clamp(((last - first) / 5) * max, 0, max);
    signals += 1;
  }
  if (discounts.length >= 2) {
    const first = discounts[0]!.value;
    const last = discounts[discounts.length - 1]!.value;
    inputs.discountRateDelta = last - first;
    score += clamp(((last - first) / 50) * max, 0, max);
    signals += 1;
  }

  if (signals === 0) {
    return {
      score: null,
      available: false,
      inputs,
      calculationVersion: SCORING_VERSION,
      reasons: ["INSUFFICIENT_HISTORY"],
    };
  }

  return {
    score: clamp(score / signals, 0, max),
    available: true,
    inputs,
    calculationVersion: SCORING_VERSION,
    reasons: [],
  };
}

/** Bayesian average with prior mean 3.5 and prior strength C=20 */
export function scoreReview(context: AnalysisContext): ScoreComponentResult {
  const max = context.weights.review;
  const average = latestMetric(context.metricsByType, "reviewAverage");
  const count = latestMetric(context.metricsByType, "reviewCount");
  const inputs: Record<string, unknown> = {
    reviewAverage: average ?? null,
    reviewCount: count ?? null,
  };

  if (average === undefined || count === undefined) {
    return {
      score: null,
      available: false,
      inputs,
      calculationVersion: SCORING_VERSION,
      reasons: ["MISSING_REVIEW_METRICS"],
    };
  }

  const priorMean = 3.5;
  const priorStrength = 20;
  const bayesian = (priorStrength * priorMean + count * average) / (priorStrength + count);
  const score = clamp(((bayesian - 1) / 4) * max, 0, max);
  inputs.bayesianAverage = Number(bayesian.toFixed(4));

  return {
    score,
    available: true,
    inputs,
    calculationVersion: SCORING_VERSION,
    reasons: [],
  };
}

export function scorePrice(context: AnalysisContext): ScoreComponentResult {
  const max = context.weights.price;
  const price = latestMetric(context.metricsByType, "price");
  const discount = latestMetric(context.metricsByType, "discountRate");
  const inputs: Record<string, unknown> = {
    price: price ?? null,
    discountRate: discount ?? null,
    genrePriceCount: context.genrePrices.length,
  };

  if (price === undefined && discount === undefined) {
    return {
      score: null,
      available: false,
      inputs,
      calculationVersion: SCORING_VERSION,
      reasons: ["MISSING_PRICE"],
    };
  }

  let score = 0;
  let parts = 0;
  if (discount !== undefined) {
    score += clamp((discount / 50) * max, 0, max);
    parts += 1;
  }
  if (price !== undefined && context.genrePrices.length >= 3) {
    const sorted = [...context.genrePrices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    // Prefer near-median with discount rather than cheapest
    const distance = Math.abs(price - median) / Math.max(1, median);
    score += clamp((1 - distance) * max * 0.7, 0, max);
    parts += 1;
  } else if (price !== undefined) {
    // Without genre distribution, only mild contribution from having a price
    score += max * 0.3;
    parts += 1;
  }

  return {
    score: clamp(parts > 0 ? score / parts : 0, 0, max),
    available: true,
    inputs,
    calculationVersion: SCORING_VERSION,
    reasons: [],
  };
}

export function scoreFreshness(context: AnalysisContext): ScoreComponentResult {
  const max = context.weights.freshness;
  const publishedAt = context.item.publishedAt;
  const collectedAt = context.item.collectedAt;
  const inputs: Record<string, unknown> = {
    publishedAt: publishedAt?.toISOString() ?? null,
    collectedAt: collectedAt.toISOString(),
  };

  const anchor = publishedAt ?? collectedAt;
  const ageDays = (context.now.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24);
  inputs.ageDays = Number(ageDays.toFixed(2));

  // Newer is higher, but old items still get some score (never force to zero solely by age)
  const score = clamp(max * Math.exp(-ageDays / 180), max * 0.15, max);
  return {
    score,
    available: true,
    inputs,
    calculationVersion: SCORING_VERSION,
    reasons: [],
  };
}

export function scoreDataQuality(context: AnalysisContext): ScoreComponentResult {
  const max = context.weights.dataQuality;
  const item = context.item;
  const checks = {
    affiliateUrl: Boolean(item.url),
    title: Boolean(item.title?.trim()),
    publishedAt: Boolean(item.publishedAt),
    price: latestMetric(context.metricsByType, "price") !== undefined,
    review: latestMetric(context.metricsByType, "reviewAverage") !== undefined,
    tags: item.tags.length > 0,
    usableImage: item.images.some(
      (image) =>
        image.usageStatus === "ALLOWED" || image.usageStatus === "REQUIRES_CONFIRMATION",
    ),
    entityTag: ["actress", "maker", "series", "genre"].some(
      (type) => (context.tagsByType.get(type)?.length ?? 0) > 0,
    ),
  };
  const keys = Object.keys(checks) as Array<keyof typeof checks>;
  const passed = keys.filter((key) => checks[key]).length;
  const score = clamp((passed / keys.length) * max, 0, max);

  return {
    score,
    available: true,
    inputs: checks,
    calculationVersion: SCORING_VERSION,
    reasons: [],
  };
}
