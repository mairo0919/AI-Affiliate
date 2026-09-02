/**
 * R150 — Plan execution reliability + dual-host title eligibility.
 */
import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import { skeletonFromMaterialProfile, ensureFeasibleWritingSkeleton } from "../skeleton-feasibility.js";
import { buildArticlePlan } from "../article-plan.js";
import {
  buildPerformerRepresentation,
  dualHostLeadCoversFacts,
} from "../performer-representation.js";
import {
  isSourceAttestedCombinedTitle,
  isRepresentationDerivedTitleCandidate,
  isTitleEligibleFact,
  repairBracketSplitPlanFacts,
} from "../title-eligibility.js";
import { isUnsafeTitleExecutionTarget } from "../writer-evidence-filter.js";
import {
  buildArticlePlanViolationFeedback,
  buildPlanViolationRegenNote,
} from "../../editorial-brain/generation/plan-aware-generation.js";
import { validateArticlePlanCompliance } from "../../editorial-brain/generation/article-plan-compliance.js";
import { resolveFactRealization } from "../../editorial-brain/generation/plan-fact-matching.js";

const PARA_TITLE =
  "★選りすぐりの「マン毛」を紹介するマン毛モロ出し写真館 優梨まいな";
const PARA_DESC =
  "★選りすぐりの「マン毛」を紹介するマン毛モロ出し写真館。パラダイステレビだからこそ収集できた「素晴らしいマン毛」を、学芸員の優梨まいなとましろ杏がスケベにご紹介◆パラダイステレビが収集したシ●ウト女性の「マン毛」を、当写真館の巨乳学芸員・優梨まいなとましろ杏、この2人と一緒に鑑賞しましょう◆コインランドリーでナンパした女子大生のマン毛、女性専門高級回春エステに通う女性のマン毛、催●術にかかった女性のマン毛、不倫中の団地妻など。";

const PRED_TITLE = "【長身美脚の一花先生に暴走中出し";
const PRED_NARRATIVE =
  "一花を家まで送ってあげた男子生徒は憧れの先生の無防備な姿と2人きりの空間に我慢ができず性欲暴走";
const PRED_DESC = `${PRED_NARRATIVE}◆念願の美脚を舐めしゃぶりまくって中出しセックス◆生徒と言えどチンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる`;

const CONTRASTIVE_BODY =
  "生徒と言えどチンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる";

const predRegenPlan = {
  schemaVersion: 1 as const,
  materialDepth: "rich" as const,
  productTitle: PRED_TITLE,
  title: { job: "who_plus_core", facts: [PRED_TITLE] },
  lead: {
    job: "opening_facts",
    facts: [PRED_NARRATIVE, PRED_TITLE],
  },
  body: [
    {
      job: "body_facts",
      facts: ["念願の美脚を舐めしゃぶりまくって中出しセックス", CONTRASTIVE_BODY],
    },
  ],
};

const PARA_BODY_THEME = "★選りすぐりの「マン毛」をマン毛モロ出し写真館";

function parathdPipeline() {
  const pack = buildEvidencePack({
    productTitle: PARA_TITLE,
    claims: [{ id: "c0", statement: "parathd03128", status: "SUPPORTED" }],
    pageEvidenceMeta: {
      description: { text: PARA_DESC, originField: "jsonld.Product.description" },
      actors: ["優梨まいな", "ましろ杏"],
    },
  });
  const profile = buildProductMaterialProfileFromPack(pack);
  const feas = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack,
    profile,
  });
  const plan = buildArticlePlan({
    productTitle: PARA_TITLE,
    pack,
    assignment: feas.assignment,
    materialDepth: profile.materialDepth,
    profile,
  });
  return { pack, profile, feas, plan };
}

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
  const plan = buildArticlePlan({
    productTitle: PRED_TITLE,
    pack,
    assignment: feas.assignment,
    materialDepth: profile.materialDepth,
    profile,
  });
  return { pack, profile, feas, plan };
}

describe("R150 plan execution reliability", () => {
  describe("title eligibility invariant", () => {
    it("CASE 1: dual_host + official title 1 name — combinedLabel not title-eligible", () => {
      const { profile } = parathdPipeline();
      const rep = profile.performerRepresentation;
      expect(rep.combinedLabel).toBe("優梨まいなとましろ杏");
      expect(isRepresentationDerivedTitleCandidate(rep.combinedLabel!, rep, PARA_TITLE)).toBe(true);
      expect(isTitleEligibleFact(rep.combinedLabel!, { productTitle: PARA_TITLE, rep })).toBe(false);
    });

    it("CASE 2: dual_host + SOURCE title attests both names — combined title allowed", () => {
      const combinedTitle = "優梨まいなとましろ杏のマン毛写真館";
      const rep = buildPerformerRepresentation({
        entities: [
          {
            normalizedName: "優梨まいな",
            displayName: "優梨まいな",
            source: "page_actors_metadata",
            sourceIndex: 0,
            sourceId: "a0",
            fromOfficialMetadata: true,
            inProductTitle: true,
            inDescription: true,
          },
          {
            normalizedName: "ましろ杏",
            displayName: "ましろ杏",
            source: "page_actors_metadata",
            sourceIndex: 1,
            sourceId: "a1",
            fromOfficialMetadata: true,
            inProductTitle: true,
            inDescription: true,
          },
        ],
        productTitle: combinedTitle,
        descriptionText: PARA_DESC,
      });
      expect(isSourceAttestedCombinedTitle(combinedTitle, rep.combinedLabel!)).toBe(true);
      expect(isTitleEligibleFact(rep.combinedLabel!, { productTitle: combinedTitle, rep })).toBe(true);
    });

    it("CASE 3: combinedLabel usable in body — dual_host coverage after leadless rewiring", () => {
      const { plan, profile } = parathdPipeline();
      const bodyFacts = plan.body.flatMap((b) => b.facts);
      expect(dualHostLeadCoversFacts(bodyFacts, profile.performerRepresentation)).toBe(true);
      expect(bodyFacts.some((f) => f.includes("優梨まいな") && f.includes("ましろ杏"))).toBe(true);
      expect(plan.lead.facts).toEqual([]);
    });

    it("CASE 4: pred title-safe candidate maintained", () => {
      const { plan } = predPipeline();
      expect(plan.title.facts.some(isUnsafeTitleExecutionTarget)).toBe(false);
      expect(plan.title.facts.join(" ")).toMatch(/長身美脚|一花先生|暴走中出し/);
    });

    it("CASE 5: pred long narrative does not return to title", () => {
      const { plan } = predPipeline();
      expect(plan.title.facts.join(" ")).not.toMatch(/男子生徒|我慢ができず/);
      expect(plan.title.facts[0]).not.toBe(PRED_NARRATIVE);
    });
  });

  describe("parathd03128 ArticlePlan", () => {
    it("title uses SOURCE-attested single name, not combinedLabel", () => {
      const { plan } = parathdPipeline();
      expect(plan.title.facts.join(" ")).not.toMatch(/ましろ杏.*優梨|優梨.*ましろ杏/);
      expect(plan.title.facts.some((f) => f.includes("優梨まいな"))).toBe(true);
    });

    it("CASE 10: catalog confirmation prose absent from title/body", () => {
      const { plan } = parathdPipeline();
      const all = [plan.title.facts, ...plan.body.map((b) => b.facts)].flat().join(" ");
      expect(all).not.toMatch(/公式ページ|出演者として.*確認できる/);
    });
  });

  describe("pred00700 lead bracket repair", () => {
    it("CASE 6: bracket-split fragments merge to SOURCE-balanced title", () => {
      const repaired = repairBracketSplitPlanFacts(
        ["【長身美脚の一花先生に暴走中出し", "】道で倒れている女教師"],
        PRED_TITLE,
        ["】道で倒れている女教師"],
      );
      expect(repaired).toEqual(["【長身美脚の一花先生に暴走中出し】"]);
    });

    it("contrastive body fact — である彼 drift is NONE (regen path)", () => {
      const writerSurface =
        "生徒である彼のチンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる";
      const result = resolveFactRealization(writerSurface, CONTRASTIVE_BODY);
      expect(result.status).toBe("NONE");
    });
  });

  describe("parathd body fact paraphrase", () => {
    it("CASE — parathd theme paraphrase recognized", () => {
      const writerSurface =
        "選りすぐりの「マン毛」をモロ出しで紹介する特別な写真館";
      const result = resolveFactRealization(writerSurface, PARA_BODY_THEME);
      expect(["EXACT", "SEMANTIC"]).toContain(result.status);
    });
  });

  describe("R141 regen wiring", () => {
    it("CASE 7: missing fact + slot passed to attempt 2", () => {
      const article = {
        title: PRED_TITLE,
        summary: "",
        lead: PRED_NARRATIVE,
        sections: [{ paragraphs: ["念願の美脚を舐めしゃぶりまくって中出しセックス。"] }],
      };
      const compliance = validateArticlePlanCompliance({ article, articlePlan: predRegenPlan });
      const feedback = buildArticlePlanViolationFeedback(1, compliance, null, predRegenPlan);
      expect(feedback.violations?.some((v) => v.fact === CONTRASTIVE_BODY)).toBe(true);
      expect(feedback.violations?.find((v) => v.fact === CONTRASTIVE_BODY)?.slot).toBe("body");
    });

    it("CASE 8: contrastive regen instruction when fact contains 言えど", () => {
      const article = {
        title: PRED_TITLE,
        summary: "",
        lead: PRED_NARRATIVE,
        sections: [{ paragraphs: ["念願の美脚を舐めしゃぶりまくって中出しセックス。"] }],
      };
      const compliance = validateArticlePlanCompliance({ article, articlePlan: predRegenPlan });
      const feedback = buildArticlePlanViolationFeedback(1, compliance, null, predRegenPlan);
      const note = JSON.parse(buildPlanViolationRegenNote(feedback));
      expect(note.instruction).toMatch(/言えど/);
      expect(note.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fact: CONTRASTIVE_BODY, code: "PLAN_FACT_OMISSION" }),
        ]),
      );
    });
  });

  describe("unplanned meaning guard", () => {
    it("CASE 9: Writer surface with unplanned title fails compliance", () => {
      const article = {
        title: "長身美脚の一花先生との禁断の一夜",
        summary: "",
        lead: PRED_NARRATIVE,
        sections: [
          {
            paragraphs: [
              "念願の美脚を舐めしゃぶりまくって中出しセックス。生徒である彼のチンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる。",
            ],
          },
        ],
      };
      const compliance = validateArticlePlanCompliance({ article, articlePlan: predRegenPlan });
      expect(compliance.findings.some((f) => f.code === "PLAN_FACT_OMISSION")).toBe(true);
    });
  });

  describe("regression — single / ensemble / collection", () => {
    it("CASE 11: single performer unchanged", () => {
      const title = "松本いちか 10作品ベスト";
      const pack = buildEvidencePack({
        productTitle: title,
        claims: [{ id: "c0", statement: "mizd00320", status: "SUPPORTED" }],
        pageEvidenceMeta: { actors: ["松本いちか"] },
      });
      const profile = buildProductMaterialProfileFromPack(pack);
      expect(profile.performerRepresentation.mode).toBe("single");
      const feas = ensureFeasibleWritingSkeleton({
        skeleton: skeletonFromMaterialProfile(profile),
        pack,
        profile,
      });
      const plan = buildArticlePlan({
        productTitle: title,
        pack,
        assignment: feas.assignment,
        materialDepth: profile.materialDepth,
        profile,
      });
      expect(plan.title.facts.length).toBeGreaterThan(0);
    });

    it("CASE 12: ensemble — no dual_host combinedLabel in title", () => {
      const title = "長身脚長バレー女子たちのガニ股天空杭打ち騎乗位ハーレム";
      const desc =
        "全員170cmオーバーのデカ女子4人身長差手コキ◆ロング美脚挟み撃ち腿コキからのガニ股騎乗位逆3P◆木下ひまり（花沢ひまり）◆辻井ほのか◆滝ゆいな◆堤セリナ";
      const pack = buildEvidencePack({
        productTitle: title,
        claims: [{ id: "c0", statement: "mird00250", status: "SUPPORTED" }],
        pageEvidenceMeta: {
          description: { text: desc, originField: "jsonld.Product.description" },
          actors: ["木下ひまり（花沢ひまり）", "辻井ほのか", "滝ゆいな", "堤セリナ"],
        },
      });
      const profile = buildProductMaterialProfileFromPack(pack);
      expect(profile.performerRepresentation.mode).toBe("ensemble");
      const feas = ensureFeasibleWritingSkeleton({
        skeleton: skeletonFromMaterialProfile(profile),
        pack,
        profile,
      });
      const plan = buildArticlePlan({
        productTitle: title,
        pack,
        assignment: feas.assignment,
        materialDepth: profile.materialDepth,
        profile,
      });
      expect(plan.title.facts.join(" ")).not.toMatch(/木下.*辻井.*滝.*堤/);
    });
  });
});
