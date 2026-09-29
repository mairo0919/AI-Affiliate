/**
 * 1rctd00760 regression: a planned situation plus an unattributed
 * recommendation must fail production compliance and enter the rewrite note.
 */
import { describe, expect, it } from "vitest";
import { validateArticlePlanCompliance } from "../../editorial-brain/generation/article-plan-compliance.js";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";
import {
  buildArticlePlanViolationFeedback,
  buildGroundedCorrectionPlan,
  buildPlanViolationRegenNote,
} from "../../editorial-brain/generation/plan-aware-generation.js";
import { hasUnattributedViewingEvaluation } from "../plan-surface-attestation.js";
import { articleSemanticRole } from "../plan-execution-contract.js";
import {
  factMeaningCovered,
  isFactRealized,
  resolveFactRealization,
} from "../../editorial-brain/generation/plan-fact-matching.js";

const rocketPlan = {
  schemaVersion: 1 as const,
  materialDepth: "standard" as const,
  productTitle: "1rctd00760",
  title: { job: "editorial_headline" as const, facts: ["私立花園女子校いじめ学級会"] },
  lead: { job: "opening_facts" as const, facts: [] },
  body: [
    {
      job: "body_facts" as const,
      facts: [
        "ROCKET18周年記念",
        "私立花園女子校いじめ学級会",
        "無様エロの元祖",
        "全裸羞恥芸という無茶ぶりいじめで大恥を晒す",
      ],
    },
  ],
  editorialDecision: {
    angle: "私立花園女子校いじめ学級会という状況を説明する",
    readerHook: "全裸羞恥芸という無茶ぶりいじめで大恥を晒すという状況を先に示す",
    whyThisWork: "公式情報から確認できる具体点を記事の切り口にする",
    supportingEvidenceRefs: ["全裸羞恥芸という無茶ぶりいじめで大恥を晒す"],
  },
};

describe("writer viewing evaluation", () => {
  it("blocks 1rctd00760-shaped おすすめ and 味わう and sends them to rewrite", () => {
    const title = "ROCKET18周年記念で蘇る私立花園女子校の屈辱的いじめ学級会を味わう";
    const body =
      "この作品は、私立花園女子校いじめ学級会の名のもとに、無様エロの元祖として全裸羞恥芸という無茶ぶりいじめで大恥を晒す状況を軸にしており、学園ものの枠を超えた深い羞恥体験を味わいたい方におすすめです。";
    const result = validateArticlePlanCompliance({
      article: { title, summary: "", sections: [{ paragraphs: [body] }] },
      articlePlan: rocketPlan,
    });
    expect(result.ok).toBe(false);
    expect(
      result.findings.some(
        (f) =>
          f.code === "PLAN_UNSUPPORTED_EVAL" &&
          f.severity === "BLOCKING" &&
          f.message.includes("おすすめ"),
      ),
    ).toBe(true);
    expect(
      result.findings.some((f) => f.code === "PLAN_TITLE_INVENT" && f.severity === "BLOCKING"),
    ).toBe(true);
    const feedback = buildArticlePlanViolationFeedback(1, result, null, rocketPlan, {
      title,
      body,
    });
    expect(
      feedback.violations?.some(
        (v) => v.code === "PLAN_UNSUPPORTED_EVAL" || v.code === "PLAN_TITLE_INVENT",
      ),
    ).toBe(true);
    expect(feedback.instruction ?? "").toMatch(/おすすめ|味わ/);
  });

  it("keeps a concrete situation sentence that does not add a verdict", () => {
    const title = "ROCKET18周年記念の私立花園女子校いじめ学級会";
    const body =
      "ROCKET18周年記念の企画で、私立花園女子校いじめ学級会が収録されている。無様エロの元祖として、全裸羞恥芸という無茶ぶりいじめで大恥を晒す。";
    const result = validateArticlePlanCompliance({
      article: { title, summary: "", sections: [{ paragraphs: [body] }] },
      articlePlan: rocketPlan,
    });
    expect(result.findings.some((f) => f.code === "PLAN_UNSUPPORTED_EVAL")).toBe(false);
    expect(result.findings.some((f) => f.code === "PLAN_TITLE_INVENT")).toBe(false);
  });

  it("allows maker promo only as a quoted plan span or with attribution", () => {
    const facts = ["圧倒的な魅力のおすすめ作品として収録されている"];
    expect(
      hasUnattributedViewingEvaluation(
        "圧倒的な魅力のおすすめ作品として収録されている。",
        facts,
      ),
    ).toBe(false);
    expect(
      hasUnattributedViewingEvaluation("公式ではおすすめと紹介されている。", facts),
    ).toBe(false);
    expect(hasUnattributedViewingEvaluation("この作品はおすすめです。", facts)).toBe(true);
  });

  it("passes articleRole through the production writer prompt", () => {
    const built = buildOptionBBloggerGeneratorPrompt({
      productTitle: "1rctd00760",
      ctaUrl: "https://example.invalid/product",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: {
        ARTICLE_PLAN: rocketPlan,
        ARTICLE_PLAN_EXECUTION: [
          {
            contributionId: "body::0",
            slot: "body",
            fact: "全裸羞恥芸という無茶ぶりいじめで大恥を晒す",
            executionMode: "SEMANTIC_PRESERVE",
            mustPreserve: [],
            allowed: [],
            notAllowed: ["unattributed evaluation, recommendation, or viewing-experience claims"],
            articleRole: "PREMISE",
          },
        ],
      },
    });
    expect(built.userPrompt).toContain("PREMISE");
    expect(built.userPrompt).not.toMatch(/Prefer 描く\/紹介する\/味わう/);
  });

  it("accepts performer plus work identity without genre glue", () => {
    const result = validateArticlePlanCompliance({
      article: {
        title: "逢沢みゆの密室タクシードライバー",
        summary: "",
        sections: [{ paragraphs: ["逢沢みゆが出演する。65分。"] }],
      },
      articlePlan: {
        schemaVersion: 1 as const,
        materialDepth: "standard" as const,
        productTitle: "密室タクシードライバー",
        title: { job: "editorial_headline" as const, facts: ["逢沢みゆ"] },
        lead: { job: "opening_facts" as const, facts: [] },
        body: [{ job: "body_facts" as const, facts: ["密室タクシードライバー", "65分"] }],
        editorialDecision: {
          angle: "逢沢みゆの密室タクシードライバーという状況を説明する",
          readerHook: "密室タクシードライバーという状況を先に示す",
          whyThisWork: "公式情報から確認できる具体点を記事の切り口にする",
          supportingEvidenceRefs: ["密室タクシードライバー"],
        },
      },
    });
    expect(result.findings.some((f) => f.code === "PLAN_TITLE_EDITORIAL_QUALITY")).toBe(false);
    expect(result.findings.some((f) => f.code === "PLAN_TITLE_INVENT")).toBe(false);
  });

  it("accepts a grounded series title without an evaluative frame", () => {
    const result = validateArticlePlanCompliance({
      article: {
        title: "女のアフター5",
        summary: "",
        sections: [
          { paragraphs: ["ごくごく普通の女性たちがある助けを求めて男性を呼ぶ。120分。"] },
        ],
      },
      articlePlan: {
        schemaVersion: 1 as const,
        materialDepth: "standard" as const,
        productTitle: "女のアフター5 vol.2",
        title: { job: "editorial_headline" as const, facts: ["女のアフター5"] },
        lead: { job: "opening_facts" as const, facts: [] },
        body: [
          {
            job: "body_facts" as const,
            facts: ["ごくごく普通の女性たちがある助けを求めて男性を呼ぶ", "120分"],
          },
        ],
        editorialDecision: {
          angle: "女のアフター5という状況を説明する",
          readerHook: "ごくごく普通の女性たちがある助けを求めて男性を呼ぶという状況を先に示す",
          whyThisWork: "公式情報から確認できる具体点を記事の切り口にする",
          supportingEvidenceRefs: ["女のアフター5"],
        },
      },
    });
    expect(result.findings.some((f) => f.code === "PLAN_TITLE_EDITORIAL_QUALITY")).toBe(false);
    expect(result.findings.some((f) => f.code === "PLAN_TITLE_INVENT")).toBe(false);
  });

  it("labels an official situation clause as PREMISE", () => {
    expect(
      articleSemanticRole({
        fact: "ごくごく普通の女性たちが助けを求めて男性を呼ぶ",
        sourceFactType: "OFFICIAL_DESCRIPTION",
        informationAxis: "scene",
      }),
    ).toBe("PREMISE");
    expect(
      articleSemanticRole({
        fact: "ROCKET18周年記念",
        sourceFactType: "OFFICIAL_DESCRIPTION",
      }),
    ).toBe("SERIES");
  });

  it("blocks unknown evaluative paraphrases that are not in the planned facts", () => {
    const facts = ["同性羞恥いじめに特化した革命AVドラマ", "無様エロの元祖"];
    expect(hasUnattributedViewingEvaluation("革新的なAVドラマである。", facts)).toBe(true);
    expect(hasUnattributedViewingEvaluation("無様エロの元祖とも言える。", facts)).toBe(true);
    expect(hasUnattributedViewingEvaluation("余すことなく描かれている。", facts)).toBe(true);
    expect(
      hasUnattributedViewingEvaluation("公式では革命AVドラマと紹介されている。", [
        "同性羞恥いじめに特化した革命AVドラマ",
      ]),
    ).toBe(false);
  });

  it("counts a meaning-preserving paraphrase as fact coverage", () => {
    const fact = "掃除中に無防備な尻を見せる";
    const sentence = "掃除中の無防備な姿が描かれる";
    expect(factMeaningCovered(sentence, fact)).toBe(true);
    expect(isFactRealized(resolveFactRealization(sentence, fact).status)).toBe(true);
    expect(factMeaningCovered("掃除中に無防備な尻を隠す", fact)).toBe(false);
    expect(
      factMeaningCovered("119分にわたって収録されている。", "120分にわたって収録されている"),
    ).toBe(false);
  });

  it("blocks an editorial title frame that is outside title authority", () => {
    const result = validateArticlePlanCompliance({
      article: {
        title: "逢沢みゆと密室タクシードライバーの世界",
        summary: "",
        sections: [{ paragraphs: ["逢沢みゆが出演する。65分。"] }],
      },
      articlePlan: {
        schemaVersion: 1 as const,
        materialDepth: "standard" as const,
        productTitle: "密室タクシードライバー",
        title: { job: "editorial_headline" as const, facts: ["逢沢みゆ"] },
        lead: { job: "opening_facts" as const, facts: [] },
        body: [{ job: "body_facts" as const, facts: ["密室タクシードライバー", "65分"] }],
      },
    });
    expect(result.findings.some((f) => f.code === "PLAN_TITLE_INVENT" && f.message.includes("世界"))).toBe(
      true,
    );
  });

  it("puts the semantic class and allowed facts on the rewrite note", () => {
    const article = {
      title: "私立花園女子校いじめ学級会",
      summary: "",
      lead: "",
      sections: [
        {
          paragraphs: ["革新的なAVドラマとして無様エロの元祖とも言える。"],
        },
      ],
    };
    const result = validateArticlePlanCompliance({ article, articlePlan: rocketPlan });
    const feedback = buildArticlePlanViolationFeedback(2, result, null, rocketPlan, {
      title: article.title,
      body: article.sections[0]!.paragraphs[0],
    });
    const evalV = feedback.violations?.find((v) => v.code === "PLAN_UNSUPPORTED_EVAL");
    expect(evalV?.violationType).toMatch(/UNSUPPORTED_EVALUATION|VIEWING_EXPERIENCE/);
    expect(evalV?.unsupportedMeaning ?? "").toMatch(/革新的|とも言える/);
    expect(evalV?.offendingSentence ?? "").toMatch(/革新的/);
    expect(feedback.instruction ?? "").toMatch(/violationType|allowedSupportingFacts/);
    const evalOps = [
      ...(feedback.correctionPlan?.repair ?? []),
      ...(feedback.correctionPlan?.remove ?? []),
    ];
    expect(evalOps.some((r) => r.unsupportedMeaning.includes("革新的"))).toBe(true);
    expect(feedback.instruction ?? "").toMatch(/Do not paraphrase UNSUPPORTED_EVALUATION/);
    const note = buildPlanViolationRegenNote(feedback);
    expect(note).toContain("GROUNDED_CORRECTION");
    expect(note).toContain("KEEP");
  });

  it("keeps covered facts and requires the omitted sioz brand fact", () => {
    const plan = {
      schemaVersion: 1 as const,
      materialDepth: "standard" as const,
      productTitle: "塩対応ベスト",
      title: { job: "editorial_headline" as const, facts: ["塩対応ベスト"] },
      lead: { job: "opening_facts" as const, facts: [] },
      body: [
        {
          job: "body_facts" as const,
          facts: [
            "しろうとまんまん",
            "年上の男を金ヅルとしか見ていないナメ腐った未成熟なP活女ども",
          ],
        },
      ],
    };
    const body =
      "塩対応ベストは、年上の男を金ヅルとしか見ていないナメ腐った未成熟なP活女どもを描く。リアルな素人感がある。";
    const result = validateArticlePlanCompliance({
      article: { title: "塩対応ベスト", summary: "", sections: [{ paragraphs: [body] }] },
      articlePlan: plan,
    });
    const feedback = buildArticlePlanViolationFeedback(2, result, null, plan, {
      title: "塩対応ベスト",
      body,
    });
    const omitted = feedback.correctionPlan?.requiredFacts.find((f) => f.fact === "しろうとまんまん");
    expect(omitted?.coveredBySentence ?? null).toBeNull();
    expect(omitted?.mustKeep).toBe(false);
    const kept = feedback.correctionPlan?.requiredFacts.find((f) => f.fact.includes("金ヅル"));
    expect(kept?.mustKeep).toBe(true);
    expect(kept?.factId).toBeTruthy();
    expect(kept?.articleRole).toBeTruthy();
    const evalOps = [
      ...(feedback.correctionPlan?.repair ?? []),
      ...(feedback.correctionPlan?.remove ?? []),
    ];
    expect(evalOps.some((r) => r.unsupportedMeaning.includes("リアルな"))).toBe(true);
    expect(feedback.correctionPlan?.keep.length).toBeGreaterThan(0);
  });

  it("requires the omitted orecs clause without dropping the covered investigation", () => {
    const omittedFact = "収入が高い家庭に生まれた子女は変態に育つという学説をご存じですか";
    const coveredFact = "いわゆるお嬢さんが溢れる都内のある街に行きまして実態を調査してきました";
    const plan = {
      schemaVersion: 1 as const,
      materialDepth: "standard" as const,
      productTitle: "お嬢さん調査",
      title: { job: "editorial_headline" as const, facts: ["お嬢さん調査"] },
      lead: { job: "opening_facts" as const, facts: [] },
      body: [{ job: "body_facts" as const, facts: [omittedFact, coveredFact] }],
    };
    const body = "いわゆるお嬢さんが溢れる都内のある街に行きまして実態を調査してきました。";
    const correction = buildGroundedCorrectionPlan(
      plan,
      { title: "お嬢さん調査", body },
      false,
    );
    const missing = correction.requiredFacts.find((f) => f.fact === omittedFact);
    const kept = correction.requiredFacts.find((f) => f.fact === coveredFact);
    expect(missing?.coveredBySentence ?? null).toBeNull();
    expect(missing?.mustKeep).toBe(false);
    expect(kept?.mustKeep).toBe(true);
    expect(kept?.coveredBySentence ?? "").toContain("お嬢さん");
    expect(correction.keep.some((k) => k.sentence.includes("お嬢さん"))).toBe(true);
  });

  it("uses a short title fact instead of a sentence-length product title", () => {
    const plan = {
      schemaVersion: 1 as const,
      materialDepth: "standard" as const,
      productTitle: "塩対応ベスト。イキった塩娘をチ○ポでひたすらわからせる240分",
      title: { job: "editorial_headline" as const, facts: ["塩対応ベスト"] },
      lead: { job: "opening_facts" as const, facts: [] },
      body: [{ job: "body_facts" as const, facts: ["しろうとまんまん"] }],
    };
    const correction = buildGroundedCorrectionPlan(plan, { title: "塩対応ベストの世界", body: "" }, true);
    expect(correction.title.strongest).toBe("塩対応ベスト");
    expect(correction.title.action).toBe("REPAIR");
  });
});
