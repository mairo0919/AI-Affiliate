import type { ScoreComponentResult, ScoreWeights } from "./types.js";
import { DEFAULT_SCORE_WEIGHTS } from "./types.js";

/**
 * Renormalize available component scores to 0–100.
 * dataQuality is always required (must be available).
 */
export function computeTotalScore(
  components: {
    popularity: ScoreComponentResult;
    trend: ScoreComponentResult;
    review: ScoreComponentResult;
    price: ScoreComponentResult;
    freshness: ScoreComponentResult;
    dataQuality: ScoreComponentResult;
  },
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): { totalScore: number; usedWeight: number } {
  if (!components.dataQuality.available || components.dataQuality.score === null) {
    throw new Error("dataQualityScore is required");
  }

  const entries: Array<{ score: number; weight: number }> = [
    { score: components.dataQuality.score, weight: weights.dataQuality },
  ];

  const optional: Array<[ScoreComponentResult, number]> = [
    [components.popularity, weights.popularity],
    [components.trend, weights.trend],
    [components.review, weights.review],
    [components.price, weights.price],
    [components.freshness, weights.freshness],
  ];

  for (const [component, weight] of optional) {
    if (component.available && component.score !== null) {
      entries.push({ score: component.score, weight });
    }
  }

  const usedWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (usedWeight <= 0) {
    return { totalScore: 0, usedWeight: 0 };
  }

  const weighted = entries.reduce(
    (sum, entry) => sum + (entry.score / entry.weight) * entry.weight,
    0,
  );
  // entry.score is already in [0, weight], so sum of scores / usedWeight * 100
  const rawSum = entries.reduce((sum, entry) => sum + entry.score, 0);
  const totalScore = Math.min(100, Math.max(0, (rawSum / usedWeight) * 100));
  void weighted;
  return { totalScore: Number(totalScore.toFixed(2)), usedWeight };
}
