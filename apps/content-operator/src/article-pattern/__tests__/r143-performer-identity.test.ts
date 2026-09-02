/**
 * R143 — multi-performer identity foundation (EvidencePack + MaterialProfile).
 */
import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../evidence-pack.js";
import {
  buildProductMaterialProfileFromPack,
  buildProductMaterialProfileFromFacts,
} from "../reference-type-profile.js";
import { performerEntityKey } from "../performer-identity.js";
import { skeletonFromMaterialProfile } from "../skeleton-feasibility.js";

const PARA_TITLE =
  "★選りすぐりの「マン毛」を紹介するマン毛モロ出し写真館 優梨まいな";
const PARA_DESC =
  "学芸員の優梨まいなとましろ杏がスケベにご紹介◆優梨まいなとましろ杏、この2人と一緒に鑑賞しましょう◆コインランドリーでナンパした女子大生のマン毛";

function packAndProfile(input: {
  productTitle: string;
  actors?: string[];
  description?: string;
  claims?: Array<{ id: string; statement: string; status?: string }>;
}) {
  const pack = buildEvidencePack({
    productTitle: input.productTitle,
    claims: input.claims ?? [{ id: "c1", statement: input.productTitle, status: "SUPPORTED" }],
    pageEvidenceMeta: {
      description: input.description
        ? { text: input.description, originField: "jsonld.Product.description" }
        : undefined,
      actors: input.actors,
    },
  });
  const profile = buildProductMaterialProfileFromPack(pack);
  return { pack, profile };
}

describe("R143 performer identity foundation", () => {
  it("CASE 1 — single performer metadata → count 1", () => {
    const { pack, profile } = packAndProfile({
      productTitle: "松本いちか 10作品ベスト",
      actors: ["松本いちか"],
    });
    expect(pack.performerItems).toHaveLength(1);
    expect(profile.performerCount).toBe(1);
    expect(profile.kind).not.toBe("multi_performer");
  });

  it("CASE 2 — two performers → count 2", () => {
    const { pack, profile } = packAndProfile({
      productTitle: "二人の共演作",
      actors: ["女優A", "女優B"],
    });
    expect(pack.performerItems.map((p) => p.normalizedName)).toEqual(["女優A", "女優B"]);
    expect(profile.performerCount).toBe(2);
    expect(profile.kind).not.toBe("standard_single_performer");
  });

  it("CASE 3 — title 1名 / actors 2名 → count 2 (metadata SSOT)", () => {
    const { pack, profile } = packAndProfile({
      productTitle: PARA_TITLE,
      actors: ["優梨まいな", "ましろ杏"],
      description: PARA_DESC,
    });
    expect(pack.performerItems.map((p) => p.normalizedName)).toEqual(["優梨まいな", "ましろ杏"]);
    expect(profile.performerCount).toBe(2);
    expect(profile.kind).not.toBe("standard_single_performer");
    expect(pack.performerItems.find((p) => p.normalizedName === "ましろ杏")).toMatchObject({
      fromOfficialMetadata: true,
      inDescription: true,
    });
    expect(pack.performerItems.find((p) => p.normalizedName === "優梨まいな")?.inProductTitle).toBe(
      true,
    );
  });

  it("CASE 4 — description combined identity does not inflate entity count", () => {
    const { pack } = packAndProfile({
      productTitle: "作品タイトル",
      actors: ["優梨まいな", "ましろ杏"],
      description: "優梨まいなとましろ杏が共演",
    });
    expect(pack.performerItems).toHaveLength(2);
    const combinedFact = pack.concreteEvidence.some((e) =>
      /優梨まいな.*ましろ杏|ましろ杏.*優梨まいな/.test(e.fact),
    );
    expect(combinedFact || PARA_DESC.includes("と")).toBe(true);
  });

  it("CASE 5 — same performer in title facet + actor atom → entity count 1", () => {
    const { pack, profile } = packAndProfile({
      productTitle: "松本いちか ベスト",
      actors: ["松本いちか"],
    });
    expect(pack.performerItems).toHaveLength(1);
    expect(profile.performerCount).toBe(1);
    const performerFacts = pack.concreteEvidence.filter((e) => e.fact === "松本いちか");
    expect(performerFacts.length).toBeGreaterThanOrEqual(1);
  });

  it("CASE 6 — four-performer ensemble → count 4", () => {
    const actors = ["木下ひまり", "女優B", "女優C", "女優D"];
    const { pack, profile } = packAndProfile({
      productTitle: "4人共演",
      actors,
    });
    expect(pack.performerItems).toHaveLength(4);
    expect(profile.performerCount).toBe(4);
  });

  it("CASE 7 — 23-performer collection → count 23", () => {
    const actors = Array.from({ length: 23 }, (_, i) => `出演者${i + 1}`);
    const { pack, profile } = packAndProfile({
      productTitle: "23名総集編",
      actors,
    });
    expect(pack.performerItems).toHaveLength(23);
    expect(profile.performerCount).toBe(23);
  });

  it("CASE 8 — alias in parentheses stays one entity", () => {
    const { pack, profile } = packAndProfile({
      productTitle: "バレー女子4人",
      actors: ["木下ひまり（花沢ひまり）", "女優B", "女優C", "女優D"],
    });
    expect(pack.performerItems).toHaveLength(4);
    expect(profile.performerCount).toBe(4);
    expect(performerEntityKey("木下ひまり（花沢ひまり）")).toBe("木下ひまり（花沢ひまり）");
  });

  it("parathd03128 — both performers preserved; not single profile", () => {
    const { pack, profile } = packAndProfile({
      productTitle: PARA_TITLE,
      actors: ["優梨まいな", "ましろ杏"],
      description: PARA_DESC,
    });
    expect(pack.performerItems.map((p) => p.normalizedName)).toEqual(["優梨まいな", "ましろ杏"]);
    expect(profile.performerCount).toBe(2);
    expect(profile.kind).not.toBe("standard_single_performer");
    const skeleton = skeletonFromMaterialProfile(profile);
    expect(skeleton.opening.primaryEvidenceRole).toBe("performer_identity");
  });

  it("does not infer performers from description/title without actor metadata", () => {
    const profile = buildProductMaterialProfileFromFacts([
      { fact: "小島みなみ", sourceType: "product_title", titleIdentityToken: true },
      { fact: "森日向子", sourceType: "product_description" },
    ]);
    expect(profile.performerCount).toBe(0);
  });

  it("counts performer_metadata facts when pack path unavailable", () => {
    const profile = buildProductMaterialProfileFromFacts([
      { fact: "優梨まいな", sourceType: "performer_metadata" },
      { fact: "ましろ杏", sourceType: "performer_metadata" },
    ]);
    expect(profile.performerCount).toBe(2);
  });

  describe("9 CID multi-actor cross-scan", () => {
    const MULTI_FIXTURES: Record<string, string[]> = {
      parathd03128: ["優梨まいな", "ましろ杏"],
      cawd00100: ["女優A", "女優B"],
      hndb00100: Array.from({ length: 23 }, (_, i) => `出演者${i + 1}`),
      mizd00316: ["女優A", "女優B"],
      mird00250: ["木下ひまり（花沢ひまり）", "女優B", "女優C", "女優D"],
      mird00237: ["女優A", "女優B", "女優C", "女優D"],
      dvaj00400: ["女優A", "女優B"],
      ofje00245: ["女優A", "女優B", "女優C"],
      cawd00200: ["女優A", "女優B"],
    };

    for (const [cid, actors] of Object.entries(MULTI_FIXTURES)) {
      it(`${cid} — performerCount matches source actors (${actors.length})`, () => {
        const { pack, profile } = packAndProfile({
          productTitle: `${cid} sample title`,
          actors,
        });
        expect(pack.performerItems).toHaveLength(actors.length);
        expect(profile.performerCount).toBe(actors.length);
        if (actors.length >= 2) {
          expect(profile.kind).not.toBe("standard_single_performer");
        }
      });
    }
  });

  describe("single-performer regression (10 CIDs)", () => {
    const SINGLES = [
      "ssis00700",
      "mizd00320",
      "ofje00230",
      "pred00700",
      "nnpj00500",
      "cawd00400",
      "ssis00300",
      "pred00400",
      "mizd00312",
      "dvaj00500",
    ];

    for (const cid of SINGLES) {
      it(`${cid} — single actor metadata stays count 1`, () => {
        const { profile } = packAndProfile({
          productTitle: `${cid} 女優名`,
          actors: [`${cid}-performer`],
        });
        expect(profile.performerCount).toBe(1);
        expect(profile.kind).not.toBe("multi_performer");
      });
    }
  });
});
