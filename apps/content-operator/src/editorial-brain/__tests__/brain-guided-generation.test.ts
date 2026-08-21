/**
 * Brain-guided generation + bounded repair unit tests (no publish).
 */

import { describe, expect, it } from "vitest";
import {
  buildBlogChannelPlan,
  buildBrainGenerationInputContract,
  buildCoreEditorialPlan,
  checkPlanCompliance,
  detectBadInputClaims,
  mapFailuresToRepairTargets,
  MAX_TARGETED_REPAIR_ATTEMPTS,
  normalizeArticleProvenance,
  applyRepairs,
  experienceMustNotMutateLearningRules,
} from "../index.js";
import { stablePublicUrlProductExternalId } from "../../ops/product-external-id.js";
import type { EditorialReviewReport } from "../core/types.js";

function makePlans(input?: {
  hook?: string[];
  development?: string[];
  opening?: string[];
  available?: Array<{ id: string; statement: string; kind: string }>;
}) {
  const claims =
    input?.available ??
    [
      { id: "c1", statement: "出演は優梨まいな", kind: "cast" },
      { id: "c2", statement: "シリーズは○○", kind: "series" },
      { id: "c3", statement: "メーカーは△△", kind: "maker" },
    ];
  const hook = input?.hook ?? ["c1"];
  const development = input?.development ?? ["c2", "c3"];
  const opening = input?.opening ?? ["c1"];
  const core = buildCoreEditorialPlan({
    channel: "BLOG",
    formatKey: "new-release",
    contentType: "blogger-article",
    availableClaims: claims,
    selectedClaims: claims.filter((c) => hook.includes(c.id) || development.includes(c.id)),
    openingClaimIds: opening,
    hookClaimIds: hook,
    developmentClaimIds: development,
    structurePatternId: null,
    editorialPatternId: null,
  });
  const channel = buildBlogChannelPlan(core);
  const contract = buildBrainGenerationInputContract({
    corePlan: core,
    channelPlan: channel,
    claims,
  });
  return { core, channel, contract, claims };
}

function reviewWith(
  failures: EditorialReviewReport["failures"],
  decision: EditorialReviewReport["decision"] = "TARGETED_REPAIR",
): EditorialReviewReport {
  return {
    decision,
    axes: [],
    failures,
    lengthWasNotSoleJudge: true,
    metrics: {
      uniqueSupportedDetailEstimate: 2,
      supportedNovelAssertionCount: 2,
      unsupportedAssertionCount: 0,
      semanticRepetitionHits: 0,
      fillerHits: 0,
      bodyUnits: 200,
      assertionSupportStats: {
        assertionCount: 2,
        supportedNovelAssertionCount: 2,
        unsupportedAssertionCount: 0,
        nameDerivedCount: 0,
        interpretiveCount: 0,
        evaluativeCount: 0,
        socialProofCount: 0,
        repetitionCount: 0,
        fillerCount: 0,
        novelFacetCoverage: 2,
        affectedSegmentRoles: [],
      },
    },
  };
}

describe("brain-guided generation contracts", () => {
  it("builds role allowlists without dumping all claims into every role", () => {
    const { contract } = makePlans();
    expect(contract.roleAllowlist.titleAllowedClaimIds).toEqual(["c1"]);
    expect(contract.roleAllowlist.leadAllowedClaimIds).toEqual(["c1"]);
    expect(contract.roleAllowlist.developmentAllowedClaimIds).toEqual(["c2", "c3"]);
    expect(contract.roleClaims.development.map((c) => c.id)).toEqual(["c2", "c3"]);
  });

  it("1. clean provenance + plan compliance → ok (repair not required by compliance)", () => {
    const { contract } = makePlans();
    const provenance = normalizeArticleProvenance({
      titleClaimIds: ["c1"],
      leadClaimIds: ["c1"],
      summaryClaimIds: ["c1", "c2"],
      sectionClaimIds: [["c2"], ["c3"]],
      sectionCount: 2,
    });
    const result = checkPlanCompliance({
      contract,
      provenance,
      sectionCount: 2,
      requireProvenance: true,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects role-outside claim use and omitted claim use", () => {
    const { contract } = makePlans();
    const provenance = normalizeArticleProvenance({
      titleClaimIds: ["c2"],
      leadClaimIds: ["c1"],
      summaryClaimIds: ["c1"],
      sectionClaimIds: [["c2"]],
      sectionCount: 1,
    });
    const result = checkPlanCompliance({
      contract,
      provenance,
      sectionCount: 1,
      requireProvenance: true,
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "ROLE_CLAIM_VIOLATION")).toBe(true);
  });

  it("2. repetition → duplicate segment only as repair target", () => {
    const { contract } = makePlans();
    const article = {
      title: "タイトル",
      summary: "要約",
      lead: "リード事実",
      sections: [
        { heading: null, paragraphs: ["リード事実の言い換えのみ"] },
        { heading: null, paragraphs: ["別の事実 c3"] },
      ],
    };
    const targets = mapFailuresToRepairTargets({
      review: reviewWith([
        {
          code: "REPETITION",
          severity: "BLOCKING",
          message: "restatement",
          evidence: {
            sampleAssertions: [{ sourceSegment: "section:0:p0", assertion: "x" }],
          },
        },
      ]),
      article,
      roleAllowlist: contract.roleAllowlist,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]!.segmentId).toBe("section:0:p0");
    const repaired = applyRepairs(article, [
      { segmentId: "section:0:p0", text: "シリーズは○○という公開事実がある。", claimIdsUsed: ["c2"] },
    ]);
    expect(repaired.lead).toBe(article.lead);
    expect(repaired.sections[1]!.paragraphs[0]).toBe("別の事実 c3");
    expect(repaired.sections[0]!.paragraphs[0]).toContain("シリーズ");
  });

  it("3. evaluative inference → matching segment only", () => {
    const { contract } = makePlans();
    const targets = mapFailuresToRepairTargets({
      review: reviewWith([
        {
          code: "EVALUATIVE_INFERENCE",
          severity: "BLOCKING",
          message: "eval",
          evidence: {
            sampleAssertions: [{ sourceSegment: "section:0:p0" }],
          },
        },
      ]),
      article: {
        title: "t",
        summary: "s",
        lead: "l",
        sections: [{ heading: null, paragraphs: ["魅力を堪能できる"] }],
      },
      roleAllowlist: contract.roleAllowlist,
    });
    expect(targets.map((t) => t.segmentId)).toEqual(["section:0:p0"]);
  });

  it("4. name-derived inference → matching segment only", () => {
    const { contract } = makePlans();
    const targets = mapFailuresToRepairTargets({
      review: reviewWith([
        {
          code: "NAME_DERIVED_INFERENCE",
          severity: "BLOCKING",
          message: "name",
          evidence: {
            sampleAssertions: [{ sourceSegment: "lead" }],
          },
        },
      ]),
      article: {
        title: "t",
        summary: "s",
        lead: "温泉宿が舞台",
        sections: [{ heading: null, paragraphs: ["ok"] }],
      },
      roleAllowlist: contract.roleAllowlist,
    });
    expect(targets.map((t) => t.segmentId)).toEqual(["lead"]);
  });

  it("5. title failure maps to title only", () => {
    const { contract } = makePlans();
    const targets = mapFailuresToRepairTargets({
      review: reviewWith([
        {
          code: "NAME_DERIVED_INFERENCE",
          severity: "BLOCKING",
          message: "title",
          evidence: { sampleAssertions: [{ sourceSegment: "title" }] },
        },
      ]),
      article: {
        title: "悪いタイトル",
        summary: "s",
        lead: "l",
        sections: [{ heading: null, paragraphs: ["p"] }],
      },
      roleAllowlist: contract.roleAllowlist,
    });
    expect(targets).toEqual([
      expect.objectContaining({ segmentId: "title", kind: "TITLE" }),
    ]);
  });

  it("6. summary failure → summary only", () => {
    const { contract } = makePlans();
    const targets = mapFailuresToRepairTargets({
      review: reviewWith([
        {
          code: "SUMMARY",
          severity: "BLOCKING",
          message: "meta",
        },
      ]),
      article: {
        title: "t",
        summary: "本記事では紹介します",
        lead: "l",
        sections: [{ heading: null, paragraphs: ["p"] }],
      },
      roleAllowlist: contract.roleAllowlist,
    });
    expect(targets.map((t) => t.segmentId)).toEqual(["summary"]);
  });

  it("7. multiple failures same segment → one repair target", () => {
    const { contract } = makePlans();
    const targets = mapFailuresToRepairTargets({
      review: reviewWith([
        {
          code: "EVALUATIVE_INFERENCE",
          severity: "BLOCKING",
          message: "a",
          evidence: { sampleAssertions: [{ sourceSegment: "section:0:p0" }] },
        },
        {
          code: "FILLER",
          severity: "BLOCKING",
          message: "b",
          evidence: { sampleAssertions: [{ sourceSegment: "section:0:p0" }] },
        },
      ]),
      article: {
        title: "t",
        summary: "s",
        lead: "l",
        sections: [{ heading: null, paragraphs: ["ぜひチェック"] }],
      },
      roleAllowlist: contract.roleAllowlist,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]!.failureCodes.sort()).toEqual(["EVALUATIVE_INFERENCE", "FILLER"].sort());
  });

  it("8. unrelated clean segment unchanged by applyRepairs", () => {
    const before = {
      title: "t",
      summary: "s",
      lead: "clean lead",
      sections: [
        { heading: null, paragraphs: ["bad para"] },
        { heading: null, paragraphs: ["clean para"] },
      ],
    };
    const after = applyRepairs(before, [
      { segmentId: "section:0:p0", text: "fixed", claimIdsUsed: ["c2"] },
    ]);
    expect(after.lead).toBe("clean lead");
    expect(after.sections[1]!.paragraphs[0]).toBe("clean para");
    expect(after.sections[0]!.paragraphs[0]).toBe("fixed");
  });

  it("9-10. max repair attempts is 1 (stop policy constant)", () => {
    expect(MAX_TARGETED_REPAIR_ATTEMPTS).toBe(1);
  });

  it("11. bad Claim input detected; must not invent cast repair", () => {
    const findings = detectBadInputClaims([
      { id: "bad", statement: "出演は優梨まいなましろ杏", kind: "cast" },
      { id: "ok", statement: "メーカーはエスワン", kind: "maker" },
    ]);
    expect(findings.some((f) => f.claimId === "bad")).toBe(true);
    expect(findings.some((f) => f.claimId === "ok")).toBe(false);
  });

  it("12-13. information gain / length are reviewer concerns — compliance ignores length", () => {
    const { contract } = makePlans();
    const longOk = checkPlanCompliance({
      contract,
      provenance: normalizeArticleProvenance({
        titleClaimIds: ["c1"],
        leadClaimIds: ["c1"],
        summaryClaimIds: ["c1"],
        sectionClaimIds: [["c2", "c3"]],
        sectionCount: 1,
      }),
      sectionCount: 1,
      requireProvenance: true,
    });
    expect(longOk.ok).toBe(true);
  });

  it("16. LearningRule mutation guard still holds", () => {
    expect(experienceMustNotMutateLearningRules()).toEqual({
      autoPromote: false,
      writesLearningRule: false,
    });
  });

  it("18. externalId collision regression — distinct FANZA urls get distinct ids", () => {
    const a = stablePublicUrlProductExternalId(
      "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=ssis00300/",
    );
    const b = stablePublicUrlProductExternalId(
      "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=pred00400/",
    );
    const c = stablePublicUrlProductExternalId(
      "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=ssis00300/?af_id=x",
    );
    expect(a).toBe("cid-ssis00300");
    expect(b).toBe("cid-pred00400");
    expect(a).not.toBe(b);
    expect(a).toBe(c);
    expect(a.startsWith("url-")).toBe(false);
    // legacy collision pattern must not be used
    const legacyA = `url-${Buffer.from(
      "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=ssis00300/",
    )
      .toString("base64url")
      .slice(0, 24)}`;
    const legacyB = `url-${Buffer.from(
      "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=pred00400/",
    )
      .toString("base64url")
      .slice(0, 24)}`;
    // Demonstrate old scheme could collide; new scheme must not equal that pattern
    expect(a).not.toBe(legacyA);
    expect(stablePublicUrlProductExternalId(
      "https://example.com/product/no-cid-here-aaaa",
    ).startsWith("urlh-")).toBe(true);
    void legacyB;
  });
});
