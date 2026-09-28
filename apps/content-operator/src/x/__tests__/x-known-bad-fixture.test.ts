/**
 * Known published bad X fixtures must not PASS Social Review / Publication unit.
 *
 * 1) h_1780gtaxd00084 — scene narration + stock CTA
 * 2) 赤名いと live bad — package fragment glue + parent URL embed + 1-tweet complete
 */
import { describe, expect, it } from "vitest";
import { reviewXSocialCopy, reviewXSocialPublicationUnit } from "../social-review.js";
import { detectXAdultExpressions } from "../x-social-content-policy.js";
import { composeXThreadPublication } from "../x-thread-publication.js";
import type { XSocialPlan } from "../social-plan.js";

const BAD_BODY_TAXI =
  "陽だまりの中で、スタイルの良いミニスカ女子が手を上げた。パックリ開いたニーソ脚を楽しみながらクンニする。作品のポイントは記事に書いています。";

/** Live bad parent (赤名いと) — package fragment glue + unsupported sweep. */
const BAD_BODY_AKANA =
  "赤名いとが出演する作品で、年上の男を金ヅルとしか見ていないナメ腐った未成熟なP活女ども。やっぱ生き物の本懐とは金よりも性。";

const planTaxi: XSocialPlan = {
  subject: "逢沢みゆ",
  contentType: "作品紹介",
  whatIsInteresting: "密室タクシーの空気感",
  corePremise: "密着タクシー",
  primaryAppeal: "ニーソ",
  secondaryAppeal: null,
  concreteDetails: [],
  angle: "密着タクシーの空気感",
  readerHook: "密室タクシーの空気感が気になる",
  whyThisWork: "設定がはっきりしている",
  supportingClaims: ["逢沢みゆ", "ミニスカ", "ニーソ", "陽だまり", "タクシー"],
  workUnderstanding: ["密着タクシー", "逢沢みゆ"],
  allowedClaims: ["逢沢みゆ", "ミニスカ", "ニーソ", "陽だまり", "タクシー"],
  publicationIntent: {
    needsArticleReply: true,
    relatedPostUseful: false,
    preferredReplyOrder: "wp_only",
  },
  productTitle: "逢沢みゆが魅せる密室タクシードライバーの濃密",
  canonicalContext: {
    performers: ["逢沢みゆ"],
    seriesName: null,
    claimCount: 4,
    droppedAdultCount: 0,
  },
};

const planAkana: XSocialPlan = {
  subject: "赤名いと",
  contentType: "作品紹介",
  whatIsInteresting: "年上との関係性を軸にした状況設定",
  corePremise: "年上の男との関係性",
  primaryAppeal: "赤名いとの出演作",
  secondaryAppeal: null,
  concreteDetails: [],
  angle: "赤名いとの作品を関係性の設定から紹介する",
  readerHook: "年上との関係性の設定",
  whyThisWork: "出演者と状況設定が確認できる",
  supportingClaims: ["赤名いと", "年上との関係性"],
  workUnderstanding: ["赤名いと", "年上との関係性"],
  allowedClaims: ["赤名いと", "年上との関係性"],
  publicationIntent: {
    needsArticleReply: true,
    relatedPostUseful: false,
    preferredReplyOrder: "wp_only",
  },
  productTitle: "赤名いと 出演作",
  canonicalContext: {
    performers: ["赤名いと"],
    seriesName: null,
    claimCount: 2,
    droppedAdultCount: 2,
  },
};

describe("known bad X published fixture h_1780gtaxd00084", () => {
  it("detects adult / stock CTA / scene narration — must not PASS", () => {
    const adult = detectXAdultExpressions(BAD_BODY_TAXI);
    const r = reviewXSocialCopy(BAD_BODY_TAXI, planTaxi);
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.severity === "BLOCKING")).toBe(true);
    const codes = r.findings.map((f) => f.code);
    expect(
      codes.some((c) =>
        ["ADULT_EXPRESSION", "STOCK_CTA", "PACKAGE_SCENE_NARRATION", "SCENE_NARRATION"].includes(
          c,
        ),
      ) || adult.hit,
    ).toBe(true);
  });

  it("rejects regenerated scene-narration taxi copy", () => {
    const scene =
      "「ゆみ 密室タクシードライバー 逢沢みゆ」では、逢沢みゆが後部座席に乗り込み、ムチムチの絶対領域を楽しむシーンが見どころです。逃げようとする尻をつかんでバックから突きまくる展開が、作品の核心を成しています。";
    const r = reviewXSocialCopy(scene, planTaxi);
    expect(r.ok).toBe(false);
    expect(
      r.findings.some((f) =>
        ["ADULT_EXPRESSION", "PACKAGE_SCENE_NARRATION", "SCENE_NARRATION"].includes(f.code),
      ),
    ).toBe(true);
  });
});

describe("known bad live fixture 赤名いと package-fragment + parent URL", () => {
  it("rejects package fragment glue / source slogan / mechanical template", () => {
    const r = reviewXSocialCopy(BAD_BODY_AKANA, planAkana);
    expect(r.ok).toBe(false);
    const codes = r.findings.map((f) => f.code);
    expect(
      codes.some((c) =>
        [
          "PACKAGE_FRAGMENT_GLUE",
          "UNSUPPORTED_SWEEP",
          "MECHANICAL_TEMPLATE",
          "SOURCE_VOICE",
          "ADULT_EXPRESSION",
        ].includes(c),
      ),
    ).toBe(true);
  });

  it("rejects 1-tweet complete with WP URL on parent as publication unit", () => {
    const badParentWithUrl = `${BAD_BODY_AKANA} https://otonaselect.net/akana-ito/`;
    const unit = reviewXSocialPublicationUnit({
      plan: planAkana,
      parentBody: BAD_BODY_AKANA,
      posts: [
        {
          sequence: 1,
          threadRole: "PARENT",
          body: badParentWithUrl,
          linkKind: "wp",
        },
      ],
    });
    expect(unit.ok).toBe(false);
    expect(unit.findings.some((f) => f.code === "PARENT_URL_FORCED")).toBe(true);
  });

  it("new compose places WP URL on reply, not parent", () => {
    const goodParent =
      "赤名いとの近作では、年上との関係性を軸にした状況設定がはっきりしている。公式に確認できる設定から紹介する。";
    const posts = composeXThreadPublication({
      strategy: "WP_TRAFFIC_EMBED",
      parentBody: `${goodParent} https://otonaselect.net/akana-ito/`,
      wpUrl: "https://otonaselect.net/akana-ito/",
      fanzaUrl: "https://al.fanza.co.jp/x",
      disclosure: "#PR",
      intent: {
        needsArticleReply: true,
        relatedPostUseful: false,
        preferredReplyOrder: "wp_only",
      },
      navSeed: "akana",
    });
    expect(posts[0]!.body).not.toContain("http");
    expect(posts[0]!.body).not.toContain("#PR");
    expect(posts[0]!.threadRole).toBe("PARENT");
    const wp = posts.find((p) => p.threadRole === "WP_REPLY");
    expect(wp?.body).toContain("otonaselect.net");
    expect(wp?.body).toContain("#PR");
    expect(posts.some((p) => p.threadRole === "AFFILIATE_REPLY")).toBe(false);
    expect(posts.some((p) => /al\.fanza\.co\.jp/i.test(p.body))).toBe(false);
  });
});
