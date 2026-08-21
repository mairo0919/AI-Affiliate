import { describe, expect, it } from "vitest";
import {
  extractOfficialPageFactAtoms,
  extractAtomsFromPageEvidenceMeta,
} from "../official-page-evidence-atoms.js";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildResearchEvidence } from "../research-evidence.js";
import { classifySemanticEvidence } from "../semantic-evidence.js";

const FULL_DESC =
  "キュートでエッチでちょっと生意気な令和イチのメスガキ！松本いちかのMOODYZベスト第2弾！メスガキわからせ、絶対空域、ギャル妹、小悪魔痴女etc.いっちゃんの魅力が詰まった10作品！痴女誘惑でもお仕置きレ●プでもエチえち可愛い厳選の22本番！超可愛いお顔と大人をバカにした表情のデカ尻にビタビタ激ピスSEX！480分の大ボリュームで45射精！最強の天使な小悪魔、松本いちかの本気をみさらせや！";

describe("official page evidence atoms (LLM=0)", () => {
  it("extracts concrete atoms and excludes promotional wrappers", () => {
    const { concrete, excluded } = extractOfficialPageFactAtoms({
      descriptionText: FULL_DESC,
      descriptionOriginField: "jsonld.Product.description",
      videoDescription: FULL_DESC,
      videoOriginField: "jsonld.VideoObject.description",
      actors: ["松本いちか"],
      uniqueSampleSceneCount: 10,
      imageContentKeys: [
        "mizd00320:package",
        ...Array.from({ length: 10 }, (_, i) => `mizd00320:sample:${i + 1}`),
      ],
    });

    expect(concrete.length).toBeGreaterThanOrEqual(5);
    expect(concrete.every((a) => a.generatorAllowed)).toBe(true);
    expect(concrete.every((a) => a.source === "fanza_product_page")).toBe(true);
    expect(concrete.some((a) => /10作品|22本番|480分|45射精/.test(a.fact))).toBe(true);
    expect(
      concrete.some(
        (a) =>
          a.fact.includes("メスガキ") ||
          a.primary === "PRODUCT_PERSONA" ||
          a.primary === "TITLE_LABEL" ||
          a.primary === "CHARACTER_TRAIT",
      ),
    ).toBe(true);
    expect(concrete.some((a) => a.fact === "松本いちか")).toBe(true);

    // Sample count must NOT become prose scene facts
    expect(concrete.every((a) => !/10シーン|10種類/.test(a.fact))).toBe(true);

    // Evaluative / catalog excluded
    expect(
      excluded.some(
        (a) =>
          a.bucket === "EVALUATIVE_OR_PROMOTIONAL" ||
          /魅力|おすすめ|キュート|楽しめる|話題|エチえち/.test(a.fact),
      ),
    ).toBe(true);

    // No full description dump as a single atom
    expect(concrete.every((a) => a.fact.length < FULL_DESC.length)).toBe(true);
  });

  it("merges page atoms into EvidencePack with provenance", () => {
    const meta = {
      description: { text: FULL_DESC, originField: "jsonld.Product.description" },
      video: {
        description: FULL_DESC,
        actor: ["松本いちか"],
        allowedForGeneration: false,
        originField: "jsonld.VideoObject.description",
      },
      actors: ["松本いちか"],
      uniqueSampleSceneCount: 10,
    };
    const research = buildResearchEvidence({
      productTitle: "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト",
      claims: [],
      pageEvidenceMeta: meta,
    });
    expect(research.some((e) => e.evidenceId.startsWith("page_atom::"))).toBe(true);

    const pack = buildEvidencePack({
      productTitle: "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト",
      claims: [],
      researchEvidence: research,
      pageEvidenceMeta: meta,
    });

    const pageConcrete = pack.concreteEvidence.filter(
      (e) => e.provenance.sourceType === "product_description",
    );
    expect(pageConcrete.length).toBeGreaterThan(0);
    expect(pageConcrete.every((e) => e.provenance.sourceRef.startsWith("fanza_product_page:"))).toBe(
      true,
    );
    expect(pack.videoEvidence?.generationEligible).toBe(false);
    expect(
      pack.unavailableEvidence.find((u) => u.kind === "product_description")?.reason,
    ).toContain("concrete_atoms");
    // Full text not in pack
    expect(pack.concreteEvidence.every((e) => e.fact !== FULL_DESC)).toBe(true);
  });

  it("does not invent scene facts from sample image count alone", () => {
    const { concrete } = extractAtomsFromPageEvidenceMeta({
      uniqueSampleSceneCount: 10,
      images: Array.from({ length: 10 }, (_, i) => ({
        contentKey: `mizd00320:sample:${i + 1}`,
      })),
    });
    expect(concrete).toHaveLength(0);
  });

  it("semantic families distinguish quantity vs duration vs scene", () => {
    expect(classifySemanticEvidence("22本番").familyId).toMatch(/^COUNT_/);
    expect(classifySemanticEvidence("480分").familyId).toMatch(/^DURATION_/);
    expect(classifySemanticEvidence("激ピス").primary).toBe("SCENE_ACTION");
    expect(classifySemanticEvidence("デカ尻").primary).toBe("BODY_TRAIT");
  });
});
