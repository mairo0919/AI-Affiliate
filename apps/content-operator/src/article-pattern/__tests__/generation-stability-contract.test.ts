/**
 * Generation stability — narrative matching, weaveable deixis, pure-eval closer strip.
 */
import { describe, expect, it } from "vitest";
import {
  classifyFactRealizationPolicy,
  narrativeCoreRealized,
  policySemanticRealized,
  weaveableDeixisRealized,
} from "../../editorial-brain/generation/fact-realization-policy.js";
import {
  isFactRealized,
  resolveFactRealization,
} from "../../editorial-brain/generation/plan-fact-matching.js";
import {
  stripPureUnsupportedEvalClosers,
  validateArticlePlanCompliance,
} from "../../editorial-brain/generation/article-plan-compliance.js";
import { hasUnsupportedEvaluativeResidue } from "../plan-surface-attestation.js";
import type { ArticlePlan } from "../article-plan.js";
import { OPTION_B_WRITER_SYSTEM } from "../natural-product-intro-policy.js";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";

function miniPlan(bodyFacts: string[], titleFacts: string[] = ["作品"]): ArticlePlan {
  return {
    schemaVersion: 2,
    productTitle: "test",
    materialDepth: "standard",
    title: { facts: titleFacts },
    body: [{ heading: null, facts: bodyFacts }],
  } as ArticlePlan;
}

describe("fact realization policy — cawd narrative core", () => {
  const fact = "ただ唯一の慰みは姪っ子";

  it("classifies as NARRATIVE_CORE (not identity-strict)", () => {
    expect(classifyFactRealizationPolicy(fact)).toBe("NARRATIVE_CORE");
  });

  it("唯一の慰みは姪っ子 realizes meaning without ただ", () => {
    const prose = "唯一の慰みは従順すぎる姪である桜もこである。";
    expect(narrativeCoreRealized(prose, fact)).toBe(true);
    expect(policySemanticRealized(prose, fact)).toBe(true);
    const r = resolveFactRealization(prose, fact);
    expect(isFactRealized(r.status)).toBe(true);
  });

  it("still OMISSION when meaning core (慰み/姪) is absent", () => {
    const prose = "イツキは生涯独身の孤独な男として描かれている。";
    expect(policySemanticRealized(prose, fact)).toBe(false);
    expect(isFactRealized(resolveFactRealization(prose, fact).status)).toBe(false);
  });

  it("quantities stay identity-strict", () => {
    expect(classifyFactRealizationPolicy("55コーナー")).toBe("IDENTITY_STRICT");
    expect(classifyFactRealizationPolicy("8時間")).toBe("IDENTITY_STRICT");
    expect(policySemanticRealized("長い作品です", "8時間")).toBe(false);
  });
});

describe("fact realization policy — nnpj weaveable deixis", () => {
  const fact = "この美女";

  it("classifies as WEAVEABLE_DEIXIS", () => {
    expect(classifyFactRealizationPolicy(fact)).toBe("WEAVEABLE_DEIXIS");
  });

  it("美女のこの人妻 realizes この美女 (noun+deixis)", () => {
    const prose = "美女のこの人妻はテクニックが凄絶で、イラマ好きです。";
    expect(weaveableDeixisRealized(prose, fact)).toBe(true);
    expect(isFactRealized(resolveFactRealization(prose, fact).status)).toBe(true);
  });

  it("出演するこの美女 exact still works", () => {
    const prose = "出演するこの美女はイラマ好きでテク凄絶です。";
    expect(isFactRealized(resolveFactRealization(prose, fact).status)).toBe(true);
  });

  it("bare 美女 without deixis is still omission", () => {
    const prose = "美女はイラマ好きでテクニックが凄絶です。";
    expect(weaveableDeixisRealized(prose, fact)).toBe(false);
    expect(isFactRealized(resolveFactRealization(prose, fact).status)).toBe(false);
  });
});

describe("pure unsupported eval closer strip — ofje", () => {
  const plan = miniPlan(
    [
      "奥田咲",
      "奥田咲の円熟した濃厚なセックスとエロポテンシャル",
      "低身長なのにグラマラスボディ",
      "人妻・NTR・痴女・追撃ピストンなどを収録",
      "55コーナー",
      "8時間",
      "ベスト第6弾",
    ],
    ["奥田咲", "エスワンベスト第6弾"],
  );

  it("keeps fact-bearing editorial interpretation; strips empty promo closer", () => {
    const article = {
      title: "奥田咲のエスワンベスト第6弾",
      lead: "",
      summary: "",
      sections: [
        {
          paragraphs: [
            "本作は奥田咲の最新12タイトルの全コーナーを収録したベスト第6弾で、AVデビューから8周年を迎えた彼女の円熟した濃厚なセックスとエロポテンシャルを堪能できる内容となっています。",
            "低身長ながらグラマラスボディを持つ奥田咲が人妻、NTR、痴女、追撃ピストンなど多彩なプレイスタイルを披露しており、合計55コーナー、8時間にわたる収録です。",
            "このベストは充実した内容で楽しめます。",
          ],
        },
      ],
    };

    // Fact-bearing sentence with soft editorial frame should not BLOCK.
    expect(
      hasUnsupportedEvaluativeResidue(
        article.sections[0]!.paragraphs[0]!,
        plan.body.flatMap((b) => b.facts),
      ),
    ).toBe(false);

    const before = validateArticlePlanCompliance({ article, articlePlan: plan });
    expect(
      before.findings.some(
        (f) =>
          f.code === "PLAN_UNSUPPORTED_EVAL" &&
          f.severity === "BLOCKING" &&
          f.message.includes("充実した内容で楽しめます"),
      ),
    ).toBe(true);

    const stripped = stripPureUnsupportedEvalClosers({ article, articlePlan: plan });
    expect(stripped.mutated).toBe(true);
    expect(stripped.droppedSentences.some((s) => s.includes("楽しめます"))).toBe(true);
    // Keep grounded editorial sentence
    const kept = stripped.article.sections.flatMap((s) => s.paragraphs).join("\n");
    expect(kept).toContain("円熟した濃厚なセックス");

    const after = validateArticlePlanCompliance({
      article: stripped.article,
      articlePlan: plan,
    });
    expect(
      after.findings.some((f) => f.code === "PLAN_UNSUPPORTED_EVAL" && f.severity === "BLOCKING"),
    ).toBe(false);
  });

  it("Writer policy allows grounded editorial interpretation; forbids external claims", () => {
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/EDITORIAL INTERPRETATION/);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/EXTERNAL FACTUAL CLAIMS/);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/で知られて|として知られて/);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/ファンはもちろん|まとめて見たい人/);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/fact formatter/i);
    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: "ofje00230",
      ctaUrl: "https://example.invalid",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: {
        ARTICLE_PLAN: plan,
        ARTICLE_PLAN_EXECUTION: [{ slot: "body", fact: "奥田咲", executionMode: "EXACT_SURFACE" }],
      },
    });
    expect(prompt.systemInstruction).toMatch(/EDITORIAL INTERPRETATION/i);
    expect(prompt.userPrompt).toMatch(/natural Japanese product intro|weave into prose/i);
    expect(prompt.userPrompt).toMatch(/で知られて|売上No\.1|大人気/);
    // Internal taxonomy dumps must not lecture Writer HOW.
    expect(prompt.userPrompt).not.toMatch(/BODY_PROGRESSION \(PLAN-TIME/);
    expect(prompt.userPrompt).not.toMatch(/SOURCE FACT TYPE \(per/);
  });

  it("allows EDITORIAL reader-address; blocks EXTERNAL reputation-as-fact", () => {
    const facts = plan.body.flatMap((b) => b.facts);
    // EDITORIAL — keep
    expect(
      hasUnsupportedEvaluativeResidue(
        "多彩なシーンと豊富な収録量が特徴のため、彼女のファンはもちろん、まとめて見たい人にも適したボリュームのあるベスト盤です。",
        facts,
      ),
    ).toBe(false);
    expect(
      hasUnsupportedEvaluativeResidue(
        "人妻、NTR、痴女、追撃ピストンといった多様なプレイスタイルを網羅しており、一つの方向性に偏らない幅広いエロティシズムを横断して楽しめる内容となっています。",
        facts,
      ),
    ).toBe(false);
    // EXTERNAL — block (third-party reputation asserted as fact)
    expect(
      hasUnsupportedEvaluativeResidue(
        "奥田咲は低身長ながらグラマラスなボディを持ち、その円熟した濃厚なセックスと高いエロポテンシャルで知られています。",
        facts,
      ),
    ).toBe(true);
    expect(
      hasUnsupportedEvaluativeResidue("世間から高く評価されているベスト盤です。", facts),
    ).toBe(true);
  });
});

describe("cawd compliance no false OMISSION", () => {
  const plan = miniPlan(
    [
      "ムラムラしたらもこに用事があるにも関わらずこちらを優先させろと呼びつけてセックスする",
      "もこの慈愛の心を悪用してタダパコする歪んだクズ叔父の性生活",
      "パチンコで負けてむしゃくしゃしたら呼びつけてフェラさせ",
      "何の努力もせずに生きて来た",
      "ただ唯一の慰みは姪っ子",
      "「世間が悪いせいだ」",
      "もこの存在だった",
      "それもそのはずで",
      "従順すぎる姪",
      "桜もこ",
    ],
    ["イツキは生涯独身の孤独な男"],
  );

  it("paraphrase without ただ passes omission gate", () => {
    const article = {
      title: "イツキは生涯独身の孤独な男",
      lead: "",
      summary: "",
      sections: [
        {
          paragraphs: [
            "本作は、何の努力もせずに生きてきた歪んだクズ叔父イツキの性生活を描いています。ムラムラした際には、もこに用事があってもこちらを優先させろと呼びつけてセックスを行い、パチンコで負けてむしゃくしゃした時には呼びつけてフェラをさせるなど、もこの慈愛の心を悪用してタダパコする生活が続きます。",
            "唯一の慰みは従順すぎる姪である桜もこの存在であり、それもそのはずで彼にとってもこの存在はかけがえのないものであるようです。「世間が悪いせいだ」と語る彼の孤独な生涯独身の姿が映し出されています。",
          ],
        },
      ],
    };
    const result = validateArticlePlanCompliance({ article, articlePlan: plan });
    expect(
      result.findings.some(
        (f) => f.code === "PLAN_FACT_OMISSION" && f.message.includes("ただ唯一の慰みは姪っ子"),
      ),
    ).toBe(false);
  });
});
