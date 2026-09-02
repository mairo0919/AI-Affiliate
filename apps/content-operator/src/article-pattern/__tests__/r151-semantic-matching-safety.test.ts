/**
 * R151 — Semantic matching safety + bracket punctuation audit.
 */
import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import { skeletonFromMaterialProfile, ensureFeasibleWritingSkeleton } from "../skeleton-feasibility.js";
import { buildArticlePlan } from "../article-plan.js";
import {
  balanceReaderFacingPunctuation,
  hasOrphanPairedPunctuation,
  repairBracketSplitPlanFacts,
} from "../punctuation-balance.js";
import {
  factRequiresConcessiveRelation,
  matchCatalogVenueThemeProposition,
  matchConcessiveProposition,
  SEMANTIC_DIMENSION_POLICY,
} from "../../editorial-brain/generation/semantic-proposition.js";
import { resolveFactRealization, paraphraseHit } from "../../editorial-brain/generation/plan-fact-matching.js";

const PRED_TITLE = "【長身美脚の一花先生に暴走中出し";
const PRED_TITLE_BALANCED = "【長身美脚の一花先生に暴走中出し】";
const PRED_DESC =
  "【長身美脚の一花先生に暴走中出し】道で倒れている女教師◆一花を家まで送ってあげた男子生徒は憧れの先生の無防備な姿と2人きりの空間に我慢ができず性欲暴走◆念願の美脚を舐めしゃぶりまくって中出しセックス◆生徒と言えどチンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる";

const CONTRASTIVE =
  "生徒と言えどチンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる";

const TAIL =
  "チンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる";

const PARA_BODY_THEME = "★選りすぐりの「マン毛」をマン毛モロ出し写真館";

function predPlan() {
  const pack = buildEvidencePack({
    productTitle: PRED_TITLE,
    claims: [{ id: "c0", statement: "pred00700", status: "SUPPORTED" }],
    pageEvidenceMeta: {
      description: { text: PRED_DESC, originField: "jsonld.Product.description" },
      actors: ["星宮一花"],
    },
  });
  const profile = buildProductMaterialProfileFromPack(pack);
  const feas = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack,
    profile,
  });
  return buildArticlePlan({
    productTitle: PRED_TITLE,
    pack,
    assignment: feas.assignment,
    materialDepth: profile.materialDepth,
    profile,
  });
}

describe("R151 semantic matching safety", () => {
  describe("semantic dimension policy", () => {
    it("documents required-dimension rule", () => {
      expect(SEMANTIC_DIMENSION_POLICY.dimensions).toContain("contrast");
      expect(SEMANTIC_DIMENSION_POLICY.forbiddenExamples.length).toBeGreaterThan(0);
    });
  });

  describe("contrastive match matrix", () => {
    const plan = `生徒と言えど${TAIL}`;

    it("A — EXACT: 生徒と言えどX", () => {
      const sentence = plan;
      expect(matchConcessiveProposition(sentence, plan)).toBe("EXACT");
      expect(resolveFactRealization(sentence, plan).status).toBe("EXACT");
    });

    it("B — SEMANTIC candidate: 生徒ではあるもののX", () => {
      const sentence = `生徒ではあるものの${TAIL}`;
      expect(matchConcessiveProposition(sentence, plan)).toBe("SEMANTIC");
      expect(resolveFactRealization(sentence, plan).status).toBe("SEMANTIC");
    });

    it("B2 — SEMANTIC: 生徒であるにもかかわらずX", () => {
      const sentence = `生徒であるにもかかわらず、${TAIL}`;
      expect(matchConcessiveProposition(sentence, plan)).toBe("SEMANTIC");
      expect(resolveFactRealization(sentence, plan).status).toBe("SEMANTIC");
    });

    it("C — NONE: 生徒である彼はX (contrast lost)", () => {
      const sentence = `生徒である彼の${TAIL}`;
      expect(matchConcessiveProposition(sentence, plan)).toBeNull();
      expect(paraphraseHit(sentence, plan)).toBe(false);
      expect(resolveFactRealization(sentence, plan).status).toBe("NONE");
    });

    it("D — NONE: 生徒なのでX (causal shift)", () => {
      const sentence = `生徒なので${TAIL}`;
      expect(matchConcessiveProposition(sentence, plan)).toBeNull();
      expect(resolveFactRealization(sentence, plan).status).toBe("NONE");
    });

    it("E — 生徒でもX: no automatic PASS without concessive relation", () => {
      const sentence = `生徒でも${TAIL}`;
      expect(matchConcessiveProposition(sentence, plan)).toBeNull();
    });

    it("F — NONE: 彼はX (subject drop + no contrast)", () => {
      const sentence = `彼は${TAIL}`;
      expect(matchConcessiveProposition(sentence, plan)).toBeNull();
      expect(resolveFactRealization(sentence, plan).status).toBe("NONE");
    });

    it("pred production drift 生徒である彼 → NONE (R150 unsafe rule reverted)", () => {
      const writer =
        "生徒である彼のチンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる";
      expect(factRequiresConcessiveRelation(CONTRASTIVE)).toBe(true);
      expect(resolveFactRealization(writer, CONTRASTIVE).status).toBe("NONE");
    });
  });

  describe("parathd catalog venue theme", () => {
    it("core proposition preserved — SEMANTIC", () => {
      const writer = "選りすぐりの「マン毛」をモロ出しで紹介する特別な写真館";
      expect(matchCatalogVenueThemeProposition(writer, PARA_BODY_THEME)).toBe(true);
      expect(resolveFactRealization(writer, PARA_BODY_THEME).status).toMatch(/EXACT|SEMANTIC/);
    });

    it("特別な is not part of fact matching — embellishment is separate", () => {
      const writer = "選りすぐりの「マン毛」をモロ出しで紹介する特別な写真館";
      expect(PARA_BODY_THEME.includes("特別")).toBe(false);
      expect(writer.includes("特別な")).toBe(true);
      expect(matchCatalogVenueThemeProposition(writer, PARA_BODY_THEME)).toBe(true);
    });
  });

  describe("no CID string hardcode in paraphraseHit", () => {
    it("generic concessive fact works without pred CID tokens", () => {
      const genericPlan = "教師と言えど現場では厳しい指導を続ける";
      const genericWriter = "教師ではあるものの現場では厳しい指導を続ける";
      expect(matchConcessiveProposition(genericWriter, genericPlan)).toBe("SEMANTIC");
    });
  });
});

describe("R151 bracket punctuation", () => {
  it("closes 【 when SOURCE has adjacent 】 shard", () => {
    const repaired = repairBracketSplitPlanFacts(
      ["【長身美脚の一花先生に暴走中出し", "】道で倒れている女教師"],
      PRED_TITLE,
      ["】道で倒れている女教師"],
    );
    expect(repaired).toEqual([PRED_TITLE_BALANCED]);
    expect(hasOrphanPairedPunctuation(repaired[0]!)).toBe(false);
  });

  it("strips orphan 【 when closing not SOURCE-attested", () => {
    const balanced = balanceReaderFacingPunctuation(PRED_TITLE, [PRED_TITLE]);
    expect(balanced).toBe("長身美脚の一花先生に暴走中出し");
    expect(hasOrphanPairedPunctuation(balanced)).toBe(false);
  });

  it("pred ArticlePlan title is bracket-balanced when SOURCE shard exists", () => {
    const plan = predPlan();
    expect(plan.title.facts[0]).toBe(PRED_TITLE_BALANCED);
    expect(hasOrphanPairedPunctuation(plan.title.facts[0]!)).toBe(false);
  });
});
