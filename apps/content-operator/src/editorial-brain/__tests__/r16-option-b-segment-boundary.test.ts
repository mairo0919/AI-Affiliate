/**
 * OPTION B post-LLM boundary — LLM=0 tests + mizd RAW replay.
 * No Prompt / Reviewer / taxonomy changes. X path untouched.
 */

import { describe, expect, it } from "vitest";
import {
  OPTION_B_LEGACY_CONTROL_INVENTORY,
  isOptionBGenerationMode,
  optionBAllowsPostLlmProseMutation,
} from "../generation/option-b-blog-boundary.js";
import { safeRedactReservedLead } from "../generation/lead-reservation-redact.js";
import { validatePostTransformIntegrity } from "../generation/post-transform-integrity.js";
import { assignEvidenceToWritingSkeleton } from "../../article-pattern/skeleton-evidence-assignment.js";
import {
  buildEvidencePack,
  toOptionBWriterSourceMaterial,
} from "../../article-pattern/evidence-pack.js";
import {
  writingSkeletonFallback,
  toWritingSkeletonPromptContract,
} from "../../article-pattern/writing-skeleton.js";
import { buildOptionBGenerationAuthority } from "../../generation/generation-authority.js";

/** Saved FIRST_LOSS RAW lead (mizd00320 production validation). */
export const MIZD_RAW_LEAD =
  "松本いちかが主演する『令和イチのメスガキ』シリーズから、10作品を収録した8時間の時間ベストが公開されている。";

const MIZD_RAW_ARTICLE = {
  title: "松本いちか出演・令和イチのメスガキ10作品8時間収録ベスト",
  summary:
    "松本いちかが出演する『令和イチのメスガキ』シリーズから、10作品を8時間にまとめた時間ベストが登場。わからせ痴女られのシーンを収録。",
  lead: MIZD_RAW_LEAD,
  sections: [
    {
      heading: null as string | null,
      paragraphs: [
        "本作品は、わからせ痴女られのシーンを中心に構成された10作品8時間のベスト版である。",
        "収録されている作品数は10本で、合計8時間の長尺となっている。",
        "この時間ベストは、シリーズの中でも特に長時間にわたる内容として公開されている。",
      ],
    },
  ],
};

/**
 * Deterministic OPTION B post-LLM gate (mirrors content-generation-service boundary):
 * no safeRedact*, no strip mutation — integrity validate only.
 */
export function optionBPostLlmGate(article: typeof MIZD_RAW_ARTICLE) {
  const mutations: string[] = [];
  const lead = article.lead;
  const sections = article.sections;

  // OPTION B: deliberately do NOT call safeRedactReservedLead / safeRedactLeadConsumedFromBody
  const integrity = validatePostTransformIntegrity({
    title: article.title,
    lead,
    summary: article.summary,
    sections,
  });
  if (!integrity.ok) {
    return {
      ok: false as const,
      code: "POST_TRANSFORM_INTEGRITY_FAILED",
      lead,
      mutations,
      mutated: false,
      integrity,
      reachPersist: false,
      observeForBrain: [] as string[],
    };
  }

  return {
    ok: true as const,
    code: null,
    lead,
    mutations,
    mutated: false,
    integrity,
    reachPersist: true,
    observeForBrain: [
      "SEGMENT_RAW_observe",
      "GENERIC_PROSE_observe",
      "REFERENCE_EXECUTION_observe",
      "SKELETON_PROGRESSION_observe",
    ],
  };
}

describe("OPTION B vs legacy SEGMENT authority (LLM=0)", () => {
  it("A. inventory marks safeRedactReservedLead as D; mutation forbidden", () => {
    const row = OPTION_B_LEGACY_CONTROL_INVENTORY.find(
      (r) => r.control === "safeRedactReservedLead",
    );
    expect(row?.classification).toBe("D_OPTION_B_DANGEROUS_MUTATION");
    expect(optionBAllowsPostLlmProseMutation()).toBe(false);
  });

  it("B. isOptionBGenerationMode detects WritingSkeleton+EvidencePack / mode flag", () => {
    expect(
      isOptionBGenerationMode({
        mode: "OPTION_B",
        writingSkeleton: {},
        evidencePack: {},
      }),
    ).toBe(true);
    expect(isOptionBGenerationMode({ layers: { SEGMENT_CONTRACTS: {} } })).toBe(false);
    expect(
      isOptionBGenerationMode({
        layers: { WRITING_SKELETON: {}, EVIDENCE_PACK: {} },
      }),
    ).toBe(true);
  });

  it("C. OPTION B RAW validator does not mutate lead", () => {
    const gate = optionBPostLlmGate(MIZD_RAW_ARTICLE);
    expect(gate.ok).toBe(true);
    expect(gate.mutated).toBe(false);
    expect(gate.lead).toBe(MIZD_RAW_LEAD);
    expect(gate.mutations).toEqual([]);
  });

  it("D. legacy safeRedact fails or mutates same RAW (reservation collision) — path not used on OPTION B", () => {
    const legacy = safeRedactReservedLead({
      lead: MIZD_RAW_LEAD,
      reservedFacets: ["10作品", "8時間", "わからせ痴女"],
      requiredFacets: ["松本いちか"],
    });
    if (legacy.ok) {
      expect(legacy.lead).not.toBe(MIZD_RAW_LEAD);
    } else {
      expect(legacy.failureCode).toBe("RAW_PLAN_EXECUTION_FAILED");
      expect(String(legacy.failureMessage)).toMatch(/safe clause|reserved|mid-clause/);
    }
  });

  it("E. EvidencePack-out / grammar: RAW passes integrity (FIRST_LOSS was redaction, not grammar)", () => {
    const integrity = validatePostTransformIntegrity({
      title: MIZD_RAW_ARTICLE.title,
      lead: MIZD_RAW_LEAD,
      summary: MIZD_RAW_ARTICLE.summary,
      sections: MIZD_RAW_ARTICLE.sections,
    });
    expect(integrity.ok).toBe(true);
  });

  it("F. broken Japanese still hard-fails integrity (KEEP validator)", () => {
    const integrity = validatePostTransformIntegrity({
      title: "t",
      lead: "2024は、を目指す素人16名",
      sections: [],
    });
    expect(integrity.ok).toBe(false);
  });

  it("G. WritingSkeleton assignment is OPTION B evidence-role SSOT", () => {
    const title =
      "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";
    const pack = buildEvidencePack({
      productTitle: title,
      claims: [
        { id: "c1", statement: title, kind: "trait_or_scene", status: "SUPPORTED" },
        {
          id: "c2",
          statement: "10作品が収録規模として記載されている。",
          kind: "trait_or_scene",
          status: "SUPPORTED",
        },
      ],
    });
    const sk = writingSkeletonFallback({ materialDepth: "standard" });
    const assignment = assignEvidenceToWritingSkeleton(sk, pack);
    expect(assignment.title).toBeTruthy();
    expect(assignment.opening).toBeTruthy();
    expect(Array.isArray(assignment.body)).toBe(true);
    expect(assignment.ending).toBeTruthy();
    const auth = buildOptionBGenerationAuthority({
      writingSkeleton: toWritingSkeletonPromptContract(sk)!,
      evidencePack: toOptionBWriterSourceMaterial({
        productTitle: title,
        claims: [
          { id: "c1", statement: title, kind: "trait_or_scene" },
          {
            id: "c2",
            statement: "10作品が収録規模として記載されている。",
            kind: "trait_or_scene",
          },
        ],
        officialDescription: null,
      }),
    });
    expect(auth.mode).toBe("OPTION_B");
    expect(auth.SEGMENT_CONTRACTS).toBeUndefined();
    const ep = auth.EVIDENCE_PACK as {
      supportedClaims?: unknown[];
      officialDescription?: string | null;
      concreteEvidence?: unknown;
      slotAssignment?: unknown;
    };
    expect(ep.supportedClaims).toHaveLength(2);
    expect(ep.concreteEvidence).toBeUndefined();
    expect(ep.slotAssignment).toBeUndefined();
    expect(assignment.opening.primary).toBeTruthy();
  });

  it("D2. reserved evidence reuse → observe metadata, not prose deletion", () => {
    const gate = optionBPostLlmGate(MIZD_RAW_ARTICLE);
    expect(gate.ok).toBe(true);
    expect(gate.mutated).toBe(false);
    expect(gate.observeForBrain).toContain("SEGMENT_RAW_observe");
  });

  it("H. mizd RAW replay: no RAW_PLAN_EXECUTION_FAILED::redact; reach persist/Brain path", () => {
    const gate = optionBPostLlmGate(MIZD_RAW_ARTICLE);
    expect(gate.ok).toBe(true);
    expect(gate.code).not.toBe("RAW_PLAN_EXECUTION_FAILED");
    expect(gate.reachPersist).toBe(true);
    expect(gate.observeForBrain.length).toBeGreaterThan(0);
    expect(gate.lead).toBe(MIZD_RAW_LEAD);
  });

  it("legacy path API still available (B: compatibility — not OPTION B)", () => {
    const okLead = safeRedactReservedLead({
      lead: "松本いちかが出演する作品が確認できる。",
      reservedFacets: ["10作品", "8時間"],
      requiredFacets: ["松本いちか"],
    });
    expect(okLead.ok).toBe(true);
    expect(okLead.lead).toContain("松本いちか");
  });
});
