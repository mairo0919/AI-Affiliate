import { describe, expect, it } from "vitest";
import {
  FANZA_AFFILIATE_IMAGE_TERMS_CHECKLIST,
  resolveImageUsageStatus,
} from "./image-usage-decision.js";

const FANZA_HERO =
  "https://pics.dmm.co.jp/digital/video/ofje00230/ofje00230pl.jpg";
const EXTERNAL = "https://cdn.example.com/x.jpg";

describe("resolveImageUsageStatus (FANZA terms gate)", () => {
  it("A. trusted + verified terms → ALLOWED", () => {
    const d = resolveImageUsageStatus({
      sourceUrl: FANZA_HERO,
      sourceKind: "fanza_item_list_api",
      productCanonicalId: "ofje00230",
      imageRole: "hero",
      fanzaAffiliateImageTermsVerified: true,
    });
    expect(d.usageStatus).toBe("ALLOWED");
    expect(d.reason).toBe("FANZA_OFFICIAL_AFFILIATE_IMAGE_TERMS_VERIFIED");
  });

  it("B. trusted but terms unverified → REQUIRES_CONFIRMATION (default)", () => {
    const api = resolveImageUsageStatus({
      sourceUrl: FANZA_HERO,
      sourceKind: "fanza_item_list_api",
      productCanonicalId: "ofje00230",
    });
    expect(api.usageStatus).toBe("REQUIRES_CONFIRMATION");
    expect(api.reason).toBe("FANZA_OFFICIAL_AFFILIATE_IMAGE_TERMS_UNVERIFIED");

    const jsonld = resolveImageUsageStatus({
      sourceUrl: FANZA_HERO,
      sourceKind: "fanza_product_page_jsonld",
      productCanonicalId: "ofje00230",
      fanzaAffiliateImageTermsVerified: false,
    });
    expect(jsonld.usageStatus).toBe("REQUIRES_CONFIRMATION");
  });

  it("C. unknown external → NOT_ALLOWED (untrusted host)", () => {
    const d = resolveImageUsageStatus({
      sourceUrl: EXTERNAL,
      sourceKind: "external_unknown",
    });
    expect(d.usageStatus).toBe("NOT_ALLOWED");
    expect(d.reason).toBe("PROHIBITED_OR_UNTRUSTED_HOST");
  });

  it("D. explicitly prohibited → NOT_ALLOWED", () => {
    const d = resolveImageUsageStatus({
      sourceUrl: FANZA_HERO,
      sourceKind: "fanza_item_list_api",
      fanzaAffiliateImageTermsVerified: true,
      explicitlyProhibited: true,
    });
    expect(d.usageStatus).toBe("NOT_ALLOWED");
    expect(d.reason).toBe("EXPLICIT_NOT_ALLOWED");
  });

  it("AI generated never auto-ALLOWED", () => {
    const d = resolveImageUsageStatus({
      sourceUrl: FANZA_HERO,
      sourceKind: "ai_generated",
      fanzaAffiliateImageTermsVerified: true,
    });
    expect(d.usageStatus).toBe("REQUIRES_CONFIRMATION");
    expect(d.reason).toBe("AI_GENERATED_UNVERIFIED");
  });

  it("checklist documents what must be verified before ALLOWED", () => {
    expect(FANZA_AFFILIATE_IMAGE_TERMS_CHECKLIST.length).toBeGreaterThanOrEqual(4);
    expect(FANZA_AFFILIATE_IMAGE_TERMS_CHECKLIST.some((s) => /affiliate/i.test(s))).toBe(
      true,
    );
  });
});
