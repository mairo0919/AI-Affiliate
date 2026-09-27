import { describe, expect, it } from "vitest";
import { publicationUnitDisclosureMissing } from "../ops/pre-publish-guard.js";
import { composeXThreadPublication } from "../x-thread-publication.js";

describe("publication unit disclosure", () => {
  it("does not require disclosure on the parent when the WP reply carries it", () => {
    expect(
      publicationUnitDisclosureMissing({
        disclosure: "#PR",
        bodies: [
          "篠田ゆうが出演する作品で、どのシーンを見ても確実にヌケる。",
          "記事はこちら\nhttps://otonaselect.net/example/ #PR",
        ],
      }),
    ).toBe(false);
  });

  it("blocks when the whole unit has no disclosure", () => {
    expect(
      publicationUnitDisclosureMissing({
        disclosure: "#PR",
        bodies: [
          "河北彩花が出演する作品です。 https://otonaselect.net/example/",
        ],
      }),
    ).toBe(true);
  });

  it("accepts disclosure on a later reply and ignores parent-only absence", () => {
    expect(
      publicationUnitDisclosureMissing({
        disclosure: "#PR",
        bodies: ["親投稿にはURLも#PRも置かない。", "紹介記事はこちら\nhttps://otonaselect.net/a/ #PR"],
      }),
    ).toBe(false);
  });

  it("places #PR on the WP reply and keeps FANZA and the parent URL off", () => {
    const posts = composeXThreadPublication({
      strategy: "WP_TRAFFIC_EMBED",
      parentBody: "紹介本文です。 https://otonaselect.net/work/",
      wpUrl: "https://otonaselect.net/work/",
      fanzaUrl: "https://al.fanza.co.jp/x",
      disclosure: "#PR",
      intent: {
        needsArticleReply: true,
        relatedPostUseful: false,
        preferredReplyOrder: "wp_only",
      },
      navSeed: "unit",
    });
    expect(posts[0]?.threadRole).toBe("PARENT");
    expect(posts[0]?.body).not.toContain("http");
    expect(posts[0]?.body).not.toContain("#PR");
    const wp = posts.find((p) => p.threadRole === "WP_REPLY");
    expect(wp?.body).toContain("otonaselect.net/work/");
    expect(wp?.body).toContain("#PR");
    expect(posts.some((p) => /al\.fanza\.co\.jp/i.test(p.body))).toBe(false);
    expect(
      publicationUnitDisclosureMissing({
        disclosure: "#PR",
        bodies: posts.map((p) => p.body),
      }),
    ).toBe(false);
  });
});
