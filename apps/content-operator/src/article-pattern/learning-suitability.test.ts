import { describe, expect, it } from "vitest";
import { evaluateSingleArticleLearningSuitability } from "./learning-suitability.js";
import type { ArticleStructureFeatures } from "./types.js";
import { aggregateArticlePatterns } from "./pattern-aggregation.js";
import { qualifyCandidateUrl, parseDuckDuckGoHtmlResults } from "./source-search.js";

function baseFeatures(
  overrides: Partial<ArticleStructureFeatures> & {
    writingFeatures?: Partial<ArticleStructureFeatures["writingFeatures"]>;
  } = {},
): ArticleStructureFeatures {
  const { writingFeatures: wOver, ...rest } = overrides;
  return {
    estimatedProductCount: 1,
    headingCount: 2,
    headingPatterns: ["h2", "h2"],
    introLength: 120,
    totalLength: 1200,
    averageProductSectionLength: 1200,
    imageCount: 1,
    imagePositions: ["middle"],
    imageRoles: ["product"],
    ctaCount: 1,
    ctaPositions: ["bottom"],
    ctaStyle: "single",
    rankingUsed: false,
    comparisonTableUsed: false,
    prosConsUsed: false,
    summaryUsed: true,
    faqUsed: false,
    disclosurePosition: "top",
    ageNoticePosition: null,
    internalLinkCount: 0,
    externalProductLinkCount: 1,
    tone: "review-leaning",
    reviewVsCatalogRatio: 0.7,
    seoTitlePattern: "descriptive",
    keywordPlacement: [],
    sectionOrder: ["intro", "product_sections", "cta"],
    writingFeatures: {
      introHookType: "direct_recommendation",
      introPurpose: "selection_frame",
      introLengthBucket: "medium",
      paragraphLengthDistribution: { short: 0.2, medium: 0.6, long: 0.2 },
      sentenceLengthDistribution: { short: 0.2, medium: 0.6, long: 0.2 },
      tone: "editorial",
      pointOfView: "third_person",
      factOpinionRatio: 0.45,
      descriptionRecommendationRatio: 0.55,
      productFactPlacement: "early",
      recommendationPlacement: "late",
      benefitFramingUsed: true,
      audienceFramingUsed: true,
      scenarioFramingUsed: false,
      curiosityGapUsed: false,
      questionHookUsed: false,
      conclusionFirstUsed: false,
      sectionPurposeSequence: ["intro_hook", "selection_criteria", "product_facts", "cta"],
      repetitionRateBucket: "low",
      ctaLeadInType: "bridge_from_editorial",
      ctaContext: "decision_support",
      informationDensityBucket: "medium",
      productDifferentiationStyle: "criteria_based",
      subjectiveLanguageLevel: "moderate",
      reviewStyle: "editorial_non_experiential",
      catalogStyleLevel: "balanced",
      ...wOver,
    },
    ...rest,
  };
}

function obs(
  features: ArticleStructureFeatures,
  extra?: { articleTypeHint?: string; domain?: string },
) {
  return {
    id: "x",
    sourceUrl: `https://${extra?.domain ?? "example.test"}/a`,
    sourceDomain: extra?.domain ?? "example.test",
    articleTypeHint: extra?.articleTypeHint ?? "single_review",
    features,
  };
}

describe("evaluateSingleArticleLearningSuitability", () => {
  it("single editorial article → A", () => {
    const result = evaluateSingleArticleLearningSuitability(obs(baseFeatures()));
    expect(result.classification).toBe("A");
    expect(result.score).toBeGreaterThanOrEqual(0.45);
  });

  it("ranking false positive + productCount=1 + editorial → A", () => {
    const result = evaluateSingleArticleLearningSuitability(
      obs(
        baseFeatures({
          rankingUsed: true,
          estimatedProductCount: 1,
          writingFeatures: {
            introHookType: "direct_recommendation",
            benefitFramingUsed: true,
            informationDensityBucket: "medium",
          },
        }),
        { articleTypeHint: "ranking_or_collection" },
      ),
    );
    expect(result.classification).toBe("A");
  });

  it("multi ranking → B", () => {
    const result = evaluateSingleArticleLearningSuitability(
      obs(
        baseFeatures({
          estimatedProductCount: 6,
          rankingUsed: true,
          writingFeatures: {
            audienceFramingUsed: true,
            benefitFramingUsed: true,
            descriptionRecommendationRatio: 0.6,
            informationDensityBucket: "high",
          },
        }),
        { articleTypeHint: "ranking_or_collection" },
      ),
    );
    expect(result.classification).toBe("B");
  });

  it("comparison → B", () => {
    const result = evaluateSingleArticleLearningSuitability(
      obs(
        baseFeatures({
          comparisonTableUsed: true,
          estimatedProductCount: 4,
          writingFeatures: {
            audienceFramingUsed: true,
            benefitFramingUsed: true,
            informationDensityBucket: "medium",
            descriptionRecommendationRatio: 0.5,
          },
        }),
        { articleTypeHint: "comparison" },
      ),
    );
    expect(result.classification).toBe("B");
  });

  it("thin catalog → C", () => {
    const result = evaluateSingleArticleLearningSuitability(
      obs(
        baseFeatures({
          estimatedProductCount: 1,
          writingFeatures: {
            introHookType: "factual",
            introPurpose: "topic_open",
            benefitFramingUsed: false,
            audienceFramingUsed: false,
            scenarioFramingUsed: false,
            descriptionRecommendationRatio: 0,
            factOpinionRatio: 1,
            catalogStyleLevel: "high",
            informationDensityBucket: "low",
            productDifferentiationStyle: "catalog",
            recommendationPlacement: "sparse",
            sectionPurposeSequence: ["intro_hook", "product_facts"],
          },
        }),
      ),
    );
    expect(result.classification).toBe("C");
  });

  it("fact-only short catalog → C", () => {
    const result = evaluateSingleArticleLearningSuitability(
      obs(
        baseFeatures({
          totalLength: 300,
          writingFeatures: {
            benefitFramingUsed: false,
            audienceFramingUsed: false,
            scenarioFramingUsed: false,
            descriptionRecommendationRatio: 0,
            factOpinionRatio: 1,
            informationDensityBucket: "low",
            catalogStyleLevel: "high",
            introHookType: "factual",
            introPurpose: "topic_open",
            sectionPurposeSequence: ["intro_hook"],
          },
        }),
      ),
    );
    expect(result.classification).toBe("C");
  });

  it("Ameblo-equivalent reco-ratio-only thin multi → C (not auto-B)", () => {
    const result = evaluateSingleArticleLearningSuitability(
      obs(
        baseFeatures({
          estimatedProductCount: 5,
          rankingUsed: true,
          headingCount: 1,
          totalLength: 1713,
          writingFeatures: {
            introHookType: "factual",
            introPurpose: "topic_open",
            benefitFramingUsed: false,
            audienceFramingUsed: false,
            scenarioFramingUsed: false,
            descriptionRecommendationRatio: 0.667,
            factOpinionRatio: 0.333,
            catalogStyleLevel: "balanced",
            informationDensityBucket: "low",
            productDifferentiationStyle: "catalog",
            sectionPurposeSequence: ["intro_hook", "product_sections", "cta"],
          },
        }),
        { articleTypeHint: "ranking_or_collection", domain: "ameblo.jp" },
      ),
    );
    expect(result.classification).toBe("C");
  });
});

describe("aggregate NEW_RELEASE_SINGLE targetProductCount", () => {
  it("does not leak targetProductCount=5 from multi evidence when formatKey overridden", () => {
    const rows = [1, 2, 3].map((i) => ({
      id: `id${i}`,
      sourceDomain: `d${i}.test`,
      sourceUrl: `https://d${i}.test/${i}`,
      articleTypeHint: "ranking_or_collection",
      features: baseFeatures({
        estimatedProductCount: 6,
        rankingUsed: true,
      }),
      contentHash: `h${i}`,
      confidence: 0.8,
      observedAt: new Date(),
      sourceDocumentId: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const result = aggregateArticlePatterns(
      rows as never,
      {
        minimumSampleCount: 3,
        minimumDomainDiversity: 2,
      },
      { formatKeyOverride: "NEW_RELEASE_SINGLE" },
    );

    expect(result?.suggestedFormatKey).toBe("NEW_RELEASE_SINGLE");
    expect(result?.proposedSpec.targetProductCount).toEqual({ min: 1, max: 1 });
    expect(result?.proposedSpec.rankingRequired).toBe(false);
    expect(result?.proposedSpec.comparisonTableRequired).toBe(false);
  });
});

describe("source-search helpers", () => {
  it("qualifies and blocks bad URLs", () => {
    expect(qualifyCandidateUrl("https://blog.example.test/review/a").ok).toBe(true);
    expect(qualifyCandidateUrl("https://twitter.com/x/status/1").ok).toBe(false);
    expect(qualifyCandidateUrl("https://example.test/tag/foo").ok).toBe(false);
    expect(qualifyCandidateUrl("https://video.dmm.co.jp/av/content/?id=x").ok).toBe(false);
    expect(qualifyCandidateUrl("https://example.test/best-10-ranking").ok).toBe(false);
  });

  it("parses duckduckgo html without storing snippets as hits body", () => {
    const html = `<a href="https://duckduckgo.com/l/?uddg=${encodeURIComponent("https://review-a.example.test/a")}">t</a>`;
    const hits = parseDuckDuckGoHtmlResults(html);
    expect(hits[0]?.url).toBe("https://review-a.example.test/a");
  });

  it("detects DDG anomaly challenge and yields zero SERP links", async () => {
    const { detectDuckDuckGoChallenge, parseDuckDuckGoHtmlResults } = await import(
      "./source-search.js"
    );
    const challengeHtml = `
      <html><body>
        <div id="anomaly-modal" class="anomaly-modal__modal">
          <form id="challenge-form"></form>
          <p>Unfortunately, bots use DuckDuckGo too. Please complete the following challenge</p>
        </div>
      </body></html>`;
    expect(detectDuckDuckGoChallenge(challengeHtml)).toEqual({
      detected: true,
      kind: "anomaly_modal",
    });
    expect(parseDuckDuckGoHtmlResults(challengeHtml)).toEqual([]);
  });
});
