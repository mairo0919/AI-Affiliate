/**
 * Title surface realization + promotional framing (Issue 4/5).
 */
import { describe, expect, it } from "vitest";
import {
  buildEvidencePack,
  claimStatementsFromPageEvidence,
} from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { buildArticlePlan } from "../article-plan.js";
import {
  classifyTitleMaterialKind,
  compactTitleDisplaySurface,
  isTitleClauseFragment,
  toTitleDisplayFact,
  validateTitleSurfaceRealization,
} from "../title-eligibility.js";
import { validateArticlePlanCompliance } from "../../editorial-brain/generation/article-plan-compliance.js";
import { validatePostTransformIntegrity } from "../../editorial-brain/generation/post-transform-integrity.js";
import {
  buildArticlePlanViolationFeedback,
  buildPlanViolationRegenNote,
} from "../../editorial-brain/generation/plan-aware-generation.js";
import { hasUnsupportedEvaluativeResidue } from "../plan-surface-attestation.js";
import { optionBAllowsPostLlmProseMutation } from "../../editorial-brain/generation/option-b-blog-boundary.js";
import { OPTION_B_WRITER_SYSTEM } from "../natural-product-intro-policy.js";
import type { PageEvidenceMetaShape } from "../official-page-evidence-atoms.js";

const OFJE_DESC =
  "AVデビューから8周年を迎え、映画や舞台でも絶賛活躍中！円熟した濃厚なセックスとエロポテンシャル、低身長なのにグラマラスボディが魅力の‘奥田咲’エスワンベスト第6弾。今回は彼女の最新12タイトル、なお且つ全コーナーを収録した豪華でスペシャルなベスト版です。超ボリューム55コーナー8時間。人妻、NTR、痴女、追撃ピストンなど今の咲が全部詰まった最高傑作がここに誕生です！！！";

function ofjePlan() {
  const pe = {
    description: { text: OFJE_DESC },
    actors: ["奥田咲"],
  } as PageEvidenceMetaShape;
  const statements = claimStatementsFromPageEvidence({
    pageEvidenceMeta: pe,
    productTitle: "ofje00230",
    actors: pe.actors,
  });
  const pack = buildEvidencePack({
    productTitle: "ofje00230",
    claims: statements.slice(0, 12).map((s, i) => ({
      id: `c${i}`,
      statement: s,
      status: "SUPPORTED" as const,
    })),
    pageEvidenceMeta: pe,
  });
  const profile = buildProductMaterialProfileFromPack(pack);
  const feas = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack,
    profile,
  });
  return buildArticlePlan({
    productTitle: "ofje00230",
    pack,
    assignment: feas.assignment,
    materialDepth: profile.materialDepth,
    profile,
  });
}

describe("title surface realization", () => {
  it("classifies anniversary clause as SEMANTIC_ONLY and compacts", () => {
    const raw = "AVデビューから8周年を迎え";
    expect(isTitleClauseFragment(raw)).toBe(true);
    expect(classifyTitleMaterialKind(raw)).toBe("SEMANTIC_ONLY");
    expect(compactTitleDisplaySurface(raw)).toBe("デビュー8周年");
    expect(toTitleDisplayFact(raw)).toBe("デビュー8周年");
  });

  it("compacts long work-form clause to trailing SOURCE noun", () => {
    const raw =
      "性欲の化身と言っても過言ではないイキっぷりがダイナミックな小島みなみを限界突破させる究極のピストン作品";
    expect(compactTitleDisplaySurface(raw)).toBe("究極のピストン作品");
    expect(toTitleDisplayFact(raw)).toBe("究極のピストン作品");
  });

  it("ofje title facts use compact anniversary — not unfinished を迎え", () => {
    const plan = ofjePlan();
    expect(plan.title.facts.some((f) => /を迎え/.test(f))).toBe(false);
    expect(plan.title.facts.some((f) => /デビュー8周年|ベスト第?6弾|エスワン/.test(f))).toBe(
      true,
    );
    expect(plan.title.facts[0]).toBe("奥田咲");
  });

  it("rejects unfinished fragment and keyword-concat titles", () => {
    expect(
      validateTitleSurfaceRealization("奥田咲 エスワンベスト第6弾 AVデビューから8周年を迎え").ok,
    ).toBe(false);
    expect(
      validateTitleSurfaceRealization("奥田咲 エスワンベスト第6弾 デビュー8周年").codes,
    ).toContain("TITLE_KEYWORD_CONCAT");
    expect(validateTitleSurfaceRealization("奥田咲のエスワンベスト第6弾——デビュー8周年").ok).toBe(
      true,
    );
  });

  it("post-transform blocks unfinished title fragment", () => {
    const r = validatePostTransformIntegrity({
      title: "奥田咲 エスワンベスト第6弾 AVデビューから8周年を迎え",
      sections: [{ paragraphs: ["本文です。"] }],
    });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.code === "TITLE_UNFINISHED_FRAGMENT")).toBe(true);
  });

  it("compliance blocks title invent beyond title.facts (ssis pattern)", () => {
    const result = validateArticlePlanCompliance({
      article: {
        title: "小島みなみ 120分の究極ピストン作品",
        summary: "",
        sections: [{ paragraphs: ["小島みなみの120分作品です。"] }],
      },
      articlePlan: {
        schemaVersion: 1,
        materialDepth: "scarce",
        productTitle: "ssis00700",
        title: { job: "who_plus_core", facts: ["小島みなみ", "120分"] },
        lead: { job: "opening_facts", facts: [] },
        body: [
          {
            job: "body_facts",
            facts: ["性欲の化身と言っても過言ではないイキっぷりがダイナミックな小島みなみを限界突破させる究極のピストン作品"],
          },
        ],
      },
    });
    expect(result.findings.some((f) => f.code === "PLAN_TITLE_INVENT")).toBe(true);
    expect(result.ok).toBe(false);
  });
});

describe("promotional framing residue", () => {
  it("flags 存分に味わえ / 楽しめます / 見どころの一つ when unattested", () => {
    const planFacts = ["奥田咲", "8時間", "NTR", "人妻"];
    expect(hasUnsupportedEvaluativeResidue("円熟したセックスが存分に味わえます。", planFacts)).toBe(
      true,
    );
    expect(hasUnsupportedEvaluativeResidue("多彩なシーンが楽しめます。", planFacts)).toBe(true);
    expect(hasUnsupportedEvaluativeResidue("身長差手コキも見どころの一つです。", planFacts)).toBe(
      true,
    );
    expect(
      hasUnsupportedEvaluativeResidue("本作には人妻やNTR要素も含まれています。", planFacts),
    ).toBe(false);
  });

  it("compliance BLOCKS hard promo 見どころ; allows grounded soft editorial 存分に", () => {
    const plan = {
      schemaVersion: 1 as const,
      materialDepth: "standard" as const,
      productTitle: "mird",
      title: { job: "who_plus_core", facts: ["ハーレム"] },
      lead: { job: "opening_facts", facts: [] },
      body: [
        {
          job: "body_facts",
          facts: ["全員170cmオーバーのデカ女子4人身長差手コキ", "円熟した濃厚なセックスとエロポテンシャル"],
        },
      ],
    };
    const closer = validateArticlePlanCompliance({
      article: {
        title: "ハーレム",
        summary: "",
        sections: [
          {
            paragraphs: [
              "全員170cmオーバーのデカ女子4人身長差手コキが収録されています。",
              "身長差を活かした手コキも見どころの一つです。",
            ],
          },
        ],
      },
      articlePlan: plan,
    });
    // Hard promo without plan attestation → BLOCKING (REGENERATE).
    expect(closer.findings.some((f) => f.code === "PLAN_UNSUPPORTED_EVAL" && f.severity === "BLOCKING")).toBe(
      true,
    );

    const mixed = validateArticlePlanCompliance({
      article: {
        title: "ハーレム",
        summary: "",
        sections: [
          {
            paragraphs: [
              "円熟した濃厚なセックスとエロポテンシャルを存分に味わえる内容です。",
            ],
          },
        ],
      },
      articlePlan: plan,
    });
    // Soft editorial on a plan-grounded sentence → allowed (editorial interpretation).
    expect(mixed.findings.some((f) => f.code === "PLAN_UNSUPPORTED_EVAL")).toBe(false);
  });

  it("OPTION B forbids post-LLM prose mutation", () => {
    expect(optionBAllowsPostLlmProseMutation()).toBe(false);
  });

  it("REGEN feedback cites unsupportedSentence for pure eval BLOCKING", () => {
    const plan = {
      schemaVersion: 1 as const,
      materialDepth: "standard" as const,
      productTitle: "mird",
      title: { job: "who_plus_core", facts: ["ハーレム"] },
      lead: { job: "opening_facts", facts: [] },
      body: [
        {
          job: "body_facts",
          facts: ["全員170cmオーバーのデカ女子4人身長差手コキ", "180分"],
        },
      ],
    };
    const body =
      "全員170cmオーバーのデカ女子4人身長差手コキが収録されています。身長差を活かした手コキも見どころの一つです。";
    const compliance = validateArticlePlanCompliance({
      article: {
        title: "ハーレム",
        summary: "",
        sections: [{ paragraphs: [body] }],
      },
      articlePlan: plan,
    });
    const feedback = buildArticlePlanViolationFeedback(1, compliance, null, plan, {
      title: "ハーレム",
      body,
    });
    const evalV = feedback.violations?.find((v) => v.code === "PLAN_UNSUPPORTED_EVAL");
    expect(evalV?.unsupportedSentence).toMatch(/見どころの一つ/);
    expect(feedback.instruction).toMatch(
      /unsupportedSentence|external factual|editorial interpretation|PLAN_UNSUPPORTED_EVAL/i,
    );
    const note = JSON.parse(buildPlanViolationRegenNote(feedback));
    expect(note.violations.some((v: { unsupportedSentence?: string }) => v.unsupportedSentence?.includes("見どころ"))).toBe(
      true,
    );
  });

  it("Writer policy forbids unfinished title fragments and external factual claims", () => {
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/を迎え/);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/EXTERNAL FACTUAL CLAIMS|EDITORIAL INTERPRETATION/);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/unfinished clauses|読者|reader orientation|No purchase urgency/i);
  });
});
