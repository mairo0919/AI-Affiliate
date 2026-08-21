import type { ArticleStructureObservation } from "@ai-affiliate/database";
import type { ArticleStructureFeatures, ArticleWritingFeatures } from "./types.js";

export type LearningSuitabilityClass = "A" | "B" | "C";

export type LearningSuitabilityResult = {
  classification: LearningSuitabilityClass;
  score: number;
  reasons: string[];
  targetFormatKey: string;
};

function asFeatures(raw: unknown): ArticleStructureFeatures | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as ArticleStructureFeatures;
}

function asWriting(features: ArticleStructureFeatures | null): ArticleWritingFeatures | null {
  if (!features?.writingFeatures || typeof features.writingFeatures !== "object") return null;
  return features.writingFeatures;
}

/**
 * Multi-signal editorial value. recommendation ratio alone does NOT count.
 */
export function countEditorialSignals(w: ArticleWritingFeatures): {
  count: number;
  signals: string[];
} {
  const signals: string[] = [];
  if (w.audienceFramingUsed) signals.push("audience_framing");
  if (w.benefitFramingUsed) signals.push("benefit_framing");
  if (w.scenarioFramingUsed) signals.push("scenario_framing");
  if (w.introPurpose === "selection_frame") signals.push("selection_frame");
  if (w.sectionPurposeSequence.includes("selection_criteria")) signals.push("selection_criteria");
  if (w.sectionPurposeSequence.includes("editorial_angle")) signals.push("editorial_angle");
  if (w.introHookType === "direct_recommendation") signals.push("direct_recommendation_hook");
  if (w.introHookType === "audience_framing") signals.push("audience_hook");
  if (w.productDifferentiationStyle === "criteria_based") signals.push("criteria_based");
  if (w.ctaContext === "decision_support" && w.ctaLeadInType === "bridge_from_editorial") {
    signals.push("decision_support_cta");
  }
  if (
    typeof w.descriptionRecommendationRatio === "number" &&
    w.descriptionRecommendationRatio >= 0.35 &&
    (w.benefitFramingUsed ||
      w.audienceFramingUsed ||
      w.introPurpose === "selection_frame" ||
      w.productDifferentiationStyle === "criteria_based")
  ) {
    signals.push("recommendation_with_reasoning");
  }
  return { count: signals.length, signals };
}

/**
 * Deterministic NEW_RELEASE_SINGLE learning suitability (strict).
 * rankingUsed alone does not force demotion when productCount≈1.
 */
export function evaluateSingleArticleLearningSuitability(
  observation: Pick<
    ArticleStructureObservation,
    "articleTypeHint" | "features" | "sourceUrl" | "sourceDomain"
  >,
  options?: { targetFormatKey?: string },
): LearningSuitabilityResult {
  const targetFormatKey = options?.targetFormatKey ?? "NEW_RELEASE_SINGLE";
  const features = asFeatures(observation.features);
  const writing = asWriting(features);
  const reasons: string[] = [];
  let score = 0.5;

  if (!features || !writing) {
    return {
      classification: "C",
      score: 0.05,
      reasons: ["missing_structure_or_writing_features"],
      targetFormatKey,
    };
  }

  const productCount = Number(features.estimatedProductCount ?? 1);
  const comparison = Boolean(features.comparisonTableUsed);
  const ranking = Boolean(features.rankingUsed);
  const hint = String(observation.articleTypeHint ?? "");
  const density = String(writing.informationDensityBucket ?? "low");
  const repetition = String(writing.repetitionRateBucket ?? "medium");
  const catalogLevel = String(writing.catalogStyleLevel ?? "balanced");
  const recoRatio = Number(writing.descriptionRecommendationRatio ?? 0);
  const factRatio = Number(writing.factOpinionRatio ?? 0.5);
  const totalLength = Number(features.totalLength ?? 0);
  const { count: editorialSignalCount, signals: editorialSignals } = countEditorialSignals(writing);
  const strongEditorial = editorialSignalCount >= 2;
  const weakRecoOnly =
    recoRatio >= 0.35 &&
    editorialSignalCount === 0 &&
    !writing.benefitFramingUsed &&
    !writing.audienceFramingUsed &&
    !writing.scenarioFramingUsed;

  if (editorialSignalCount > 0) {
    reasons.push(`editorial_signals_${editorialSignalCount}`);
    score += Math.min(0.28, editorialSignalCount * 0.1);
  } else {
    reasons.push("no_multi_signal_editorial");
    score -= 0.2;
  }
  for (const s of editorialSignals.slice(0, 6)) reasons.push(s);

  // --- Hard C signals ---
  if (totalLength > 0 && totalLength < 400 && !strongEditorial) {
    reasons.push("content_too_short");
    score -= 0.35;
  } else if (totalLength > 0 && totalLength < 400) {
    reasons.push("short_but_editorial");
    score -= 0.1;
  }
  if (catalogLevel === "high" && recoRatio <= 0.05 && !strongEditorial) {
    reasons.push("thin_catalog_restate");
    score -= 0.4;
  }
  if (recoRatio <= 0.05 && factRatio >= 0.9 && density === "low") {
    reasons.push("fact_only_low_density");
    score -= 0.35;
  }
  if (!strongEditorial && recoRatio < 0.2 && catalogLevel !== "balanced") {
    reasons.push("weak_editorial_value");
    score -= 0.25;
  }
  if (weakRecoOnly && density === "low") {
    reasons.push("reco_ratio_only_low_density");
    score -= 0.25;
  }
  if (repetition === "high") {
    reasons.push("high_repetition");
    score -= 0.2;
  }

  const clearlyMulti =
    comparison ||
    productCount >= 5 ||
    (hint === "comparison" && productCount >= 2) ||
    (hint === "ranking_or_collection" && productCount >= 4);

  if (comparison) {
    reasons.push("comparison_table");
    score -= 0.15;
  }
  if (productCount >= 5) {
    reasons.push(`multi_product_count_${productCount}`);
    score -= 0.25;
  } else if (productCount >= 3) {
    reasons.push(`elevated_product_count_${productCount}`);
    score -= 0.1;
  } else if (productCount <= 1) {
    reasons.push("product_count_near_1");
    score += 0.18;
  } else if (productCount === 2) {
    reasons.push("borderline_product_count_2");
    score -= 0.05;
  }

  // rankingUsed alone: soft signal only (known false positives)
  if (ranking && productCount <= 1) {
    reasons.push("ranking_flag_with_single_product_ignored_for_demotion");
  } else if (ranking && productCount >= 3) {
    reasons.push("ranking_with_multi_product");
    score -= 0.1;
  }

  if (recoRatio >= 0.35 && strongEditorial) {
    reasons.push("recommendation_signal");
    score += 0.1;
  } else if (recoRatio >= 0.35 && !strongEditorial) {
    reasons.push("recommendation_ratio_without_reasoning");
    score -= 0.05;
  } else if (recoRatio <= 0.05) {
    reasons.push("recommendation_near_zero");
    score -= 0.18;
  }

  if (density === "medium" || density === "high") {
    reasons.push(`density_${density}`);
    score += 0.1;
  } else {
    reasons.push("density_low");
    score -= 0.12;
  }
  if (repetition === "low") {
    reasons.push("repetition_low");
    score += 0.08;
  }
  if (catalogLevel === "high" && !strongEditorial) {
    reasons.push("catalog_style_high");
    score -= 0.12;
  } else if (catalogLevel === "balanced") {
    score += 0.05;
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(3))));

  // Hard C exits
  if (
    reasons.includes("thin_catalog_restate") ||
    reasons.includes("fact_only_low_density") ||
    (reasons.includes("content_too_short") && !strongEditorial) ||
    (weakRecoOnly && density === "low") ||
    (reasons.includes("weak_editorial_value") && density === "low" && !strongEditorial)
  ) {
    reasons.push("insufficient_editorial_for_learning");
    return { classification: "C", score, reasons, targetFormatKey };
  }

  // Multi / comparison → at best B (needs strong multi-signal editorial)
  if (clearlyMulti) {
    if (strongEditorial && score >= 0.4 && density !== "low") {
      reasons.push("multi_or_comparison_style_reference_only");
      return { classification: "B", score, reasons, targetFormatKey };
    }
    if (strongEditorial && score >= 0.45) {
      reasons.push("multi_with_editorial_but_density_or_score_limited");
      return { classification: "B", score, reasons, targetFormatKey };
    }
    reasons.push("multi_without_enough_editorial_for_B");
    return { classification: "C", score, reasons, targetFormatKey };
  }

  // Single-product path
  const singleish = productCount <= 1 || (productCount <= 3 && strongEditorial && !comparison);
  const catalogOk = catalogLevel !== "high" || (strongEditorial && recoRatio >= 0.3);
  const densityOk = density === "medium" || density === "high";
  const aEligible =
    singleish &&
    !comparison &&
    !clearlyMulti &&
    repetition !== "high" &&
    catalogOk &&
    strongEditorial &&
    editorialSignalCount >= 2 &&
    densityOk &&
    recoRatio > 0.05;

  if (aEligible && score >= 0.5) {
    reasons.push("single_editorial_suitable_for_new_release_single");
    return { classification: "A", score, reasons, targetFormatKey };
  }

  // Single with some writing value → B (not thin C)
  if (strongEditorial && score >= 0.4 && !weakRecoOnly) {
    reasons.push("editorial_but_not_single_format_ready");
    return { classification: "B", score, reasons, targetFormatKey };
  }

  reasons.push("insufficient_single_editorial_signals");
  return { classification: "C", score, reasons, targetFormatKey };
}

export function readLearningSuitability(
  metadata: unknown,
): LearningSuitabilityResult | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const raw = (metadata as { learningSuitability?: unknown }).learningSuitability;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const classification = r.classification;
  if (classification !== "A" && classification !== "B" && classification !== "C") return null;
  return {
    classification,
    score: typeof r.score === "number" ? r.score : 0,
    reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : [],
    targetFormatKey:
      typeof r.targetFormatKey === "string" ? r.targetFormatKey : "NEW_RELEASE_SINGLE",
  };
}
