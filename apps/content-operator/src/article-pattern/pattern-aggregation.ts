import type { ArticleStructureObservation } from "@ai-affiliate/database";
import { canonicalizeArticlePatternUrl } from "./canonical-url.js";
import type {
  ArticleFormatSpec,
  ArticleStructureFeatures,
  ArticleWritingFeatures,
  ArticleWritingPolicy,
} from "./types.js";
import { DEFAULT_SINGLE_WRITING_POLICY } from "./types.js";

function normalizeFormatKeyForAggregation(raw: string): string {
  const key = raw.trim();
  if (!key) return "NEW_RELEASE_SINGLE";
  if (key === "blogger-article" || key === "new-release") return "NEW_RELEASE_SINGLE";
  return key;
}

export type AggregationThresholds = {
  minimumSampleCount: number;
  minimumDomainDiversity: number;
};

export type PatternAggregationResult = {
  sampleCount: number;
  sourceCount: number;
  domainDiversity: number;
  confidence: number;
  meetsThresholds: boolean;
  articleTypeHint: string;
  suggestedFormatKey: string;
  suggestedCategory: "ARTICLE" | "LISTICLE" | "COMPARISON" | "GUIDE" | "OTHER";
  suggestedDisplayName: string;
  featureSummary: {
    medianProductCount: number;
    medianHeadingCount: number;
    medianCtaCount: number;
    medianIntroLength: number;
    medianTotalLength: number;
    rankingUsedRate: number;
    comparisonTableUsedRate: number;
    faqUsedRate: number;
    sectionOrderMode: string[];
    writingFeatureFrequencies: Record<string, Record<string, number>>;
    benefitFramingRate: number;
    audienceFramingRate: number;
  };
  proposedSpec: ArticleFormatSpec;
  observationIds: string[];
  domains: string[];
};

function asFeatures(raw: unknown): ArticleStructureFeatures | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const f = raw as ArticleStructureFeatures;
  if (!f.writingFeatures || typeof f.writingFeatures !== "object") {
    return {
      ...f,
      imageRoles: Array.isArray(f.imageRoles) ? f.imageRoles : [],
      writingFeatures: {
        introHookType: "factual",
        introPurpose: "topic_open",
        introLengthBucket: "medium",
        paragraphLengthDistribution: { short: 0.3, medium: 0.5, long: 0.2 },
        sentenceLengthDistribution: { short: 0.3, medium: 0.5, long: 0.2 },
        tone: "catalog",
        pointOfView: "third_person",
        factOpinionRatio: 0.6,
        descriptionRecommendationRatio: 0.3,
        productFactPlacement: "mid",
        recommendationPlacement: "sparse",
        benefitFramingUsed: false,
        audienceFramingUsed: false,
        scenarioFramingUsed: false,
        curiosityGapUsed: false,
        questionHookUsed: false,
        conclusionFirstUsed: false,
        sectionPurposeSequence: ["intro_hook", "product_facts", "cta"],
        repetitionRateBucket: "medium",
        ctaLeadInType: "direct",
        ctaContext: "link_only",
        informationDensityBucket: "low",
        productDifferentiationStyle: "catalog",
        subjectiveLanguageLevel: "low",
        reviewStyle: "editorial_non_experiential",
        catalogStyleLevel: "high",
      },
    };
  }
  return f;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : (sorted[mid] ?? 0);
}

function modeSectionOrder(orders: string[][]): string[] {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const key = order.join(">");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best ? best.split(">").filter(Boolean) : ["intro", "product_sections", "cta"];
}

function frequencyMap(values: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const total = Math.max(1, values.length);
  const out: Record<string, number> = {};
  for (const [k, c] of counts) out[k] = Number((c / total).toFixed(3));
  return out;
}

function topKeys(freq: Record<string, number>, n: number): string[] {
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function modePurposeSequence(seqs: string[][]): string[] {
  return modeSectionOrder(seqs);
}

function buildWritingPolicy(
  writingList: ArticleWritingFeatures[],
): ArticleWritingPolicy {
  if (writingList.length === 0) return { ...DEFAULT_SINGLE_WRITING_POLICY };

  const hookFreq = frequencyMap(writingList.map((w) => w.introHookType));
  const benefitRate =
    writingList.filter((w) => w.benefitFramingUsed).length / writingList.length;
  const audienceRate =
    writingList.filter((w) => w.audienceFramingUsed).length / writingList.length;
  const densityFreq = frequencyMap(writingList.map((w) => w.informationDensityBucket));
  const densityTop = topKeys(densityFreq, 1)[0] ?? "medium";
  const purpose = modePurposeSequence(writingList.map((w) => w.sectionPurposeSequence));
  const medianFact = median(writingList.map((w) => w.factOpinionRatio));
  const ctaLead = topKeys(frequencyMap(writingList.map((w) => w.ctaLeadInType)), 1)[0];

  return {
    introRole: topKeys(frequencyMap(writingList.map((w) => w.introPurpose)), 1)[0] ??
      DEFAULT_SINGLE_WRITING_POLICY.introRole,
    preferredHookTypes: topKeys(hookFreq, 3),
    targetParagraphLength: "medium",
    factOpinionBalance: {
      factMin: Math.min(0.7, Math.max(0.35, Number(medianFact.toFixed(2)) - 0.05)),
      opinionMax: Math.min(0.65, Math.max(0.3, 1 - medianFact + 0.1)),
    },
    recommendationRequired:
      writingList.filter((w) => w.descriptionRecommendationRatio >= 0.35).length /
        writingList.length >=
      0.4,
    audienceFraming: audienceRate >= 0.4,
    benefitFraming: benefitRate >= 0.4,
    repetitionPolicy: { maxOverlapScore: 0.35 },
    sectionPurposeSequence:
      purpose.length >= 2 ? purpose : DEFAULT_SINGLE_WRITING_POLICY.sectionPurposeSequence,
    ctaLeadInPolicy: ctaLead ?? DEFAULT_SINGLE_WRITING_POLICY.ctaLeadInPolicy,
    informationDensity:
      densityTop === "high" || densityTop === "low" || densityTop === "medium"
        ? densityTop
        : "medium",
    forbidGenericPraise: true,
    requireEditorialValue: true,
  };
}

export function aggregateArticlePatterns(
  observations: ArticleStructureObservation[],
  thresholds: AggregationThresholds,
  options?: {
    /** When set to NEW_RELEASE_SINGLE, force single-product spec regardless of evidence mix. */
    formatKeyOverride?: string | null;
  },
): PatternAggregationResult | null {
  if (observations.length === 0) return null;

  const domains = [...new Set(observations.map((o) => o.sourceDomain))];
  const featuresList = observations
    .map((o) => asFeatures(o.features))
    .filter((f): f is ArticleStructureFeatures => f != null);
  if (featuresList.length === 0) return null;

  const sampleCount = featuresList.length;
  const domainDiversity = domains.length;
  const sourceCount = new Set(
    observations
      .map((o) => canonicalizeArticlePatternUrl(o.sourceUrl) ?? o.sourceUrl)
      .filter(Boolean),
  ).size;

  const productCounts = featuresList.map((f) => f.estimatedProductCount);
  const medianProductCount = median(productCounts);
  const rankingUsedRate =
    featuresList.filter((f) => f.rankingUsed).length / featuresList.length;
  const comparisonTableUsedRate =
    featuresList.filter((f) => f.comparisonTableUsed).length / featuresList.length;
  const faqUsedRate = featuresList.filter((f) => f.faqUsed).length / featuresList.length;

  const sectionOrderMode = modeSectionOrder(featuresList.map((f) => f.sectionOrder));
  const typeHints = observations.map((o) => o.articleTypeHint ?? "single_review");
  const typeHint =
    typeHints.sort(
      (a, b) =>
        typeHints.filter((t) => t === b).length - typeHints.filter((t) => t === a).length,
    )[0] ?? "single_review";

  // Prefer single-product format keys for this phase; multi-product keys remain proposable
  // only when evidence is overwhelmingly listicle (still not implemented for generation).
  let suggestedFormatKey = "NEW_RELEASE_SINGLE";
  let suggestedCategory: PatternAggregationResult["suggestedCategory"] = "ARTICLE";
  let suggestedDisplayName = "New release single";
  if (medianProductCount >= 5 || rankingUsedRate >= 0.5) {
    suggestedFormatKey = medianProductCount >= 8 ? "BEST_10" : "BEST_5";
    suggestedCategory = "LISTICLE";
    suggestedDisplayName = suggestedFormatKey === "BEST_10" ? "Best 10 list" : "Best 5 list";
  } else if (comparisonTableUsedRate >= 0.5) {
    suggestedFormatKey = "COMPARISON";
    suggestedCategory = "COMPARISON";
    suggestedDisplayName = "Comparison";
  } else if (typeHint === "catalog_overview") {
    suggestedFormatKey = "NEW_RELEASE_SINGLE";
    suggestedCategory = "ARTICLE";
  }

  // Explicit format-key override wins for suggested key AND single-product target count.
  // Prevents multi evidence from leaking targetProductCount=5 into NEW_RELEASE_SINGLE.
  const formatKeyOverride = options?.formatKeyOverride
    ? normalizeFormatKeyForAggregation(options.formatKeyOverride)
    : null;
  if (formatKeyOverride === "NEW_RELEASE_SINGLE") {
    suggestedFormatKey = "NEW_RELEASE_SINGLE";
    suggestedCategory = "ARTICLE";
    suggestedDisplayName = "New release single";
  }

  const targetCount =
    suggestedFormatKey === "BEST_10"
      ? 10
      : suggestedFormatKey === "BEST_5"
        ? 5
        : suggestedFormatKey === "NEW_RELEASE_SINGLE"
          ? 1
          : Math.max(1, Math.min(3, medianProductCount));

  const writingList = featuresList.map((f) => f.writingFeatures);
  const writingPolicy = buildWritingPolicy(writingList);
  const hookFreq = frequencyMap(writingList.map((w) => w.introHookType));
  const densityFreq = frequencyMap(writingList.map((w) => w.informationDensityBucket));

  const proposedSpec: ArticleFormatSpec = {
    targetProductCount: { min: targetCount, max: targetCount },
    requiredSectionOrder:
      sectionOrderMode.length > 0 ? sectionOrderMode : ["intro", "product_sections", "cta"],
    optionalSections: faqUsedRate >= 0.3 ? ["faq"] : [],
    ctaPolicy: {
      minCount: 1,
      maxCount: Math.max(1, median(featuresList.map((f) => f.ctaCount)) || 1),
      preferredPositions: ["bottom"],
    },
    imagePolicy: { minCount: 0, enforce: false },
    rankingRequired:
      suggestedFormatKey === "NEW_RELEASE_SINGLE" ? false : rankingUsedRate >= 0.5,
    comparisonTableRequired:
      suggestedFormatKey === "NEW_RELEASE_SINGLE" ? false : comparisonTableUsedRate >= 0.5,
    introPolicy: { maxChars: Math.max(120, median(featuresList.map((f) => f.introLength)) || 200) },
    lengthPolicy: {
      minChars: 80,
      maxChars: Math.max(1500, median(featuresList.map((f) => f.totalLength)) || 2000),
    },
    writingPolicy,
  };

  const meetsThresholds =
    sampleCount >= thresholds.minimumSampleCount &&
    domainDiversity >= thresholds.minimumDomainDiversity;

  const confidence = Math.min(
    0.95,
    0.2 + sampleCount * 0.08 + domainDiversity * 0.15 + (meetsThresholds ? 0.2 : 0),
  );

  return {
    sampleCount,
    sourceCount,
    domainDiversity,
    confidence: Number(confidence.toFixed(3)),
    meetsThresholds,
    articleTypeHint: typeHint,
    suggestedFormatKey,
    suggestedCategory,
    suggestedDisplayName,
    featureSummary: {
      medianProductCount,
      medianHeadingCount: median(featuresList.map((f) => f.headingCount)),
      medianCtaCount: median(featuresList.map((f) => f.ctaCount)),
      medianIntroLength: median(featuresList.map((f) => f.introLength)),
      medianTotalLength: median(featuresList.map((f) => f.totalLength)),
      rankingUsedRate: Number(rankingUsedRate.toFixed(3)),
      comparisonTableUsedRate: Number(comparisonTableUsedRate.toFixed(3)),
      faqUsedRate: Number(faqUsedRate.toFixed(3)),
      sectionOrderMode,
      writingFeatureFrequencies: {
        introHookType: hookFreq,
        informationDensityBucket: densityFreq,
      },
      benefitFramingRate: Number(
        (
          writingList.filter((w) => w.benefitFramingUsed).length / writingList.length
        ).toFixed(3),
      ),
      audienceFramingRate: Number(
        (
          writingList.filter((w) => w.audienceFramingUsed).length / writingList.length
        ).toFixed(3),
      ),
    },
    proposedSpec,
    observationIds: observations.map((o) => o.id),
    domains,
  };
}
