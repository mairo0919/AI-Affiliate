/**
 * Reference-guided generation foundation tests (r13).
 */
import { describe, expect, it } from "vitest";
import {
  extractReferenceEditorialBlueprint,
  buildWeakBlueprintFromWritingFeatures,
} from "../reference-editorial-blueprint.js";
import { buildResearchEvidence } from "../research-evidence.js";
import { buildReferenceEvidenceMappingPlan } from "../reference-evidence-mapping.js";
import { detectReferenceNearCopy } from "../reference-near-copy.js";
import { extractFanzaSampleMovieMeta } from "../../providers/fanza/sample-movie-meta.js";
import { validateReferenceExecution } from "../../editorial-brain/generation/reference-execution-compliance.js";

describe("ReferenceEditorialBlueprint", () => {
  it("preserves paragraph editorial progression without storing prose", () => {
    const html = `
      <p>突然のベロキスが展開される濃密なシーンから始まる。</p>
      <p>その後、イヤラしい舐め尽くしの描写が加わる。</p>
      <p>シリーズとしてプールナンパが位置づけられている。</p>
    `;
    const bp = extractReferenceEditorialBlueprint({
      html,
      sourceUrl: "https://example.com/ref",
      referenceId: "ref1",
    });
    expect(bp.extractionMode).toBe("paragraph_functions");
    expect(bp.segments.length).toBeGreaterThanOrEqual(2);
    expect(bp.segments[0]?.role).toBe("lead");
    expect(bp.progression[0]).toMatch(/lead:/);
    expect(JSON.stringify(bp)).not.toContain("ベロキスが展開");
    expect(bp.evidenceTypesAdopted.length).toBeGreaterThan(0);
  });

  it("weak blueprint from writingFeatures still yields progression tokens", () => {
    const bp = buildWeakBlueprintFromWritingFeatures({
      sectionPurposeSequence: ["intro_hook", "product_sections", "cta"],
      introHookType: "direct_recommendation",
      informationDensityBucket: "high",
    });
    expect(bp.extractionMode).toBe("weak_from_writing_features");
    expect(bp.segments).toHaveLength(3);
  });
});

describe("Evidence mapping", () => {
  it("maps blueprint segments to product evidence and DEFERS when empty", () => {
    const bp = extractReferenceEditorialBlueprint({
      html: `<p>16名が参加する1泊2日の大乱交。</p><p>発掘と育成が目的である。</p>`,
    });
    const evidence = buildResearchEvidence({
      productTitle: "テスト16名1泊2日乱交",
      claims: [
        { id: "c1", statement: "素人16名と女優が参加する1泊2日", kind: "trait_or_scene", status: "SUPPORTED" },
        { id: "c2", statement: "大乱交の企画", kind: "trait_or_scene", status: "SUPPORTED" },
      ],
    });
    const plan = buildReferenceEvidenceMappingPlan({ blueprint: bp, evidence });
    expect(plan.mappings.some((m) => m.status === "mapped")).toBe(true);
    expect(plan.insufficient).toBe(false);
  });

  it("insufficient when no usable evidence", () => {
    const bp = extractReferenceEditorialBlueprint({
      html: `<p>激しい乱交シーンが中心。</p><p>別の責めが続く。</p>`,
    });
    const evidence = buildResearchEvidence({
      productTitle: "x",
      claims: [],
    });
    const plan = buildReferenceEvidenceMappingPlan({ blueprint: bp, evidence });
    expect(plan.deferCode).toBe("DEFER_INSUFFICIENT_REFERENCE_MATERIAL");
  });
});

describe("near-copy + sample movie meta", () => {
  it("detects blocked phrase near-copy", () => {
    const blocked = "REFERENCE_UNIQUE_PHRASE_XYZ_999";
    const r = detectReferenceNearCopy({
      generatedText: `これは独自の文章です。${blocked} が混ざっています。`,
      blockedPhrases: [blocked],
    });
    expect(r.hit).toBe(true);
  });

  it("sample movie meta is never generation-allowed", () => {
    const meta = extractFanzaSampleMovieMeta({
      sampleMovieURL: { size_720_480: "https://www.dmm.co.jp/litevideo/-/detail/=/cid=test/" },
    });
    expect(meta.researchStatus).toBe("meta_only");
    expect(meta.allowedForGeneration).toBe(false);
    expect(meta.allowedForVision).toBe(false);
  });
});

describe("REFERENCE_EXECUTION", () => {
  it("flags evidence omission when mapped fact missing", () => {
    const plan = {
      schemaVersion: 1 as const,
      blueprintReferenceId: null,
      blueprintExtractionMode: "paragraph_functions" as const,
      materialDepth: "standard" as const,
      mappings: [
        {
          segmentIndex: 0,
          role: "lead" as const,
          editorialFunction: "open_with_strongest_concrete_scene",
          requiredEvidenceType: "scene_or_act" as const,
          assignedEvidenceIds: ["e1"],
          assignedFacts: ["突然のベロキスシーン"],
          status: "mapped" as const,
        },
      ],
      unusedEvidenceIds: [],
      insufficient: false,
      insufficientReason: null,
      deferCode: null,
    };
    const result = validateReferenceExecution({
      article: {
        title: "t",
        lead: "一般的な紹介文のみ。",
        summary: "s",
        sections: [{ paragraphs: ["特に具体がない。"] }],
      },
      mappingPlan: plan,
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "EVIDENCE_OMISSION")).toBe(true);
  });
});
