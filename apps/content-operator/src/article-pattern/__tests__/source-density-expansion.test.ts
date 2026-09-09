import { describe, expect, it } from "vitest";
import {
  detectSourceResolution,
  expansionPolicyForResolution,
  selectRepresentativeThemeTags,
} from "../source-resolution.js";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildArticlePlan } from "../article-plan.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";

describe("source density expansion policy", () => {
  it("classifies ofje-like copy as THEME_LEVEL and mizd-like as RICH", () => {
    expect(
      detectSourceResolution([
        "最新12タイトル",
        "55コーナー",
        "約8時間",
        "人妻・主婦",
        "NTR",
        "痴女",
        "パイズリ",
        "円熟した濃厚なセックス",
      ]),
    ).toBe("THEME_LEVEL_EVIDENCE");

    expect(
      detectSourceResolution([
        "メスガキわからせプレイで絶対的に屈服させる",
        "絶対空域の食い込みパンティ",
        "ギャル妹の小悪魔痴女プレイ",
        "お仕置きレ●プで22本番45射精",
        "激しいピストンで何度も絶頂",
      ]),
    ).toBe("RICH_SCENE_EVIDENCE");
  });

  it("selects representative theme tags under cap", () => {
    const selected = selectRepresentativeThemeTags(
      ["人妻", "人妻・主婦", "NTR", "痴女", "パイズリ", "巨乳", "追撃ピストン", "淫乱・ハード系"],
      4,
    );
    expect(selected.length).toBeLessThanOrEqual(4);
    expect(selected).toContain("パイズリ");
    expect(selected).not.toContain("人妻"); // stem dropped vs 人妻・主婦
  });

  it("THEME_LEVEL ofje plan stays under density ceilings", () => {
    const pack = buildEvidencePack({
      productTitle: "ofje00230",
      claims: [{ id: "c1", statement: "ofje00230", status: "SUPPORTED" }],
      pageEvidenceMeta: {
        description: {
          text: "AVデビューから8周年。円熟した濃厚なセックスとグラマラスボディが魅力の奥田咲エスワンベスト第6弾。最新12タイトル、全コーナー収録。超ボリューム55コーナー8時間。人妻、NTR、痴女、追撃ピストンなど。",
          originField: "jsonld.Product.description",
        },
        actors: ["奥田咲"],
        catalog: {
          genres: [
            { value: "パイズリ", provenance: "page_json_ld", originField: "jsonld.VideoObject.genre" },
            { value: "巨乳", provenance: "page_json_ld", originField: "jsonld.VideoObject.genre" },
            {
              value: "人妻・主婦",
              provenance: "page_json_ld",
              originField: "jsonld.VideoObject.genre",
            },
            { value: "NTR", provenance: "page_json_ld", originField: "jsonld.VideoObject.genre" },
            { value: "痴女", provenance: "page_json_ld", originField: "jsonld.VideoObject.genre" },
            {
              value: "淫乱・ハード系",
              provenance: "page_json_ld",
              originField: "jsonld.VideoObject.genre",
            },
            {
              value: "追撃ピストン",
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
      profile,
    });
    const policy = expansionPolicyForResolution("THEME_LEVEL_EVIDENCE");
    expect(plan.sourceExpansion?.resolution).toBe("THEME_LEVEL_EVIDENCE");
    const bodyFacts = plan.body.flatMap((s) => s.facts);
    expect(bodyFacts.length).toBeLessThanOrEqual(policy.maxBodyFacts);
    const themes = bodyFacts.filter((f) =>
      /人妻|NTR|痴女|パイズリ|巨乳|追撃|淫乱|ハード/u.test(f),
    );
    expect(themes.length).toBeLessThanOrEqual(policy.maxThemeTagFacts);
    expect(bodyFacts.some((f) => /12タイトル|55コーナー|8時間/u.test(f))).toBe(true);
  });
});
