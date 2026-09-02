/**
 * Quality route fixes: natural title facts, theme overreach, unsupported eval residue.
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
import { buildArticlePlanExecutionContract } from "../plan-execution-contract.js";
import {
  hasShortThemeSemanticOverreach,
  hasUnsupportedEvaluativeResidue,
} from "../plan-surface-attestation.js";
import { validateArticlePlanCompliance } from "../../editorial-brain/generation/article-plan-compliance.js";
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
  const plan = buildArticlePlan({
    productTitle: "ofje00230",
    pack,
    assignment: feas.assignment,
    materialDepth: profile.materialDepth,
    profile,
  });
  return { plan, pack, profile };
}

describe("quality route — title / theme / eval", () => {
  it("ofje title prefers identity/collection over bare theme keyword concat", () => {
    const { plan } = ofjePlan();
    expect(plan.title.facts[0]).toBe("奥田咲");
    expect(plan.title.facts.some((f) => /ベスト第?6弾|エスワン/.test(f))).toBe(true);
    // Theme tags remain eligible in body; title must not be keyword-only list.
    const titleJoined = plan.title.facts.join(" ");
    expect(titleJoined).not.toBe("奥田咲 人妻 痴女");
    // Same product-form meaning must not duplicate as ベスト + ベスト第6弾.
    const formHits = plan.title.facts.filter((f) => /ベスト/u.test(f));
    expect(formHits.length).toBeLessThanOrEqual(1);
    expect(plan.body.flatMap((b) => b.facts).some((f) => /人妻|痴女/u.test(f))).toBe(
      true,
    );
  });

  it("mizd best title avoids redundant ベスト+時間ベスト form pair", () => {
    const pe = {
      description: {
        text:
          "キュートでエッチでちょっと生意気な令和イチのメスガキ！松本いちかのMOODYZベスト第2弾！メスガキわからせ、絶対空域、ギャル妹、小悪魔痴女etc.いっちゃんの魅力が詰まった10作品！痴女誘惑でもお仕置きレ●プでもエチえち可愛い厳選の22本番！超可愛いお顔と大人をバカにした表情のデカ尻にビタビタ激ピスSEX！480分の大ボリュームで45射精！最強の天使な小悪魔、松本いちかの本気をみさらせや！",
      },
      actors: ["松本いちか"],
    } as PageEvidenceMetaShape;
    const statements = claimStatementsFromPageEvidence({
      pageEvidenceMeta: pe,
      productTitle: "令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト",
      actors: pe.actors,
    });
    const pack = buildEvidencePack({
      productTitle: "令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト",
      claims: statements.slice(0, 12).map((s, i) => ({
        id: `c${i}`,
        statement: s,
        status: "SUPPORTED" as const,
        kind: null,
      })),
      pageEvidenceMeta: pe,
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const feas = ensureFeasibleWritingSkeleton({
      skeleton: skeletonFromMaterialProfile(profile),
      pack,
      profile,
    });
    const plan = buildArticlePlan({
      productTitle: "令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト",
      pack,
      assignment: feas.assignment,
      materialDepth: profile.materialDepth,
      profile,
    });
    expect(plan.title.facts).toContain("松本いちか");
    expect(plan.title.facts).not.toEqual(["松本いちか", "ベスト", "時間ベスト"]);
    const formHits = plan.title.facts.filter((f) => /ベスト/u.test(f));
    expect(formHits.length).toBeLessThanOrEqual(1);
    expect(
      plan.title.facts.some((f) => /MOODYZベスト第2弾|わからせ痴女られ10作品8時間ベスト|ベスト第2弾/u.test(f)),
    ).toBe(true);
  });

  it("ssis title does not stay performer+duration when work-form compact exists", () => {
    const pe = {
      description: {
        text:
          "性欲の化身と言っても過言ではないイキっぷりがダイナミックな小島みなみを限界突破させる究極のピストン作品！膣奥をエグる猛烈ハードピストンでエビ反り絶頂！イッても止めずの追撃ピストンで快感飽和状態になりビックンガックン大痙攣オーガズム！そのままトドメの追い込みピストンで脱水症状限界まで快感潮を大量失禁！小島みなみの華奢スレンダーボディがぶっ壊れるほど仰け反りまくる120分ノーカットぶっ通しFUCK！",
      },
      actors: ["小島みなみ"],
    } as PageEvidenceMetaShape;
    const statements = claimStatementsFromPageEvidence({
      pageEvidenceMeta: pe,
      productTitle: "ssis00700",
      actors: pe.actors,
    });
    const pack = buildEvidencePack({
      productTitle: "ssis00700",
      claims: statements.slice(0, 8).map((s, i) => ({
        id: `c${i}`,
        statement: s,
        status: "SUPPORTED" as const,
        kind: null,
      })),
      pageEvidenceMeta: pe,
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const feas = ensureFeasibleWritingSkeleton({
      skeleton: skeletonFromMaterialProfile(profile),
      pack,
      profile,
    });
    const plan = buildArticlePlan({
      productTitle: "ssis00700",
      pack,
      assignment: feas.assignment,
      materialDepth: profile.materialDepth,
      profile,
    });
    expect(plan.title.facts).toContain("小島みなみ");
    expect(plan.title.facts).not.toEqual(["小島みなみ", "120分"]);
    expect(plan.title.facts.some((f) => /ピストン作品|120分/.test(f))).toBe(true);
    expect(plan.title.facts.some((f) => /ピストン作品/.test(f))).toBe(true);
  });

  it("short theme EXEC forbids genre-knowledge psychology expansion", () => {
    const { plan } = ofjePlan();
    const exec = buildArticlePlanExecutionContract(plan);
    const theme = exec.find(
      (t) =>
        t.fact === "NTR" ||
        t.fact === "人妻" ||
        /人妻.*NTR|NTR.*痴女/u.test(t.fact),
    );
    expect(theme).toBeTruthy();
    // Bare theme tags get membership-only notAllowed; compound variety lists stay SEMANTIC_PRESERVE.
    if ((theme!.fact === "NTR" || theme!.fact === "人妻") && theme!.fact.length <= 4) {
      expect(theme!.executionMode).toBe("SEMANTIC_PRESERVE");
      expect(theme!.notAllowed.some((x) => /emotion|psychology|genre-knowledge/i.test(x))).toBe(
        true,
      );
    } else {
      expect(theme!.executionMode).toBe("SEMANTIC_PRESERVE");
    }
  });

  it("detects short-theme semantic overreach vs membership-only", () => {
    const planFacts = ["NTR", "人妻", "奥田咲"];
    expect(
      hasShortThemeSemanticOverreach(
        "また、NTR要素も含まれており、人妻としての複雑な感情や役柄が描かれています。",
        planFacts,
      ),
    ).toBe(true);
    expect(hasShortThemeSemanticOverreach("本作には人妻やNTR要素も含まれています。", planFacts)).toBe(
      false,
    );
  });

  it("detects unsupported evaluative residue via plan attestation", () => {
    const planFacts = [
      "星宮一花",
      "一花を家まで送ってあげた男子生徒は憧れの先生の無防備な姿と2人きりの空間に我慢ができず性欲暴走",
    ];
    expect(
      hasUnsupportedEvaluativeResidue(
        "主演の星宮一花が演じる先生への情熱的なアプローチが見どころとなっています。",
        planFacts,
      ),
    ).toBe(true);
    expect(
      hasUnsupportedEvaluativeResidue(
        "一花を家まで送ってあげた男子生徒は憧れの先生の無防備な姿と2人きりの空間に我慢ができず性欲暴走する。",
        planFacts,
      ),
    ).toBe(false);
    // Natural product prose with 魅力 inside attested SOURCE phrasing must not trip eval frame.
    expect(
      hasUnsupportedEvaluativeResidue(
        "低身長なのにグラマラスボディが魅力の奥田咲が出演するベストです。",
        ["奥田咲", "低身長", "グラマラスボディが魅力", "エスワンベスト第6弾"],
      ),
    ).toBe(false);
  });

  it("compliance BLOCKS theme overreach and unsupported eval (no prose repair on path)", () => {
    const plan = {
      schemaVersion: 1 as const,
      materialDepth: "standard" as const,
      productTitle: "ofje",
      title: { job: "who_plus_core", facts: ["奥田咲"] },
      lead: { job: "opening_facts", facts: [] },
      body: [{ job: "body_facts", facts: ["NTR", "人妻", "8時間"] }],
    };
    const overreach = validateArticlePlanCompliance({
      article: {
        title: "奥田咲",
        summary: "",
        sections: [
          {
            paragraphs: [
              "8時間の作品です。",
              "また、NTR要素も含まれており、人妻としての複雑な感情や役柄が描かれています。",
            ],
          },
        ],
      },
      articlePlan: plan,
    });
    expect(overreach.findings.some((f) => f.code === "PLAN_THEME_OVERREACH")).toBe(true);
    expect(overreach.ok).toBe(false);

    const evalHit = validateArticlePlanCompliance({
      article: {
        title: "奥田咲",
        summary: "",
        sections: [
          {
            paragraphs: [
              "8時間の作品です。人妻やNTR要素も含まれています。",
              "情熱的なアプローチが見どころとなっています。",
            ],
          },
        ],
      },
      articlePlan: plan,
    });
    const evalFinding = evalHit.findings.find((f) => f.code === "PLAN_UNSUPPORTED_EVAL");
    expect(evalFinding?.severity).toBe("BLOCKING");
    expect(evalHit.ok).toBe(false);
  });

  it("Writer policy states natural title + short-theme membership boundary", () => {
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/space-separated keyword list/);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/membership or recorded variety/);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/TERMINATION|hard stop/i);
  });
});
