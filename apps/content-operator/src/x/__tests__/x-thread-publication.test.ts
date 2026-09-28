import { describe, expect, it } from "vitest";
import {
  composeXThreadPublication,
  extractThreadPostIds,
  isStrongRelatedRelation,
  resolveThreadReplyOrder,
  resolveXPublicationStrategy,
} from "../x-thread-publication.js";
import { adaptCanonicalToXSocial } from "../x-social-adaptation.js";
import { planXSocial } from "../social-plan.js";
import { synthesizeXSocialFromPlan } from "../social-write.js";

describe("X publication strategy", () => {
  it("defaults to WP_TRAFFIC_EMBED when affiliate thread mode is OFF", () => {
    const r = resolveXPublicationStrategy({
      affiliateThreadMode: false,
      wpUrl: "https://otonaselect.net/a/",
      fanzaUrl: "https://al.fanza.co.jp/?af_id=x&lurl=y",
      affiliateLinkReady: true,
    });
    expect(r.strategy).toBe("WP_TRAFFIC_EMBED");
    expect(r.fanzaUrl).toBeNull();
    expect(r.reason).toBe("affiliate_thread_mode_off");
  });

  it("selects AFFILIATE_THREAD only when flag ON and both URLs ready", () => {
    const r = resolveXPublicationStrategy({
      affiliateThreadMode: true,
      wpUrl: "https://otonaselect.net/a/",
      fanzaUrl: "https://al.fanza.co.jp/?af_id=x&lurl=y",
      affiliateLinkReady: true,
    });
    expect(r.strategy).toBe("AFFILIATE_THREAD");
    expect(r.fanzaUrl).toContain("al.fanza.co.jp");
  });

  it("falls back to embed when thread mode ON but FANZA missing", () => {
    const r = resolveXPublicationStrategy({
      affiliateThreadMode: true,
      wpUrl: "https://otonaselect.net/a/",
      fanzaUrl: null,
      affiliateLinkReady: false,
    });
    expect(r.strategy).toBe("WP_TRAFFIC_EMBED");
  });
});

describe("composeXThreadPublication", () => {
  const parent =
    "九井スナオの近作では、ROCKET18周年の主観企画が軸になっている。顔面特化の臨場感が特徴として紹介できる。";

  it("CURRENT: parent without URL; WP on reply (no FANZA)", () => {
    const posts = composeXThreadPublication({
      strategy: "WP_TRAFFIC_EMBED",
      parentBody: parent,
      wpUrl: "https://otonaselect.net/guide/",
      fanzaUrl: "https://al.fanza.co.jp/?af_id=x",
      disclosure: "",
      intent: {
        needsArticleReply: true,
        relatedPostUseful: false,
        preferredReplyOrder: "wp_only",
      },
      navSeed: "test-wp",
    });
    expect(posts).toHaveLength(2);
    expect(posts[0]!.threadRole).toBe("PARENT");
    expect(posts[0]!.body).not.toContain("http");
    expect(posts[0]!.body).not.toContain("al.fanza.co.jp");
    expect(posts[1]!.threadRole).toBe("WP_REPLY");
    expect(posts[1]!.body).toContain("otonaselect.net");
    expect(posts[1]!.body).not.toContain("al.fanza.co.jp");
  });

  it("CURRENT: parent + WP + related when strong relation", () => {
    const posts = composeXThreadPublication({
      strategy: "WP_TRAFFIC_EMBED",
      parentBody: parent,
      wpUrl: "https://otonaselect.net/guide/",
      fanzaUrl: null,
      intent: {
        needsArticleReply: true,
        relatedPostUseful: true,
        preferredReplyOrder: "wp_then_related",
      },
      related: {
        postUrl: "https://x.com/demo/status/1234567890",
        publicationId: "pub-1",
        reasons: ["sameActress"],
      },
      navSeed: "test-rel",
    });
    expect(posts.map((p) => p.threadRole)).toEqual([
      "PARENT",
      "WP_REPLY",
      "RELATED_REPLY",
    ]);
    expect(posts[2]!.body).toContain("status/1234567890");
    expect(posts[2]!.relatedPublicationId).toBe("pub-1");
  });

  it("CURRENT: skips weak related (genre-only)", () => {
    expect(isStrongRelatedRelation(["sameGenre"])).toBe(false);
    const posts = composeXThreadPublication({
      strategy: "WP_TRAFFIC_EMBED",
      parentBody: parent,
      wpUrl: "https://otonaselect.net/guide/",
      fanzaUrl: null,
      intent: {
        needsArticleReply: true,
        relatedPostUseful: true,
        preferredReplyOrder: "wp_then_related",
      },
      related: {
        postUrl: "https://x.com/demo/status/999",
        publicationId: "pub-weak",
        reasons: ["sameGenre"],
      },
      navSeed: "test-weak",
    });
    expect(posts.map((p) => p.threadRole)).toEqual(["PARENT", "WP_REPLY"]);
  });

  it("CURRENT: parent_only when intent says so", () => {
    const posts = composeXThreadPublication({
      strategy: "WP_TRAFFIC_EMBED",
      parentBody: parent,
      wpUrl: "https://otonaselect.net/guide/",
      fanzaUrl: null,
      intent: {
        needsArticleReply: false,
        relatedPostUseful: false,
        preferredReplyOrder: "parent_only",
      },
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.linkKind).toBe("none");
  });

  it("resolves reply order from intent + availability", () => {
    expect(
      resolveThreadReplyOrder({
        intent: {
          needsArticleReply: true,
          relatedPostUseful: true,
          preferredReplyOrder: "related_then_wp",
        },
        hasWp: true,
        hasRelated: true,
      }),
    ).toBe("related_then_wp");
  });

  it("AFFILIATE_THREAD: parent without URLs, then FANZA reply, then WP reply", () => {
    const posts = composeXThreadPublication({
      strategy: "AFFILIATE_THREAD",
      parentBody: parent,
      wpUrl: "https://otonaselect.net/guide/",
      fanzaUrl: "https://al.fanza.co.jp/?af_id=demo&lurl=https%3A%2F%2Fwww.dmm.co.jp%2F",
      disclosure: "",
    });
    expect(posts).toHaveLength(3);
    expect(posts.map((p) => p.threadRole)).toEqual([
      "PARENT",
      "AFFILIATE_REPLY",
      "WP_REPLY",
    ]);
    expect(posts[0]!.body).not.toContain("http");
    expect(posts[1]!.body).toMatch(/作品(?:は|リンクは)こちら/);
    expect(posts[1]!.body).toContain("al.fanza.co.jp");
    expect(posts[1]!.replyToSequence).toBe(1);
    expect(posts[2]!.body).toContain("otonaselect.net");
    expect(posts[2]!.replyToSequence).toBe(2);
  });

  it("extractThreadPostIds maps sequences after partial publish", () => {
    const ids = extractThreadPostIds([
      { sequence: 1, role: "ROOT", xPostId: "p1", body: "intro" },
      {
        sequence: 2,
        role: "CTA",
        xPostId: "p2",
        body: "作品はこちら↓\nhttps://al.fanza.co.jp/?af_id=x",
      },
      {
        sequence: 3,
        role: "CTA",
        xPostId: null,
        body: "作品の詳しい紹介はこちら↓\nhttps://otonaselect.net/a/",
      },
    ]);
    expect(ids.PARENT_POST_ID).toBe("p1");
    expect(ids.AFFILIATE_REPLY_POST_ID).toBe("p2");
    expect(ids.WP_REPLY_POST_ID).toBeNull();
  });
});

describe("adaptation wires strategy without Writer inventing nav replies", () => {
  it("CURRENT mode: parent without URL; WP reply; Writer body has no CTA nav", async () => {
    const adapted = await adaptCanonicalToXSocial({
      canonicalTitle: "ROCKET18周年記念 主観ホラー 九井スナオ",
      productTitle: "ROCKET18周年記念ユーザーリクエスト祭り 完全主観ホラー 九井スナオ",
      cid: "1rctd00763",
      performerNames: ["九井スナオ"],
      claimStatements: [
        { statement: "ROCKET18周年記念のユーザーリクエスト企画" },
        { statement: "顔面特化の主観ホラーとして構成されている" },
        { statement: "完全主観視点の臨場感が軸" },
      ],
      publishedBlogUrl: "https://otonaselect.net/guide-1rctd00763/",
      wpStatus: "publish",
      affiliateUrl: "https://al.fanza.co.jp/?af_id=x&lurl=y",
      affiliateLinkReady: true,
      preferredLinkMode: "WP_TRAFFIC",
      preferWpTraffic: true,
      allowDirectAffiliate: false,
      affiliateThreadMode: false,
      disclosure: "",
    });
    expect(adapted.skip).toBeNull();
    expect(adapted.publicationStrategy).toBe("WP_TRAFFIC_EMBED");
    expect(adapted.posts.length).toBeGreaterThanOrEqual(2);
    expect(adapted.posts[0]!.threadRole).toBe("PARENT");
    expect(adapted.posts[0]!.body).not.toContain("http");
    expect(adapted.posts.some((p) => p.threadRole === "WP_REPLY")).toBe(true);
    expect(adapted.posts[0]!.body).not.toMatch(/作品はこちら/);
    expect(adapted.fanzaUrl).toBeNull();
    expect(adapted.parentBody).toBeTruthy();
    expect(adapted.publicationIntent?.needsArticleReply).toBe(true);
  });

  it("AFFILIATE_THREAD dry-run structure for future mode", async () => {
    const adapted = await adaptCanonicalToXSocial({
      canonicalTitle: "ROCKET18周年記念 主観ホラー 九井スナオ",
      productTitle: "ROCKET18周年記念ユーザーリクエスト祭り 完全主観ホラー 九井スナオ",
      cid: "1rctd00763",
      performerNames: ["九井スナオ"],
      claimStatements: [
        { statement: "ROCKET18周年記念のユーザーリクエスト企画" },
        { statement: "顔面特化の主観ホラーとして構成されている" },
        { statement: "完全主観視点の臨場感が軸" },
      ],
      publishedBlogUrl: "https://otonaselect.net/guide-1rctd00763/",
      wpStatus: "publish",
      affiliateUrl: "https://al.fanza.co.jp/?af_id=demo&lurl=https%3A%2F%2Fwww.dmm.co.jp%2F",
      affiliateLinkReady: true,
      preferredLinkMode: "WP_TRAFFIC",
      preferWpTraffic: true,
      affiliateThreadMode: true,
      disclosure: "",
    });
    expect(adapted.publicationStrategy).toBe("AFFILIATE_THREAD");
    expect(adapted.posts.length).toBeGreaterThanOrEqual(3);
    expect(adapted.posts[0]!.body).not.toContain("http");
    expect(adapted.posts[1]!.threadRole).toBe("AFFILIATE_REPLY");
    expect(adapted.posts.some((p) => p.threadRole === "WP_REPLY")).toBe(true);
    expect(adapted.socialPlan).toBeTruthy();
  });
});

describe("parent copy quality (Planner → synthesize)", () => {
  it("produces multi-sentence work intro when claims are rich", () => {
    const plan = planXSocial({
      canonicalTitle: "ROCKET18周年記念ユーザーリクエスト祭り 完全主観ホラー 九井スナオ",
      productTitle: "ROCKET18周年記念ユーザーリクエスト祭り 完全主観ホラー 九井スナオ",
      performerNames: ["九井スナオ"],
      claimStatements: [
        { statement: "ROCKET18周年記念のユーザーリクエスト企画" },
        { statement: "顔面特化の主観ホラーとして構成されている" },
        { statement: "完全主観視点ならではの臨場感" },
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.whatIsInteresting).toBeTruthy();
    expect(plan.plan.publicationIntent).toBeTruthy();
    const written = synthesizeXSocialFromPlan(plan.plan);
    expect(written.sentences.length).toBeGreaterThanOrEqual(2);
    expect(written.body).toContain("九井スナオ");
    expect(written.body).not.toMatch(/作品はこちら|詳しい紹介はこちら|https?:\/\//);
  });
});
