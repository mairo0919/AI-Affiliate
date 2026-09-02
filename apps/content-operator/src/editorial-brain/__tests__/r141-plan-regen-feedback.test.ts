/**
 * R141 — structured regen corrective feedback (LLM=0).
 */

import { describe, expect, it } from "vitest";
import type { ArticlePlan } from "../../article-pattern/article-plan.js";
import {
  buildArticlePlanViolationFeedback,
  buildPlanViolationRegenNote,
  buildStructuredPlanRegenViolations,
  PLAN_REGEN_CORRECTION_INSTRUCTION,
} from "../generation/plan-aware-generation.js";
import { validateArticlePlanCompliance } from "../generation/article-plan-compliance.js";
import { buildOptionBBloggerGeneratorPrompt } from "../generation/option-b-blogger-prompt.js";
import { buildOptionBGenerationAuthority } from "../../generation/generation-authority.js";
import { resolveFactRealization } from "../generation/plan-fact-matching.js";

const nnpjPlan: ArticlePlan = {
  schemaVersion: 1,
  materialDepth: "rich",
  productTitle: "nnpj00500",
  title: { job: "who_plus_core", facts: ["2時間"] },
  lead: { job: "opening_facts", facts: ["2時間", "ノンストップ"] },
  body: [
    {
      job: "body_facts",
      facts: [
        "アナル舐め",
        "イクイクイグぅぅうう",
        "時間ないから早くホテル入ろっ",
        "オナニー見せド変態妻",
        "連発射精",
        "Sexで日頃のストレスを発散する人妻",
        "中出しもたっぷり",
      ],
    },
  ],
};

const predPlan: ArticlePlan = {
  schemaVersion: 1,
  materialDepth: "rich",
  productTitle: "【長身美脚の一花先生に暴走中出し",
  title: {
    job: "who_plus_core",
    facts: [
      "一花を家まで送ってあげた男子生徒は憧れの先生の無防備な姿と2人きりの空間に我慢ができず性欲暴走",
    ],
  },
  lead: {
    job: "opening_facts",
    facts: [
      "一花を家まで送ってあげた男子生徒は憧れの先生の無防備な姿と2人きりの空間に我慢ができず性欲暴走",
      "【長身美脚の一花先生に暴走中出し",
    ],
  },
  body: [
    {
      job: "body_facts",
      facts: [
        "念願の美脚を舐めしゃぶりまくって中出しセックス",
        "生徒と言えどチンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる",
      ],
    },
  ],
};

describe("R141 plan regen corrective feedback", () => {
  it("CASE 1: body PLAN_FACT_OMISSION — 連発射精", () => {
    const article = {
      title: "2時間",
      summary: "",
      lead: "2時間ノンストップ",
      sections: [
        {
          paragraphs: ["アナル舐めとイクイクイグぅぅうう。連続射精で快感が続く。"],
        },
      ],
    };
    const compliance = validateArticlePlanCompliance({
      article,
      articlePlan: nnpjPlan,
    });
    expect(compliance.ok).toBe(false);

    const feedback = buildArticlePlanViolationFeedback(1, compliance, null, nnpjPlan);
    expect(feedback.violations).toContainEqual(
      expect.objectContaining({
        code: "PLAN_FACT_OMISSION",
        slot: "body",
        fact: "連発射精",
      }),
    );

    const note = JSON.parse(buildPlanViolationRegenNote(feedback));
    expect(note.violations).toContainEqual(
      expect.objectContaining({ slot: "body", fact: "連発射精" }),
    );
    expect(note.instruction).toContain(PLAN_REGEN_CORRECTION_INSTRUCTION);
    expect(note.instruction).toMatch(/PLAN_FACT_OMISSION/);
    expect(note.note).toBeUndefined();
  });

  it("CASE 2: title PLAN_FACT_OMISSION — exact missing title fact", () => {
    const titleFact = predPlan.title.facts[0]!;
    const article = {
      title: "禁断の夜",
      summary: "",
      lead: "一花先生を家まで送った男子生徒は、憧れの先生の無防備な姿と二人きりの空間に我慢ができず、性欲が暴走してしまった。【長身美脚の一花先生に暴走中出し",
      sections: [
        {
          paragraphs: [
            "念願の美脚を舐めしゃぶりまくって中出しセックス。生徒と言えども、チンポの快感に負けてしまった一花は、先生の立場を捨て、女として激しくイキまくる。",
          ],
        },
      ],
    };
    const compliance = validateArticlePlanCompliance({ article, articlePlan: predPlan });
    const feedback = buildArticlePlanViolationFeedback(1, compliance, null, predPlan);
    const titleViolation = feedback.violations?.find((v) => v.slot === "title");
    expect(titleViolation?.fact).toBe(titleFact);
    expect(titleViolation?.code).toBe("PLAN_FACT_OMISSION");
  });

  it("CASE 3: PLAN_SLOT_VIOLATION — assigned title slot preserved", () => {
    const titleFact = predPlan.title.facts[0]!;
    const article = {
      title: "禁断の夜",
      summary: "",
      lead: "短いリード",
      sections: [
        {
          paragraphs: [
            `${titleFact}。念願の美脚を舐めしゃぶりまくって中出しセックス。生徒と言えども、チンポの快感に負けてしまった一花は、先生の立場を捨て、女として激しくイキまくる。`,
          ],
        },
      ],
    };
    const compliance = validateArticlePlanCompliance({ article, articlePlan: predPlan });
    const slotViolation = buildStructuredPlanRegenViolations(predPlan, compliance).find(
      (v) => v.code === "PLAN_SLOT_VIOLATION",
    );
    expect(slotViolation).toMatchObject({
      slot: "title",
      fact: titleFact,
      reason: "plan fact must be realized in assigned slot",
    });
  });

  it("CASE 4: multiple omissions — all facts, no duplicates", () => {
    const article = {
      title: "x",
      summary: "",
      lead: "y",
      sections: [{ paragraphs: ["z"] }],
    };
    const compliance = validateArticlePlanCompliance({ article, articlePlan: nnpjPlan });
    const violations = buildStructuredPlanRegenViolations(nnpjPlan, compliance);
    expect(violations.length).toBeGreaterThan(1);
    const keys = violations.map((v) => `${v.slot}::${v.fact}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(violations.every((v) => v.fact.length > 0)).toBe(true);
  });

  it("CASE 5: attempt 1 PASS — no regen feedback in prompt", () => {
    const article = {
      title: "2時間",
      summary: "",
      lead: "2時間にわたるノンストップ。",
      sections: [
        {
          paragraphs: [
            "アナル舐めからイクイクイグぅぅうう。時間ないから早くホテル入ろっ。オナニー見せド変態妻。連発射精。Sexで日頃のストレスを発散する人妻。中出しもたっぷり。",
          ],
        },
      ],
    };
    const compliance = validateArticlePlanCompliance({ article, articlePlan: nnpjPlan });
    expect(compliance.ok).toBe(true);

    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: "nnpj00500",
      ctaUrl: "https://example.com",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: buildOptionBGenerationAuthority({ articlePlan: nnpjPlan }),
      planViolationNote: null,
    });
    expect(prompt.userPrompt).not.toContain("Bounded regen");
    expect(prompt.userPrompt).not.toContain("violations");
  });

  it("Writer attempt 2 prompt includes structured correction payload", () => {
    const article = {
      title: "2時間",
      summary: "",
      lead: "2時間ノンストップ",
      sections: [{ paragraphs: ["連続射精で何度も快感。"] }],
    };
    const compliance = validateArticlePlanCompliance({ article, articlePlan: nnpjPlan });
    const feedback = buildArticlePlanViolationFeedback(1, compliance, null, nnpjPlan);
    const note = buildPlanViolationRegenNote(feedback);
    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: "nnpj00500",
      ctaUrl: "https://example.com",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: buildOptionBGenerationAuthority({
        articlePlan: nnpjPlan,
        planViolationFeedback: feedback,
      }),
      planViolationNote: note,
    });
    expect(prompt.userPrompt).toContain("連発射精");
    expect(prompt.userPrompt).toContain('"slot":"body"');
    expect(prompt.userPrompt).toContain(PLAN_REGEN_CORRECTION_INSTRUCTION);
    expect(prompt.systemInstruction).not.toContain(PLAN_REGEN_CORRECTION_INSTRUCTION);
  });

  it("BEFORE vs AFTER: missing fact now in Writer payload", () => {
    const compliance = validateArticlePlanCompliance({
      article: {
        title: "2時間",
        summary: "",
        lead: "2時間",
        sections: [{ paragraphs: ["連続射精"] }],
      },
      articlePlan: nnpjPlan,
    });
    const feedback = buildArticlePlanViolationFeedback(1, compliance, null, nnpjPlan);
    const before = JSON.stringify({
      codes: feedback.codes,
      violatedSegments: feedback.violatedSegments,
      note: feedback.note,
    });
    const after = buildPlanViolationRegenNote(feedback);

    expect(before).not.toContain("連発射精");
    expect(after).toContain("連発射精");
    const regenFact = JSON.parse(after).violations.find(
      (v: { fact: string }) => v.fact === "連発射精",
    );
    expect(regenFact).toMatchObject({ slot: "body", fact: "連発射精" });
  });

  it("連続射精 is still NONE — Fact Matching unchanged", () => {
    const r = resolveFactRealization("連続射精で何度も", "連発射精");
    expect(r.status).toBe("NONE");
    expect(r.realized).toBe(false);
  });
});
