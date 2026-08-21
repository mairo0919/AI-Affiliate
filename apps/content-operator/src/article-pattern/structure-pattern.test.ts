import { describe, expect, it } from "vitest";
import {
  clusterStructurePatterns,
  extractStructureBlocksFromFeatures,
  selectStructurePattern,
  toStructurePatternPromptContract,
  type ObservationStructureInput,
} from "./structure-pattern.js";
import type { ArticleStructureFeatures, ArticleWritingFeatures } from "./types.js";
import { buildBloggerGeneratePromptDefinition } from "../generation/structured-article.js";
import {
  classifyClaimKind,
  selectClaimsForStructurePattern,
} from "../generation/select-claims-for-structure-pattern.js";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import { parseBloggerArticle, structuredToPlainBody } from "../generation/structured-article.js";

function wf(partial: Partial<ArticleWritingFeatures>): ArticleWritingFeatures {
  return {
    introHookType: "factual",
    introPurpose: "topic_open",
    introLengthBucket: "short",
    paragraphLengthDistribution: { short: 0.6, medium: 0.3, long: 0.1 },
    sentenceLengthDistribution: { short: 0.6, medium: 0.3, long: 0.1 },
    tone: "editorial",
    pointOfView: "third_person",
    factOpinionRatio: 0.4,
    descriptionRecommendationRatio: 0.6,
    productFactPlacement: "mid",
    recommendationPlacement: "mid",
    benefitFramingUsed: false,
    audienceFramingUsed: false,
    scenarioFramingUsed: true,
    curiosityGapUsed: false,
    questionHookUsed: false,
    conclusionFirstUsed: false,
    sectionPurposeSequence: ["intro_hook", "editorial_angle"],
    repetitionRateBucket: "low",
    ctaLeadInType: "direct",
    ctaContext: "link_only",
    informationDensityBucket: "high",
    productDifferentiationStyle: "catalog",
    subjectiveLanguageLevel: "moderate",
    reviewStyle: "editorial_non_experiential",
    catalogStyleLevel: "balanced",
    ...partial,
  };
}

function features(partial: Partial<ArticleStructureFeatures>): ArticleStructureFeatures {
  return {
    estimatedProductCount: 1,
    headingCount: 1,
    headingPatterns: ["h1"],
    introLength: 80,
    totalLength: 1200,
    averageProductSectionLength: 1000,
    imageCount: 9,
    imagePositions: ["top", "middle", "bottom"],
    imageRoles: ["hero", "product", "unknown"],
    ctaCount: 2,
    ctaPositions: ["top", "middle"],
    ctaStyle: "link",
    rankingUsed: false,
    comparisonTableUsed: false,
    prosConsUsed: false,
    summaryUsed: false,
    faqUsed: false,
    disclosurePosition: null,
    ageNoticePosition: null,
    internalLinkCount: 0,
    externalProductLinkCount: 2,
    tone: "editorial",
    reviewVsCatalogRatio: 0.6,
    seoTitlePattern: "topic",
    keywordPlacement: [],
    // Chrome lists in sectionOrder must NOT become catalog dumps
    sectionOrder: ["intro", "product_sections", "list", "cta"],
    writingFeatures: wf({}),
    ...partial,
  };
}

/** Minimal stand-in for v4 failure modes (catalog list + meta evaluation). */
const V4_REGRESSION_ARTICLE = {
  title: "福原みな出演のプールナンパシリーズで魅せるHカップの高感度巨乳",
  summary: "福原みなが出演し、特徴が確認できる。",
  lead: "Hカップの巨乳と高感度が特徴の福原みなが出演するプールナンパシリーズの作品が配信中。",
  sections: [
    {
      heading: null,
      paragraphs: [
        "福原みなが出演し、DOCレーベルから配信されているプールナンパシリーズの作品である。",
      ],
      lists: [],
    },
    {
      heading: null,
      paragraphs: [
        "こうした要素は、感度の良さや肉体的な激しさを求める視聴者にとって選択のポイントとなる。",
      ],
      lists: [],
    },
    {
      heading: null,
      paragraphs: [],
      lists: [
        "出演者：福原みな",
        "メーカー／レーベル：DOC",
        "シリーズ：プールナンパ",
        "販売状態：配信中",
        "特徴：Hカップの超敏感巨乳、連続生ハメ、大量潮吹き",
      ],
    },
  ],
  cta: { label: "作品ページで詳細を確認", url: "https://example.invalid/p" },
  sourceReferences: [],
  seoTitle: "t",
  metaDescription: "m",
  labels: [],
  warnings: [],
  usedClaimIds: [],
  usedProductLinkIds: [],
};

function looksLikeV4Failure(article: {
  sections: Array<{ paragraphs: string[]; lists: string[] }>;
}): string[] {
  const problems: string[] = [];
  const prose = article.sections.flatMap((s) => s.paragraphs).join("\n");
  const lists = article.sections.flatMap((s) => s.lists);
  if (/選択のポイントとなる/.test(prose)) problems.push("meta_evaluation_phrase");
  if (
    lists.some((l) => /出演者|メーカー|レーベル|シリーズ|販売状態|配信状態/.test(l)) &&
    lists.length >= 3
  ) {
    problems.push("catalog_metadata_list_dump");
  }
  const listJoined = lists.join(" ");
  if (/福原みな/.test(prose) && /福原みな/.test(listJoined) && /DOC/.test(prose) && /DOC/.test(listJoined)) {
    problems.push("prose_list_restatement");
  }
  return problems;
}

describe("structure-pattern narrative extraction", () => {
  it("does not turn chrome sectionOrder list into list_attributes catalog dump", () => {
    const extracted = extractStructureBlocksFromFeatures(features({}));
    expect(extracted.blocks.map((b) => b.role)).toEqual([
      "hook",
      "interest_development",
      "cta_bridge",
    ]);
    expect(extracted.blocks.some((b) => b.role === "list_attributes")).toBe(false);
    expect(extracted.blocks.every((b) => b.generation.avoidCatalogMetadata)).toBe(true);
    expect(extracted.blocks.every((b) => b.generation.avoidMetaEvaluationPhrases)).toBe(true);
  });

  it("adds cue_list only when criteria_based / decision cues are evidenced", () => {
    const extracted = extractStructureBlocksFromFeatures(
      features({
        writingFeatures: wf({
          productDifferentiationStyle: "criteria_based",
          sectionPurposeSequence: ["intro_hook", "selection_criteria", "cta"],
        }),
      }),
    );
    expect(extracted.blocks.some((b) => b.role === "cue_list")).toBe(true);
    const cue = extracted.blocks.find((b) => b.role === "cue_list")!;
    expect(cue.generation.listPurpose).toBe("decision_axes");
    expect(cue.generation.avoidCatalogMetadata).toBe(true);
  });

  it("clusters sparse A samples around interest_development narrative", () => {
    const sparse: ObservationStructureInput[] = [1, 2, 3].map((i) => ({
      id: `sparse-${i}`,
      sourceDomain: "sadist-avreview.com",
      features: features({
        headingCount: 1,
        totalLength: 1000 + i * 100,
        imageCount: 9 + i,
        summaryUsed: false,
      }),
    }));
    const patterns = clusterStructurePatterns(sparse);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    const selected = selectStructurePattern(patterns, { claimCount: 5 });
    expect(selected?.blocks.some((b) => b.role === "interest_development")).toBe(true);
    expect(selected?.blocks.some((b) => b.role === "list_attributes")).toBe(false);
    const contract = toStructurePatternPromptContract(selected!);
    expect(JSON.stringify(contract)).toMatch(/avoidCatalogMetadata/);
    expect(JSON.stringify(contract)).toMatch(/選択のポイント/);
  });
});

describe("claim selection + v4 regression guards", () => {
  it("classifies and defers low-value availability/maker claims", () => {
    const pattern = clusterStructurePatterns([
      { id: "a", sourceDomain: "x.com", features: features({}) },
    ])[0]!;
    const result = selectClaimsForStructurePattern(
      [
        { id: "1", statement: "出演者／クリエイターとして「福原みな」が記載されている。" },
        { id: "2", statement: "メーカー／レーベルとして「DOC」が公開されている。" },
        { id: "3", statement: "公開ページ上で販売／配信状態は「配信中」と確認できる。" },
        { id: "4", statement: "感度の良さが際立ち大量の潮吹きシーンが公開されている。" },
        { id: "5", statement: "シリーズ情報として「プールナンパ」が公開されている。" },
      ],
      pattern,
    );
    expect(classifyClaimKind(result.selectedClaims[0]!.statement)).not.toBe("availability");
    expect(result.selectedClaims.some((c) => c.kind === "availability")).toBe(false);
    expect(result.deferredClaimIds.length).toBeGreaterThan(0);
    expect(result.selectedClaims.length).toBeLessThanOrEqual(result.maxClaimsSuggested);
  });

  it("flags v4 failure modes as regression problems to avoid", () => {
    expect(looksLikeV4Failure(V4_REGRESSION_ARTICLE)).toEqual(
      expect.arrayContaining([
        "meta_evaluation_phrase",
        "catalog_metadata_list_dump",
        "prose_list_restatement",
      ]),
    );
  });

  it("good sparse narrative article does not match v4 failure detectors", () => {
    const good = parseBloggerArticle({
      ...V4_REGRESSION_ARTICLE,
      lead: "福原みなの高感度が前面に出るプールナンパ作品。",
      sections: [
        {
          heading: null,
          paragraphs: [
            "公開情報上、感度の高さと連続的な展開が確認できる。レーベル名の列挙ではなく、その感度が候補にする理由になる。",
          ],
          lists: [],
        },
        {
          heading: null,
          paragraphs: ["気になる点があれば作品ページで最新の公開情報を確認する。"],
          lists: [],
        },
      ],
    });
    expect(looksLikeV4Failure(good)).toEqual([]);
    const body = structuredToPlainBody(good);
    const html = formatBloggerHtml({
      title: good.title,
      lead: good.lead,
      sections: good.sections,
      cta: good.cta,
    });
    expect(body).not.toMatch(/^##\s*$/m);
    expect(html).not.toMatch(/<h2>\s*<\/h2>/);
    expect(html).toContain("作品ページ");
  });

  it("prompt mentions selective claim usage and narrative contracts", () => {
    const def = buildBloggerGeneratePromptDefinition();
    const all = `${def.systemInstruction}\n${def.body}`;
    expect(all).toMatch(/claimSelectionPolicy/);
    expect(all).toMatch(/permissions not obligations|permissions, not obligations|義務/);
    expect(all).toMatch(/catalog|SEGMENT_CONTRACTS|generationAuthority/i);
  });
});
