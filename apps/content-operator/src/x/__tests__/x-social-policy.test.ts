import { describe, expect, it } from "vitest";
import {
  buildXSocialSafeBodyFromEvidence,
  detectXAdultExpressions,
  enforceXSocialContentBody,
  filterClaimsForXSocialContent,
  isXSocialSafeClaimStatement,
} from "../x-social-content-policy.js";
import {
  assessXSocialVisualContent,
  collectOfficialSampleCandidates,
  evaluateXSocialMedia,
  parseOfficialSampleIndex,
  selectXSocialMediaImage,
} from "../x-social-media-gate.js";
import { evaluateFanzaOfficialSampleMaterialRights } from "../x-fanza-sample-rights.js";
import { CONTENT_POLICY_SURFACE } from "../content-policy-surfaces.js";
import { buildXDryRunPayload } from "../x-dry-run.js";

describe("X_SOCIAL_CONTENT policy", () => {
  it("detects adult expressions and allows catalog claims", () => {
    expect(detectXAdultExpressions("濃厚セックスと激しいピストン").hit).toBe(true);
    expect(detectXAdultExpressions("パイズリ収録").hit).toBe(true);
    expect(detectXAdultExpressions("最新12タイトルの全コーナーを収録").hit).toBe(false);
    expect(isXSocialSafeClaimStatement("奥田咲")).toBe(true);
    expect(isXSocialSafeClaimStatement("低身長なのにグラマラスボディ")).toBe(false);
    expect(
      filterClaimsForXSocialContent([
        { id: "1", statement: "奥田咲" },
        { id: "2", statement: "最新12タイトルの全コーナーを収録" },
        { id: "3", statement: "濃厚なセックス" },
      ]).map((c) => c.id),
    ).toEqual(["1", "2"]);
  });

  it("builds evidence-based body without inventing ranking and without article excerpt style", () => {
    const body = buildXSocialSafeBodyFromEvidence({
      productTitle: "奥田咲 S1 8時間 最新12タイトル全コーナー入りベスト Vol.6",
      safeFacets: ["奥田咲", "最新12タイトルの全コーナーを収録", "8時間ベスト"],
      destinationUrl: "https://otonaselect.net/?p=26",
      disclosure: "#PR",
    });
    expect(body).toMatch(/奥田咲/);
    expect(body).toMatch(/#PR/);
    expect(body).toContain("https://otonaselect.net/?p=26");
    expect(detectXAdultExpressions(body).hit).toBe(false);
    expect(body).not.toMatch(/セックス|ピストン|パイズリ/);
    expect(body).not.toMatch(/ランキング|人気No/);
  });

  it("rewrites adult LLM leak via enforce gate", () => {
    const out = enforceXSocialContentBody({
      body: "奥田咲の濃厚セックスをチェック",
      productTitle: "奥田咲 S1 8時間 最新12タイトル全コーナー入りベスト Vol.6",
      safeFacets: ["奥田咲", "最新12タイトルの全コーナーを収録"],
      destinationUrl: "https://otonaselect.net/?p=26",
      disclosure: "#PR",
    });
    expect(out.rewritten).toBe(true);
    expect(out.contentPolicySurface).toBe(CONTENT_POLICY_SURFACE.X_SOCIAL_CONTENT);
    expect(detectXAdultExpressions(out.body).hit).toBe(false);
  });
});

describe("X_SOCIAL_MEDIA sample selection", () => {
  const samples = [1, 2, 3, 4, 5, 10].map((n) => ({
    sourceUrl: `https://pics.dmm.co.jp/digital/video/ofje00230/ofje00230jp-${n}.jpg`,
    imageType: "sample_large",
    usageStatus: "REQUIRES_CONFIRMATION",
  }));

  it("parses sample index and prefers early samples for ranking only", () => {
    expect(parseOfficialSampleIndex(samples[0]!.sourceUrl)).toBe(0);
    expect(parseOfficialSampleIndex(samples[4]!.sourceUrl)).toBe(4);
    const collected = collectOfficialSampleCandidates({
      researchImages: samples,
      earlySamplePreferCount: 5,
    });
    expect(collected[0]!.sampleIndex).toBe(0);
    expect(collected.filter((c) => c.earlyPreferred).map((c) => c.sampleIndex)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it("does not treat sample index as auto-SAFE", () => {
    const v = assessXSocialVisualContent({
      sourceUrl: samples[0]!.sourceUrl,
      imageType: "sample_large",
      assetKind: "OFFICIAL_SAMPLE",
    });
    expect(v.status).toBe("UNASSESSED");
  });

  it("RC alone does not make official sample material NOT_ELIGIBLE", () => {
    const material = evaluateFanzaOfficialSampleMaterialRights({
      sourceUrl: samples[0]!.sourceUrl,
      imageType: "sample_large",
      storedUsageStatus: "REQUIRES_CONFIRMATION",
      sourceKind: "fanza_official_sample",
      productCanonicalId: "ofje00230",
    });
    expect(material.status).toBe("ELIGIBLE");
  });

  it("with site unapproved: material ELIGIBLE but publication WAITING_FOR_AFFILIATE_SITE_APPROVAL", () => {
    const r = selectXSocialMediaImage({
      researchImages: samples,
      productCanonicalId: "ofje00230",
      fanzaXSiteApproved: false,
    });
    expect(r.decision).toBe("WAITING_FOR_AFFILIATE_SITE_APPROVAL");
    expect(r.reason).toBe("FANZA_X_SITE_APPROVED=false");
    expect(r.fanzaXSiteApproved).toBe(false);
    expect(r.candidates.every((c) => c.materialRightsStatus === "ELIGIBLE")).toBe(true);
    expect(r.candidates.every((c) => c.rightsStatus === "BLOCKED_SITE_APPROVAL")).toBe(true);
    expect(r.candidates.every((c) => c.xSocialStatus !== "SKIPPED_RIGHTS")).toBe(true);
    expect(r.candidates.every((c) => c.adopted === false)).toBe(true);
  });

  it("does not invent ALLOWED when site unapproved even with SAFE visual hints", () => {
    const r = selectXSocialMediaImage({
      researchImages: [
        {
          sourceUrl: samples[0]!.sourceUrl,
          imageType: "sample_large",
          usageStatus: "REQUIRES_CONFIRMATION",
          visualHints: {
            faceVisible: true,
            clothedNormal: true,
            portraitFriendly: true,
            subjectClear: true,
          },
        },
      ],
      productCanonicalId: "ofje00230",
      fanzaXSiteApproved: false,
    });
    expect(r.decision).toBe("WAITING_FOR_AFFILIATE_SITE_APPROVAL");
    expect(r.candidates[0]!.xSocialStatus).toBe("X_SOCIAL_SAFE");
    expect(r.candidates[0]!.rightsStatus).toBe("BLOCKED_SITE_APPROVAL");
    expect(r.selectedUrl).toBeNull();
  });

  it("selects early SAFE sample when site approved + positive visual hints", () => {
    const r = selectXSocialMediaImage({
      researchImages: [
        {
          sourceUrl: samples[0]!.sourceUrl,
          imageType: "sample_large",
          usageStatus: "REQUIRES_CONFIRMATION",
        },
        {
          sourceUrl: samples[2]!.sourceUrl,
          imageType: "sample_large",
          usageStatus: "REQUIRES_CONFIRMATION",
          visualHints: {
            faceVisible: true,
            clothedNormal: true,
            portraitFriendly: true,
            subjectClear: true,
          },
        },
      ],
      productCanonicalId: "ofje00230",
      fanzaXSiteApproved: true,
    });
    expect(r.decision).toBe("SAFE_IMAGE");
    expect(r.selectedSampleIndex).toBe(2);
    expect(r.selectedUrl).toContain("jp-3");
    expect(r.candidates.find((c) => c.sampleIndex === 2)?.rightsStatus).toBe("ALLOWED");
  });

  it("package cover is not timeline-safe by default", () => {
    const v = assessXSocialVisualContent({
      sourceUrl: "https://pics.dmm.co.jp/digital/video/ofje00230/ofje00230pl.jpg",
      imageType: "main_large",
      assetKind: "ARTICLE_PACKAGE",
    });
    expect(v.status).toBe("X_SOCIAL_UNSAFE");
  });

  it("legacy evaluate waits instead of TEXT_ONLY auto-post", () => {
    const r = evaluateXSocialMedia({
      candidates: [
        {
          sourceUrl: "https://pics.dmm.co.jp/digital/video/ofje00230/ofje00230pl.jpg",
          assetKind: "ARTICLE_PACKAGE",
          usageStatus: "REQUIRES_CONFIRMATION",
        },
      ],
    });
    expect(r.decision).toBe("WAITING_FOR_X_IMAGE");
  });
});

describe("X dry-run with social media selection", () => {
  it("reports site-approval block separately from material rights", () => {
    const payload = buildXDryRunPayload({
      config: {
        xApiEnabled: false,
        xReleaseMode: "DRY_RUN",
        xGlobalKillSwitch: true,
        xAutoPublicationEnabled: false,
        xMaxWeightedLength: 280,
        xAffiliateDisclosure: "#PR",
        fanzaXSiteApproved: false,
        fanzaDefaultService: "digital",
        fanzaDefaultFloor: "videoa",
      },
      body: "奥田咲の最新12タイトルまとめ。シリーズをまとめてチェックしたい人向け。 #PR https://otonaselect.net/?p=26",
      productId: "ofje00230",
      publishedBlogUrl: "https://otonaselect.net/?p=26",
      researchImages: [1, 2, 3, 4, 5].map((n) => ({
        sourceUrl: `https://pics.dmm.co.jp/digital/video/ofje00230/ofje00230jp-${n}.jpg`,
        imageType: "sample_large",
        usageStatus: "REQUIRES_CONFIRMATION",
      })),
      fanzaXSiteApproved: false,
    });
    expect(payload.wouldCallCreatePost).toBe(false);
    expect(payload.route).toBe("BLOG_TRAFFIC");
    expect(payload.fanzaXSiteApproved).toBe(false);
    expect(payload.mediaDecision).toBe("WAITING_FOR_AFFILIATE_SITE_APPROVAL");
    expect(payload.mediaMaterialEligibleCount).toBe(5);
    expect(payload.mediaCandidates.every((c) => c.materialRightsStatus === "ELIGIBLE")).toBe(
      true,
    );
    expect(payload.adultExpressionHit).toBe(false);
  });
});
