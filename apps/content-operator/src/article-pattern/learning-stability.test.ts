import { describe, expect, it, vi } from "vitest";
import { canonicalizeArticlePatternUrl } from "./canonical-url.js";
import { prepareObservationsForLearning } from "./observation-dedupe.js";
import { hashNormalizedArticleContent } from "./content-hash.js";
import { validateWritingFeaturesLlmOverlay } from "./writing-extraction.js";
import { evaluateSingleArticleLearningSuitability } from "./learning-suitability.js";
import type { ArticleStructureFeatures } from "./types.js";
import { OpenAiCompatibleLLMProvider } from "../adapters/llm/openai-compatible-provider.js";

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

function makeObs(input: {
  id: string;
  url: string;
  domain?: string;
  hash?: string;
  observedAt: Date;
  classification?: "A" | "B" | "C";
  features?: ArticleStructureFeatures;
  articleTypeHint?: string;
}) {
  const features = input.features ?? baseFeatures();
  return {
    id: input.id,
    sourceUrl: input.url,
    sourceDomain: input.domain ?? new URL(input.url).hostname,
    contentHash: input.hash ?? `hash-${input.id}`,
    articleTypeHint: input.articleTypeHint ?? "single_review",
    features,
    confidence: 0.8,
    observedAt: input.observedAt,
    createdAt: input.observedAt,
    sourceDocumentId: null,
    metadata: {
      sourceKind: "live_url",
      learningSuitability: input.classification
        ? {
            classification: input.classification,
            score: input.classification === "A" ? 0.7 : 0.4,
            reasons: ["test"],
            targetFormatKey: "NEW_RELEASE_SINGLE",
          }
        : undefined,
    },
  };
}

describe("canonicalizeArticlePatternUrl", () => {
  it("strips fragment, tracking query, trailing slash; keeps meaningful query", () => {
    expect(
      canonicalizeArticlePatternUrl(
        "https://Example.COM/path/entry/?utm_source=x&id=129#frag",
      ),
    ).toBe("https://example.com/path/entry?id=129");
    expect(canonicalizeArticlePatternUrl("https://a.test/x/")).toBe("https://a.test/x");
    expect(canonicalizeArticlePatternUrl("https://a.test/x?page=2")).toBe(
      "https://a.test/x?page=2",
    );
    expect(canonicalizeArticlePatternUrl("https://a.test/x?page=2")).not.toBe(
      canonicalizeArticlePatternUrl("https://a.test/x?page=3"),
    );
  });
});

describe("prepareObservationsForLearning", () => {
  it("keeps latest observation per canonical URL only", () => {
    const old = makeObs({
      id: "old",
      url: "https://ameblo.jp/x/entry-1.html",
      observedAt: new Date("2026-08-14T07:00:00Z"),
      classification: "A",
    });
    const neu = makeObs({
      id: "new",
      url: "https://ameblo.jp/x/entry-1.html?utm_source=x#y",
      observedAt: new Date("2026-08-14T17:00:00Z"),
      classification: "B",
    });
    const prepared = prepareObservationsForLearning([old, neu] as never, {
      suitabilityAOnly: false,
    });
    expect(prepared.selected.map((o) => o.id)).toEqual(["new"]);
    expect(prepared.diagnostics.duplicateCanonicalExcluded).toBe(1);
  });

  it("latest=B old=A → A-only aggregate input excludes old A", () => {
    const old = makeObs({
      id: "old-a",
      url: "https://blog.example.test/a",
      observedAt: new Date("2026-01-01T00:00:00Z"),
      classification: "A",
    });
    const neu = makeObs({
      id: "new-b",
      url: "https://blog.example.test/a/",
      observedAt: new Date("2026-08-01T00:00:00Z"),
      classification: "B",
    });
    const prepared = prepareObservationsForLearning([old, neu] as never, {
      suitabilityAOnly: true,
    });
    expect(prepared.selected.map((o) => o.id)).toEqual([]);
    expect(prepared.diagnostics.afterCanonicalLatestCount).toBe(1);
    expect(prepared.diagnostics.suitabilityExcluded).toBe(1);
    expect(prepared.diagnostics.exclusions.some((e) => e.id === "old-a")).toBe(true);
  });

  it("dedupes identical contentHash across different URLs", () => {
    const a = makeObs({
      id: "a",
      url: "https://a.example.test/1",
      hash: "samehash",
      observedAt: new Date("2026-01-01T00:00:00Z"),
      classification: "A",
    });
    const b = makeObs({
      id: "b",
      url: "https://b.example.test/2",
      hash: "samehash",
      observedAt: new Date("2026-02-01T00:00:00Z"),
      classification: "A",
    });
    const prepared = prepareObservationsForLearning([a, b] as never, {
      suitabilityAOnly: true,
    });
    expect(prepared.selected.map((o) => o.id)).toEqual(["b"]);
    expect(prepared.diagnostics.duplicateContentHashExcluded).toBe(1);
  });
});

describe("contentHash stability", () => {
  it("ignores ad/related chrome changes; changes when main article text changes", () => {
    const base = `
      <html><body>
        <nav>nav</nav>
        <article><p>主記事のレビュー本文です。おすすめポイントを説明します。</p></article>
        <aside class="related">related-old</aside>
        <div class="ad-banner">ad-1</div>
        <footer>footer</footer>
      </body></html>`;
    const withAdNoise = base
      .replace("related-old", "related-new-123")
      .replace("ad-1", "ad-2-ts=999");
    const bodyChanged = base.replace(
      "主記事のレビュー本文です。おすすめポイントを説明します。",
      "主記事のレビュー本文が更新されました。別の結論です。",
    );
    const h1 = hashNormalizedArticleContent(base);
    const h2 = hashNormalizedArticleContent(withAdNoise);
    const h3 = hashNormalizedArticleContent(bodyChanged);
    expect(h1.contentHash).toBe(h2.contentHash);
    expect(h1.contentHash).not.toBe(h3.contentHash);
    expect(h1.hashBasis).toBe("normalized_main_article_v1");
  });
});

describe("Writing LLM schema validation", () => {
  it("rejects tone array overlay", () => {
    const result = validateWritingFeaturesLlmOverlay({
      introHookType: "factual",
      introPurpose: "topic_open",
      tone: ["informative", "promotional", "enthusiastic"],
      benefitFramingUsed: false,
      audienceFramingUsed: false,
      informationDensityBucket: "low",
      sectionPurposeSequence: ["intro_hook"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("tone");
  });

  it("accepts valid string tone", () => {
    const result = validateWritingFeaturesLlmOverlay({
      introHookType: "factual",
      tone: "editorial",
      benefitFramingUsed: true,
    });
    expect(result.ok).toBe(true);
  });
});

describe("Writing LLM temperature=0", () => {
  it("passes temperature 0 for writing feature extraction only", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  introHookType: "factual",
                  introPurpose: "topic_open",
                  sectionPurposeSequence: ["intro_hook"],
                  benefitFramingUsed: false,
                  audienceFramingUsed: false,
                  informationDensityBucket: "low",
                  tone: "editorial",
                }),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200 },
      );
    });
    const provider = new OpenAiCompatibleLLMProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      defaultModel: "gpt-4.1-mini",
      timeoutMs: 5000,
      maxAttempts: 1,
      currency: "JPY",
      yenPer1kInput: 0.1,
      yenPer1kOutput: 0.2,
      allowExternal: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await provider.executeTask({
      taskType: "WRITING_FEATURE_EXTRACTION",
      temperature: 0,
      outputSchema: {
        type: "object",
        properties: { tone: { type: "string" } },
        additionalProperties: false,
      },
      input: {},
      userPrompt: "x",
      systemInstruction: "y",
    });
    expect((bodies[0] as { temperature: number }).temperature).toBe(0);

    await provider.executeTask({
      taskType: "GENERATION_BLOGGER",
      input: {},
      userPrompt: "x",
      systemInstruction: "y",
    });
    expect((bodies[1] as { temperature: number }).temperature).toBe(0.4);
  });
});

describe("strict suitability A/B/C", () => {
  it("genuine single editorial → A", () => {
    const result = evaluateSingleArticleLearningSuitability({
      sourceUrl: "https://a.test/1",
      sourceDomain: "a.test",
      articleTypeHint: "single_review",
      features: baseFeatures(),
    });
    expect(result.classification).toBe("A");
  });

  it("Ameblo-like thin recommendation → C", () => {
    const result = evaluateSingleArticleLearningSuitability({
      sourceUrl: "https://ameblo.jp/se11085472/entry-12964883673.html",
      sourceDomain: "ameblo.jp",
      articleTypeHint: "ranking_or_collection",
      features: baseFeatures({
        estimatedProductCount: 5,
        rankingUsed: true,
        headingCount: 1,
        imageCount: 11,
        ctaCount: 0,
        totalLength: 1713,
        writingFeatures: {
          introHookType: "factual",
          introPurpose: "topic_open",
          tone: "editorial",
          pointOfView: "third_person",
          benefitFramingUsed: false,
          audienceFramingUsed: false,
          scenarioFramingUsed: false,
          factOpinionRatio: 0.333,
          descriptionRecommendationRatio: 0.667,
          recommendationPlacement: "mid",
          productDifferentiationStyle: "catalog",
          informationDensityBucket: "low",
          repetitionRateBucket: "low",
          sectionPurposeSequence: ["intro_hook", "product_sections", "cta"],
          ctaLeadInType: "direct",
          ctaContext: "decision_support",
          reviewStyle: "editorial_non_experiential",
          catalogStyleLevel: "balanced",
        },
      }),
    });
    expect(result.classification).toBe("C");
    expect(result.reasons.some((r) => /reco_ratio_only|insufficient|multi_without/.test(r))).toBe(
      true,
    );
  });

  it("multi/comparison high-quality → B", () => {
    const result = evaluateSingleArticleLearningSuitability({
      sourceUrl: "https://cmp.test/list",
      sourceDomain: "cmp.test",
      articleTypeHint: "comparison",
      features: baseFeatures({
        comparisonTableUsed: true,
        estimatedProductCount: 4,
        writingFeatures: {
          audienceFramingUsed: true,
          benefitFramingUsed: true,
          informationDensityBucket: "medium",
          descriptionRecommendationRatio: 0.5,
          productDifferentiationStyle: "criteria_based",
          introPurpose: "selection_frame",
        },
      }),
    });
    expect(result.classification).toBe("B");
  });

  it("ranking false positive + single editorial → A", () => {
    const result = evaluateSingleArticleLearningSuitability({
      sourceUrl: "https://a.test/1",
      sourceDomain: "a.test",
      articleTypeHint: "ranking_or_collection",
      features: baseFeatures({
        rankingUsed: true,
        estimatedProductCount: 1,
      }),
    });
    expect(result.classification).toBe("A");
  });
});
