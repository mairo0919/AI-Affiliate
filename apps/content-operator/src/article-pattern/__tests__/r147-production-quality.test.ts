/**
 * R147 — production quality consolidation (deterministic).
 */
import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import { skeletonFromMaterialProfile, ensureFeasibleWritingSkeleton } from "../skeleton-feasibility.js";
import { buildArticlePlan } from "../article-plan.js";
import {
  buildPerformerRepresentation,
  representationLeadCoversFacts,
  resolveRepresentationLeadFact,
  sourceRosterCoversFacts,
} from "../performer-representation.js";
import {
  isTitleSafeExecutionTarget,
  isUnsafeTitleExecutionTarget,
} from "../writer-evidence-filter.js";
import { fillOptionBArticleDefaults } from "../../generation/structured-article.js";

const PRED_TITLE = "【長身美脚の一花先生に暴走中出し";
const PRED_NARRATIVE =
  "一花を家まで送ってあげた男子生徒は憧れの先生の無防備な姿と2人きりの空間に我慢ができず性欲暴走";
const PRED_DESC = `${PRED_NARRATIVE}◆念願の美脚を舐めしゃぶりまくって中出しセックス◆生徒と言えどチンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる`;

function predPipeline() {
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

describe("R147 production quality", () => {
  describe("title fact shape (pred00700)", () => {
    it("flags causal narrative as unsafe title target", () => {
      expect(isUnsafeTitleExecutionTarget(PRED_NARRATIVE)).toBe(true);
      expect(isTitleSafeExecutionTarget(PRED_TITLE)).toBe(true);
    });

    it("AFTER — title uses SOURCE title-safe facet, not causal narrative", () => {
      const plan = predPipeline();
      expect(plan.title.facts.some(isUnsafeTitleExecutionTarget)).toBe(false);
      expect(plan.title.facts.join(" ")).toMatch(/長身美脚|一花先生|暴走中出し/);
      expect(plan.title.facts.join(" ")).not.toMatch(/男子生徒|我慢ができず/);
      // Narrative clause remains SOURCE-available in pack for lead/body when page atoms include it (r137 full DESC).
      expect(plan.title.facts[0]).not.toBe(PRED_NARRATIVE);
    });
  });

  describe("roster policy — SOURCE-supported, not headcount prohibition", () => {
    it("allows full SOURCE roster in lead when all names present", () => {
      const entities = ["Alpha", "Beta", "Gamma"].map((name, i) => ({
        normalizedName: name,
        displayName: name,
        source: "page_actors_metadata" as const,
        sourceIndex: i,
        sourceId: `a${i}`,
        fromOfficialMetadata: true,
        inProductTitle: false,
        inDescription: true,
      }));
      const rep = buildPerformerRepresentation({
        entities,
        productTitle: "共演",
        descriptionText: "Alpha、Beta、Gammaの3人が豪華共演。",
      });
      expect(["unknown_multi", "ensemble"]).toContain(rep.mode);
      const leadFacts = ["Alpha、Beta、Gammaの3人が豪華共演"];
      expect(sourceRosterCoversFacts(leadFacts, rep)).toBe(true);
      expect(representationLeadCoversFacts(leadFacts, rep)).toBe(true);
    });

    it("does not force neutral label when SOURCE combined roster exists in pack", () => {
      const entities = ["Alpha", "Beta", "Gamma"].map((name, i) => ({
        normalizedName: name,
        displayName: name,
        source: "page_actors_metadata" as const,
        sourceIndex: i,
        sourceId: `a${i}`,
        fromOfficialMetadata: true,
        inProductTitle: false,
        inDescription: true,
      }));
      const rep = buildPerformerRepresentation({
        entities,
        productTitle: "共演",
        descriptionText: "Alpha、Beta、Gammaの3人が豪華共演。",
      });
      const fact = resolveRepresentationLeadFact(rep, [
        { fact: "Alpha、Beta、Gammaの3人が豪華共演" },
      ]);
      expect(fact).toBe("Alpha、Beta、Gammaの3人が豪華共演");
      expect(fact).not.toBe("3名が出演");
    });
  });

  describe("lead/summary duplication root (fillOptionBArticleDefaults)", () => {
    it("summary must not copy lead verbatim when LLM omits summary", () => {
      const lead =
        "8時間の映像に55のコーナーを収録した充実の内容でお届けします。";
      const filled = fillOptionBArticleDefaults({
        title: "8時間にわたる濃密な魅力の集大成",
        lead,
        sections: [{ paragraphs: ["body"] }],
      });
      expect(filled.summary).not.toBe(lead);
      expect(filled.summary).toBe("8時間にわたる濃密な魅力の集大成");
    });
  });
});
