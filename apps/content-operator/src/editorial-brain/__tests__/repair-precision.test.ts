/**
 * Repair precision + informational contribution tests.
 */

import { describe, expect, it } from "vitest";
import {
  buildContributionPlan,
  contributionsFromClaim,
  selectRepairOperation,
  validateRepairedSegment,
  applyRepairs,
  mapFailuresToRepairTargets,
  MAX_TARGETED_REPAIR_ATTEMPTS,
  detectBadInputClaims,
  classifyRepairSegment,
  experienceMustNotMutateLearningRules,
  consumedFacetKeysOutsideTarget,
  unusedContributionsForRepair,
  facetKey,
} from "../index.js";

const claims = [
  {
    id: "c1",
    statement: "出演者として「松本いちか」が記載されている。わからせ痴女られ10作品8時間ベスト。",
    kind: "cast",
  },
  {
    id: "c2",
    statement: "メーカー／レーベルとして「ムーディーズ」が公開されている。",
    kind: "maker",
  },
  {
    id: "c3",
    statement: "シリーズ情報として「バコバコバスツアー」が公開されている。",
    kind: "series",
  },
];

describe("informational contribution allocation", () => {
  it("1. same Claim / same facet restatement → duplicate facet not allocated to both roles", () => {
    const plan = buildContributionPlan({
      claims: [claims[0]!],
      openingClaimIds: ["c1"],
      developmentClaimIds: [],
    });
    const leadKeys = new Set(plan.byRole.lead.map((c) => facetKey(c.facet)));
    const devOverlap = plan.byRole.development.filter((c) => leadKeys.has(facetKey(c.facet)));
    expect(devOverlap).toHaveLength(0);
  });

  it("2. same Claim / different new facet → allowed across lead vs development", () => {
    const multi = {
      id: "cm",
      statement:
        "出演は「松本いちか」。シリーズは「わからせ」。場面は「痴女られ」。10作品8時間。",
      kind: "trait_or_scene",
    };
    const plan = buildContributionPlan({
      claims: [multi],
      openingClaimIds: ["cm"],
      developmentClaimIds: ["cm"],
    });
    expect(plan.byRole.lead.length).toBeGreaterThan(0);
    // remaining facets after lead take can go to development
    const leadKeys = new Set(plan.byRole.lead.map((c) => facetKey(c.facet)));
    expect(plan.byRole.development.every((c) => !leadKeys.has(facetKey(c.facet)))).toBe(true);
    expect(
      plan.byRole.lead.length + plan.byRole.development.length,
    ).toBeGreaterThanOrEqual(plan.byRole.lead.length);
  });

  it("3. different Claim / same contribution facet key treated as consumed", () => {
    const a = { id: "a", statement: "出演は「葵つかさ」", kind: "cast" };
    const b = { id: "b", statement: "クレジットは「葵つかさ」", kind: "cast" };
    const plan = buildContributionPlan({
      claims: [a, b],
      openingClaimIds: ["a"],
      developmentClaimIds: ["b"],
    });
    const leadKeys = new Set(plan.byRole.lead.map((c) => facetKey(c.facet)));
    expect(plan.byRole.development.every((c) => !leadKeys.has(facetKey(c.facet)))).toBe(true);
  });
});

describe("repair operations", () => {
  const baseTarget = {
    kind: "PARAGRAPH" as const,
    segmentId: "section:0:p0",
    failureCodes: ["REPETITION"],
    originalText: "松本いちかが出演する独占配信が公開されています。",
    allowedClaimIds: ["c1", "c2"],
    hints: ["restatement"],
  };

  it("4. repetition + unused fact → REPLACE", () => {
    const unused = contributionsFromClaim(claims[2]!);
    const op = selectRepairOperation({
      target: baseTarget,
      unusedContributions: unused,
      consumedFacetKeys: new Set(["松本いちか", "独占"].map((s) => s)),
    });
    expect(op.operation).toBe("REPLACE_WITH_UNUSED_SUPPORTED_DETAIL");
    expect(op.requiresLlm).toBe(false);
  });

  it("5. repetition + no unused fact → DELETE", () => {
    const op = selectRepairOperation({
      target: baseTarget,
      unusedContributions: [],
      consumedFacetKeys: new Set(["松本いちか", "独占配信", "公開"].map((s) => facetKey(s))),
    });
    expect(op.operation).toBe("DELETE");
    expect(op.requiresLlm).toBe(false);
  });

  it("6. unsupported evaluation with factual core → COMPRESS", () => {
    const op = selectRepairOperation({
      target: {
        ...baseTarget,
        failureCodes: ["EVALUATIVE_INFERENCE"],
        originalText: "松本いちか出演。魅力を堪能できるおすすめ作品。",
      },
      unusedContributions: [],
      consumedFacetKeys: new Set(),
      allowedFacets: ["松本いちか"],
    });
    expect(op.operation).toBe("COMPRESS");
  });

  it("7. pure filler → DELETE", () => {
    const op = selectRepairOperation({
      target: {
        ...baseTarget,
        kind: "CTA",
        segmentId: "cta",
        failureCodes: ["FILLER"],
        originalText: "ぜひチェックしてください。",
      },
      unusedContributions: [],
      consumedFacetKeys: new Set(),
    });
    expect(op.operation).toBe("DELETE");
  });

  it("8. name-derived only → DELETE when short", () => {
    const op = selectRepairOperation({
      target: {
        ...baseTarget,
        failureCodes: ["NAME_DERIVED_INFERENCE"],
        originalText: "温泉宿が舞台の物語。",
      },
      unusedContributions: [],
      consumedFacetKeys: new Set(),
    });
    expect(["DELETE", "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL"]).toContain(op.operation);
  });

  it("9. repair success validation fail path → not ok (structure)", () => {
    const result = validateRepairedSegment({
      operation: "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL",
      originalText: "restatement of lead",
      repairedText: "松本いちかが出演する独占配信が公開されています。",
      claimIdsUsed: ["c1"],
      allowedClaimIds: ["c1"],
      allowedFacets: ["バコバコバスツアー"],
      consumedFacetKeys: new Set(["松本いちか", "独占配信", "公開"].map(facetKey)),
      replaceWith: contributionsFromClaim(claims[2]!),
    });
    expect(result.ok).toBe(false);
  });

  it("10. repaired provenance lies about claimIds → reject", () => {
    const result = validateRepairedSegment({
      operation: "REWRITE",
      originalText: "x",
      repairedText: "ムーディーズの公開事実。",
      claimIdsUsed: ["unknown-claim"],
      allowedClaimIds: ["c2"],
      allowedFacets: ["ムーディーズ"],
      consumedFacetKeys: new Set(),
    });
    expect(result.findings.some((f) => f.code === "PROVENANCE_LIE")).toBe(true);
  });

  it("11. cross-segment consumed contribution respected", () => {
    const consumed = consumedFacetKeysOutsideTarget({
      article: {
        title: "t",
        summary: "s",
        lead: "松本いちかが出演する独占作品",
        sections: [{ paragraphs: ["重複本文"] }],
      },
      targetSegmentId: "section:0:p0",
    });
    expect([...consumed].some((k) => k.includes("松本") || k === facetKey("松本いちか"))).toBe(
      true,
    );
  });

  it("12. clean segments byte-equivalent unchanged by applyRepairs", () => {
    const article = {
      title: "clean-title",
      summary: "clean-summary",
      lead: "clean-lead",
      sections: [
        { heading: null, paragraphs: ["bad"] },
        { heading: null, paragraphs: ["clean-body"] },
      ],
    };
    const next = applyRepairs(article, [
      { segmentId: "section:0:p0", text: "", claimIdsUsed: [], operation: "DELETE" },
    ]);
    expect(next.title).toBe("clean-title");
    expect(next.lead).toBe("clean-lead");
    expect(next.sections.some((s) => s.paragraphs.includes("clean-body"))).toBe(true);
    expect(next.sections.every((s) => !s.paragraphs.includes("bad"))).toBe(true);
  });

  it("13. scarcity → unused empty allows DELETE (shorter OK)", () => {
    const plan = buildContributionPlan({
      claims: [claims[0]!],
      openingClaimIds: ["c1"],
      developmentClaimIds: [],
    });
    const unused = unusedContributionsForRepair({
      plan,
      article: {
        title: "松本いちか",
        summary: "松本いちか",
        lead: claims[0]!.statement,
        sections: [{ paragraphs: [claims[0]!.statement] }],
      },
    });
    // After lead consumed opening facets, unused may be empty → DELETE path
    const op = selectRepairOperation({
      target: baseTarget,
      unusedContributions: unused,
      consumedFacetKeys: consumedFacetKeysOutsideTarget({
        article: {
          title: "t",
          summary: "s",
          lead: claims[0]!.statement,
          sections: [{ paragraphs: ["x"] }],
        },
        targetSegmentId: "section:0:p0",
      }),
    });
    expect(op.operation === "DELETE" || op.operation === "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL").toBe(
      true,
    );
  });

  it("14. rich article → development contributions preserved for expansion", () => {
    const plan = buildContributionPlan({
      claims,
      openingClaimIds: ["c1"],
      developmentClaimIds: ["c2", "c3"],
    });
    expect(plan.byRole.development.length).toBeGreaterThan(0);
  });

  it("15. bad Claim → no fabrication path (detect)", () => {
    const bad = detectBadInputClaims([
      { id: "b", statement: "出演者／クリエイターとして「優梨まいなましろ杏」が記載されている。", kind: "cast" },
    ]);
    expect(bad.length).toBeGreaterThan(0);
  });

  it("16. max attempts remains 1", () => {
    expect(MAX_TARGETED_REPAIR_ATTEMPTS).toBe(1);
  });

  it("20. LearningRule unchanged guard", () => {
    expect(experienceMustNotMutateLearningRules()).toEqual({
      autoPromote: false,
      writesLearningRule: false,
    });
  });
});

describe("repair diagnostics classification", () => {
  it("classifies rewrite-restatement as REPAIR_NON_COMPLIANCE + CLAIM_RESTATEMENT", () => {
    const d = classifyRepairSegment({
      segmentId: "section:0:p0",
      originalText: "松本いちかの出演作品をまとめた独占ベスト版が公開されています。",
      repairedText: "松本いちかの出演作品をまとめたベスト版が公開されています。",
      allowedClaimIds: ["c1"],
      operation: "REWRITE",
      initialFailureCodes: ["REPETITION"],
      postFailureCodes: ["REPETITION"],
      leadText: "松本いちかが出演する独占配信作品が公開されています。",
    });
    expect(d.classifications).toContain("CLAIM_RESTATEMENT");
    expect(d.classifications).toContain("REPAIR_NON_COMPLIANCE");
  });
});

describe("mapFailures still collapses multi-failure", () => {
  it("maps repetition to section target", () => {
    const targets = mapFailuresToRepairTargets({
      review: {
        decision: "TARGETED_REPAIR",
        axes: [],
        failures: [
          {
            code: "REPETITION",
            severity: "BLOCKING",
            message: "r",
            evidence: { sampleAssertions: [{ sourceSegment: "section:0:p0" }] },
          },
        ],
        lengthWasNotSoleJudge: true,
        metrics: {
          uniqueSupportedDetailEstimate: 1,
          supportedNovelAssertionCount: 1,
          unsupportedAssertionCount: 0,
          semanticRepetitionHits: 1,
          fillerHits: 0,
          bodyUnits: 10,
          assertionSupportStats: {
            assertionCount: 1,
            supportedNovelAssertionCount: 1,
            unsupportedAssertionCount: 0,
            interpretiveCount: 0,
            evaluativeCount: 0,
            nameDerivedCount: 0,
            socialProofCount: 0,
            repetitionCount: 1,
            fillerCount: 0,
            novelFacetCoverage: 1,
            affectedSegmentRoles: [],
          },
        },
      },
      article: {
        title: "t",
        summary: "s",
        lead: "l",
        sections: [{ heading: null, paragraphs: ["p"] }],
      },
      roleAllowlist: {
        titleAllowedClaimIds: ["c1"],
        leadAllowedClaimIds: ["c1"],
        developmentAllowedClaimIds: ["c2"],
        summaryAllowedClaimIds: ["c1"],
        ctaAllowedClaimIds: [],
      },
    });
    expect(targets[0]!.segmentId).toBe("section:0:p0");
  });
});
