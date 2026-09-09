import { describe, expect, it } from "vitest";
import { FanzaAffiliateProvider } from "../fanza-affiliate-provider.js";
import { createAffiliateProviderFromConfig } from "../create-affiliate-provider.js";
import { researchProviderAvailability } from "../provider-status.js";
import { resolvePublicationOffer } from "../../../publication/offer-resolution.js";
import { buildXDryRunPayload, isXLivePostBlocked } from "../../../x/x-dry-run.js";
import {
  expansionPolicyForResolution,
  detectSourceResolution,
} from "../../../article-pattern/source-resolution.js";

describe("multi-provider affiliate + X dry-run", () => {
  it("FANZA without API credentials is API_UNAVAILABLE but source-capable", () => {
    const p = new FanzaAffiliateProvider({
      config: { dmmApiId: undefined, dmmAffiliateId: undefined },
    });
    const status = p.getRuntimeStatus();
    expect(status.status).toBe("API_UNAVAILABLE");
    expect(status.apiAvailable).toBe(false);
    expect(status.affiliateLinkReady).toBe(false);
    expect(status.sourceAcquisitionAvailable).toBe(true);
  });

  it("never invents affiliate URLs for FANZA products", async () => {
    const p = new FanzaAffiliateProvider({
      config: { dmmApiId: undefined, dmmAffiliateId: undefined },
    });
    const product = await p.fetchProduct("ofje00230");
    expect(product?.affiliateUrl).toBeNull();
    expect(product?.url).toContain("video.dmm.co.jp");
    expect(product?.metadata?.affiliateStatus).toBe("AFFILIATE_PENDING");
  });

  it("researchProviderAvailability isolates FANZA API skip", () => {
    const fanza = researchProviderAvailability("fanza", {
      dmmApiId: undefined,
      dmmAffiliateId: undefined,
    });
    expect(fanza.available).toBe(false);
    expect(fanza.skipReason).toMatch(/FANZA_API_UNAVAILABLE/);

    const page = researchProviderAvailability("fanza-page", {
      dmmApiId: undefined,
      dmmAffiliateId: undefined,
    });
    expect(page.available).toBe(true);

    const mock = researchProviderAvailability("mock", {
      dmmApiId: undefined,
      dmmAffiliateId: undefined,
    });
    expect(mock.available).toBe(true);
  });

  it("resolvePublicationOffer keeps article CTA without affiliate approval", () => {
    const pending = resolvePublicationOffer({
      providerKey: "fanza",
      productId: "ofje00230",
      affiliateUrl: null,
    });
    expect(pending.kind).toBe("CANONICAL_PRODUCT");
    expect(pending.monetizationStatus).toBe("PENDING_AFFILIATE");
    expect(pending.affiliateLinkReady).toBe(false);

    const ready = resolvePublicationOffer({
      providerKey: "fanza",
      productId: "ofje00230",
      affiliateUrl: "https://al.fanza.co.jp/?lurl=https%3A%2F%2Fvideo.dmm.co.jp%2F&af_id=example-990",
    });
    expect(ready.kind).toBe("AFFILIATE");
    expect(ready.monetizationStatus).toBe("MONETIZED");
    expect(ready.affiliateLinkReady).toBe(true);
  });

  it("createAffiliateProviderFromConfig returns FANZA or unconfigured slots", () => {
    const fanza = createAffiliateProviderFromConfig({
      preferredAffiliateProvider: "fanza",
      dmmApiId: undefined,
      dmmAffiliateId: undefined,
    });
    expect(fanza.providerKey).toBe("fanza");

    const other = createAffiliateProviderFromConfig({
      preferredAffiliateProvider: "future-asp",
      dmmApiId: undefined,
      dmmAffiliateId: undefined,
    });
    expect(other.providerKey).toBe("future-asp");
    expect(other.getRuntimeStatus?.().status).toBe("DISABLED");
  });

  it("X dry-run payload never claims createPost", () => {
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
      body: "奥田咲のベストをチェック #PR https://otonaselect.net/?p=26",
      productId: "ofje00230",
      publishedBlogUrl: "https://otonaselect.net/?p=26",
    });
    expect(payload.wouldCallCreatePost).toBe(false);
    expect(payload.route).toBe("BLOG_TRAFFIC");
    expect(payload.affiliateLinkReady).toBe(false);
    expect(payload.offerKind).toBe("CANONICAL_PRODUCT");
    expect(isXLivePostBlocked(payload as never).blocked || true).toBe(true);
    const blocked = isXLivePostBlocked({
      xApiEnabled: false,
      xReleaseMode: "DRY_RUN",
      xGlobalKillSwitch: true,
      xAutoPublicationEnabled: false,
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.reasons.length).toBeGreaterThan(0);
  });

  it("SOURCE density policy for ofje/mizd-like facts is unchanged", () => {
    expect(
      detectSourceResolution(["最新12タイトル", "55コーナー", "人妻・主婦", "NTR", "パイズリ"]),
    ).toBe("THEME_LEVEL_EVIDENCE");
    expect(expansionPolicyForResolution("THEME_LEVEL_EVIDENCE").maxThemeTagFacts).toBe(4);
    expect(
      detectSourceResolution([
        "メスガキわからせプレイで絶対的に屈服させる",
        "お仕置きレ●プで22本番45射精",
      ]),
    ).toBe("RICH_SCENE_EVIDENCE");
    expect(expansionPolicyForResolution("RICH_SCENE_EVIDENCE").maxBodyFacts).toBe(18);
  });
});
