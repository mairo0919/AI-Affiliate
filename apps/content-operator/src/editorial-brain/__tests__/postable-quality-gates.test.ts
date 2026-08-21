/**
 * Article-level sufficiency + X ACTIVE fail-closed regression.
 */

import { describe, expect, it } from "vitest";
import {
  applyBrainProductionAuthority,
  evaluateBlogArticleEditorialSufficiency,
  getChannelCapabilities,
  ensureChannelModulesRegistered,
  reviewArtifactShadow,
  buildCoreEditorialPlan,
  withEditorialBrainModeOverride,
} from "../index.js";
import type { ReviewableBlogArtifact } from "../shadow/reviewer.js";
import type { SemanticAssertion } from "../shadow/semantic-types.js";

ensureChannelModulesRegistered();

function core(claims: Array<{ id: string; statement: string; kind: string }>, depth: "scarce" | "standard" | "rich") {
  const ids = claims.map((c) => c.id);
  return buildCoreEditorialPlan({
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    availableClaims: claims,
    selectedClaims: claims,
    openingClaimIds: ids.slice(0, 1),
    hookClaimIds: ids.slice(0, 1),
    developmentClaimIds: ids.slice(1),
    structurePatternId: null,
    editorialPatternId: null,
  });
}

describe("article editorial sufficiency", () => {
  it("blocks empty sections after DELETE-style repair", () => {
    const artifact: ReviewableBlogArtifact = {
      channel: "BLOG",
      title: "木下ひまりと森日向子の作品",
      summary: "プレミアムの独占配信。",
      lead: "木下ひまりと森日向子が出演する独占作品。プレミアムレーベル。",
      sections: [{ paragraphs: [""], lists: [] }],
      bodyText: "lead only",
    };
    const assertions: SemanticAssertion[] = [
      {
        assertion: artifact.lead,
        sourceSegment: "lead",
        supportingClaimIds: ["c1"],
        supportType: "DIRECT",
        confidence: 0.8,
        addsInformation: true,
        failureCodes: [],
        novelFacets: ["木下ひまり", "森日向子"],
        predicateFamilies: ["IDENTITY"],
        repetitionKind: "NONE",
      },
    ];
    const claims = [
      { id: "c1", statement: "木下ひまり 森日向子 独占", kind: "title" },
      { id: "c2", statement: "メーカーはプレミアム", kind: "maker" },
      { id: "c3", statement: "配信中", kind: "availability" },
    ];
    const r = evaluateBlogArticleEditorialSufficiency({
      artifact,
      assertions,
      corePlan: core(claims, "scarce"),
      claimStatements: claims,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INSUFFICIENT_SUPPORTED_MATERIAL");
  });

  it("blocks maker/availability-only development (banal body)", () => {
    const artifact: ReviewableBlogArtifact = {
      channel: "BLOG",
      title: "葵つかさ出演のベロキス作品",
      summary: "突然のベロキスが展開。",
      lead: "葵つかさが出演し、突然のベロキスや濃厚な舐め尽くしが公開されている。",
      sections: [
        {
          paragraphs: ["この作品はエスワン ナンバーワンスタイルが制作しており、独占配信されている。"],
          lists: [],
        },
      ],
      bodyText: "…",
    };
    const assertions: SemanticAssertion[] = [
      {
        assertion: artifact.lead,
        sourceSegment: "lead",
        supportingClaimIds: ["c1"],
        supportType: "DIRECT",
        confidence: 0.8,
        addsInformation: true,
        failureCodes: [],
        novelFacets: ["葵つかさ", "ベロキス"],
        predicateFamilies: ["EVENT_OR_SCENE"],
        repetitionKind: "NONE",
      },
      {
        assertion: artifact.sections[0]!.paragraphs[0]!,
        sourceSegment: "section:0:p0",
        supportingClaimIds: ["c2"],
        supportType: "DIRECT",
        confidence: 0.7,
        addsInformation: true,
        failureCodes: [],
        // Maker facets alone must NOT rescue catalog-only body
        novelFacets: ["エスワン"],
        predicateFamilies: ["IDENTITY"],
        repetitionKind: "NONE",
      },
    ];
    const claims = [
      { id: "c1", statement: "葵つかさ ベロキス", kind: "scene" },
      { id: "c2", statement: "メーカーはエスワン", kind: "maker" },
      { id: "c3", statement: "配信中", kind: "availability" },
      { id: "c4", statement: "出演者は葵つかさ", kind: "performer" },
    ];
    const r = evaluateBlogArticleEditorialSufficiency({
      artifact,
      assertions,
      corePlan: {
        ...core(claims, "standard"),
        scarcityMode: false,
        informationGainTarget: 2,
      },
      claimStatements: claims,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("CATALOG_NARRATION");
  });

  it("blocks maker + evaluative fluff development even with novel maker facets", () => {
    const body =
      "メーカーはムーディーズで、専門性の高いレーベルが手がけていることから作品の統一感と質の高さが期待されます。";
    const artifact: ReviewableBlogArtifact = {
      channel: "BLOG",
      title: "松本いちか出演ベスト",
      summary: "10作品8時間。",
      lead: "松本いちか主演の10作品、合計8時間にわたる令和時代のメスガキ痴女ベストが独占配信されています。",
      sections: [{ paragraphs: [body], lists: [] }],
      bodyText: body,
    };
    const assertions: SemanticAssertion[] = [
      {
        assertion: artifact.lead,
        sourceSegment: "lead",
        supportingClaimIds: ["c1"],
        supportType: "DIRECT",
        confidence: 0.9,
        addsInformation: true,
        failureCodes: [],
        novelFacets: ["松本いちか", "8時間", "痴女"],
        predicateFamilies: ["EVENT_OR_SCENE"],
        repetitionKind: "NONE",
      },
      {
        assertion: body,
        sourceSegment: "section:0:p0",
        supportingClaimIds: ["c2"],
        supportType: "DIRECT",
        confidence: 0.8,
        addsInformation: true,
        failureCodes: [],
        novelFacets: ["ムーディーズ"],
        predicateFamilies: ["IDENTITY", "EVALUATION"],
        repetitionKind: "NONE",
      },
    ];
    const claims = [
      { id: "c1", statement: "松本いちか 痴女ベスト 8時間", kind: "trait_or_scene" },
      { id: "c2", statement: "メーカーはムーディーズ", kind: "maker" },
    ];
    const r = evaluateBlogArticleEditorialSufficiency({
      artifact,
      assertions,
      corePlan: { ...core(claims, "standard"), scarcityMode: false, informationGainTarget: 2 },
      claimStatements: claims,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("CATALOG_NARRATION");
  });
});

describe("X ACTIVE fail-closed", () => {
  it("TARGETED_REPAIR with targetedRepair=false → CHANNEL_REPAIR_UNSUPPORTED", () => {
    const r = withEditorialBrainModeOverride("ACTIVE", () =>
      applyBrainProductionAuthority({
        mode: "ACTIVE",
        channel: "X",
        channelCapabilities: getChannelCapabilities("X"),
        brainDecision: "TARGETED_REPAIR",
        repairAttempted: false,
        initialContentVersionId: "xv1",
      }),
    );
    expect(getChannelCapabilities("X").targetedRepair).toBe(false);
    expect(r.lifecycle.blockReason).toBe("CHANNEL_REPAIR_UNSUPPORTED");
    expect(r.downstreamAllowed).toBe(false);
    expect(r.finalDecision).toMatch(/DOWNSTREAM:BLOCK/);
  });

  it("DEFER_INSUFFICIENT_MATERIAL → BLOCKED with insufficient reason", () => {
    const r = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "X",
      channelCapabilities: getChannelCapabilities("X"),
      brainDecision: "DEFER_INSUFFICIENT_MATERIAL",
      initialContentVersionId: "xv2",
    });
    expect(r.lifecycle.blockReason).toBe("INSUFFICIENT_SUPPORTED_MATERIAL");
    expect(r.downstreamAllowed).toBe(false);
  });

  it("X review of promo template is not PASS", () => {
    const claims = [
      { id: "c1", statement: "葵つかさが出演する独占作品である。" },
      { id: "c2", statement: "メーカーはエスワン ナンバーワンスタイルである。" },
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
        body: "葵つかさが魅せる特別な時間。美しさと緊張感をお見逃しなく。https://example.com",
      },
      corePlan: plan,
      claimStatements: claims,
    });
    expect(review.decision).not.toBe("PASS");
  });
});
