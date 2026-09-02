/**
 * R146 — multi-performer representation (ensemble / collection / unknown_multi).
 */
import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import { skeletonFromMaterialProfile, ensureFeasibleWritingSkeleton } from "../skeleton-feasibility.js";
import { buildArticlePlan } from "../article-plan.js";
import {
  buildPerformerRepresentation,
  countRosterNamesInFacts,
  representationCoverage,
  representationLeadCoversFacts,
} from "../performer-representation.js";

const PARA_TITLE =
  "★選りすぐりの「マン毛」を紹介するマン毛モロ出し写真館 優梨まいな";
const PARA_DESC =
  "学芸員の優梨まいなとましろ杏がスケベにご紹介◆優梨まいなとましろ杏、この2人と一緒に鑑賞しましょう◆コインランドリーでナンパした女子大生のマン毛";

const MIRD250_TITLE = "長身脚長バレー女子たちのガニ股天空杭打ち騎乗位ハーレム";
const MIRD250_DESC =
  "全員170cmオーバーのデカ女子4人身長差手コキ◆ロング美脚挟み撃ち腿コキからのガニ股騎乗位逆3P◆木下ひまり（花沢ひまり）◆辻井ほのか◆滝ゆいな◆堤セリナ";

const HNDB_TITLE = "絶対妊娠！ガン反り生チ○ポで孕ませ中出しSEX！総集編";
const HNDB_DESC = "ガン反りチンポの虜になったエロエロ娘5人の妊娠確実中出しをたっぷり";

const DVAJ_TITLE = "柔らかいオッパイの谷間でヌチュヌチュしごかれるパイズリ挟射BEST19名5時間";
const DVAJ_DESC =
  "女優自慢のオッパイでチンポをがっちりホールドされ上下にシコシコ◆奥田咲◆藤咲エレン◆長瀬麻美";

const MIRD237_TITLE =
  "【独占】MOODYZファン感謝祭 バコバコバスツアー2024 AV男優発掘＆育成スペシャル！！ AV男優を目指す素人16名とAV女優16名の1泊2日大乱交ツアー！";

function pipeline(input: {
  productTitle: string;
  description?: string;
  actors?: string[];
  cid?: string;
  withProfile?: boolean;
}) {
  const pack = buildEvidencePack({
    productTitle: input.productTitle,
    claims: [{ id: "c0", statement: input.cid ?? input.productTitle, status: "SUPPORTED" }],
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
  const base = {
    productTitle: input.productTitle,
    pack,
    assignment: feas.assignment,
    materialDepth: profile.materialDepth,
  };
  const before = buildArticlePlan(base);
  const after = buildArticlePlan({
    ...base,
    profile: input.withProfile === false ? undefined : profile,
  });
  return { profile, before, after };
}

describe("R146 multi-performer representation", () => {
  describe("mode detection guards", () => {
    it("false COLLECTION — many actors without collection cue → unknown_multi", () => {
      const actors = Array.from({ length: 10 }, (_, i) => `P${i + 1}`);
      const rep = buildPerformerRepresentation({
        entities: actors.map((name, i) => ({
          normalizedName: name,
          displayName: name,
          source: "page_actors_metadata" as const,
          sourceIndex: i,
          sourceId: `a${i}`,
          fromOfficialMetadata: true,
          inProductTitle: false,
          inDescription: false,
        })),
        productTitle: "共演シーン集",
        descriptionText: "複数シーンで展開される作品。",
      });
      expect(rep.mode).toBe("unknown_multi");
      expect(rep.neutralMultiLabel).toBe("10名が出演");
    });

    it("false ENSEMBLE — 4 actors scene co-star without group cue", () => {
      const rep = buildPerformerRepresentation({
        entities: ["A", "B", "C", "D"].map((name, i) => ({
          normalizedName: name,
          displayName: name,
          source: "page_actors_metadata" as const,
          sourceIndex: i,
          sourceId: `a${i}`,
          fromOfficialMetadata: true,
          inProductTitle: false,
          inDescription: true,
        })),
        productTitle: "共演作",
        descriptionText: "AとBとCとDが順番にシーン出演。",
      });
      expect(rep.mode).toBe("unknown_multi");
    });

    it("collection requires BEST/総集編 cue not actor count alone", () => {
      const rep = buildPerformerRepresentation({
        entities: ["A", "B", "C"].map((name, i) => ({
          normalizedName: name,
          displayName: name,
          source: "page_actors_metadata" as const,
          sourceIndex: i,
          sourceId: `a${i}`,
          fromOfficialMetadata: true,
          inProductTitle: false,
          inDescription: false,
        })),
        productTitle: "8時間BEST vol.3 収録",
        descriptionText: "人気シーン厳選。",
      });
      expect(rep.mode).toBe("collection");
    });
  });

  describe("mird00250 mandatory", () => {
    it("ensemble body overview uses SOURCE group abstraction when cue exists — roster not forced", () => {
      const actors = ["木下ひまり（花沢ひまり）", "辻井ほのか", "滝ゆいな", "堤セリナ"];
      const { profile, before, after } = pipeline({
        productTitle: MIRD250_TITLE,
        description: MIRD250_DESC,
        actors,
        cid: "mird00250",
      });

      expect(profile.performerRepresentation.mode).toBe("ensemble");
      expect(profile.performerRepresentation.combinedLabel).toBeUndefined();

      const body0 = after.body[0]?.facts ?? [];
      const titleBody0 = [...after.title.facts, ...body0];
      expect(countRosterNamesInFacts(titleBody0, profile.performerRepresentation)).toBeLessThan(
        4,
      );
      expect(representationLeadCoversFacts(body0, profile.performerRepresentation)).toBe(true);
      expect(
        titleBody0.some((f) => /ハーレム|4人|バレー女子|170cm|デカ女子/u.test(f)),
      ).toBe(true);
      expect(
        representationCoverage(
          { title: after.title.facts, lead: body0 },
          profile.performerRepresentation,
        ),
      ).toBe("group_abstraction");
      expect(after.lead.facts).toEqual([]);
      void before;
    });
  });

  describe("large collection mandatory", () => {
    it("hndb — collection abstraction, no combined roster", () => {
      const actors = Array.from({ length: 23 }, (_, i) => `出演者${i + 1}`);
      const { profile, after } = pipeline({
        productTitle: HNDB_TITLE,
        description: HNDB_DESC,
        actors,
        cid: "hndb00100",
      });
      const body0 = after.body[0]?.facts ?? [];
      expect(profile.performerRepresentation.mode).toBe("collection");
      expect(profile.performerRepresentation.combinedLabel).toBeUndefined();
      expect(representationLeadCoversFacts(body0, profile.performerRepresentation)).toBe(true);
      expect(
        countRosterNamesInFacts([...after.title.facts, ...body0], profile.performerRepresentation),
      ).toBeLessThan(5);
      expect(after.lead.facts).toEqual([]);
    });

    it("dvaj00400 — 19名 BEST collection overview in body", () => {
      const actors = Array.from({ length: 19 }, (_, i) => `女優${i + 1}`);
      const { profile, after } = pipeline({
        productTitle: DVAJ_TITLE,
        description: DVAJ_DESC,
        actors,
        cid: "dvaj00400",
      });
      const bodyFacts = after.body.flatMap((b) => b.facts);
      expect(profile.performerRepresentation.mode).toBe("collection");
      expect(
        bodyFacts.some((f) => /BEST|19名|5時間|パイズリ/u.test(f)) ||
          representationLeadCoversFacts(bodyFacts, profile.performerRepresentation),
      ).toBe(true);
      expect(after.lead.facts).toEqual([]);
    });

    it("mird00237 — event/collection not ensemble", () => {
      const actors = Array.from({ length: 16 }, (_, i) => `女優${i + 1}`);
      const { profile } = pipeline({
        productTitle: MIRD237_TITLE,
        description: MIRD237_TITLE,
        actors,
        cid: "mird00237",
      });
      expect(profile.performerRepresentation.mode).toBe("collection");
      expect(profile.performerRepresentation.mode).not.toBe("ensemble");
    });
  });

  describe("unknown_multi neutral representation", () => {
    it("2 actors without host/group/collection cues → neutral body overview", () => {
      const { profile, after } = pipeline({
        productTitle: "共演ドラマ",
        description: "女優Aは前半、女優Bは後半シーンに出演。",
        actors: ["女優A", "女優B"],
        cid: "cawd00100",
      });
      expect(profile.performerRepresentation.mode).toBe("unknown_multi");
      expect(after.body.flatMap((b) => b.facts).some((f) => f.includes("2名が出演"))).toBe(true);
      expect(after.lead.facts).toEqual([]);
    });
  });

  describe("DUAL_HOST regression (R145)", () => {
    it("parathd03128 unchanged", () => {
      const { profile, after } = pipeline({
        productTitle: PARA_TITLE,
        description: PARA_DESC,
        actors: ["優梨まいな", "ましろ杏"],
        cid: "parathd03128",
      });
      expect(profile.performerRepresentation.mode).toBe("dual_host");
      expect(
        after.body
          .flatMap((b) => b.facts)
          .some((f) => f.includes("優梨まいな") && f.includes("ましろ杏")),
      ).toBe(true);
      expect(after.title.facts.join(" ")).not.toMatch(/ましろ杏.*優梨/);
      expect(after.lead.facts).toEqual([]);
    });
  });

  describe("single regression", () => {
    for (const cid of ["ssis00700", "mizd00320", "pred00700"]) {
      it(`${cid} — plan unchanged with profile`, () => {
        const off = pipeline({
          productTitle: `${cid} title`,
          actors: [`${cid}-p`],
          cid,
          withProfile: false,
        });
        const on = pipeline({
          productTitle: `${cid} title`,
          actors: [`${cid}-p`],
          cid,
        });
        expect(off.before.title.facts).toEqual(on.after.title.facts);
        expect(off.before.body.map((b) => b.facts)).toEqual(on.after.body.map((b) => b.facts));
        expect(off.before.lead.facts).toEqual([]);
        expect(on.after.lead.facts).toEqual([]);
      });
    }
  });
});
