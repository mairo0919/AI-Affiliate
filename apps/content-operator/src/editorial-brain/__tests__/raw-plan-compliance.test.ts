import { describe, expect, it } from "vitest";
import { validateRawEditorialPlanCompliance } from "../generation/raw-plan-compliance.js";
import { buildSegmentExecutionContract } from "../generation/segment-execution.js";
import { summarizePlanFailureTendencies } from "../generation/planner-failure-tendencies.js";
import {
  buildGenerationAuthorityPromptContract,
  GENERATION_AUTHORITY_PRIORITY,
} from "../../generation/generation-authority.js";
import type { BrainGenerationInputContract } from "../generation/generation-input-contract.js";

function stubContract(overrides?: Partial<BrainGenerationInputContract>): BrainGenerationInputContract {
  const leadReq = [
    { id: "c1::10作品", claimId: "c1", facet: "10作品" },
    { id: "c1::8時間", claimId: "c1", facet: "8時間" },
  ];
  const bodyReq = [
    { id: "c2::わからせ", claimId: "c2", facet: "わからせ" },
  ];
  const base = {
    corePlan: {} as never,
    channelPlan: {} as never,
    roleAllowlist: {
      titleAllowedClaimIds: ["c1"],
      leadAllowedClaimIds: ["c1"],
      developmentAllowedClaimIds: ["c2"],
      summaryAllowedClaimIds: ["c1", "c2"],
      ctaAllowedClaimIds: [],
      omittedClaimIds: [],
    },
    roleClaims: { title: [], lead: [], development: [], summary: [] },
    roleFactualBoundaries: {
      title: { allowedClaims: [], forbiddenInventions: [] },
      lead: { allowedClaims: [], forbiddenInventions: [] },
      development: { allowedClaims: [], forbiddenInventions: [] },
      summary: { allowedClaims: [], forbiddenInventions: [] },
    },
    contributionPlan: {} as never,
    segmentAllocation: {} as never,
    segmentContracts: {
      title: {
        role: "title" as const,
        allowedContributions: leadReq,
        requiredContributions: [],
        reservedForLaterContributions: [],
        forbiddenConsumedContributions: [],
        allowedRelationFamilies: ["FACTUAL" as const],
      },
      lead: {
        role: "lead" as const,
        allowedContributions: leadReq,
        requiredContributions: leadReq,
        reservedForLaterContributions: bodyReq,
        forbiddenConsumedContributions: bodyReq,
        allowedRelationFamilies: ["FACTUAL" as const],
      },
      development: {
        role: "development" as const,
        allowedContributions: bodyReq,
        requiredContributions: bodyReq,
        reservedForLaterContributions: [],
        forbiddenConsumedContributions: leadReq,
        allowedRelationFamilies: ["FACTUAL" as const],
      },
      summary: {
        role: "summary" as const,
        allowedContributions: [],
        requiredContributions: [],
        reservedForLaterContributions: [],
        forbiddenConsumedContributions: [],
        allowedRelationFamilies: ["FACTUAL" as const],
      },
    },
    inferencePolicy: { allowed: ["direct_paraphrase"], forbidden: [] },
    scarcityMode: false,
    developmentDepth: "standard" as const,
    titleStrategy: "performer_plus_trait",
    summaryStrategy: "list_snippet",
    ctaStrategy: "widget_only_no_generic_bridge",
    informationGainTarget: "new_supported_detail",
    omitDevelopmentSubstance: false,
    insufficientDevelopmentMaterial: false,
    editorialExecution: null,
  };
  return { ...base, ...overrides } as BrainGenerationInputContract;
}

describe("raw plan compliance + authority", () => {
  it("passes when lead/body consume distinct required contributions", () => {
    const contract = stubContract();
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "いちかベスト",
        summary: "収録規模の整理",
        lead: "10作品・8時間の収録規模が確認できる。",
        sections: [{ paragraphs: ["わからせ展開がSUPPORTEDとして確認できる。"] }],
      },
      contract,
    });
    expect(result.ok).toBe(true);
    expect(result.planExecutionFailed).toBe(false);
  });

  it("flags lead/body overlap and forbidden reuse as PLAN_EXECUTION_FAILED", () => {
    const contract = stubContract();
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "10作品と8時間が揃う。",
        sections: [{ paragraphs: ["10作品・8時間のボリュームを改めて説明する。"] }],
      },
      contract,
    });
    expect(result.planExecutionFailed).toBe(true);
    expect(result.structuralDefect).toBe(true);
    expect(
      result.findings.some(
        (f) =>
          f.severity === "BLOCKING" &&
          (f.code === "LEAD_BODY_OVERLAP" ||
            f.code === "FORBIDDEN_CONTRIBUTION_REUSED" ||
            f.code === "SEMANTIC_CONTRIBUTION_REUSE" ||
            f.code === "COMPOSITE_COMPONENT_RESTATEMENT"),
      ),
    ).toBe(true);
  });

  it("builds progressive segmentExecution slots", () => {
    const contract = stubContract();
    const exec = buildSegmentExecutionContract(contract);
    expect(exec.progressive).toBe(true);
    expect(exec.slots[0]?.role).toBe("lead");
    expect(exec.slots[0]?.requiredContributionIds).toContain("c1::10作品");
    expect(exec.slots.some((s) => s.forbiddenContributionIds.includes("c1::10作品"))).toBe(true);
  });

  it("authority priority is OPTION B: FACTUAL > EVIDENCE_PACK > WRITING_SKELETON > CHANNEL > style", () => {
    expect(GENERATION_AUTHORITY_PRIORITY[0]).toBe("FACTUAL_SAFETY");
    expect(GENERATION_AUTHORITY_PRIORITY[1]).toBe("EVIDENCE_PACK");
    expect(GENERATION_AUTHORITY_PRIORITY[2]).toBe("WRITING_SKELETON");
    expect(GENERATION_AUTHORITY_PRIORITY[3]).toBe("BLOG_CHANNEL_REQUIREMENTS");
    expect(GENERATION_AUTHORITY_PRIORITY[4]).toBe("MINIMAL_STYLE");
    const auth = buildGenerationAuthorityPromptContract({
      brainGenerationContract: {
        writingSkeleton: { opening: { purpose: "hook" } },
        evidencePack: { concreteEvidence: [{ id: "1", fact: "10作品" }] },
        layers: { FACTS: {}, EDITORIAL_PLAN: { openingStrategy: "x" }, SEGMENT_CONTRACTS: {} },
        segmentExecution: { progressive: true },
      },
      planViolationFeedback: {
        attempt: 1,
        violatedSegments: ["development"],
        missingRequiredContributionIds: [],
        forbiddenReusedContributionIds: ["c1::10作品"],
        codes: ["FORBIDDEN_CONTRIBUTION_REUSED"],
        note: "fix only",
      },
    });
    expect(auth.mode).toBe("OPTION_B");
    expect(auth.planViolationFeedback).toBeTruthy();
    expect(auth.authorityPriority).toEqual([...GENERATION_AUTHORITY_PRIORITY]);
  });

  it("summarizes experience failure tendencies without dumping prose", () => {
    const hints = summarizePlanFailureTendencies({
      query: { channel: "BLOG" },
      hits: [
        {
          id: "e1",
          scope: "CHANNEL",
          channel: "BLOG",
          score: 3,
          confidence: 0.5,
          failureCodes: ["LEAD_BODY_OVERLAP", "PLAN_EXECUTION_FAILED"],
          outcome: "PLAN_EXECUTION_FAILED",
        },
        {
          id: "e2",
          scope: "CHANNEL",
          channel: "BLOG",
          score: 2,
          confidence: 0.4,
          failureCodes: ["LEAD_BODY_OVERLAP"],
          outcome: "PLAN_EXECUTION_FAILED",
        },
      ],
    });
    expect(hints[0]?.failureClass).toBe("LEAD_BODY_OVERLAP");
    expect(hints[0]?.sampleCount).toBe(2);
    expect(hints[0]?.executionConstraint).toMatch(/lead-required/i);
  });
});
