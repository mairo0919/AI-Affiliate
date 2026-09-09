import { describe, expect, it } from "vitest";
import { selectXSocialMediaImage } from "../x-social-media-gate.js";
import { buildXDryRunPayload } from "../x-dry-run.js";

/** Regression: acquired #26 / ofje00230 official samples (DB URL host). */
describe("ofje00230 #26 rights re-eval", () => {
  const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
    sourceUrl: `https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/ofje00230/ofje00230jp-${n}.jpg`,
    imageType: "sample_large",
    usageStatus: "REQUIRES_CONFIRMATION",
  }));

  it("reports material vs site separately when FANZA_X_SITE_APPROVED=false", () => {
    const r = selectXSocialMediaImage({
      researchImages: samples,
      productCanonicalId: "ofje00230",
      fanzaXSiteApproved: false,
      fanzaService: "digital",
      fanzaFloor: "videoa",
      earlySamplePreferCount: 5,
    });
    expect(r.decision).toBe("WAITING_FOR_AFFILIATE_SITE_APPROVAL");
    expect(r.candidates).toHaveLength(10);
    expect(r.candidates.every((c) => c.materialRightsStatus === "ELIGIBLE")).toBe(true);
    expect(r.candidates.every((c) => c.rightsStatus === "BLOCKED_SITE_APPROVAL")).toBe(true);
    expect(r.candidates.every((c) => c.xSocialStatus === "UNASSESSED")).toBe(true);

    const afterTrue = selectXSocialMediaImage({
      researchImages: samples,
      productCanonicalId: "ofje00230",
      fanzaXSiteApproved: true,
      fanzaService: "digital",
      fanzaFloor: "videoa",
    });
    expect(afterTrue.decision).toBe("WAITING_FOR_X_IMAGE");
    expect(afterTrue.candidates.every((c) => c.rightsStatus === "ALLOWED")).toBe(true);

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
      body: "奥田咲の最新12タイトルまとめ。 #PR https://otonaselect.net/?p=26",
      productId: "ofje00230",
      publishedBlogUrl: "https://otonaselect.net/?p=26",
      researchImages: samples,
    });
    expect(payload.wouldCallCreatePost).toBe(false);
    expect(payload.mediaDecision).toBe("WAITING_FOR_AFFILIATE_SITE_APPROVAL");
    expect(payload.mediaMaterialEligibleCount).toBe(10);
  });
});
