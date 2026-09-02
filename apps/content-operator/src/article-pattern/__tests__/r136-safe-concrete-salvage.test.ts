/**
 * R136 — safe concrete salvage from promo/eval segments (LLM=0).
 */
import { describe, expect, it } from "vitest";
import {
  extractOfficialPageFactAtoms,
  extractSafeConcreteSalvageTokens,
  extractAtomsFromPageEvidenceMeta,
  extractRelationPreservingFacts,
} from "../official-page-evidence-atoms.js";
import { buildEvidencePack } from "../evidence-pack.js";
import { semanticClassToBlueprintType } from "../semantic-evidence.js";
import type { SemanticEvidenceClass } from "../semantic-evidence.js";
const OFJE_DESC =
  "AVデビューから8周年を迎え、映画や舞台でも絶賛活躍中！円熟した濃厚なセックスとエロポテンシャル、低身長なのにグラマラスボディが魅力の‘奥田咲’エスワンベスト第6弾。今回は彼女の最新12タイトル、なお且つ全コーナーを収録した豪華でスペシャルなベスト版です。超ボリューム55コーナー8時間。人妻、NTR、痴女、追撃ピストンなど今の咲が全部詰まった最高傑作がここに誕生です！！！";

const PISTON_SEG =
  "追撃ピストンなど今の咲が全部詰まった最高傑作がここに誕生です";

const CORNER_SEG = "超ボリューム55コーナー8時間";

const ATTR_SEG = "低身長なのにグラマラスボディが魅力の‘奥田咲’エスワンベスト第6弾";

describe("R136 safe concrete salvage", () => {
  it("salvages 追撃ピストン from promo segment without reviving parent wrapper", () => {
    const salvaged = extractSafeConcreteSalvageTokens(PISTON_SEG);
    expect(salvaged).toContain("追撃ピストン");
    expect(salvaged.some((t) => /最高|詰まった|誕生/.test(t))).toBe(false);

    const { concrete, excluded } = extractOfficialPageFactAtoms({
      descriptionText: OFJE_DESC,
      actors: ["奥田咲"],
    });

    const piston = concrete.find(
      (a) => a.fact === "追撃ピストン" || (/追撃ピストン/.test(a.fact) && /などを収録$/.test(a.fact)),
    );
    expect(piston).toBeDefined();
    expect(piston?.generatorAllowed).toBe(true);
    if (piston?.fact === "追撃ピストン") {
      expect(piston.primary).toBe("SCENE_ACTION");
    }

    expect(
      excluded.some(
        (a) =>
          a.bucket === "EVALUATIVE_OR_PROMOTIONAL" &&
          a.fact.includes("追撃ピストン") &&
          a.fact.includes("最高傑作"),
      ),
    ).toBe(true);
    // Bare stem may be marked UNUSABLE when subsumed by theme-scope compound
    expect(concrete.some((a) => /追撃ピストン/.test(a.fact))).toBe(true);
  });

  it("extracts 55コーナー as quantity without breaking 8時間 duration", () => {
    const salvaged = extractSafeConcreteSalvageTokens(CORNER_SEG);
    expect(salvaged).not.toContain("超ボリューム");

    const { concrete } = extractOfficialPageFactAtoms({
      descriptionText: CORNER_SEG,
    });

    expect(concrete.some((a) => a.fact === "55コーナー")).toBe(true);
    expect(concrete.some((a) => a.fact === "8時間")).toBe(true);
    const eightHour = concrete.find((a) => a.fact === "8時間");
    expect(eightHour?.primary).toBe("DURATION");
  });

  it("salvages SOURCE-attested body traits from evaluative compound; drops promo wrapper", () => {
    const salvaged = extractSafeConcreteSalvageTokens(ATTR_SEG);
    expect(salvaged.some((t) => /低身長|グラマラス/.test(t))).toBe(true);
    expect(salvaged.every((t) => !/魅力/.test(t))).toBe(true);

    const { concrete, excluded } = extractOfficialPageFactAtoms({
      descriptionText: ATTR_SEG,
    });
    expect(concrete.some((a) => /低身長|グラマラス/.test(a.fact))).toBe(true);
    expect(
      excluded.some(
        (a) => a.bucket === "EVALUATIVE_OR_PROMOTIONAL" && a.fact.includes("魅力"),
      ),
    ).toBe(true);
    expect(concrete.some((a) => /ベスト第6弾|ベスト/.test(a.fact))).toBe(true);
  });

  it("ofje00230 EvidencePack includes salvaged scene and corner quantity", () => {
    const pack = buildEvidencePack({
      productTitle: "ofje00230",
      claims: [{ id: "c1", statement: "ofje00230", status: "SUPPORTED" }],
      pageEvidenceMeta: {
        description: { text: OFJE_DESC, originField: "jsonld.Product.description" },
        actors: ["奥田咲"],
      },
    });

    const eligible = pack.concreteEvidence.filter((e) => e.generationEligible);
    const facts = eligible.map((e) => e.fact);
    expect(facts.some((f) => /追撃ピストン/.test(f))).toBe(true);
    expect(facts).toContain("55コーナー");
    expect(facts).toContain("8時間");
    expect(facts.some((f) => /最高傑作|全部詰まった/.test(f))).toBe(false);
  });

  it("does not duplicate existing concrete when salvaging from promo segment", () => {
    const { concrete } = extractOfficialPageFactAtoms({
      descriptionText: "8時間の大ボリュームで詰まった最高傑作！追撃ピストン",
    });
    const eightHours = concrete.filter((a) => a.fact === "8時間");
    expect(eightHours).toHaveLength(1);
  });

  it("remains stable when extractAtomsFromPageEvidenceMeta is called twice (no global-regex drift)", () => {
    const meta = {
      description: { text: OFJE_DESC, originField: "jsonld.Product.description" },
      actors: ["奥田咲"],
    };
    const first = extractOfficialPageFactAtoms({
      descriptionText: OFJE_DESC,
      actors: ["奥田咲"],
    });
    const second = extractAtomsFromPageEvidenceMeta(meta);
    expect(first.concrete.some((a) => /追撃ピストン/.test(a.fact))).toBe(true);
    expect(second.concrete.some((a) => /追撃ピストン/.test(a.fact))).toBe(true);
    expect(second.concrete.some((a) => a.fact === "55コーナー")).toBe(true);
  });

  it("preserves contrast / compilation scope / theme scope; attaches ambiguous quality to performer", () => {
    const { concrete, excluded } = extractOfficialPageFactAtoms({
      descriptionText: OFJE_DESC,
      actors: ["奥田咲"],
    });
    const facts = concrete.map((a) => a.fact);

    expect(facts.some((f) => f.includes("なのに") && /低身長/.test(f) && /グラマラス/.test(f))).toBe(
      true,
    );
    expect(facts.some((f) => /全コーナーを収録/.test(f))).toBe(true);
    expect(
      facts.some(
        (f) =>
          /などを収録$/.test(f) &&
          /人妻/.test(f) &&
          /NTR/.test(f) &&
          /痴女/.test(f) &&
          /追撃ピストン/.test(f),
      ),
    ).toBe(true);
    expect(facts.some((f) => f === "奥田咲の円熟した濃厚なセックスとエロポテンシャル")).toBe(true);
    expect(facts.some((f) => f === "円熟した濃厚なセックスとエロポテンシャル")).toBe(false);
    expect(facts.some((f) => f === "低身長")).toBe(false);
    expect(facts.some((f) => f === "グラマラスボディ")).toBe(false);
    expect(facts.some((f) => /最高傑作|豪華でスペシャル|全部詰まった/.test(f))).toBe(false);
    expect(
      excluded.some((a) => a.bucket === "EVALUATIVE_OR_PROMOTIONAL" && /最高傑作/.test(a.fact)),
    ).toBe(true);

    // Step1 SSOT: primary drives blueprint; collection family is PRODUCT_FORM
    for (const a of concrete) {
      expect(a.blueprintType).toBe(
        semanticClassToBlueprintType(a.primary as SemanticEvidenceClass),
      );
    }
    const theme = concrete.find((a) => /などを収録$/.test(a.fact) && /人妻/.test(a.fact));
    expect(theme?.primary).toBe("PRODUCT_FORM");
    expect(theme?.blueprintType).toBe("series_or_event");
    const corner = concrete.find((a) => /全コーナーを収録/.test(a.fact));
    expect(corner?.primary).toBe("PRODUCT_FORM");
    expect(corner?.blueprintType).toBe("series_or_event");
  });

  it("extractRelationPreservingFacts stays within SOURCE wording", () => {
    const rel = extractRelationPreservingFacts(OFJE_DESC, ["奥田咲"]);
    expect(rel.some((f) => /なのに/.test(f))).toBe(true);
    expect(rel.some((f) => /全コーナーを収録/.test(f))).toBe(true);
    expect(rel.some((f) => /などを収録$/.test(f))).toBe(true);
    expect(rel.every((f) => !/最高傑作|豪華/.test(f))).toBe(true);
  });
});
