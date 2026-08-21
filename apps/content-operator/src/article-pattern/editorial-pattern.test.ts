import { describe, expect, it } from "vitest";
import {
  clusterEditorialPatterns,
  detectEditorialFailureCategories,
  selectEditorialPattern,
  toEditorialPatternPromptContract,
  type ObservationEditorialInput,
} from "./editorial-pattern.js";
import type { ArticleStructureFeatures, ArticleWritingFeatures } from "./types.js";
import {
  classifyClaimKind,
  selectClaimsForStructurePattern,
  statementHasConcreteTrait,
} from "../generation/select-claims-for-structure-pattern.js";
import { buildBloggerGeneratePromptDefinition } from "../generation/structured-article.js";
import { clusterStructurePatterns } from "./structure-pattern.js";

function wf(partial: Partial<ArticleWritingFeatures>): ArticleWritingFeatures {
  return {
    introHookType: "factual",
    introPurpose: "topic_open",
    introLengthBucket: "medium",
    paragraphLengthDistribution: { short: 0.5, medium: 0.4, long: 0.1 },
    sentenceLengthDistribution: { short: 0.4, medium: 0.4, long: 0.2 },
    tone: "editorial",
    pointOfView: "third_person",
    factOpinionRatio: 0.5,
    descriptionRecommendationRatio: 0.4,
    productFactPlacement: "mid",
    recommendationPlacement: "sparse",
    benefitFramingUsed: false,
    audienceFramingUsed: false,
    scenarioFramingUsed: true,
    curiosityGapUsed: false,
    questionHookUsed: false,
    conclusionFirstUsed: false,
    sectionPurposeSequence: ["intro_hook", "editorial_angle"],
    repetitionRateBucket: "low",
    ctaLeadInType: "bridge_from_editorial",
    ctaContext: "decision_support",
    informationDensityBucket: "high",
    productDifferentiationStyle: "catalog",
    subjectiveLanguageLevel: "moderate",
    reviewStyle: "editorial_non_experiential",
    catalogStyleLevel: "balanced",
    ...partial,
  };
}

function features(
  headingCount: number,
  writing?: Partial<ArticleWritingFeatures>,
): ArticleStructureFeatures {
  return {
    estimatedProductCount: 1,
    headingCount,
    headingPatterns: [],
    introLength: 80,
    totalLength: 900,
    averageProductSectionLength: 400,
    imageCount: 1,
    imagePositions: ["top"],
    imageRoles: ["hero"],
    ctaCount: 1,
    ctaPositions: ["bottom"],
    ctaStyle: "text_link",
    rankingUsed: false,
    comparisonTableUsed: false,
    prosConsUsed: false,
    summaryUsed: false,
    faqUsed: false,
    disclosurePosition: null,
    ageNoticePosition: null,
    internalLinkCount: 0,
    externalProductLinkCount: 1,
    tone: "editorial",
    reviewVsCatalogRatio: 0.5,
    seoTitlePattern: "mixed",
    keywordPlacement: [],
    sectionOrder: ["intro", "body", "cta"],
    writingFeatures: wf(writing ?? {}),
  };
}

const MINA_CLAIMS = [
  {
    id: "cmsroxoe2001ds7qz4k7p8eof",
    statement: "出演者／クリエイターとして「福原みな」が記載されている。",
  },
  {
    id: "cmsroxodo000ps7qzg28egr73",
    statement: "メーカー／レーベルとして「DOC」が公開されている。",
  },
  {
    id: "cmsroxodt000xs7qziu2s8m7h",
    statement: "シリーズ情報として「プールナンパ」が公開されている。",
  },
  {
    id: "cmsroxodx0015s7qznk5gafus",
    statement: "販売／配信状態として「AVAILABLE」が公開されている。",
  },
  {
    id: "cmsroxod8000hs7qzuwjwvc1m",
    statement:
      "【セール】【Hカップの超敏感 巨乳】清楚系ヤリマンを発見！Wチ●コからの顔面ビンタに「幸せ◆」ご満悦！？大好きな筋肉にガッチリ抱かれて猛烈ピストン！感度が良すぎて大量潮吹き＆痙攣絶頂！チ●コに夢中なデカ乳娘が休憩無しの連続生ハメ！！【水着っ子ナンパ】【Mina】 福原みな",
  },
];

const V5_FAILURE_TEXT = [
  "福原みな出演、DOCの「プールナンパ」シリーズ作品",
  "福原みなは、DOCレーベルの人気シリーズ「プールナンパ」に出演している女優です。",
  "女優として知られています",
  "魅力を活かした演出",
  "セールスポイント",
  "注目すべき作品",
  "興味を持った方は、詳細を作品ページで確認することで、より深く内容を把握できます。",
].join("\n");

describe("Editorial Pattern extraction from A-like sparse observations", () => {
  it("promotes strongest_concrete_trait opening from sparse/scenario A cluster", () => {
    const inputs: ObservationEditorialInput[] = [
      { id: "a1", sourceDomain: "sadist-avreview.com", features: features(1, { scenarioFramingUsed: true }) },
      { id: "a2", sourceDomain: "sadist-avreview.com", features: features(1, { scenarioFramingUsed: true }) },
      { id: "a3", sourceDomain: "note.com", features: features(2, { scenarioFramingUsed: true, curiosityGapUsed: true }) },
    ];
    const patterns = clusterEditorialPatterns(inputs);
    const selected = selectEditorialPattern(patterns, { preferSparse: true });
    expect(selected).toBeTruthy();
    expect(selected!.opening.strategy).toBe("strongest_concrete_trait");
    expect(selected!.opening.claimAvoid).toEqual(
      expect.arrayContaining(["maker", "availability"]),
    );
    expect(selected!.avoidCategories).toEqual(
      expect.arrayContaining([
        "unsupported_social_proof",
        "generic_meta_evaluation",
        "catalog_narration",
        "generic_cta_boilerplate",
      ]),
    );
    const contract = toEditorialPatternPromptContract(selected!);
    expect(JSON.stringify(contract)).toMatch(/strongest_concrete_trait/);
    expect(JSON.stringify(contract)).toMatch(/avoidCategories/);
    expect(JSON.stringify(contract)).not.toMatch(/女優として知られ/);
  });
});

describe("Claim selection with Editorial Pattern (Mina v5 root cause)", () => {
  it("classifies long marketing title with traits as trait_or_scene (not temporal_sale)", () => {
    expect(classifyClaimKind(MINA_CLAIMS[4]!.statement)).toBe("trait_or_scene");
    expect(statementHasConcreteTrait(MINA_CLAIMS[4]!.statement)).toBe(true);
    expect(classifyClaimKind(MINA_CLAIMS[1]!.statement)).toBe("maker");
    expect(classifyClaimKind(MINA_CLAIMS[3]!.statement)).toBe("availability");
  });

  it("selects trait title + performer for opening; defers maker/availability", () => {
    const structure = clusterStructurePatterns([
      {
        id: "s1",
        sourceDomain: "sadist-avreview.com",
        features: features(1, { scenarioFramingUsed: true }),
      },
    ])[0]!;
    const editorial = clusterEditorialPatterns([
      {
        id: "e1",
        sourceDomain: "sadist-avreview.com",
        features: features(1, { scenarioFramingUsed: true }),
      },
    ])[0]!;

    const result = selectClaimsForStructurePattern(MINA_CLAIMS, structure, editorial);
    expect(result.selectedClaims.some((c) => c.kind === "trait_or_scene")).toBe(true);
    expect(result.selectedClaims.some((c) => c.id === "cmsroxod8000hs7qzuwjwvc1m")).toBe(true);
    expect(result.openingClaimIds[0]).toBe("cmsroxod8000hs7qzuwjwvc1m");
    expect(result.selectedClaims.find((c) => c.kind === "availability")).toBeUndefined();
    // maker should be deferred or ranked after opening traits
    expect(result.openingClaimIds).not.toContain("cmsroxodo000ps7qzg28egr73");
  });
});

describe("v5 failure categories prevented by Editorial contract (not word bans)", () => {
  it("detects v5 failure categories as avoidCategory hits", () => {
    expect(detectEditorialFailureCategories(V5_FAILURE_TEXT)).toEqual(
      expect.arrayContaining([
        "unsupported_social_proof",
        "generic_meta_evaluation",
        "generic_cta_boilerplate",
        "catalog_narration",
        "catalog_identity_title",
      ]),
    );
  });

  it("good sparse editorial prose does not trip category detectors", () => {
    const good = [
      "福原みなの高感度が前面に出る水着ナンパ作品",
      "公開情報上、感度の高さと連続的な展開が確認できる。",
      "気になる点があれば作品ページで最新の公開情報を確認する。",
    ].join("\n");
    expect(detectEditorialFailureCategories(good)).toEqual([]);
  });

  it("Prompt definition includes editorialPattern template and category policy", () => {
    const def = buildBloggerGeneratePromptDefinition();
    expect(def.body).toContain("editorialPattern={{editorialPattern}}");
    expect(def.systemInstruction).toMatch(/EDITORIAL PATTERN|EDITORIAL_PLAN|SELECTED_PATTERN/);
    expect(def.systemInstruction).toMatch(/openingClaimIds|strongest concrete trait/);
  });
});
