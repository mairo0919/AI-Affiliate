import { describe, expect, it } from "vitest";
import {
  catalogGenreToAtom,
  isProductMeaningfulCatalogGenre,
} from "../catalog-genre-evidence.js";
import { extractAtomsFromPageEvidenceMeta } from "../official-page-evidence-atoms.js";
import { classifySourceFactType } from "../source-fact-authority.js";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildArticlePlan } from "../article-plan.js";
import { buildArticlePlanExecutionContract } from "../plan-execution-contract.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { detectSourceResolution } from "../source-resolution.js";

const OFJE_DESC =
  "AVデビューから8周年を迎え、映画や舞台でも絶賛活躍中！円熟した濃厚なセックスとエロポテンシャル、低身長なのにグラマラスボディが魅力の‘奥田咲’エスワンベスト第6弾。今回は彼女の最新12タイトル、なお且つ全コーナーを収録した豪華でスペシャルなベスト版です。超ボリューム55コーナー8時間。人妻、NTR、痴女、追撃ピストンなど今の咲が全部詰まった最高傑作がここに誕生です！！！";

describe("catalog genre evidence authority", () => {
  it("keeps product-meaningful genres and drops delivery-only", () => {
    expect(isProductMeaningfulCatalogGenre("パイズリ")).toBe(true);
    expect(isProductMeaningfulCatalogGenre("巨乳")).toBe(true);
    expect(isProductMeaningfulCatalogGenre("人妻・主婦")).toBe(true);
    expect(isProductMeaningfulCatalogGenre("ハイビジョン")).toBe(false);
  });

  it("never elevates catalog genre to scene_or_act", () => {
    for (const value of ["人妻・主婦", "痴女", "パイズリ", "巨乳", "NTR"]) {
      const atom = catalogGenreToAtom(
        {
          value,
          provenance: "page_json_ld",
          originField: "jsonld.VideoObject.genre",
        },
        0,
      );
      expect(atom).not.toBeNull();
      expect(atom!.sourceFactType).toBe("GENRE_TAG");
      expect(atom!.blueprintType).not.toBe("scene_or_act");
      expect(atom!.blueprintType).not.toBe("setting_or_situation");
      expect(atom!.primary).not.toBe("SCENE_ACTION");
      expect(atom!.primary).not.toBe("RELATIONSHIP");
    }
  });

  it("classifies genre provenance as GENRE_TAG even for body-looking labels", () => {
    expect(
      classifySourceFactType({
        fact: "巨乳",
        originField: "jsonld.VideoObject.genre",
        sourceRef: "fanza_product_page:jsonld.VideoObject.genre",
      }),
    ).toBe("GENRE_TAG");
    expect(
      classifySourceFactType({
        fact: "低身長なのにグラマラスボディ",
        originField: "jsonld.Product.description",
      }),
    ).toBe("BODY_ATTRIBUTE");
  });

  it("merges catalog genres into page evidence atoms", () => {
    const atoms = extractAtomsFromPageEvidenceMeta({
      description: {
        text: "最新12タイトル全コーナー。人妻、NTR、痴女、追撃ピストンなど。8時間。",
        originField: "jsonld.Product.description",
      },
      actors: ["奥田咲"],
      catalog: {
        genres: [
          { value: "パイズリ", provenance: "page_json_ld", originField: "jsonld.VideoObject.genre" },
          { value: "巨乳", provenance: "page_json_ld", originField: "jsonld.VideoObject.genre" },
          { value: "ハイビジョン", provenance: "page_json_ld", originField: "jsonld.VideoObject.genre" },
          {
            value: "女優ベスト・総集編",
            provenance: "page_json_ld",
            originField: "jsonld.VideoObject.genre",
          },
        ],
      },
    });
    const facts = atoms.concrete.filter((a) => a.generatorAllowed).map((a) => a.fact);
    expect(facts).toEqual(expect.arrayContaining(["パイズリ", "巨乳", "女優ベスト・総集編"]));
    expect(facts).not.toContain("ハイビジョン");
    const paizuri = atoms.concrete.find((a) => a.fact === "パイズリ");
    expect(paizuri?.sourceFactType).toBe("GENRE_TAG");
    expect(paizuri?.blueprintType).not.toBe("scene_or_act");
  });

  it("Plan prefers official パイズリ over dropping it for meta surplus", () => {
    const pack = buildEvidencePack({
      productTitle: "ofje00230",
      claims: [{ id: "c1", statement: "ofje00230", status: "SUPPORTED" }],
      pageEvidenceMeta: {
        description: { text: OFJE_DESC, originField: "jsonld.Product.description" },
        actors: ["奥田咲"],
        catalog: {
          genres: [
            {
              value: "パイズリ",
              provenance: "page_json_ld",
              originField: "jsonld.VideoObject.genre",
            },
            { value: "巨乳", provenance: "page_json_ld", originField: "jsonld.VideoObject.genre" },
            {
              value: "人妻・主婦",
              provenance: "page_json_ld",
              originField: "jsonld.VideoObject.genre",
            },
            {
              value: "淫乱・ハード系",
              provenance: "page_json_ld",
              originField: "jsonld.VideoObject.genre",
            },
            {
              value: "女優ベスト・総集編",
              provenance: "page_json_ld",
              originField: "jsonld.VideoObject.genre",
            },
          ],
        },
      },
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const feasibility = ensureFeasibleWritingSkeleton({
      skeleton: skeletonFromMaterialProfile(profile),
      pack,
      profile,
    });
    const plan = buildArticlePlan({
      productTitle: "ofje00230",
      pack,
      assignment: feasibility.assignment,
      materialDepth: profile.materialDepth,
    });
    const bodyFacts = plan.body.flatMap((s) => s.facts);
    expect(bodyFacts).toContain("パイズリ");
    // Soft-dedupe: bare 人妻 should not coexist with longer official 人妻・主婦
    if (bodyFacts.includes("人妻・主婦")) {
      expect(bodyFacts).not.toContain("人妻");
    }
    // THEME_LEVEL: representative tags only — not full genre dump
    const themeTags = bodyFacts.filter((f) =>
      /^(?:人妻|人妻・主婦|NTR|痴女|淫乱・ハード系|パイズリ|巨乳|追撃ピストン|女優ベスト・総集編)$/u.test(
        f,
      ),
    );
    expect(themeTags.length).toBeLessThanOrEqual(4);
    expect(plan.sourceExpansion?.resolution).toBe("THEME_LEVEL_EVIDENCE");
    expect(plan.sourceExpansion?.maxThemeTagFacts).toBe(4);
    const types = plan.body.flatMap((s) => s.factSourceTypes ?? []);
    expect(types).toContain("GENRE_TAG");
    expect(detectSourceResolution(bodyFacts)).toBe("THEME_LEVEL_EVIDENCE");

    const exec = buildArticlePlanExecutionContract({
      title: plan.title,
      lead: plan.lead,
      body: plan.body,
    });
    const genreExec = exec.find((e) => e.fact === "パイズリ" || e.fact === "人妻・主婦");
    expect(genreExec?.sourceFactType).toBe("GENRE_TAG");
    expect(genreExec?.notAllowed.some((x) => /GENRE_TAG|SCENE|relationship/i.test(x))).toBe(true);
    expect(genreExec?.informationAxis).not.toBe("scene");
  });
});

// debug helper kept out of describe
