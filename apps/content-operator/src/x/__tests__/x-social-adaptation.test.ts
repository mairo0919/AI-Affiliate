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
  toGroundedPlanAtom,
} from "../x-social-facts.js";
import { planXSocial } from "../social-plan.js";
import { writeXSocialCopySync } from "../social-write.js";
import { reviewXSocialCopy } from "../social-review.js";
import { runXSocialPipeline } from "../social-pipeline.js";
import { detectXAdultExpressions } from "../x-social-content-policy.js";
import { chooseXPostRoute } from "../../daily-ops/x-route.js";
import { buildXDryRunPayload } from "../x-dry-run.js";

function miniPlan(partial: Partial<{
  subject: string | null;
  contentType: string | null;
  corePremise: string | null;
  primaryAppeal: string | null;
  secondaryAppeal: string | null;
  concreteDetails: string[];
  angle: string;
  readerHook: string;
  whyThisWork: string;
  workUnderstanding: string[];
  allowedClaims: string[];
  productTitle: string;
}> ) {
  const allowed = partial.allowedClaims ?? [];
  return {
    subject: partial.subject ?? null,
    contentType: partial.contentType ?? null,
    whatIsInteresting: partial.readerHook ?? partial.angle ?? "hook",
    corePremise: partial.corePremise ?? null,
    primaryAppeal: partial.primaryAppeal ?? null,
    secondaryAppeal: partial.secondaryAppeal ?? null,
    concreteDetails: partial.concreteDetails ?? [],
    angle: partial.angle ?? "identity_plus_hook",
    readerHook: partial.readerHook ?? partial.angle ?? "hook",
    whyThisWork: partial.whyThisWork ?? partial.corePremise ?? "why",
    supportingClaims: allowed.slice(0, 4),
    workUnderstanding: partial.workUnderstanding ?? [],
    allowedClaims: allowed,
    publicationIntent: {
      needsArticleReply: true,
      relatedPostUseful: Boolean(partial.subject),
      preferredReplyOrder: "wp_only" as const,
    },
    productTitle: partial.productTitle ?? "test",
    canonicalContext: { performers: [], seriesName: null, claimCount: 0, droppedAdultCount: 0 },
  };
}


describe("x-eligibility backlog gate", () => {
  it("allows NORMAL + factory-linked only", async () => {
    const ok = evaluateXBacklogEligibility({
      cid: "cemd00899",
      classification: "NORMAL",
      factoryLinked: true,
      bodyEmpty: false,
    });
    expect(ok.eligible).toBe(true);
  });

  it("WP traffic only when publicly published", async () => {
    expect(isWordPressPublicForXTraffic("publish")).toBe(true);
    expect(isWordPressPublicForXTraffic("future")).toBe(false);
  });
});

describe("social planner / writer / review", () => {
  it("drops adult atoms entirely — never strip-and-glue", async () => {
    expect(toGroundedPlanAtom("チ○ポの限界を超えて女の子みたいに連続する者も")).toBeNull();
    expect(
      toGroundedPlanAtom("1発の射精では満足できないくらい官能的で貪欲な射精をー"),
    ).toBeNull();
    expect(toGroundedPlanAtom("町内会の合宿で人妻たちが集う温泉企画")).toBeTruthy();
  });

  it("plans from claims/title — prefers work premise over taxonomy shells", async () => {
    const planFacts = extractArticlePlanSocialFacts({
      brainGenerationContract: {
        layers: {
          ARTICLE_PLAN: {
            title: { facts: ["長瀬麻美"] },
            body: [
              {
                facts: [
                  "長瀬麻美",
                  "合宿で再会した幼なじみが教える主観もの",
                  "人妻・主婦",
                  "キス・接吻",
                ],
                factSourceTypes: ["IDENTITY", "SCENE", "GENRE_TAG", "GENRE_TAG"],
              },
            ],
          },
        },
      },
    });
    const planned = planXSocial({
      canonicalTitle: "長瀬麻美の合宿再会",
      productTitle: "長瀬麻美の合宿で再会した幼なじみ",
      performerNames: ["長瀬麻美"],
      groundedPlanFacts: planFacts.map((f) => f.text),
    });
    expect(planned.ok).toBe(true);
    if (planned.ok) {
      expect(planned.plan.subject).toBe("長瀬麻美");
      expect(planned.plan.allowedClaims.join("|")).toMatch(/合宿|幼なじみ/);
      expect(planned.plan.allowedClaims.join("|")).not.toMatch(/^キス・接吻/);
    }
  });

  it("rejects source voice / brand slogan / awkward Nameの+numeral structurally", async () => {
    const badPersona = reviewXSocialCopy("響蓮ちゃんとエッチができるんだ。8KでKMPVRが変わる。", miniPlan({
      subject: "響蓮",
      contentType: "VR",
      corePremise: "響蓮に沼る",
      primaryAppeal: null,
      concreteDetails: [],
      allowedClaims: ["響蓮に沼る"],
    }));
    expect(badPersona.ok).toBe(false);
    expect(badPersona.findings.some((f) => f.code === "SOURCE_VOICE" || f.code === "BRAND_SLOGAN")).toBe(
      true,
    );

    const badGlue = reviewXSocialCopy("藤森里穂の10発するまで、ギブアップなしの企画。", miniPlan({
      subject: "藤森里穂",
      contentType: null,
      corePremise: "10発するまでギブアップなしの企画",
      primaryAppeal: null,
      concreteDetails: [],
      allowedClaims: ["10発するまでギブアップなしの企画"],
    }));
    expect(badGlue.ok).toBe(false);
    expect(badGlue.findings.some((f) => f.code === "MECHANICAL_TEMPLATE" || f.code === "MECHANICAL_INTRO")).toBe(
      true,
    );

    const badPuff = reviewXSocialCopy("篠田ゆうの今もなお進化を続ける業界トップの尻テク女優。", miniPlan({
      subject: "篠田ゆう",
      contentType: "BEST_COMPILATION",
      corePremise: null,
      primaryAppeal: "今もなお進化を続ける業界トップの尻テク女優",
      concreteDetails: [],
      allowedClaims: ["今もなお進化を続ける業界トップの尻テク女優"],
    }));
    expect(badPuff.ok).toBe(false);
    expect(badPuff.findings.some((f) => f.code === "MECHANICAL_TEMPLATE" || f.code === "MECHANICAL_INTRO")).toBe(
      true,
    );
  });

  it("writer keeps identity separate from numeric / puffery clauses", async () => {
    const written = writeXSocialCopySync(miniPlan({
      subject: "藤森里穂",
      contentType: null,
      corePremise: null,
      primaryAppeal: "10発するまでギブアップNG",
      concreteDetails: [],
      allowedClaims: ["10発するまでギブアップNG"],
    }));
    expect(written.body).not.toMatch(/藤森里穂の10発/);
    expect(written.body).toMatch(/藤森里穂/);
    expect(written.body).toMatch(/ギブアップなし/);
  });

  it("pipeline binds identity into work premise", async () => {
    const result = await runXSocialPipeline({
      canonicalTitle: "八木奈々の神業ハンドテクで絶対連続させてくれるメンズエステ",
      productTitle: "八木奈々の神業ハンドテクで絶対連続させてくれるメンズエステ",
      performerNames: ["八木奈々"],
      groundedPlanFacts: [
        "神業ハンドテクで絶対連続させてくれるメンズエステ",
        "チ○ポの限界を超えて女の子みたいに連続アクメする者も",
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalBody).toMatch(/八木奈々/);
      expect(result.finalBody).toMatch(/メンズエステ|ハンドテク/);
      expect(result.finalBody).not.toMatch(/チ[〇○]ポ|アクメ/);
    }
  });
});

describe("wp traffic CTA + permalink", () => {
  it("omits stock CTA for WP_TRAFFIC — WP URL on reply, not parent", async () => {
    const result = await adaptCanonicalToXSocial({
      canonicalTitle: "アリスJAPANのBEST 5時間BEST",
      productTitle: "おしゃぶり大好き美女たちの顔がスケベすぎる5時間BEST",
      cid: "dvaj00760",
      articlePlanFacts: [
        {
          text: "おしゃぶり大好き美女たちの顔がスケベすぎる",
          kind: "situation",
          source: "article_plan",
          score: 10,
        },
        {
          text: "5時間BEST",
          kind: "feature",
          source: "article_plan",
          score: 12,
        },
      ],
      claimStatements: [{ statement: "宍戸里帆" }, { statement: "小野坂ゆいか" }],
      performerNames: ["宍戸里帆", "小野坂ゆいか", "柏木こなつ", "北野未奈"],
      publishedBlogUrl: "https://otonaselect.net/?p=211",
      wordpressSlug:
        "%e3%82%a2%e3%83%aa%e3%82%b9japan%e3%81%8c%e8%b4%88%e3%82%8b%e5%ae%8d%e6%88%b8%e9%87%8c%e5%b8%86%e5%87%ba%e6%bc%94%e3%81%ae%e3%83%95%e3%82%a7%e3%83%a9%e3%83%99%e3%82%b9%e3%83%885%e6%99%92%e9%96%93",
      siteBaseUrl: "https://otonaselect.net",
      wpStatus: "publish",
      disclosure: "",
      preferredLinkMode: "WP_TRAFFIC",
      preferWpTraffic: true,
      allowDirectAffiliate: false,
    });
    expect(result.skip).toBeNull();
    const parent = result.posts[0]!;
    const all = result.posts.map((p) => p.body).join("\n");
    expect(parent.body).not.toMatch(/https?:\/\//);
    expect(parent.linkKind).toBe("none");
    expect(all).not.toMatch(/詳細は記事で/);
    expect(all).not.toMatch(/気になる方は作品紹介をどうぞ/);
    expect(all).not.toMatch(/#PR/);
    expect(all).not.toMatch(/al\.fanza\.co\.jp|af_id=/i);
    expect(all).not.toMatch(/\?p=211/);
    expect(all).toMatch(/otonaselect\.net\//);
    expect(result.posts.some((p) => p.threadRole === "WP_REPLY")).toBe(true);
    expect(parent.body).toMatch(/宍戸里帆|5時間BEST|小野坂ゆいか/);
    expect(all).not.toMatch(/おしゃぶり/);
  });
});

describe("social composer regression fixtures (dry-preview CIDs)", () => {
  const stockCtaRe =
    /気になる方は作品紹介をどうぞ|作品のポイントは記事に書いています|作品の内容をもう少し詳しくまとめています|この作品の見どころはこちら|詳しい見どころは記事で紹介しています/;

  it("13dsvr02004: no stock CTA; keeps work hook; WP URL on reply", async () => {
    const result = await adaptCanonicalToXSocial({
      canonicalTitle: "小野坂ゆいかの【VR】【8K】身体の隅々まで舐めるのが大好きな都合のいいタダマンギャル",
      productTitle:
        "【VR】【8K】身体の隅々まで舐めるのが大好きな都合のいいタダマンギャル 男（俺）に依存する女を好き勝手ヤリまくる 小野坂ゆいか",
      cid: "13dsvr02004",
      articlePlanFacts: [
        {
          text: "身体の隅々まで舐めるのが大好きな都合のいいタダマンギャル",
          kind: "situation",
          source: "article_plan",
          score: 8,
        },
        {
          text: "都合のいいタダマンギャルを軸にした8K VR",
          kind: "feature",
          source: "article_plan",
          score: 10,
        },
      ],
      performerNames: ["小野坂ゆいか"],
      publishedBlogUrl: "https://otonaselect.net/onozaka/",
      siteBaseUrl: "https://otonaselect.net",
      wpStatus: "publish",
      disclosure: "",
      preferredLinkMode: "WP_TRAFFIC",
      preferWpTraffic: true,
      allowDirectAffiliate: false,
    });
    expect(result.skip).toBeNull();
    const body = result.posts[0]!.body;
    expect(body).not.toMatch(stockCtaRe);
    expect(body).not.toMatch(/https?:\/\//);
    expect(body).toMatch(/小野坂ゆいか/);
    expect(result.posts.map((p) => p.body).join("\n")).toMatch(/https:\/\/otonaselect\.net\//);
  });

  it("vrkm01889: drops product-voice / brand slogan; may SKIP if only thin remains", async () => {
    const result = await adaptCanonicalToXSocial({
      canonicalTitle: "響蓮と【VR】響蓮に沼る",
      productTitle: "【VR】響蓮に沼る 今日のSEXでもっと沼にハメてあげるからね",
      cid: "vrkm01889",
      articlePlanFacts: [
        {
          text: "今日のSEXでもっと沼にハメてあげるからね",
          kind: "situation",
          source: "article_plan",
          score: 8,
        },
        {
          text: "響蓮ちゃんとエッチができるんだ",
          kind: "situation",
          source: "article_plan",
          score: 9,
        },
        {
          text: "8KでKMPVRが変わる",
          kind: "feature",
          source: "article_plan",
          score: 20,
        },
      ],
      performerNames: ["響蓮"],
      publishedBlogUrl: "https://otonaselect.net/hibiki/",
      siteBaseUrl: "https://otonaselect.net",
      wpStatus: "publish",
      disclosure: "",
      preferredLinkMode: "WP_TRAFFIC",
      preferWpTraffic: true,
      allowDirectAffiliate: false,
    });
    const body = result.posts.map((p) => p.body).join("\n");
    expect(body).not.toMatch(/してあげるからね/);
    expect(body).not.toMatch(/できるんだ/);
    expect(body).not.toMatch(/KMPVRが変わる/);
    expect(body).not.toMatch(/響蓮ちゃんとエッチができるんだ。8KでKMPVRが変わる/);
    expect(body).not.toMatch(stockCtaRe);
  });

  it("ofje00250: prefers 全48タイトル over S1GIRLSCOLLECTION shell", async () => {
    const result = await adaptCanonicalToXSocial({
      canonicalTitle: "橋本ありなの全48タイトル完全コンプリート",
      productTitle: "橋本ありな S1GIRLSCOLLECTION 全48タイトル完全コンプリート",
      cid: "ofje00250",
      articlePlanFacts: [
        {
          text: "S1GIRLSCOLLECTION",
          kind: "series",
          source: "article_plan",
          score: 28,
        },
        {
          text: "全48タイトル完全コンプリート",
          kind: "feature",
          source: "article_plan",
          score: 5,
        },
      ],
      performerNames: ["橋本ありな"],
      publishedBlogUrl: "https://otonaselect.net/hashimoto/",
      siteBaseUrl: "https://otonaselect.net",
      wpStatus: "publish",
      disclosure: "",
      preferredLinkMode: "WP_TRAFFIC",
      preferWpTraffic: true,
      allowDirectAffiliate: false,
    });
    expect(result.skip).toBeNull();
    const body = result.posts[0]!.body;
    expect(body).toMatch(/橋本ありな/);
    expect(body).toMatch(/48タイトル|コンプリート/);
    expect(body).not.toMatch(/^橋本ありな出演。S1GIRLSCOLLECTION/);
    expect(body).not.toMatch(stockCtaRe);
  });

  it("sone00200: strip-broken and chronology-only must not PASS as thin intro", async () => {
    expect(toGroundedPlanAtom("1発の射精では満足できないくらい官能的で貪欲な射精をー")).toBeNull();

    const thin = await adaptCanonicalToXSocial({
      canonicalTitle: "河北彩花と1発の射精では満足できないくらい",
      productTitle: "河北彩花と1発の射精では満足できないくらい",
      cid: "sone00200",
      articlePlanFacts: [
        {
          text: "1発の射精では満足できないくらい官能的で貪欲な射精をー",
          kind: "situation",
          source: "article_plan",
          score: 8,
        },
        {
          text: "復活から約3年",
          kind: "work_theme",
          source: "article_plan",
          score: 12,
        },
      ],
      performerNames: ["河北彩花"],
      publishedBlogUrl: "https://otonaselect.net/kawakitaya/",
      siteBaseUrl: "https://otonaselect.net",
      wpStatus: "publish",
      disclosure: "",
      preferredLinkMode: "WP_TRAFFIC",
      preferWpTraffic: true,
      allowDirectAffiliate: false,
    });
    const thinBody = thin.posts.map((p) => p.body).join("\n");
    expect(thinBody).not.toMatch(/のでは|なを|にを|をー/);
    if (!thin.skip) {
      expect(thinBody).not.toMatch(/^河北彩花出演。復活から約3年/);
    } else {
      expect(thin.skip.reason).toBe("SOCIAL_CONTENT_TOO_THIN");
    }
  });

  it("miaa00400: drops persona / broken glue; does not emit Nameの+numeral NG", async () => {
    const result = await adaptCanonicalToXSocial({
      canonicalTitle: "藤森里穂の痴女お姉さんが射精の限界突破と男潮吹かせまくるM性感ソープランド",
      productTitle: "藤森里穂の痴女お姉さんが射精の限界突破と男潮吹かせまくるM性感ソープランド",
      cid: "miaa00400",
      articlePlanFacts: [
        {
          text: "ヤラしさ全開の風俗で悶絶するほどの気持ちよさをご体験あれ",
          kind: "situation",
          source: "article_plan",
          score: 8,
        },
        {
          text: "お姉さんが射精の限界突破と男潮吹かせまくるM性感ソープランド",
          kind: "situation",
          source: "article_plan",
          score: 9,
        },
        {
          text: "10発するまでギブアップNG",
          kind: "feature",
          source: "article_plan",
          score: 6,
        },
      ],
      performerNames: ["藤森里穂"],
      publishedBlogUrl: "https://otonaselect.net/fujimori/",
      siteBaseUrl: "https://otonaselect.net",
      wpStatus: "publish",
      disclosure: "",
      preferredLinkMode: "WP_TRAFFIC",
      preferWpTraffic: true,
      allowDirectAffiliate: false,
    });
    const body = result.posts.map((p) => p.body).join("\n");
    expect(body).not.toMatch(/がの|ご体験あれ|男かせ/);
    expect(body).not.toMatch(/藤森里穂の10発するまで、ギブアップなしの企画/);
    expect(body).not.toMatch(stockCtaRe);
    if (!result.skip) {
      expect(body).toMatch(/藤森里穂/);
      expect(body).toMatch(/ギブアップなし|M性感|ソープ/);
      expect(body).not.toMatch(/藤森里穂の\d/);
    }
  });

  it("mizd00315: drops desire voice; does not emit Nameの+puffery NG", async () => {
    const result = await adaptCanonicalToXSocial({
      canonicalTitle: "篠田ゆうの11作品30射精8時間BEST",
      productTitle: "篠田ゆうの11作品30射精8時間BEST",
      cid: "mizd00315",
      articlePlanFacts: [
        {
          text: "生涯一度はこんなお姉さんとセックスがしたい",
          kind: "situation",
          source: "article_plan",
          score: 8,
        },
        {
          text: "顔も身体も女に思いっきりしたい",
          kind: "situation",
          source: "article_plan",
          score: 9,
        },
        {
          text: "今もなお進化を続ける業界トップの尻テク女優",
          kind: "feature",
          source: "article_plan",
          score: 6,
        },
      ],
      performerNames: ["篠田ゆう"],
      publishedBlogUrl: "https://otonaselect.net/shinoda/",
      siteBaseUrl: "https://otonaselect.net",
      wpStatus: "publish",
      disclosure: "",
      preferredLinkMode: "WP_TRAFFIC",
      preferWpTraffic: true,
      allowDirectAffiliate: false,
    });
    const body = result.posts.map((p) => p.body).join("\n");
    expect(body).not.toMatch(/とがしたい|お姉さんとが|思いっきりしたい/);
    expect(body).not.toMatch(/篠田ゆうの今もなお進化を続ける業界トップの尻テク女優/);
    expect(body).not.toMatch(stockCtaRe);
    if (!result.skip) {
      expect(body).toMatch(/篠田ゆう/);
      expect(body).toMatch(/尻テク|業界トップ|11作品|8時間BEST/);
    }
  });
});

describe("x-social-adaptation", () => {
  it("uses plan/claim situation — not WP title or genre list", async () => {
    const planFacts = extractArticlePlanSocialFacts({
      brainGenerationContract: {
        layers: {
          ARTICLE_PLAN: {
            body: [
              {
                facts: [
                  "町内会の合宿で人妻たちが集う温泉企画",
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
    const result = await adaptCanonicalToXSocial({
      canonicalTitle: "MadonnaVR史上初の専属美熟女10人とハイクオリティVRの温泉企画",
      wordpressTitle: "SEO別タイトル",
      productTitle:
        "【VR】MadonnaVR史上初！！専属美熟女10人大集合！！町内会の合宿で人妻たちが集う温泉企画 8KVR",
      cid: "juvr00281",
      performerNames: ["風間ゆみ", "椎名ゆな"],
      articlePlanFacts: planFacts,
      taxonomyTags: ["人妻・主婦", "熟女"],
      affiliateUrl: "https://al.fanza.co.jp/?af_id=example-001",
      affiliateLinkReady: true,
      wpStatus: "future",
      disclosure: "",
      preferredLinkMode: "DIRECT_AFFILIATE",
      allowDirectAffiliate: true,
    });
    expect(result.skip).toBeNull();
    expect(result.wpTitleUsedAsSoleInput).toBe(false);
    expect(result.posts[0]!.body).toMatch(/合宿|町内会|10人|温泉/);
    expect(result.posts[0]!.body).not.toMatch(/#PR/);
    expect(result.posts[0]!.body).toMatch(/、|。/);
  });

  it("reuses article sample over hero when sample is less-explicit proxy", async () => {
    const result = await adaptCanonicalToXSocial({
      canonicalTitle: "町内会の合宿温泉",
      cid: "juvr00281",
      articlePlanFacts: [
        {
          text: "町内会の合宿で人妻たちが集う温泉企画",
          kind: "situation",
          source: "article_plan",
          score: 10,
        },
      ],
      articleImages: [
        {
          role: "hero",
          sourceUrl: "https://pics.dmm.co.jp/digital/video/juvr00281/juvr00281pl.jpg",
          imageType: "main_large",
          alt: "hero",
          researchImageId: "ri-1",
          usageStatus: "ALLOWED",
          provenance: "research_image",
          displayMode: "url_reference",
        },
        {
          role: "auxiliary",
          sourceUrl: "https://pics.dmm.co.jp/digital/video/juvr00281/juvr00281jp-1.jpg",
          imageType: "sample_large",
          alt: "sample",
          researchImageId: "ri-2",
          usageStatus: "ALLOWED",
          provenance: "research_image",
          displayMode: "url_reference",
        },
      ],
      affiliateUrl: "https://al.fanza.co.jp/?af_id=example-001",
      affiliateLinkReady: true,
      wpStatus: "publish",
      publishedBlogUrl: "https://otonaselect.net/?p=267",
      disclosure: "",
    });
    expect(result.mediaMode).toBe("SAFE_IMAGE");
    expect(result.mediaRole).toBe("auxiliary");
    expect(result.mediaUrl).toContain("juvr00281jp-1.jpg");
    expect(result.mediaReason).toMatch(/less_explicit|sample/);
    expect(result.skip).toBeNull();
    expect(result.posts[0]!.body).not.toMatch(/#PR/);
    expect(result.posts[0]!.body).not.toMatch(/al\.fanza\.co\.jp/);
    expect(result.posts[0]!.body).not.toContain("otonaselect.net");
    expect(result.posts.map((p) => p.body).join("\n")).toContain("otonaselect.net");
  });

  it("falls back to TEXT_ONLY when no ALLOWED article images", async () => {
    const result = await adaptCanonicalToXSocial({
      canonicalTitle: "町内会の合宿温泉",
      cid: "juvr00281",
      articlePlanFacts: [
        {
          text: "町内会の合宿で人妻たちが集う温泉企画",
          kind: "situation",
          source: "article_plan",
          score: 10,
        },
      ],
      articleImages: [],
      affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
      affiliateLinkReady: true,
      wpStatus: "publish",
      publishedBlogUrl: "https://otonaselect.net/?p=267",
      disclosure: "",
    });
    expect(result.mediaMode).toBe("TEXT_ONLY");
    expect(result.mediaUrl).toBeNull();
  });

  it("skips SOCIAL_CONTENT_TOO_THIN instead of posting performer-only", async () => {
    const result = await adaptCanonicalToXSocial({
      canonicalTitle: "桜乃りの",
      cid: "snos00418",
      performerNames: ["桜乃りの"],
      claimStatements: [],
      articlePlanFacts: [],
      taxonomyTags: ["独占配信", "単体作品"],
      affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
      affiliateLinkReady: true,
      wpStatus: "publish",
      publishedBlogUrl: "https://otonaselect.net/?p=100",
      disclosure: "",
    });
    expect(result.skip?.reason).toBe("SOCIAL_CONTENT_TOO_THIN");
    expect(result.posts).toHaveLength(0);
  });

  it("salvages X-safe title/catalog hooks when claims are adult-only", () => {
    const cemd = planXSocial({
      canonicalTitle:
        "1本限りのアナルSEX復活と玉城夏帆 ～これで見納め！？～撮影中にアナルSEXを交渉してみた～",
      productTitle:
        "1本限りのアナルSEX復活と玉城夏帆 ～これで見納め！？～撮影中にアナルSEXを交渉してみた～",
      performerNames: ["玉城夏帆"],
    });
    expect(cemd.ok).toBe(true);
    if (cemd.ok) {
      expect(cemd.plan.subject).toBe("玉城夏帆");
      expect(detectXAdultExpressions(cemd.plan.allowedClaims.join("")).hit).toBe(false);
      expect(`${cemd.plan.corePremise ?? ""}${cemd.plan.primaryAppeal ?? ""}`.length).toBeGreaterThan(8);
    }

    const hours = planXSocial({
      canonicalTitle: "近親相姦と巨乳",
      productTitle: "本当はオバさんだってHしたいのよ！我慢できずに若いチ○ポを貪りまくる七十路六十路五十路の変態熟女4時間3",
      performerNames: [],
    });
    expect(hours.ok).toBe(true);
    if (hours.ok) {
      expect(hours.plan.subject).not.toBe("近親相姦");
      expect(hours.plan.allowedClaims.join("")).toMatch(/4時間/);
      expect(detectXAdultExpressions(hours.plan.allowedClaims.join("")).hit).toBe(false);
    }

    const hatano = planXSocial({
      canonicalTitle: "波多野結衣のアクメ・オーガズム",
      productTitle: "下品なSEXでアへ顔晒してオホ声絶頂 波多野結衣",
      performerNames: ["波多野結衣"],
    });
    expect(hatano.ok).toBe(true);
    if (hatano.ok) {
      expect(hatano.plan.subject).toBe("波多野結衣");
      expect(detectXAdultExpressions(hatano.plan.allowedClaims.join("")).hit).toBe(false);
    }
  });

  it("holds X when WP is future under WP_TRAFFIC", async () => {
    const result = await adaptCanonicalToXSocial({
      canonicalTitle: "町内会の合宿温泉",
      cid: "juvr00281",
      articlePlanFacts: [
        {
          text: "町内会の合宿で人妻たちが集う温泉企画",
          kind: "situation",
          source: "article_plan",
          score: 10,
        },
      ],
      publishedBlogUrl: "https://otonaselect.net/?p=267",
      wpStatus: "future",
      affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
      affiliateLinkReady: true,
      disclosure: "",
      preferredLinkMode: "WP_TRAFFIC",
    });
    expect(result.skip?.reason).toBe("WP_NOT_PUBLIC");
    expect(result.posts).toHaveLength(0);
  });

  it("does not fall back to FANZA when WP is future (WP_TRAFFIC hold)", () => {
    const link = chooseXLinkMode({
      publishedBlogUrl: "https://otonaselect.net/?p=203",
      wpStatus: "future",
      affiliateUrl: "https://al.fanza.co.jp/?af_id=example-001",
      affiliateLinkReady: true,
      preferredLinkMode: "WP_TRAFFIC",
      allowDirectAffiliate: false,
    });
    expect(link.mode).toBe("WP_TRAFFIC");
    expect(link.wpUrl).toBeNull();
    expect(link.fanzaUrl).toBeNull();
    expect(link.reason).toBe("wp_required_not_public");
  });

  it("can still use DIRECT when allowDirectAffiliate is explicitly enabled", async () => {
    const link = chooseXLinkMode({
      publishedBlogUrl: "https://otonaselect.net/?p=203",
      wpStatus: "future",
      affiliateUrl: "https://al.fanza.co.jp/?af_id=example-001",
      affiliateLinkReady: true,
      preferredLinkMode: "DIRECT_AFFILIATE",
      allowDirectAffiliate: true,
    });
    expect(link.mode).toBe("DIRECT_AFFILIATE");
    expect(link.fanzaUrl).toContain("al.fanza.co.jp");
  });

  it("extractXSocialHooks no longer returns pure genre lists", async () => {
    const hooks = await extractXSocialHooks({
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
  it("supports combined when blog + affiliate ready and flag enabled", async () => {
    const d = chooseXPostRoute({
      affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
      publishedBlogUrl: "https://blog.example/p/1",
      preferredRoute: "COMBINED",
      affiliateLinkReady: true,
      allowCombined: true,
      allowDirectAffiliate: true,
    });
    expect(d.route).toBe("COMBINED");
  });
});

describe("dry-run multi-post", () => {
  it("never wouldCallCreatePost", async () => {
    const adapted = await adaptCanonicalToXSocial({
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
      disclosure: "",
    });
    const payload = buildXDryRunPayload({
      config: {
        xApiEnabled: false,
        xReleaseMode: "DRY_RUN",
        xGlobalKillSwitch: true,
        xAutoPublicationEnabled: false,
        xMaxWeightedLength: 280,
        xAffiliateDisclosure: "",
        fanzaXSiteApproved: false,
        fanzaDefaultService: "digital",
        fanzaDefaultFloor: "videoa",
      },
      body: adapted.posts[0]?.body ?? "",
      posts: adapted.posts,
      threadShape: adapted.threadShape,
      linkMode: adapted.linkMode,
      productId: "dazd00312",
      publishedBlogUrl: "https://otonaselect.net/?p=100",
    });
    expect(payload.wouldCallCreatePost).toBe(false);
  });
});
