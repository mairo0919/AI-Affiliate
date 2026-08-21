import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ARTICLE_SCOPE_VERSION,
  extractArticleContentScope,
} from "./article-content-scope.js";
import {
  ARTICLE_PATTERN_HASH_BASIS,
  hashNormalizedArticleContent,
} from "./content-hash.js";
import {
  evaluateSingleArticleLearningSuitability,
} from "./learning-suitability.js";
import {
  detectScopedRankingUsed,
  estimateScopedProductCount,
  extractArticleStructureFeatures,
} from "./structure-extraction.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
function load(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("Article Scope SSOT", () => {
  it("prefers article selector", () => {
    const scope = extractArticleContentScope(load("scope-single-with-sidebar.html"));
    expect(scope.selectorKind).toBe("article");
    expect(scope.fallbackUsed).toBe(false);
    expect(scope.scopeVersion).toBe(ARTICLE_SCOPE_VERSION);
    expect(scope.scopedHtml).toMatch(/腋汗/);
    expect(scope.scopedHtml).not.toMatch(/関連記事A/);
  });

  it("falls back to role=main", () => {
    const scope = extractArticleContentScope(load("scope-comparison.html"));
    expect(scope.selectorKind).toBe("role_main");
    expect(scope.fallbackUsed).toBe(false);
  });

  it("uses heuristic entry-content", () => {
    const scope = extractArticleContentScope(load("scope-heuristic-entry.html"));
    expect(scope.selectorKind).toBe("heuristic_content");
    expect(scope.scopedHtml).not.toMatch(/x1/);
  });

  it("body fallback when no main container", () => {
    const html = `<html><body><p>${"本文テキスト。".repeat(20)}</p></body></html>`;
    const scope = extractArticleContentScope(html);
    expect(scope.selectorKind).toBe("body_fallback");
    expect(scope.fallbackUsed).toBe(true);
  });

  it("contentHash and structure share scope version / selector", () => {
    const html = load("scope-single-with-sidebar.html");
    const hashed = hashNormalizedArticleContent(html);
    const extracted = extractArticleStructureFeatures({
      html,
      title: "t",
      sourceUrl: "https://sadist-avreview.example.test/post/1",
    });
    expect(hashed.hashBasis).toBe(ARTICLE_PATTERN_HASH_BASIS);
    expect(hashed.scopeVersion).toBe(ARTICLE_SCOPE_VERSION);
    expect(extracted.articleScope.scopeVersion).toBe(ARTICLE_SCOPE_VERSION);
    expect(extracted.articleScope.selectorKind).toBe(hashed.selectorKind);
    expect(extracted.contentHash).toBe(hashed.contentHash);
  });
});

describe("scoped structure: sadist-like sidebar must not inflate products", () => {
  it("article内1商品 + sidebar h5/list×10 → productCount=1, rankingUsed=false", () => {
    const extracted = extractArticleStructureFeatures({
      html: load("scope-single-with-sidebar.html"),
      title: "腋汗が見られるAV紹介",
      sourceUrl: "https://sadist-avreview.example.test/2026/08/15/sample",
    });
    expect(extracted.features.estimatedProductCount).toBe(1);
    expect(extracted.features.rankingUsed).toBe(false);
    expect(extracted.articleTypeHint).not.toMatch(/ranking_or_collection|comparison/);
    expect(extracted.articleScope.selectorKind).toBe("article");
    // chrome headings must not dominate headingPatterns
    expect(extracted.features.headingPatterns.filter((p) => p === "h5").length).toBe(0);
  });

  it("関連記事ランキングwidget alone does not set rankingUsed", () => {
    expect(
      detectScopedRankingUsed({
        text: "この一本の見どころを整理する。",
        headingLabels: ["人気記事", "おすすめ記事", "関連記事"],
      }),
    ).toBe(false);
  });
});

describe("scoped structure: true multi preserved", () => {
  it("article本文内BEST5 → rankingUsed=true / productCount>1", () => {
    const extracted = extractArticleStructureFeatures({
      html: load("scope-multi-best5.html"),
      title: "BEST5 おすすめAVランキング",
      sourceUrl: "https://rank.example.test/best5",
    });
    expect(extracted.features.rankingUsed).toBe(true);
    expect(extracted.features.estimatedProductCount).toBeGreaterThanOrEqual(5);
    expect(extracted.articleTypeHint).toBe("ranking_or_collection");
  });

  it("comparison table in main → comparison=true", () => {
    const extracted = extractArticleStructureFeatures({
      html: load("scope-comparison.html"),
      title: "比較",
      sourceUrl: "https://cmp.example.test/a",
    });
    expect(extracted.features.comparisonTableUsed).toBe(true);
    expect(extracted.articleTypeHint).toBe("comparison");
    expect(extracted.features.estimatedProductCount).toBeGreaterThanOrEqual(2);
  });

  it("listCount alone never becomes productCount", () => {
    const pc = estimateScopedProductCount({
      text: "単品の感想です。",
      headingLabels: ["導入"],
      headingTags: ["h1"],
      rankingUsed: true,
      comparisonTableUsed: false,
      tableRowCount: 0,
      externalProductLinkCount: 0,
    });
    expect(pc).toBe(1);
  });
});

describe("suitability unchanged with scoped features", () => {
  it("genuine single editorial remains A-eligible", () => {
    const extracted = extractArticleStructureFeatures({
      html: load("scope-single-with-sidebar.html"),
      title: "AV 作品レビュー 感想 見どころ",
      sourceUrl: "https://blog.example.test/single",
    });
    // Strengthen writing overlay already present from deterministic on scoped text
    extracted.features.writingFeatures = {
      ...extracted.features.writingFeatures,
      audienceFramingUsed: true,
      benefitFramingUsed: true,
      scenarioFramingUsed: true,
      introPurpose: "selection_frame",
      introHookType: "audience_framing",
      productDifferentiationStyle: "criteria_based",
      sectionPurposeSequence: ["intro_hook", "selection_criteria", "editorial_angle", "cta"],
      descriptionRecommendationRatio: 0.5,
      informationDensityBucket: "medium",
      repetitionRateBucket: "low",
      catalogStyleLevel: "balanced",
    };
    const suit = evaluateSingleArticleLearningSuitability({
      articleTypeHint: extracted.articleTypeHint,
      features: extracted.features,
      sourceUrl: "https://blog.example.test/single",
      sourceDomain: "blog.example.test",
    });
    expect(extracted.features.estimatedProductCount).toBe(1);
    expect(suit.classification).toBe("A");
  });

  it("true multi BEST5 does not promote to A", () => {
    const extracted = extractArticleStructureFeatures({
      html: load("scope-multi-best5.html"),
      title: "BEST5",
      sourceUrl: "https://rank.example.test/best5",
    });
    extracted.features.writingFeatures = {
      ...extracted.features.writingFeatures,
      audienceFramingUsed: true,
      benefitFramingUsed: true,
      scenarioFramingUsed: true,
      introPurpose: "selection_frame",
      introHookType: "audience_framing",
      productDifferentiationStyle: "criteria_based",
      sectionPurposeSequence: ["intro_hook", "selection_criteria", "editorial_angle", "cta"],
      descriptionRecommendationRatio: 0.6,
      informationDensityBucket: "medium",
      repetitionRateBucket: "low",
      catalogStyleLevel: "balanced",
    };
    const suit = evaluateSingleArticleLearningSuitability({
      articleTypeHint: extracted.articleTypeHint,
      features: extracted.features,
      sourceUrl: "https://rank.example.test/best5",
      sourceDomain: "rank.example.test",
    });
    expect(extracted.features.estimatedProductCount).toBeGreaterThanOrEqual(5);
    expect(suit.classification).not.toBe("A");
  });
});

describe("existing single-a fixture body stores no prose regression", () => {
  it("single-a productCount stays singleish (not list-inflated)", () => {
    const extracted = extractArticleStructureFeatures({
      html: load("single-a.html"),
      title: "新作を候補にする人向け",
      sourceUrl: "https://note.example.test/a",
    });
    expect(extracted.features.estimatedProductCount).toBeLessThanOrEqual(2);
    expect(extracted.features.rankingUsed).toBe(false);
  });
});
