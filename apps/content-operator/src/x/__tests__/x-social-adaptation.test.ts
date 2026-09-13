import { describe, expect, it } from "vitest";
import {
  evaluateXBacklogEligibility,
  isWordPressPublicForXTraffic,
} from "../x-eligibility.js";
import {
  adaptCanonicalToXSocial,
  chooseXLinkMode,
  chooseXThreadShape,
  extractXSocialHooks,
} from "../x-social-adaptation.js";
import { chooseXPostRoute } from "../../daily-ops/x-route.js";
import { buildXDryRunPayload } from "../x-dry-run.js";

describe("x-eligibility backlog gate", () => {
  it("allows NORMAL + factory-linked only", () => {
    const ok = evaluateXBacklogEligibility({
      cid: "cemd00899",
      classification: "NORMAL",
      factoryLinked: true,
      bodyEmpty: false,
    });
    expect(ok.eligible).toBe(true);
    expect(ok.reasons).toEqual([]);
  });

  it("blocks unlinked / title / multiple / unknown cid", () => {
    expect(
      evaluateXBacklogEligibility({
        cid: "ofje00230",
        classification: "IDENTITY_ISSUE",
        factoryLinked: false,
      }).eligible,
    ).toBe(false);
    expect(
      evaluateXBacklogEligibility({
        cid: "dvaj00759",
        classification: "TITLE_ISSUE",
        factoryLinked: true,
        issues: ["TITLE_ISSUE"],
      }).eligible,
    ).toBe(false);
    expect(
      evaluateXBacklogEligibility({
        cid: null,
        classification: "NORMAL",
        factoryLinked: true,
      }).cidUnknown,
    ).toBe(true);
  });

  it("WP traffic only when publicly published", () => {
    expect(isWordPressPublicForXTraffic("publish")).toBe(true);
    expect(isWordPressPublicForXTraffic("future")).toBe(false);
    expect(isWordPressPublicForXTraffic("draft")).toBe(false);
  });
});

describe("x-social-adaptation", () => {
  it("uses canonical title and Evidence hooks — not WP title alone", () => {
    const result = adaptCanonicalToXSocial({
      canonicalTitle: "幸村泉希と元カノの3年ぶりに再会",
      wordpressTitle: "SEO用の別タイトル",
      cid: "dvaj00761",
      performerNames: ["幸村泉希"],
      claimStatements: [
        { id: "1", statement: "元カノとの再会が設定に含まれる" },
        { id: "2", statement: "3年ぶりの再会が記載されている" },
      ],
      safeFacets: ["再会", "元カノ"],
      publishedBlogUrl: "https://otonaselect.net/?p=214",
      wpStatus: "publish",
      affiliateUrl: "https://al.fanza.co.jp/?lurl=https%3A%2F%2Fwww.dmm.co.jp%2Fdigital%2Fvideoa%2F-%2Fdetail%2F%3D%2Fcid%3Ddvaj00761%2F&af_id=example-001",
      affiliateLinkReady: true,
      preferredLinkMode: "COMBINED",
      disclosure: "#PR",
    });
    expect(result.wpTitleUsedAsSoleInput).toBe(false);
    expect(result.titleDivergence).toBe(true);
    expect(result.canonicalTitleUsed).toContain("幸村泉希");
    expect(result.linkMode).toBe("COMBINED");
    expect(result.posts.length).toBeGreaterThanOrEqual(2);
    expect(result.posts[0]!.linkKind).toBe("none");
    expect(result.posts.some((p) => p.linkKind === "wp")).toBe(true);
    expect(result.posts.some((p) => p.linkKind === "fanza")).toBe(true);
    expect(result.posts.every((p) => !/気になる作品を紹介|好きならチェック/.test(p.body))).toBe(
      true,
    );
  });

  it("falls back to FANZA when WP is future", () => {
    const link = chooseXLinkMode({
      publishedBlogUrl: "https://otonaselect.net/?p=203",
      wpStatus: "future",
      affiliateUrl: "https://al.fanza.co.jp/?af_id=example-001",
      affiliateLinkReady: true,
      preferredLinkMode: "WP_TRAFFIC",
    });
    expect(link.mode).toBe("DIRECT_AFFILIATE");
    expect(link.wpUrl).toBeNull();
  });

  it("chooses thread shape from hook density", () => {
    expect(chooseXThreadShape(["a"])).toBe("SINGLE");
    expect(chooseXThreadShape(["a", "b"])).toBe("SHORT_THREAD");
    expect(chooseXThreadShape(["a", "b", "c"])).toBe("RICH_THREAD");
  });

  it("extracts work-specific hooks without adult surface", () => {
    const hooks = extractXSocialHooks({
      canonicalTitle: "パート家政婦のBEST8時間",
      performerNames: [],
      claimStatements: [
        { statement: "8時間ベスト" },
        { statement: "濃厚なセックス収録" },
      ],
      safeFacets: ["パート家政婦", "8時間"],
    });
    expect(hooks.some((h) => /8時間|パート家政婦|BEST/.test(h))).toBe(true);
    expect(hooks.every((h) => !/セックス/.test(h))).toBe(true);
  });
});

describe("x-route COMBINED", () => {
  it("supports combined when blog + affiliate ready", () => {
    const d = chooseXPostRoute({
      affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
      publishedBlogUrl: "https://blog.example/p/1",
      preferredRoute: "COMBINED",
      affiliateLinkReady: true,
    });
    expect(d.route).toBe("COMBINED");
    expect(d.secondaryUrl).toContain("al.fanza.co.jp");
  });
});

describe("dry-run multi-post", () => {
  it("never wouldCallCreatePost and carries posts", () => {
    const adapted = adaptCanonicalToXSocial({
      canonicalTitle: "5作品BEST",
      cid: "dazd00311",
      safeFacets: ["5作品", "BEST"],
      affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
      affiliateLinkReady: true,
      wpStatus: "future",
      publishedBlogUrl: "https://otonaselect.net/?p=224",
      disclosure: "#PR",
    });
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
      body: adapted.posts[0]!.body,
      posts: adapted.posts,
      threadShape: adapted.threadShape,
      linkMode: adapted.linkMode,
      productId: "dazd00311",
      affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
      publishedBlogUrl: null,
      preferredRoute: "DIRECT_AFFILIATE",
    });
    expect(payload.wouldCallCreatePost).toBe(false);
    expect(payload.posts.length).toBeGreaterThanOrEqual(1);
    expect(payload.killSwitch).toBe(true);
  });
});
