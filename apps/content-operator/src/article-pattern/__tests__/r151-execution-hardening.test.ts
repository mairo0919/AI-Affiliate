/**
 * R151 — ArticlePlan execution hardening (deterministic).
 */
import { describe, expect, it } from "vitest";
import {
  buildArticlePlanExecutionContract,
  deriveExecutionMode,
  deriveRequiredRelations,
  missingAnchorsInSentence,
  missingRelationsInSentence,
  toWriterExecutionContractView,
} from "../plan-execution-contract.js";
import { extractBalancedPunctuationSpans } from "../official-page-evidence-atoms.js";
import {
  balanceReaderFacingPunctuation,
  hasOrphanPairedPunctuation,
  repairBracketSplitPlanFacts,
} from "../punctuation-balance.js";
import { resolveFactRealization } from "../../editorial-brain/generation/plan-fact-matching.js";
import {
  buildArticlePlanViolationFeedback,
  buildStructuredPlanRegenViolations,
} from "../../editorial-brain/generation/plan-aware-generation.js";
import { validateArticlePlanCompliance } from "../../editorial-brain/generation/article-plan-compliance.js";
import { buildOptionBGenerationAuthority } from "../../generation/generation-authority.js";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import { skeletonFromMaterialProfile, ensureFeasibleWritingSkeleton } from "../skeleton-feasibility.js";
import { buildArticlePlan } from "../article-plan.js";
import { dualHostLeadCoversFacts } from "../performer-representation.js";

const CONTRASTIVE =
  "生徒と言えどチンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる";
const TAIL =
  "チンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる";

const PARA_TITLE =
  "★選りすぐりの「マン毛」を紹介するマン毛モロ出し写真館 優梨まいな";
const PARA_DESC =
  "★選りすぐりの「マン毛」を紹介するマン毛モロ出し写真館。パラダイステレビだからこそ収集できた「素晴らしいマン毛」を、学芸員の優梨まいなとましろ杏がスケベにご紹介◆パラダイステレビが収集したシ●ウト女性の「マン毛」を、当写真館の巨乳学芸員・優梨まいなとましろ杏、この2人と一緒に鑑賞しましょう◆コインランドリーでナンパした女子大生のマン毛、女性専門高級回春エステに通う女性のマン毛、催●術にかかった女性のマン毛、不倫中の団地妻など。";

describe("R151 ArticlePlan execution hardening", () => {
  describe("requiredRelations derivation", () => {
    it("CASE 1: 生徒と言えどX → CONTRAST", () => {
      expect(deriveRequiredRelations(CONTRASTIVE)).toContain("CONTRAST");
    });

    it("CASE 7: causal relation derived", () => {
      expect(deriveRequiredRelations("激しい刺激のため何度も絶頂する")).toContain("CAUSE");
    });

    it("CASE 8: comparison relation derived", () => {
      expect(deriveRequiredRelations("以前より激しい快感")).toContain("COMPARISON");
    });
  });

  describe("contrastive matching", () => {
    it("CASE 2: 生徒ではあるもののX → SEMANTIC", () => {
      const w = `生徒ではあるものの${TAIL}`;
      expect(resolveFactRealization(w, CONTRASTIVE).status).toBe("SEMANTIC");
      expect(missingRelationsInSentence(w, ["CONTRAST"])).toEqual([]);
    });

    it("CASE 3: 生徒である彼はX → NONE", () => {
      const w = `生徒である彼の${TAIL}`;
      expect(resolveFactRealization(w, CONTRASTIVE).status).toBe("NONE");
      expect(missingRelationsInSentence(w, ["CONTRAST"])).toEqual(["CONTRAST"]);
    });
  });

  describe("title execution", () => {
    it("CASE 4: title → EXACT_SURFACE", () => {
      expect(deriveExecutionMode("【長身美脚の一花先生に暴走中出し】", "title")).toBe(
        "EXACT_SURFACE",
      );
    });

    it("CASE 5: title paraphrase with new meaning fails compliance", () => {
      const plan = {
        schemaVersion: 1 as const,
        materialDepth: "standard" as const,
        productTitle: "【長身美脚の一花先生に暴走中出し】",
        title: { job: "who_plus_core", facts: ["【長身美脚の一花先生に暴走中出し】"] },
        lead: { job: "opening_facts", facts: ["一花を家まで送ってあげた男子生徒"] },
        body: [{ job: "body_facts", facts: [CONTRASTIVE] }],
      };
      const article = {
        title: "禁断の一夜だけの物語",
        summary: "",
        lead: "一花を家まで送ってあげた男子生徒",
        sections: [{ paragraphs: [`生徒ではあるものの${TAIL}`] }],
      };
      const compliance = validateArticlePlanCompliance({ article, articlePlan: plan });
      expect(
        compliance.findings.some(
          (f) => f.code === "PLAN_FACT_OMISSION" || f.code === "PLAN_UNPLANNED_MEANING",
        ),
      ).toBe(true);
      expect(deriveExecutionMode(plan.title.facts[0]!, "title")).toBe("EXACT_SURFACE");
    });

    it("CASE 6: quantity alteration → fail (anchor/quantity not realized)", () => {
      const fact = "50発射のノンストップ";
      expect(deriveRequiredRelations(fact)).toContain("QUANTITY");
      const writer = "3回だけ射精した";
      expect(missingAnchorsInSentence(writer, ["50発射"])).toContain("50発射");
      expect(deriveExecutionMode("50発射", "body")).toBe("EXACT_SURFACE");
    });

    it("CASE 9: performer name alteration → fail", () => {
      expect(resolveFactRealization("架空の女優が出演", "優梨まいな").status).toBe("NONE");
    });
  });

  describe("punctuation atomization", () => {
    it("CASE 10: balanced SOURCE bracket survives as atomic span", () => {
      const spans = extractBalancedPunctuationSpans(
        "【長身美脚の一花先生に暴走中出し】道で倒れている女教師",
      );
      expect(spans).toContain("【長身美脚の一花先生に暴走中出し】");
    });

    it("CASE 11: orphan bracket removed without content loss", () => {
      const balanced = balanceReaderFacingPunctuation(
        "【長身美脚の一花先生に暴走中出し",
        ["【長身美脚の一花先生に暴走中出し"],
      );
      expect(balanced).toBe("長身美脚の一花先生に暴走中出し");
      expect(hasOrphanPairedPunctuation(balanced)).toBe(false);
    });

    it("SOURCE-attested closing completes title", () => {
      const repaired = repairBracketSplitPlanFacts(
        ["【長身美脚の一花先生に暴走中出し"],
        "【長身美脚の一花先生に暴走中出し",
        ["【長身美脚の一花先生に暴走中出し】道で倒れている女教師"],
      );
      expect(repaired[0]).toBe("【長身美脚の一花先生に暴走中出し】");
    });
  });

  describe("regen structured correction", () => {
    const plan = {
      schemaVersion: 1 as const,
      materialDepth: "rich" as const,
      productTitle: "pred",
      title: { job: "who_plus_core", facts: ["【長身美脚の一花先生に暴走中出し】"] },
      lead: { job: "opening_facts", facts: ["一花を家まで送ってあげた男子生徒"] },
      body: [{ job: "body_facts", facts: [CONTRASTIVE] }],
    };

    it("CASE 12: regen receives missingRelations", () => {
      const article = {
        title: "【長身美脚の一花先生に暴走中出し】",
        summary: "",
        lead: "一花を家まで送ってあげた男子生徒",
        sections: [
          {
            paragraphs: [
              "生徒である彼のチンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる",
            ],
          },
        ],
      };
      const compliance = validateArticlePlanCompliance({ article, articlePlan: plan });
      const feedback = buildArticlePlanViolationFeedback(1, compliance, null, plan, {
        title: article.title,
        lead: article.lead,
        body: article.sections[0]!.paragraphs.join("\n"),
      });
      const v = feedback.violations?.find((x) => x.fact === CONTRASTIVE);
      expect(v?.missingRelations).toContain("CONTRAST");
    });

    it("CASE 13: regen receives missingAnchors when anchors absent", () => {
      const article = {
        title: "【長身美脚の一花先生に暴走中出し】",
        summary: "",
        lead: "一花を家まで送ってあげた男子生徒",
        sections: [{ paragraphs: ["まったく別の内容だけが書かれている。"] }],
      };
      const compliance = validateArticlePlanCompliance({ article, articlePlan: plan });
      const violations = buildStructuredPlanRegenViolations(plan, compliance, {
        title: article.title,
        lead: article.lead,
        body: article.sections[0]!.paragraphs.join("\n"),
      });
      const v = violations.find((x) => x.fact === CONTRASTIVE);
      expect(v).toBeTruthy();
      expect((v?.missingAnchors?.length ?? 0) + (v?.missingRelations?.length ?? 0)).toBeGreaterThan(
        0,
      );
    });
  });

  describe("execution contract modes", () => {
    it("CASE 14: FREE_CONNECTIVE only for empty/connective — body narrative is SEMANTIC_PRESERVE", () => {
      expect(deriveExecutionMode(CONTRASTIVE, "body")).toBe("SEMANTIC_PRESERVE");
      expect(deriveExecutionMode("優梨まいな", "lead")).toBe("EXACT_SURFACE");
    });

    it("Writer prompt includes ARTICLE_PLAN_EXECUTION", () => {
      const plan = {
        schemaVersion: 1,
        materialDepth: "standard",
        productTitle: "t",
        title: { job: "who_plus_core", facts: ["タイトル事実"] },
        lead: { job: "opening_facts", facts: ["リード事実"] },
        body: [{ job: "body_facts", facts: [CONTRASTIVE] }],
      };
      const execution = toWriterExecutionContractView(buildArticlePlanExecutionContract(plan));
      const auth = buildOptionBGenerationAuthority({
        articlePlan: plan,
        articlePlanExecution: execution,
      });
      const prompt = buildOptionBBloggerGeneratorPrompt({
        productTitle: "t",
        ctaUrl: "https://example.com",
        articleFormat: "NEW_RELEASE_SINGLE",
        generationAuthority: auth,
      });
      expect(prompt.userPrompt).toContain("ARTICLE_PLAN_EXECUTION");
      expect(prompt.userPrompt).toContain("CONTRAST");
      expect(prompt.userPrompt).toContain("EXACT_SURFACE");
    });
  });

  describe("regressions", () => {
    function pipeline(title: string, desc: string, actors: string[], cid: string) {
      const pack = buildEvidencePack({
        productTitle: title,
        claims: [{ id: "c0", statement: cid, status: "SUPPORTED" }],
        pageEvidenceMeta: {
          description: { text: desc, originField: "jsonld.Product.description" },
          actors,
        },
      });
      const profile = buildProductMaterialProfileFromPack(pack);
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
      return { pack, profile, plan };
    }

    it("CASE 15: catalog prose regression = 0", () => {
      const { plan } = pipeline(PARA_TITLE, PARA_DESC, ["優梨まいな", "ましろ杏"], "parathd03128");
      const all = [plan.title.facts, plan.lead.facts, ...plan.body.map((b) => b.facts)]
        .flat()
        .join(" ");
      expect(all).not.toMatch(/公式ページ|出演者として.*確認できる/);
    });

    it("CASE 16: dual_host regression", () => {
      const { plan, profile } = pipeline(
        PARA_TITLE,
        PARA_DESC,
        ["優梨まいな", "ましろ杏"],
        "parathd03128",
      );
      expect(profile.performerRepresentation.mode).toBe("dual_host");
      const bodyFacts = plan.body.flatMap((b) => b.facts);
      expect(dualHostLeadCoversFacts(bodyFacts, profile.performerRepresentation)).toBe(true);
      expect(plan.lead.facts).toEqual([]);
      expect(plan.title.facts.join(" ")).not.toMatch(/ましろ杏.*優梨|優梨.*ましろ杏/);
    });

    it("CASE 17: ensemble regression", () => {
      const title = "長身脚長バレー女子たちのガニ股天空杭打ち騎乗位ハーレム";
      const desc =
        "全員170cmオーバーのデカ女子4人身長差手コキ◆ロング美脚挟み撃ち腿コキからのガニ股騎乗位逆3P◆木下ひまり（花沢ひまり）◆辻井ほのか◆滝ゆいな◆堤セリナ";
      const { profile } = pipeline(title, desc, ["木下ひまり（花沢ひまり）", "辻井ほのか", "滝ゆいな", "堤セリナ"], "mird00250");
      expect(profile.performerRepresentation.mode).toBe("ensemble");
    });

    it("CASE 18: R136/R137 ofje-like concrete pool maintained", () => {
      const title = "奥田咲 エスワン全タイトル完全コンプリートBEST55コーナー8時間";
      const desc =
        "55コーナー収録◆追撃ピストンで何度もイカせる◆奥田咲の魅力を凝縮したベスト";
      const { plan } = pipeline(title, desc, ["奥田咲"], "ofje00230");
      const facts = [plan.title.facts, plan.lead.facts, ...plan.body.map((b) => b.facts)]
        .flat()
        .join(" ");
      expect(facts.length).toBeGreaterThan(0);
      expect(facts).not.toMatch(/公式ページ上で確認できる/);
    });
  });
});
