export type ArticleStructureFeatures = {
  estimatedProductCount: number;
  headingCount: number;
  headingPatterns: string[];
  introLength: number;
  totalLength: number;
  averageProductSectionLength: number;
  imageCount: number;
  imagePositions: string[];
  /** Abstract roles only: hero | product | gallery | decorative | unknown */
  imageRoles: string[];
  ctaCount: number;
  ctaPositions: string[];
  ctaStyle: string;
  rankingUsed: boolean;
  comparisonTableUsed: boolean;
  prosConsUsed: boolean;
  summaryUsed: boolean;
  faqUsed: boolean;
  disclosurePosition: string | null;
  ageNoticePosition: string | null;
  internalLinkCount: number;
  externalProductLinkCount: number;
  tone: string;
  reviewVsCatalogRatio: number;
  seoTitlePattern: string;
  keywordPlacement: string[];
  sectionOrder: string[];
  /** Abstract writing craft features — never prose / quotes / templates */
  writingFeatures: ArticleWritingFeatures;
};

/**
 * Abstract writing craft signals learned from external articles.
 * Must never contain article body, long quotes, or reusable sentence templates.
 */
export type ArticleWritingFeatures = {
  introHookType: string;
  introPurpose: string;
  introLengthBucket: string;
  paragraphLengthDistribution: { short: number; medium: number; long: number };
  sentenceLengthDistribution: { short: number; medium: number; long: number };
  tone: string;
  pointOfView: string;
  factOpinionRatio: number;
  descriptionRecommendationRatio: number;
  productFactPlacement: string;
  recommendationPlacement: string;
  benefitFramingUsed: boolean;
  audienceFramingUsed: boolean;
  scenarioFramingUsed: boolean;
  curiosityGapUsed: boolean;
  questionHookUsed: boolean;
  conclusionFirstUsed: boolean;
  sectionPurposeSequence: string[];
  repetitionRateBucket: string;
  ctaLeadInType: string;
  ctaContext: string;
  informationDensityBucket: string;
  productDifferentiationStyle: string;
  subjectiveLanguageLevel: string;
  reviewStyle: string;
  catalogStyleLevel: string;
};

export type ArticleWritingPolicy = {
  introRole: string;
  preferredHookTypes: string[];
  targetParagraphLength: "short" | "medium" | "long" | "mixed";
  factOpinionBalance: { factMin: number; opinionMax: number };
  recommendationRequired: boolean;
  audienceFraming: boolean;
  benefitFraming: boolean;
  repetitionPolicy: { maxOverlapScore: number };
  sectionPurposeSequence: string[];
  ctaLeadInPolicy: string;
  informationDensity: "low" | "medium" | "high";
  forbidGenericPraise: boolean;
  requireEditorialValue: boolean;
};

export type ArticleFormatSpec = {
  targetProductCount: { min: number; max: number };
  requiredSectionOrder: string[];
  optionalSections: string[];
  ctaPolicy: { minCount: number; maxCount: number; preferredPositions: string[] };
  imagePolicy: { minCount: number; enforce: boolean };
  rankingRequired: boolean;
  comparisonTableRequired: boolean;
  introPolicy: { maxChars: number };
  lengthPolicy: { minChars: number; maxChars: number };
  writingPolicy?: ArticleWritingPolicy;
};

/** Legacy keys that remain valid for single-product generation without ACTIVE registry. */
export const LEGACY_FORMAT_KEYS = new Set([
  "blogger-article",
  "new-release",
  "catalog-fact",
  "overview",
  "NEW_RELEASE_SINGLE",
]);

export function normalizeFormatKey(raw: string | null | undefined): string {
  const key = (raw ?? "").trim();
  if (!key) return "new-release";
  if (key === "blogger-article") return "new-release";
  return key;
}

export const DEFAULT_SINGLE_WRITING_POLICY: ArticleWritingPolicy = {
  introRole: "hook_then_selection_frame",
  preferredHookTypes: ["direct_recommendation", "audience_framing", "curiosity"],
  targetParagraphLength: "medium",
  factOpinionBalance: { factMin: 0.45, opinionMax: 0.55 },
  recommendationRequired: true,
  audienceFraming: true,
  benefitFraming: true,
  repetitionPolicy: { maxOverlapScore: 0.35 },
  sectionPurposeSequence: [
    "intro_hook",
    "selection_criteria",
    "product_facts",
    "editorial_angle",
    "cta",
  ],
  ctaLeadInPolicy: "bridge_from_editorial",
  informationDensity: "medium",
  forbidGenericPraise: true,
  requireEditorialValue: true,
};
