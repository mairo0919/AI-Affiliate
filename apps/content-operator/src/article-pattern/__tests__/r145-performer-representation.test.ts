/**
 * R145 — performer representation + DUAL_HOST lead correction.
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

const PARA_TITLE =
  "★選りすぐりの「マン毛」を紹介するマン毛モロ出し写真館 優梨まいな";
const PARA_DESC =
  "★選りすぐりの「マン毛」を紹介するマン毛モロ出し写真館。パラダイステレビだからこそ収集できた「素晴らしいマン毛」を、学芸員の優梨まいなとましろ杏がスケベにご紹介◆パラダイステレビが収集したシ●ウト女性の「マン毛」を、当写真館の巨乳学芸員・優梨まいなとましろ杏、この2人と一緒に鑑賞しましょう◆コインランドリーでナンパした女子大生のマン毛、女性専門高級回春エステに通う女性のマン毛、催●術にかかった女性のマン毛、不倫中の団地妻など。";

const MIRD250_TITLE = "長身脚長バレー女子たちのガニ股天空杭打ち騎乗位ハーレム";
const MIRD250_DESC =
  "全員170cmオーバーのデカ女子4人身長差手コキ◆ロング美脚挟み撃ち腿コキからのガニ股騎乗位逆3P◆木下ひまり（花沢ひまり）◆辻井ほのか◆滝ゆいな◆堤セリナ";

function pipeline(input: {
  productTitle: string;
  description?: string;
  actors?: string[];
  cid?: string;
  useProfile?: boolean;
}) {
  const pack = buildEvidencePack({
    productTitle: input.productTitle,
    claims: [
      {
        id: "c0",
        statement: input.cid ?? input.productTitle,
        status: "SUPPORTED",
      },
    ],
    pageEvidenceMeta: {
      description: input.description
        ? { text: input.description, originField: "jsonld.Product.description" }
        : undefined,
      actors: input.actors,
    },
  });
  const profile = buildProductMaterialProfileFromPack(pack);
  const feas = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack,
    profile,
  });
  const baseInput = {
    productTitle: input.productTitle,
    pack,
    assignment: feas.assignment,
    materialDepth: profile.materialDepth,
  };
  const planWithout = buildArticlePlan(baseInput);
  const plan = buildArticlePlan({
    ...baseInput,
    profile: input.useProfile === false ? undefined : profile,
  });
  return { pack, profile, feas, plan, planWithout };
}

describe("R145 performer representation", () => {
  describe("mode detection", () => {
    it("parathd03128 → dual_host with combinedLabel and titleAttested", () => {
      const { profile } = pipeline({
        productTitle: PARA_TITLE,
        description: PARA_DESC,
        actors: ["優梨まいな", "ましろ杏"],
        cid: "parathd03128",
      });
      expect(profile.performerCount).toBe(2);
      expect(profile.performerRepresentation.mode).toBe("dual_host");
      expect(profile.performerRepresentation.entities.map((e) => e.normalizedName)).toEqual([
        "優梨まいな",
        "ましろ杏",
      ]);
      expect(profile.performerRepresentation.titleAttested).toEqual(["優梨まいな"]);
      expect(profile.performerRepresentation.combinedLabel).toBe("優梨まいなとましろ杏");
    });

    it("false DUAL_HOST — scene co-star without host cue stays unknown_multi", () => {
      const rep = buildPerformerRepresentation({
        entities: [
          {
            normalizedName: "女優A",
            displayName: "女優A",
            source: "page_actors_metadata",
            sourceIndex: 0,
            sourceId: "page_atom::actor::0",
            fromOfficialMetadata: true,
            inProductTitle: false,
            inDescription: true,
          },
          {
            normalizedName: "女優B",
            displayName: "女優B",
            source: "page_actors_metadata",
            sourceIndex: 1,
            sourceId: "page_atom::actor::1",
            fromOfficialMetadata: true,
            inProductTitle: false,
            inDescription: true,
          },
        ],
        productTitle: "共演作",
        descriptionText: "女優Aと女優Bが激しいシーンで共演する。",
      });
      expect(rep.mode).toBe("unknown_multi");
      expect(rep.combinedLabel).toBeUndefined();
    });

    it("false DUAL_HOST — best omnibus without host cue", () => {
      const rep = buildPerformerRepresentation({
        entities: [
          {
            normalizedName: "女優A",
            displayName: "女優A",
            source: "page_actors_metadata",
            sourceIndex: 0,
            sourceId: "a0",
            fromOfficialMetadata: true,
            inProductTitle: true,
            inDescription: true,
          },
          {
            normalizedName: "女優B",
            displayName: "女優B",
            source: "page_actors_metadata",
            sourceIndex: 1,
            sourceId: "a1",
            fromOfficialMetadata: true,
            inProductTitle: false,
            inDescription: true,
          },
        ],
        productTitle: "8時間BEST vol.3",
        descriptionText: "女優Aと女優Bのシーンを収録したベスト。",
      });
      expect(rep.mode).not.toBe("dual_host");
    });

    it("mird00250 → ensemble not dual_host", () => {
      const { profile } = pipeline({
        productTitle: MIRD250_TITLE,
        description: MIRD250_DESC,
        actors: ["木下ひまり（花沢ひまり）", "辻井ほのか", "滝ゆいな", "堤セリナ"],
        cid: "mird00250",
      });
      expect(profile.performerRepresentation.mode).toBe("ensemble");
      expect(profile.performerRepresentation.combinedLabel).toBeUndefined();
    });

    it("collection shape — 23 actors + 総集編", () => {
      const actors = Array.from({ length: 23 }, (_, i) => `出演者${i + 1}`);
      const { profile } = pipeline({
        productTitle: "絶対妊娠！ガン反り生チ○ポで孕ませ中出しSEX！総集編",
        description: "ガン反りチンポの虜になったエロエロ娘5人の妊娠確実中出しをたっぷり",
        actors,
        cid: "hndb00100",
      });
      expect(profile.performerRepresentation.mode).toBe("collection");
      expect(profile.performerRepresentation.combinedLabel).toBeUndefined();
    });

    it("single performer → single mode", () => {
      const { profile } = pipeline({
        productTitle: "松本いちか 10作品ベスト",
        actors: ["松本いちか"],
        cid: "mizd00320",
      });
      expect(profile.performerRepresentation.mode).toBe("single");
    });
  });

  describe("parathd03128 ArticlePlan (mandatory)", () => {
    it("body exposes dual-host identity; title not forced to both names", () => {
      const { plan, planWithout, profile } = pipeline({
        productTitle: PARA_TITLE,
        description: PARA_DESC,
        actors: ["優梨まいな", "ましろ杏"],
        cid: "parathd03128",
      });

      const bodyFacts = plan.body.flatMap((b) => b.facts);
      const bodyWithout = planWithout.body.flatMap((b) => b.facts);
      // With profile: representation injects combinedLabel into overview (now body).
      expect(dualHostLeadCoversFacts(bodyFacts, profile.performerRepresentation)).toBe(true);
      expect(bodyFacts.some((f) => f.includes("優梨まいな") && f.includes("ましろ杏"))).toBe(true);
      expect(plan.lead.facts).toEqual([]);
      // Without profile: may still cover via SOURCE dual-name atoms — do not require false.
      // Require profile path to be at least as explicit as combinedLabel when available.
      if (profile.performerRepresentation.combinedLabel) {
        expect(
          bodyFacts.some((f) => f.includes(profile.performerRepresentation.combinedLabel!)) ||
            dualHostLeadCoversFacts(bodyFacts, profile.performerRepresentation),
        ).toBe(true);
      }
      expect(plan.title.facts.join(" ")).not.toMatch(/ましろ杏.*優梨|優梨.*ましろ杏/);
      expect(bodyFacts.length).toBeGreaterThan(0);
      void bodyWithout;
    });

    it("Human — body overview conveys dual host not single star", () => {
      const { plan } = pipeline({
        productTitle: PARA_TITLE,
        description: PARA_DESC,
        actors: ["優梨まいな", "ましろ杏"],
        cid: "parathd03128",
      });
      const bodyText = plan.body.flatMap((b) => b.facts).join(" ");
      expect(
        bodyText.includes("優梨まいなとましろ杏") ||
          (bodyText.includes("優梨まいな") && bodyText.includes("ましろ杏")),
      ).toBe(true);
    });
  });

  describe("ensemble / collection regression", () => {
    it("mird00250 — does not inject dual_host combined into body overview", () => {
      const { plan, profile } = pipeline({
        productTitle: MIRD250_TITLE,
        description: MIRD250_DESC,
        actors: ["木下ひまり（花沢ひまり）", "辻井ほのか", "滝ゆいな", "堤セリナ"],
        cid: "mird00250",
      });
      expect(profile.performerRepresentation.mode).toBe("ensemble");
      expect(plan.body.flatMap((b) => b.facts).some((f) => /と.*と/.test(f))).toBe(false);
      expect(plan.lead.facts).toEqual([]);
    });
  });

  describe("single performer regression", () => {
    for (const cid of ["ssis00700", "mizd00320", "pred00700"]) {
      it(`${cid} — profile does not change plan vs baseline`, () => {
        const without = pipeline({
          productTitle: `${cid} 女優名`,
          actors: [`${cid}-p`],
          cid,
          useProfile: false,
        });
        const withP = pipeline({
          productTitle: `${cid} 女優名`,
          actors: [`${cid}-p`],
          cid,
        });
        expect(without.plan.title.facts).toEqual(withP.plan.title.facts);
        expect(without.plan.body.map((b) => b.facts)).toEqual(withP.plan.body.map((b) => b.facts));
        expect(without.plan.lead.facts).toEqual([]);
        expect(withP.plan.lead.facts).toEqual([]);
      });
    }
  });
});
