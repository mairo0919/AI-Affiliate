/**
 * Contribution allocation + X title-restatement fixtures (deterministic, no LLM).
 */

import { describe, expect, it } from "vitest";
import {
  buildSegmentContributionAllocation,
  validateContributionCompliance,
  detectSourceTitleRestatement,
  allocateXFacetContributions,
  reviewArtifactShadow,
  buildCoreEditorialPlan,
  ensureChannelModulesRegistered,
} from "../index.js";

ensureChannelModulesRegistered();

const LONG_TITLE =
  "【独占】ファン感謝祭 バスツアー企画 AV男優を目指す素人16名とAV女優16名の1泊2日大乱交ツアー！ は公開ページ上で確認できる。";

describe("BLOG contribution fixtures", () => {
  it("A: lead consumes facet A / body repeats A → FAIL REPETITION", () => {
    const leadContrib = {
      id: "c1::ベロキス",
      claimId: "c1",
      facet: "ベロキス",
    };
    const bodyContrib = {
      id: "c1::舐め尽くし",
      claimId: "c1",
      facet: "舐め尽くし",
    };
    const allocation = buildSegmentContributionAllocation({
      claims: [
        {
          id: "c1",
          statement: "突然のベロキスと舐め尽くしが公開されている。",
          kind: "trait_or_scene",
        },
      ],
      openingClaimIds: ["c1"],
      developmentClaimIds: [],
    });
    const r = validateContributionCompliance({
      article: {
        title: "ベロキス作品",
        summary: "ベロキス。",
        lead: "作品ではベロキスが確認できる。",
        sections: [{ paragraphs: ["再びベロキスが描かれる。"] }],
      },
      allocation: {
        ...allocation,
        leadContributions: [leadContrib],
        bodyContributions: [bodyContrib],
        insufficientDevelopmentMaterial: false,
        insufficientReason: null,
        segmentContracts: {
          ...allocation.segmentContracts,
          lead: {
            ...allocation.segmentContracts.lead,
            allowedContributions: [leadContrib],
            requiredContributions: [leadContrib],
            forbiddenConsumedContributions: [],
          },
          development: {
            ...allocation.segmentContracts.development,
            allowedContributions: [bodyContrib],
            requiredContributions: [bodyContrib],
            forbiddenConsumedContributions: [leadContrib],
          },
        },
      },
    });
    expect(r.findings.some((f) => f.code === "REPETITION" || f.code === "GENERATION_PLAN_UNDERUSE")).toBe(
      true,
    );
  });

  it("B: lead A / body B → PASS compliance", () => {
    const claims = [
      {
        id: "c1",
        statement: LONG_TITLE,
        kind: "trait_or_scene",
      },
    ];
    const allocation = buildSegmentContributionAllocation({
      claims,
      openingClaimIds: ["c1"],
      developmentClaimIds: [],
    });
    expect(allocation.insufficientDevelopmentMaterial).toBe(false);
    expect(allocation.bodyContributions.length).toBeGreaterThan(0);
    const leadF = allocation.leadContributions.map((c) => c.facet);
    const bodyF = allocation.bodyContributions.map((c) => c.facet);
    const r = validateContributionCompliance({
      article: {
        title: `${leadF[0]}の企画`,
        summary: leadF.slice(0, 2).join("、"),
        lead: `${leadF.join("と")}が確認できる。`,
        sections: [{ paragraphs: [`さらに${bodyF.slice(0, 2).join("、")}が公開されている。`] }],
      },
      allocation,
    });
    expect(r.ok).toBe(true);
  });

  it("C: lead A / body maker only → insufficient development material", () => {
    const claims = [
      { id: "c1", statement: "出演者Aがクレジットされている。", kind: "performer" },
      { id: "c2", statement: "メーカー／レーベルとして「DOC」が公開されている。", kind: "maker" },
      { id: "c3", statement: "公開ページ上で販売／配信状態は「配信中」と確認できる。", kind: "availability" },
    ];
    const allocation = buildSegmentContributionAllocation({
      claims,
      openingClaimIds: ["c1"],
      developmentClaimIds: ["c2", "c3"],
    });
    expect(allocation.insufficientDevelopmentMaterial).toBe(true);
  });

  it("D: long title A+B+C / lead A / body B+C → PASS", () => {
    const claims = [{ id: "t", statement: LONG_TITLE, kind: "trait_or_scene" }];
    const allocation = buildSegmentContributionAllocation({
      claims,
      openingClaimIds: ["t"],
      developmentClaimIds: [],
    });
    expect(allocation.leadContributions.length).toBeGreaterThan(0);
    expect(allocation.bodyContributions.length).toBeGreaterThan(0);
    const overlap = allocation.leadContributions.some((l) =>
      allocation.bodyContributions.some((b) => b.facet === l.facet),
    );
    expect(overlap).toBe(false);
  });

  it("E: long title / lead A / body A paraphrase → FAIL", () => {
    const claims = [{ id: "t", statement: LONG_TITLE, kind: "trait_or_scene" }];
    const allocation = buildSegmentContributionAllocation({
      claims,
      openingClaimIds: ["t"],
      developmentClaimIds: [],
    });
    const a = allocation.leadContributions[0]!;
    const r = validateContributionCompliance({
      article: {
        title: "企画",
        summary: a.facet,
        lead: `${a.facet}がある。`,
        sections: [{ paragraphs: [`つまり${a.facet}の再掲である。`] }],
      },
      allocation: {
        ...allocation,
        insufficientDevelopmentMaterial: false,
        segmentContracts: {
          ...allocation.segmentContracts,
          development: {
            ...allocation.segmentContracts.development,
            requiredContributions: allocation.bodyContributions.slice(0, 1),
            forbiddenConsumedContributions: allocation.leadContributions,
            allowedContributions: allocation.bodyContributions,
          },
        },
      },
    });
    expect(r.ok).toBe(false);
  });

  it("H: supported facts + unsupported evaluation → FAIL", () => {
    const claims = [
      { id: "c1", statement: "Hカップの超敏感巨乳が公開されている。", kind: "trait_or_scene" },
      { id: "c2", statement: "顔面ビンタと猛烈ピストンが確認できる。", kind: "trait_or_scene" },
    ];
    const allocation = buildSegmentContributionAllocation({
      claims,
      openingClaimIds: ["c1"],
      developmentClaimIds: ["c2"],
      claimsAllowEvaluation: false,
    });
    const r = validateContributionCompliance({
      article: {
        title: "魅力的なHカップ",
        summary: "Hカップ。",
        lead: "Hカップの超敏感巨乳が公開されている。",
        sections: [{ paragraphs: ["顔面ビンタと猛烈ピストンが確認できる。特別な時間を堪能できる。"] }],
      },
      allocation,
      claimsAllowEvaluation: false,
    });
    expect(r.findings.some((f) => f.code === "EVALUATIVE_INFERENCE")).toBe(true);
  });
});

describe("X title-restatement fixtures", () => {
  const longSource =
    "【独占】彼女の綺麗なお姉さんと二人きり… 突然のベロキス、イヤラしく舐め尽くされてセックス三昧 こんな僕って最低ですか…？ 葵つかさ は公開ページ上で確認できる。";

  it("A: almost verbatim long title post → SOURCE_TITLE_RESTATEMENT", () => {
    const r = detectSourceTitleRestatement({
      body: "【独占】彼女の綺麗なお姉さんと二人きり… 突然のベロキス、イヤラしく舐め尽くされてセックス三昧 こんな僕って最低ですか…？ 葵つかさ",
      sourceStatements: [longSource],
    });
    expect(r.hit).toBe(true);
  });

  it("B: one concrete facet selected → PASS (no restatement)", () => {
    const r = detectSourceTitleRestatement({
      body: "突然のベロキスから始まる二人きりの展開。",
      sourceStatements: [longSource],
    });
    expect(r.hit).toBe(false);
  });

  it("C: title facet + new supported facet → PASS", () => {
    const r = detectSourceTitleRestatement({
      body: "突然のベロキス。シリーズはプールナンパとして公開。",
      sourceStatements: [longSource, "シリーズ情報として「プールナンパ」が公開されている。"],
    });
    expect(r.hit).toBe(false);
  });

  it("D: performer/product identity share only → not blocking", () => {
    const r = detectSourceTitleRestatement({
      body: "葵つかさ出演の作品。",
      sourceStatements: [longSource],
    });
    expect(r.hit).toBe(false);
  });

  it("E: title compression + evaluation → EVALUATIVE via review", () => {
    const claims = [
      { id: "c1", statement: longSource },
      { id: "c2", statement: "出演者／クリエイターとして「葵つかさ」が記載されている。" },
    ];
    const plan = buildCoreEditorialPlan({
      channel: "X",
      formatKey: null,
      contentType: "x-post",
      availableClaims: claims.map((c) => ({ ...c, kind: "other" })),
      selectedClaims: claims.map((c) => ({ ...c, kind: "other" })),
      openingClaimIds: ["c1"],
      hookClaimIds: ["c1"],
      developmentClaimIds: ["c2"],
      structurePatternId: null,
      editorialPatternId: null,
    });
    const review = reviewArtifactShadow({
      artifact: {
        channel: "X",
        body: "突然のベロキスの魅力を堪能できる特別な時間。",
      },
      corePlan: plan,
      claimStatements: claims,
    });
    expect(review.decision).not.toBe("PASS");
    expect(review.failures.some((f) => f.code === "EVALUATIVE_INFERENCE")).toBe(true);
  });

  it("review fails verbatim title copy without evaluation", () => {
    const claims = [{ id: "c1", statement: longSource }];
    const plan = buildCoreEditorialPlan({
      channel: "X",
      formatKey: null,
      contentType: "x-post",
      availableClaims: claims.map((c) => ({ ...c, kind: "trait_or_scene" })),
      selectedClaims: claims.map((c) => ({ ...c, kind: "trait_or_scene" })),
      openingClaimIds: ["c1"],
      hookClaimIds: ["c1"],
      developmentClaimIds: [],
      structurePatternId: null,
      editorialPatternId: null,
    });
    const review = reviewArtifactShadow({
      artifact: {
        channel: "X",
        body: "【独占】彼女の綺麗なお姉さんと二人きり… 突然のベロキス、イヤラしく舐め尽くされてセックス三昧 こんな僕って最低ですか…？ 葵つかさ",
      },
      corePlan: plan,
      claimStatements: claims,
    });
    expect(review.failures.some((f) => f.code === "SOURCE_TITLE_RESTATEMENT")).toBe(true);
    expect(review.decision).not.toBe("PASS");
  });

  it("X facet allocation selects concrete facets from long title", () => {
    const a = allocateXFacetContributions({
      claimStatements: [{ id: "t", statement: LONG_TITLE }],
      hookClaimIds: ["t"],
      supportClaimIds: [],
    });
    expect(a.sufficient).toBe(true);
    expect(a.hookContributions.length).toBeGreaterThan(0);
    expect(a.hookContributions[0]!.facet).not.toMatch(/公開ページ/);
  });
});
