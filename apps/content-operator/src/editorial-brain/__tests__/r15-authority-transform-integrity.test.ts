/**
 * r15 Editorial Brain BLOG quality — deterministic tests (LLM calls = 0).
 */

import { describe, expect, it } from "vitest";
import {
  GENERATION_AUTHORITY_PRIORITY,
  buildGenerationAuthorityPromptContract,
} from "../../generation/generation-authority.js";
import {
  extractTransformationFromEditorialBlueprint,
  toTransformationPromptContract,
} from "../../article-pattern/reference-editorial-transformation.js";
import type { ReferenceEditorialBlueprint } from "../../article-pattern/reference-editorial-blueprint.js";
import { buildReferenceSegmentExecution } from "../../article-pattern/reference-segment-execution.js";
import {
  classifyProductMaterialProfile,
  classifyReferenceEditorialType,
  referenceTypeCompatible,
} from "../../article-pattern/reference-type-profile.js";
import { detectGenericProseViolations } from "../generation/generic-prose-compliance.js";
import {
  safeRedactReservedLead,
} from "../generation/lead-reservation-redact.js";
import { validatePostTransformIntegrity } from "../generation/post-transform-integrity.js";
import { detectReferenceNearCopy } from "../../article-pattern/reference-near-copy.js";
import { EDITORIAL_FAILURE_CODES } from "../core/failure-taxonomy.js";

function stubBlueprint(overrides?: Partial<ReferenceEditorialBlueprint>): ReferenceEditorialBlueprint {
  return {
    schemaVersion: 1,
    referenceId: "ref-1",
    sourceUrlHost: "example.com",
    articleType: "NEW_RELEASE_SINGLE",
    extractionMode: "paragraph_functions",
    materialDepth: "rich",
    segments: [
      {
        index: 0,
        role: "lead",
        editorialFunction: "hook_with_concrete_scene",
        primaryEvidenceType: "scene_or_act",
        evidenceTypeUsed: ["scene_or_act", "quantity_or_runtime"],
        specificityLevel: "high",
        approximateInformationDensity: "high",
        transitionFunction: "shift_to_performer",
        lengthBucket: "long",
      },
      {
        index: 1,
        role: "development",
        editorialFunction: "advance_unused_detail",
        primaryEvidenceType: "performer_identity",
        evidenceTypeUsed: ["performer_identity"],
        specificityLevel: "medium",
        approximateInformationDensity: "medium",
        transitionFunction: "shift_to_scene",
        lengthBucket: "medium",
      },
    ],
    progression: ["lead:hook", "development:advance"],
    evidenceTypesAdopted: ["scene_or_act", "quantity_or_runtime", "performer_identity"],
    evidenceTypesDeferredHint: [],
    avoidPatterns: ["catalog_maker_dump"],
    endingStrategy: "stop_without_generic_eval",
    repetitionStrategy: "no_cross_segment_restatement",
    extractedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("r15 authority + transformation + integrity (LLM=0)", () => {
  it("A. OPTION B authority prefers Writing Skeleton + Evidence Pack over legacy Reference dump", () => {
    const auth = buildGenerationAuthorityPromptContract({
      brainGenerationContract: {
        writingSkeleton: { opening: { purpose: "hook" } },
        evidencePack: { concreteEvidence: [{ id: "1", fact: "ベロキス" }] },
        layers: {
          FACTS: {},
          EDITORIAL_PLAN: { openingStrategy: "strongest_concrete_trait" },
          SEGMENT_CONTRACTS: {},
          REFERENCE_BLUEPRINT: { referenceId: "x" },
          EVIDENCE_MAPPING_PLAN: { mappings: [] },
        },
      },
    });
    expect(auth.mode).toBe("OPTION_B");
    expect(auth.WRITING_SKELETON).toBeTruthy();
    expect(auth.EVIDENCE_PACK).toBeTruthy();
    expect(auth.SEGMENT_CONTRACTS).toBeUndefined();
  });

  it("B. Authority priority is OPTION B (not legacy 8-rank)", () => {
    expect(GENERATION_AUTHORITY_PRIORITY[0]).toBe("FACTUAL_SAFETY");
    expect(GENERATION_AUTHORITY_PRIORITY[1]).toBe("EVIDENCE_PACK");
    expect(GENERATION_AUTHORITY_PRIORITY[2]).toBe("WRITING_SKELETON");
    expect(GENERATION_AUTHORITY_PRIORITY[3]).toBe("BLOG_CHANNEL_REQUIREMENTS");
    expect(GENERATION_AUTHORITY_PRIORITY[4]).toBe("MINIMAL_STYLE");

    const bp = stubBlueprint();
    const transform = extractTransformationFromEditorialBlueprint(bp);
    const auth = buildGenerationAuthorityPromptContract({
      brainGenerationContract: {
        writingSkeleton: { referenceId: bp.referenceId, progression: bp.progression },
        evidencePack: {
          concreteEvidence: [{ id: "f1", fact: "16名" }],
        },
        layers: {
          FACTS: {},
          EDITORIAL_PLAN: { openingStrategy: "strongest_concrete_trait" },
          SEGMENT_CONTRACTS: { lead: {} },
          REFERENCE_BLUEPRINT: { referenceId: bp.referenceId, progression: bp.progression },
          EVIDENCE_MAPPING_PLAN: { mappings: [{ role: "lead", assignedFacts: ["16名"] }] },
          REFERENCE_TRANSFORM_BLUEPRINT: toTransformationPromptContract(transform),
        },
        segmentExecution: { progressive: true },
      },
    });
    expect(auth.mode).toBe("OPTION_B");
    expect(auth.authorityPriority).toEqual([...GENERATION_AUTHORITY_PRIORITY]);
  });

  it("C. Without OPTION B inputs, authority stays minimal (no 26KB legacy dump)", () => {
    const auth = buildGenerationAuthorityPromptContract({
      brainGenerationContract: {
        layers: {
          FACTS: { hard: true },
          SEGMENT_CONTRACTS: { lead: { required: ["factA"] } },
          EDITORIAL_PLAN: { openingStrategy: "strongest_concrete_trait" },
          REFERENCE_BLUEPRINT: {
            referenceId: "r",
            openingFunction: "scene_first_hook",
            progression: ["scene", "performer"],
          },
          EVIDENCE_MAPPING_PLAN: { mappings: [] },
        },
      },
    });
    expect(auth.mode).toBe("TRANSITION_MINIMAL");
    expect(auth.FACTUAL_SAFETY).toBeTruthy();
    expect(auth.SEGMENT_CONTRACTS).toBeUndefined();
  });

  it("D. Evidence Mapping + Transformation segmentExecution forbids lead restatement in body", () => {
    const bp = stubBlueprint();
    const transform = extractTransformationFromEditorialBlueprint(bp);
    const mappingPlan = {
      schemaVersion: 1 as const,
      blueprintReferenceId: "ref-1",
      blueprintExtractionMode: "paragraph_functions" as const,
      materialDepth: "rich" as const,
      mappings: [
        {
          segmentIndex: 0,
          role: "lead" as const,
          editorialFunction: "hook",
          status: "mapped" as const,
          assignedFacts: ["素人16名のツアー"],
          assignedEvidenceIds: ["e1"],
          requiredEvidenceType: "quantity_or_runtime" as const,
        },
        {
          segmentIndex: 1,
          role: "development" as const,
          editorialFunction: "advance",
          status: "mapped" as const,
          assignedFacts: ["発掘と育成"],
          assignedEvidenceIds: ["e2"],
          requiredEvidenceType: "series_or_event" as const,
        },
      ],
      unusedEvidenceIds: [],
      insufficient: false,
      insufficientReason: null,
      deferCode: null,
    };
    const rows = buildReferenceSegmentExecution({
      blueprint: bp,
      mappingPlan,
      transform,
    });
    const lead = rows.find((r) => r.role === "lead");
    const body = rows.find((r) => r.role === "development");
    expect(lead?.transformationOperation?.factLexicalization).toBe("scene_first");
    expect(body?.transformationOperation?.factLexicalization).toMatch(/progressive|performer/);
    expect(body?.forbiddenConsumed).toEqual(expect.arrayContaining(["素人16名のツアー"]));
    expect(body?.primaryEvidence).toEqual(["発掘と育成"]);
  });

  it("E. generic catalog narration without new evidence → CATALOG_NARRATION / TRANSFORM_MISSED", () => {
    const r = detectGenericProseViolations({
      lead: "素人16名が参加するツアーだ。",
      sections: [{ paragraphs: ["この作品は濃密な内容が特徴です。"] }],
      leadAssignedFacts: ["素人16名"],
      bodyAssignedFacts: ["発掘"],
      transformationAvailable: true,
    });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.code === "CATALOG_NARRATION" || f.code === "REFERENCE_TRANSFORM_MISSED")).toBe(
      true,
    );
  });

  it("F. same shell phrase with new evidence → not false positive", () => {
    const r = detectGenericProseViolations({
      lead: "素人16名が参加する。",
      sections: [{ paragraphs: ["発掘と育成が目的の企画として、濃密なベロキスシーンが展開されます。"] }],
      leadAssignedFacts: ["素人16名"],
      bodyAssignedFacts: ["発掘", "ベロキス"],
      transformationAvailable: true,
    });
    expect(r.ok).toBe(true);
  });

  it("G. mird RAW reservation conflict → blind token deletion forbidden", () => {
    const raw =
      "AV男優を目指す素人16名とAV女優16名が参加する1泊2日の大乱交ツアー";
    const result = safeRedactReservedLead({
      lead: `2024は、${raw}として公開されている。`,
      reservedFacets: ["AV男優", "大乱交"],
      requiredFacets: ["16名", "1泊2日"],
    });
    expect(result.ok).toBe(false);
    // Must not produce broken Japanese like 「は、を目指す」
    expect(result.lead).not.toMatch(/は、を/);
    expect(result.failureCode).toMatch(/RAW_PLAN_EXECUTION_FAILED|POST_TRANSFORM/);
  });

  it("H. 「2024は、を目指す素人16名」 → POST_TRANSFORM_INTEGRITY_FAILED", () => {
    const r = validatePostTransformIntegrity({
      lead: "2024は、を目指す素人16名とAV女優16名が参加する。",
      sections: [],
    });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => /INCOMPLETE|INTEGRITY|EMPTY/.test(f.code) || /は、を/.test(f.message))).toBe(
      true,
    );
  });

  it("I. near-copy detector still rejects reference prose copy", () => {
    const phrase = "素人16名と女優16名が参加する1泊2日の特別ツアー企画である";
    const near = detectReferenceNearCopy({
      generatedText: `${phrase}。続きの本文。`,
      blockedPhrases: [phrase],
    });
    expect(near.hit).toBe(true);
  });

  it("J. Transformation unavailable — do not force incompatible reference type", () => {
    const product = classifyProductMaterialProfile([
      {
        evidenceId: "e1",
        claimId: "c1",
        facetType: "body_trait",
        observedFact: "超敏感な巨乳",
        sourceType: "supported_claim",
        sourceRef: "c1",
        confidence: "high",
        allowedForGeneration: true,
      },
      {
        evidenceId: "e2",
        claimId: "c2",
        facetType: "body_trait",
        observedFact: "美脚で長身",
        sourceType: "supported_claim",
        sourceRef: "c2",
        confidence: "high",
        allowedForGeneration: true,
      },
    ]);
    expect(product).toBe("trait_rich");
    expect(referenceTypeCompatible(product, "long_title_event_or_multi_performer")).toBe(false);
    const longTitleBp = stubBlueprint({
      materialDepth: "rich",
      evidenceTypesAdopted: ["series_or_event", "quantity_or_runtime"],
      segments: [
        {
          index: 0,
          role: "lead",
          editorialFunction: "event_hook",
          primaryEvidenceType: "series_or_event",
          evidenceTypeUsed: ["series_or_event", "quantity_or_runtime"],
          specificityLevel: "high",
          approximateInformationDensity: "high",
          transitionFunction: "shift_to_quantity",
          lengthBucket: "long",
        },
      ],
    });
    const refType = classifyReferenceEditorialType(longTitleBp);
    expect(refType).toBe("long_title_event_or_multi_performer");
    expect(referenceTypeCompatible(product, refType)).toBe(false);
  });

  it("taxonomy includes grammatical / transform codes", () => {
    expect(EDITORIAL_FAILURE_CODES).toContain("GRAMMATICAL_INTEGRITY");
    expect(EDITORIAL_FAILURE_CODES).toContain("INCOMPLETE_CLAUSE");
    expect(EDITORIAL_FAILURE_CODES).toContain("REFERENCE_TRANSFORM_MISSED");
  });
});
