/**
 * R130 — mutation must not DROP sentences carrying EXACT/SEMANTIC planned fact realization.
 */
import { describe, expect, it } from "vitest";
import type { ArticlePlan } from "../../article-pattern/article-plan.js";
import {
  applyArticlePlanComplianceMutations,
  validateArticlePlanCompliance,
} from "../generation/article-plan-compliance.js";
import {
  isFactRealized,
  resolveFactRealization,
} from "../generation/plan-fact-matching.js";

const MIZD_DROP_SENTENCE =
  "まさにベストな内容で、濃密な時間を堪能できる作品となっています。";

const OFJE_DROP_SENTENCE =
  "今回の作品では人妻やNTRといったテーマにも挑戦し、多彩な表情を見せています。";

const mizdPlan: ArticlePlan = {
  schemaVersion: 1,
  materialDepth: "rich",
  productTitle: "mizd00312",
  title: { job: "who_plus_core", facts: ["10作品"] },
  lead: { job: "opening_facts", facts: ["24本番"] },
  body: [
    {
      job: "body_facts",
      facts: [
        "ハメ潮びっちゃーーーーー",
        "8時間",
        "ベスト",
        "アナルFUCK",
        "メスイキペニバン",
        "PtoM騎乗位",
        "おっぱいもお尻もエロい",
        "可愛いのにプレイもハード",
      ],
    },
  ],
};

const mizdArticle = {
  title: "10作品で魅せる濃密なプレイの数々",
  summary: "24本番の濃厚なシーンが詰まった作品集をご紹介します。",
  lead: "24本番の濃厚なシーンが詰まった作品集をご紹介します。",
  sections: [
    {
      paragraphs: [
        "本作は8時間に及ぶボリュームで、ハメ潮がびっちゃーーーーーっと飛び散る迫力満点のシーンが満載です。",
        "アナルFUCKやメスイキペニバン、PtoM騎乗位など、多彩なプレイが楽しめます。",
        "おっぱいもお尻もエロさ全開で、可愛い見た目とは裏腹にハードなプレイを繰り広げるのが特徴です。",
        MIZD_DROP_SENTENCE,
      ],
    },
  ],
};

const ofjePlan: ArticlePlan = {
  schemaVersion: 1,
  materialDepth: "rich",
  productTitle: "ofje00230",
  title: { job: "who_plus_core", facts: ["8時間"] },
  lead: {
    job: "opening_facts",
    facts: ["8時間", "円熟した濃厚なセックスとエロポテンシャル"],
  },
  body: [
    {
      job: "body_facts",
      facts: [
        "痴女",
        "ベスト第6弾",
        "AVデビューから8周年を迎え",
        "映画や舞台でも絶賛活躍中",
        "今回は彼女の最新12タイトル",
        "人妻",
        "NTR",
      ],
    },
  ],
};

const ofjeArticle = {
  title: "8時間にわたる濃密な時間を堪能する",
  summary: "8時間に及ぶ円熟した濃厚なセックスとエロポテンシャルが詰まった作品です。",
  lead: "8時間に及ぶ円熟した濃厚なセックスとエロポテンシャルが詰まった作品です。",
  sections: [
    {
      paragraphs: [
        "痴女として知られる彼女のベスト第6弾が登場しました。AVデビューから8周年を迎え、映画や舞台でも絶賛活躍中の彼女が魅せる最新12タイトルを収録しています。",
        OFJE_DROP_SENTENCE,
      ],
    },
  ],
};

describe("R130 mizd00312 — ベスト SEMANTIC realization", () => {
  it("KEEP sentence that uniquely realizes ベスト", () => {
    const r = resolveFactRealization(MIZD_DROP_SENTENCE, "ベスト");
    expect(isFactRealized(r.status)).toBe(true);

    const result = applyArticlePlanComplianceMutations({
      article: mizdArticle,
      articlePlan: mizdPlan,
    });

    expect(result.droppedSentences).not.toContain(MIZD_DROP_SENTENCE);
    expect(result.decisions.find((d) => d.sentence === MIZD_DROP_SENTENCE)?.decision).toBe(
      "KEEP",
    );
  });
});

describe("R130 ofje00230 — NTR SEMANTIC realization", () => {
  it("KEEP sentence when NTR is only body realization", () => {
    const r = resolveFactRealization(OFJE_DROP_SENTENCE, "NTR");
    expect(isFactRealized(r.status)).toBe(true);

    const result = applyArticlePlanComplianceMutations({
      article: ofjeArticle,
      articlePlan: ofjePlan,
    });

    expect(result.droppedSentences).not.toContain(OFJE_DROP_SENTENCE);
    expect(result.decisions.find((d) => d.sentence === OFJE_DROP_SENTENCE)?.decision).toBe(
      "KEEP",
    );
  });

  it("may DROP when NTR is already realized elsewhere in body", () => {
    const duplicate = {
      ...ofjeArticle,
      sections: [
        {
          paragraphs: [
            "痴女として知られる彼女のベスト第6弾が登場しました。NTRをテーマにした最新作も収録。",
            OFJE_DROP_SENTENCE,
          ],
        },
      ],
    };
    const result = applyArticlePlanComplianceMutations({
      article: duplicate,
      articlePlan: ofjePlan,
    });
    if (result.droppedSentences.includes(OFJE_DROP_SENTENCE)) {
      expect(validateArticlePlanCompliance({ article: result.article, articlePlan: ofjePlan }).ok).toBe(
        true,
      );
    }
  });
});

describe("R130 true completion-only", () => {
  it("DROP pad sentence with no planned fact realization when facts already covered", () => {
    const plan: ArticlePlan = {
      schemaVersion: 1,
      materialDepth: "standard",
      productTitle: "fixture",
      title: { job: "who_plus_core", facts: ["120分"] },
      lead: { job: "opening_facts", facts: ["120分"] },
      body: [
        {
          job: "body_facts",
          facts: ["性欲の化身と言っても過言ではないイキっぷりがダイナミックな小島みなみを限界突破させる究極のピストン作品"],
        },
      ],
    };
    const article = {
      title: "120分の作品",
      summary: "120分",
      lead: "120分にわたる濃密な時間。",
      sections: [
        {
          paragraphs: [
            "性欲の化身と言っても過言ではないイキっぷりがダイナミックな小島みなみを、限界突破させる究極のピストン作品です。",
            "見応えのある内容となっています。",
          ],
        },
      ],
    };
    const result = applyArticlePlanComplianceMutations({ article, articlePlan: plan });
    expect(result.droppedSentences.some((s) => s.includes("見応え"))).toBe(true);
    expect(validateArticlePlanCompliance({ article: result.article, articlePlan: plan }).ok).toBe(
      true,
    );
  });
});
