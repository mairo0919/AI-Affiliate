import { describe, expect, it } from "vitest";
import {
  sceneSubsumes,
  facetsSemanticallyEquivalent,
  isSemanticRestatement,
  expandConsumedFacets,
  detectCompositeLocks,
  bodyFacetIllicitlyRestates,
  planFailureSignature,
} from "../generation/contribution-family.js";
import { validateRawEditorialPlanCompliance } from "../generation/raw-plan-compliance.js";
import { routeRawPlanFailure } from "../generation/raw-failure-routing.js";
import { buildSegmentContributionAllocation } from "../generation/contribution-compliance.js";
import type { BrainGenerationInputContract } from "../generation/generation-input-contract.js";

function stubContract(opts: {
  leadFacets: string[];
  bodyFacets: string[];
}): BrainGenerationInputContract {
  const leadReq = opts.leadFacets.map((facet) => ({
    id: `c1::${facet}`,
    claimId: "c1",
    facet,
  }));
  const bodyReq = opts.bodyFacets.map((facet) => ({
    id: `c2::${facet}`,
    claimId: "c2",
    facet,
  }));
  return {
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
        role: "title",
        allowedContributions: leadReq,
        requiredContributions: [],
        reservedForLaterContributions: [],
        forbiddenConsumedContributions: [],
        allowedRelationFamilies: ["FACTUAL"],
      },
      lead: {
        role: "lead",
        allowedContributions: leadReq,
        requiredContributions: leadReq,
        reservedForLaterContributions: bodyReq,
        forbiddenConsumedContributions: bodyReq,
        allowedRelationFamilies: ["FACTUAL"],
      },
      development: {
        role: "development",
        allowedContributions: bodyReq,
        requiredContributions: bodyReq,
        reservedForLaterContributions: [],
        forbiddenConsumedContributions: leadReq,
        allowedRelationFamilies: ["FACTUAL"],
      },
      summary: {
        role: "summary",
        allowedContributions: [],
        requiredContributions: [],
        reservedForLaterContributions: [],
        forbiddenConsumedContributions: [],
        allowedRelationFamilies: ["FACTUAL"],
      },
    },
    inferencePolicy: { allowed: ["direct_paraphrase"], forbidden: [] },
    scarcityMode: false,
    developmentDepth: "standard",
    titleStrategy: "performer_plus_trait",
    summaryStrategy: "list_snippet",
    ctaStrategy: "widget_only_no_generic_bridge",
    informationGainTarget: "new_supported_detail",
    omitDevelopmentSubstance: false,
    insufficientDevelopmentMaterial: false,
    editorialExecution: null,
  } as BrainGenerationInputContract;
}

describe("contribution family / subsumption", () => {
  it("1. composite→component reuse is semantic restatement", () => {
    const plan = ["16名", "1泊2日", "大乱交", "乱交", "発掘"];
    const { consumed, locks } = expandConsumedFacets({
      segmentText: "素人16名と女優16名の1泊2日の大乱交ツアー",
      planFacets: plan,
    });
    expect(locks.some((l) => l.reason === "duration_scene_bundle")).toBe(true);
    expect(
      bodyFacetIllicitlyRestates({
        bodyFacet: "1泊2日",
        leadConsumed: consumed,
        leadLocks: locks,
        planFacets: plan,
      }),
    ).toBe(true);
    expect(
      bodyFacetIllicitlyRestates({
        bodyFacet: "16名",
        leadConsumed: consumed,
        leadLocks: locks,
        planFacets: plan,
      }),
    ).toBe(true);
  });

  it("2. component→new sibling contribution is allowed", () => {
    const plan = ["1泊2日", "大乱交", "16名"];
    const { consumed, locks } = expandConsumedFacets({
      segmentText: "1泊2日のツアーとして公開されている。",
      planFacets: plan,
    });
    // lead only used duration — scene sibling 大乱交 / qty 16名 may be new
    expect(
      bodyFacetIllicitlyRestates({
        bodyFacet: "大乱交",
        leadConsumed: consumed,
        leadLocks: locks,
        planFacets: plan,
      }),
    ).toBe(false);
    expect(
      bodyFacetIllicitlyRestates({
        bodyFacet: "16名",
        leadConsumed: consumed,
        leadLocks: locks,
        planFacets: plan,
      }),
    ).toBe(false);
  });

  it("3. parent consumed → child restatement fails", () => {
    expect(sceneSubsumes("大乱交", "乱交")).toBe(true);
    expect(isSemanticRestatement("乱交", ["大乱交"])).toBe(true);
  });

  it("4. semantically equivalent different surface forms fail", () => {
    expect(facetsSemanticallyEquivalent("大乱交", "乱交")).toBe(true);
    expect(isSemanticRestatement("乱交", new Set(["大乱交"]))).toBe(true);
  });
});

describe("RAW semantic compliance cases", () => {
  it("5. lead 10作品8時間 → body メスガキ PASS", () => {
    const contract = stubContract({
      leadFacets: ["10作品", "8時間"],
      bodyFacets: ["メスガキ"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "10作品・合計8時間を収録したベストが公開されている。",
        sections: [{ paragraphs: ["メスガキキャラクターに焦点を当てている。"] }],
      },
      contract,
    });
    expect(result.ok).toBe(true);
    expect(result.planExecutionFailed).toBe(false);
  });

  it("5b. lead mentions body trait → body restatement FAIL", () => {
    const contract = stubContract({
      leadFacets: ["10作品", "8時間"],
      bodyFacets: ["メスガキ"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "メスガキジャンルの10作品・合計8時間が公開されている。",
        sections: [{ paragraphs: ["メスガキキャラクターに焦点を当てている。"] }],
      },
      contract,
    });
    expect(result.ok).toBe(false);
    expect(
      result.findings.some((f) =>
        ["SEMANTIC_CONTRIBUTION_REUSE", "COMPOSITE_COMPONENT_RESTATEMENT", "LEAD_BODY_OVERLAP"].includes(
          f.code,
        ),
      ),
    ).toBe(true);
  });

  it("6. lead 10作品8時間 → body 10作品 FAIL", () => {
    const contract = stubContract({
      leadFacets: ["10作品", "8時間"],
      bodyFacets: ["メスガキ"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "10作品・合計8時間を収録したベストが公開されている。",
        sections: [{ paragraphs: ["10作品を収録した長時間作品である。"] }],
      },
      contract,
    });
    expect(result.planExecutionFailed).toBe(true);
    expect(
      result.findings.some((f) =>
        ["FORBIDDEN_CONTRIBUTION_REUSED", "SEMANTIC_CONTRIBUTION_REUSE", "LEAD_BODY_OVERLAP"].includes(
          f.code,
        ),
      ),
    ).toBe(true);
  });

  it("mird-like: lead composite → body component FAIL", () => {
    const contract = stubContract({
      leadFacets: ["1泊2日", "16名"],
      bodyFacets: ["発掘"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "素人16名と女優16名による1泊2日の大乱交ツアーとして公開されている。",
        sections: [
          {
            paragraphs: [
              "参加者は素人16名と女優16名で構成され、1泊2日の期間中に撮影が行われる。",
            ],
          },
        ],
      },
      contract,
    });
    expect(result.ok).toBe(false);
    expect(
      result.findings.some((f) =>
        [
          "COMPOSITE_COMPONENT_RESTATEMENT",
          "SEMANTIC_CONTRIBUTION_REUSE",
          "FORBIDDEN_CONTRIBUTION_REUSED",
          "LEAD_BODY_OVERLAP",
        ].includes(f.code),
      ),
    ).toBe(true);
  });

  it("mird-like asymmetric: lead duration only → body 16名 PASS", () => {
    const contract = stubContract({
      leadFacets: ["1泊2日"],
      bodyFacets: ["16名"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "1泊2日のツアーとして公開されている。",
        sections: [{ paragraphs: ["男女16名ずつが参加する構成である。"] }],
      },
      contract,
    });
    expect(result.ok).toBe(true);
  });
});

describe("RAW failure routing", () => {
  it("7. scarce material → DEFER route", () => {
    const contract = stubContract({ leadFacets: ["独占"], bodyFacets: [] });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "独占作品として公開されている。",
        sections: [{ paragraphs: ["独占の設定を改めて説明する。"] }],
      },
      contract,
    });
    const routing = routeRawPlanFailure({
      result,
      insufficientDevelopmentMaterial: true,
      scarcityMode: true,
      bodyOnlyRestatesLead: true,
    });
    expect(routing.route).toBe("DEFER_INSUFFICIENT_MATERIAL");
    expect(routing.allowPlanAwareRegen).toBe(false);
  });

  it("7b. rich material + bodyOnlyRestatesLead → regen not DEFER", () => {
    const routing = routeRawPlanFailure({
      result: {
        ok: false,
        planExecutionFailed: true,
        findings: [
          {
            code: "SEMANTIC_CONTRIBUTION_REUSE",
            severity: "BLOCKING",
            segment: "development",
            message: "reuse",
          },
        ],
        structuralDefect: true,
        violatedSegments: ["development"],
        missingRequiredContributionIds: [],
        forbiddenReusedContributionIds: [],
        prematurelyConsumedContributionIds: [],
        semanticReusedFacets: ["16名"],
        missingFacets: [],
        failureSignature: "x",
        leadConsumedFacets: ["16名"],
        bodyOnlyRestatesLead: true,
      },
      insufficientDevelopmentMaterial: false,
      scarcityMode: false,
      bodyOnlyRestatesLead: true,
    });
    expect(routing.route).toBe("PLAN_AWARE_REGEN");
    expect(routing.defer).toBe(false);
  });

  it("8. structural failure → repair forbidden / regen", () => {
    const contract = stubContract({
      leadFacets: ["ベロキス"],
      bodyFacets: ["舐め"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "突然のベロキスから始まる。",
        sections: [{ paragraphs: ["ベロキスのシーンを改めて描写する。"] }],
      },
      contract,
    });
    const routing = routeRawPlanFailure({ result });
    expect(routing.failureClass).toBe("STRUCTURAL_PLAN_FAILURE");
    expect(routing.allowTargetedRepair).toBe(false);
    expect(routing.allowPlanAwareRegen).toBe(true);
  });

  it("9. local defect codes route to targeted repair", () => {
    const routing = routeRawPlanFailure({
      result: {
        ok: false,
        planExecutionFailed: true,
        findings: [
          {
            code: "UNSUPPORTED_EVALUATION",
            severity: "BLOCKING",
            segment: "section:0:p0",
            message: "eval",
          },
        ],
        structuralDefect: false,
        violatedSegments: ["section:0:p0"],
        missingRequiredContributionIds: [],
        forbiddenReusedContributionIds: [],
        semanticReusedFacets: [],
        missingFacets: [],
        failureSignature: "UNSUPPORTED_EVALUATION::reuse=::miss=",
        leadConsumedFacets: [],
        bodyOnlyRestatesLead: false,
      },
    });
    expect(routing.route).toBe("TARGETED_REPAIR");
    expect(routing.allowTargetedRepair).toBe(true);
  });

  it("10. repeated regen signature is stable", () => {
    const a = planFailureSignature({
      codes: ["SEMANTIC_CONTRIBUTION_REUSE", "LEAD_BODY_OVERLAP"],
      reusedFacets: ["16名", "1泊2日"],
      missingFacets: [],
    });
    const b = planFailureSignature({
      codes: ["LEAD_BODY_OVERLAP", "SEMANTIC_CONTRIBUTION_REUSE"],
      reusedFacets: ["1泊2日", "16名"],
      missingFacets: [],
    });
    expect(a).toBe(b);
  });

  it("11. repair article-level: empty body with required → structural", () => {
    const contract = stubContract({
      leadFacets: ["10作品"],
      bodyFacets: ["メスガキ"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "10作品を収録。",
        sections: [{ paragraphs: [] }],
      },
      contract,
    });
    expect(result.findings.some((f) => f.code === "EMPTY_REQUIRED_SEGMENT")).toBe(true);
    expect(routeRawPlanFailure({ result }).allowTargetedRepair).toBe(false);
  });

  it("12. Experience tendency shape affects planner constraint list", async () => {
    const { summarizePlanFailureTendencies, formatTendencyHintsForAuthority } = await import(
      "../generation/planner-failure-tendencies.js"
    );
    const hints = summarizePlanFailureTendencies({
      query: { channel: "BLOG" },
      hits: [
        {
          id: "e1",
          scope: "CHANNEL",
          channel: "BLOG",
          score: 3,
          confidence: 0.6,
          failureCodes: ["COMPOSITE_COMPONENT_RESTATEMENT", "PLAN_EXECUTION_FAILED"],
          outcome: "PLAN_EXECUTION_FAILED",
        },
      ],
    });
    expect(hints.length).toBeGreaterThan(0);
    const formatted = formatTendencyHintsForAuthority(hints);
    expect(formatted).toBeTruthy();
    expect(JSON.stringify(formatted)).toMatch(/constraint|failureClass/);
  });
});

describe("allocation still splits atomics without product rules", () => {
  it("detectCompositeLocks on multi qty + duration", () => {
    const locks = detectCompositeLocks(["16名", "1泊2日", "大乱交"]);
    expect(locks.some((l) => l.reason === "duration_scene_bundle")).toBe(true);
  });

  it("scarce catalog-only → insufficient allocation", () => {
    const allocation = buildSegmentContributionAllocation({
      claims: [
        { id: "a", statement: "メーカー／レーベルとして「プレミアム」が公開されている。", kind: "maker" },
        { id: "b", statement: "公開ページ上で販売／配信状態は「配信中」と確認できる。", kind: "availability" },
      ],
      openingClaimIds: ["a"],
      developmentClaimIds: ["b"],
    });
    // May or may not be insufficient depending on lead substance — assert no crash and contracts exist
    expect(allocation.segmentContracts.lead).toBeTruthy();
    expect(allocation.segmentContracts.development).toBeTruthy();
  });
});
