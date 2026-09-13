import { describe, expect, it } from "vitest";
import {
  evaluateXBacklogEligibility,
  isWordPressPublicForXTraffic,
} from "../x-eligibility.js";
import {
  adaptCanonicalToXSocial,
  chooseXLinkMode,
  extractXSocialHooks,
} from "../x-social-adaptation.js";
import {
  extractArticlePlanSocialFacts,
  selectXSocialFacts,
  toXSocialSafePhrase,
} from "../x-social-facts.js";
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
  });

  it("WP traffic only when publicly published", () => {
    expect(isWordPressPublicForXTraffic("publish")).toBe(true);
    expect(isWordPressPublicForXTraffic("future")).toBe(false);
  });
});

describe("x-social-facts selection", () => {
  it("prefers ARTICLE_PLAN situation over taxonomy tags", () => {
    const planFacts = extractArticlePlanSocialFacts({
      brainGenerationContract: {
        layers: {
          ARTICLE_PLAN: {
            title: { facts: ["長瀬麻美", "キス・接吻"] },
            body: [
              {
                facts: [
                  "長瀬麻美",
                  "唾液調教で敏感イキ狂い潮吹き女と化した麗しの欲情妻",
                  "人妻・主婦",
                  "キス・接吻",
                ],
                factSourceTypes: ["IDENTITY", "BODY_ATTRIBUTE", "GENRE_TAG", "GENRE_TAG"],
              },
            ],
          },
        },
      },
    });
    const selected = selectXSocialFacts({
      canonicalTitle: "長瀬麻美のキス・接吻",
      articlePlanFacts: planFacts,
      performerNames: ["長瀬麻美"],
      taxonomyTags: ["人妻・主婦", "キス・接吻", "中出し", "独占配信"],
    });
    expect(selected.selected.some((f) => /唾液|欲情妻|麗し/.test(f.text))).toBe(true);
    expect(selected.selected.every((f) => f.kind !== "taxonomy_aux" || selected.selected.length > 1)).toBe(
      true,
    );
    // Must not be pure taxonomy enumeration
    expect(selected.selected.map((f) => f.text).join("|")).not.toMatch(/^キス・接吻\|人妻/);
  });

  it("keeps VR town-meeting situation after adult strip", () => {
    const safe = toXSocialSafePhrase(
      "【VR】MadonnaVR史上初！！専属美熟女10人大集合！！町内会の合宿で欲求不満な人妻たちが僕1人を求め合い奪い合う超ハーレム温泉中出し乱交 8KVR",
    );
    expect(safe).toBeTruthy();
    expect(safe!).toMatch(/町内会|合宿|ハーレム|温泉|10人/);
    expect(safe!).not.toMatch(/中出し|乱交/);
  });

  it("does not pad thread with taxonomy when only one work fact", () => {
    const selected = selectXSocialFacts({
      canonicalTitle: "彩月七緒と幼なじみ",
      articlePlanFacts: [
        {
          text: "幼なじみの彩月七緒が教える主観もの",
          kind: "situation",
          source: "article_plan",
          score: 10,
        },
      ],
      performerNames: ["彩月七緒"],
      taxonomyTags: ["痴女", "主観", "騎乗位", "手コキ"],
    });
    expect(selected.threadShape).toBe("SINGLE");
    expect(selected.selected.every((f) => f.kind !== "taxonomy_aux")).toBe(true);
  });
});

describe("x-social-adaptation", () => {
  it("uses plan/claim situation — not WP title or genre list", () => {
    const planFacts = extractArticlePlanSocialFacts({
      brainGenerationContract: {
        layers: {
          ARTICLE_PLAN: {
            body: [
              {
                facts: [
                  "町内会の合宿で欲求不満な人妻たちが僕1人を求め合い奪い合う超ハーレム温泉",
                  "専属美熟女10人",
                  "人妻・主婦",
                ],
                factSourceTypes: ["OTHER", "QUANTITY", "GENRE_TAG"],
              },
            ],
            title: { facts: ["MadonnaVR", "専属美熟女10人"] },
          },
        },
      },
    });
    const result = adaptCanonicalToXSocial({
      canonicalTitle: "MadonnaVR史上初の専属美熟女10人とハイクオリティVRの温泉中出し乱交",
      wordpressTitle: "SEO別タイトル",
      cid: "juvr00281",
      performerNames: ["風間ゆみ", "椎名ゆな"],
      articlePlanFacts: planFacts,
      taxonomyTags: ["ハーレム", "人妻・主婦", "熟女", "乱交"],
      affiliateUrl: "https://al.fanza.co.jp/?af_id=example-001",
      affiliateLinkReady: true,
      wpStatus: "future",
      disclosure: "#PR",
      preferredLinkMode: "DIRECT_AFFILIATE",
    });
    expect(result.wpTitleUsedAsSoleInput).toBe(false);
    expect(result.posts[0]!.body).toMatch(/合宿|町内会|10人|ハーレム/);
    expect(result.posts.map((p) => p.body).join("\n")).not.toMatch(/^ハーレム。人妻・主婦/);
    expect(result.posts.every((p) => !detectDupTaxonomyThread(p.body))).toBe(true);
    expect(result.selectedFacts[0]!.kind).not.toBe("taxonomy_aux");
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
  });

  it("extractXSocialHooks no longer returns pure genre lists", () => {
    const hooks = extractXSocialHooks({
      canonicalTitle: "上戸まりのスレンダー作品",
      performerNames: ["上戸まり"],
      safeFacets: ["騎乗位", "M女", "貧乳・微乳", "独占配信"],
      articlePlanFacts: [
        {
          text: "上戸まりのスレンダーボディを軸にした4時間",
          kind: "feature",
          source: "article_plan",
          score: 12,
        },
      ],
    });
    expect(hooks.some((h) => /スレンダー|4時間|上戸まり/.test(h))).toBe(true);
    expect(hooks.includes("騎乗位")).toBe(false);
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
  });
});

describe("dry-run multi-post", () => {
  it("never wouldCallCreatePost", () => {
    const adapted = adaptCanonicalToXSocial({
      canonicalTitle: "5作品BEST",
      cid: "dazd00312",
      articlePlanFacts: [
        {
          text: "人妻とのひとときを凝縮したベスト",
          kind: "work_theme",
          source: "article_plan",
          score: 10,
        },
      ],
      taxonomyTags: ["人妻・主婦", "ベスト・総集編"],
      affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
      affiliateLinkReady: true,
      wpStatus: "future",
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
      productId: "dazd00312",
      affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
      preferredRoute: "DIRECT_AFFILIATE",
    });
    expect(payload.wouldCallCreatePost).toBe(false);
    expect(payload.killSwitch).toBe(true);
  });
});

function detectDupTaxonomyThread(body: string): boolean {
  return /^(人妻・主婦。|キス・接吻。|熟女。|ハーレム。)+$/u.test(body.trim());
}
