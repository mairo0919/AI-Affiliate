import { describe, expect, it } from "vitest";
import { publicationUnitDisclosureMissing } from "../ops/pre-publish-guard.js";
import { composeXThreadPublication } from "../x-thread-publication.js";

describe("publication unit disclosure", () => {
  it("passes when plain-text PR is present and the #PR hashtag is absent", () => {
    expect(
      publicationUnitDisclosureMissing({
        disclosure: "#PR",
        bodies: [
          "篠田ゆうが出演する作品で、どのシーンを見ても確実にヌケる。",
          "PR\n記事はこちら\nhttps://otonaselect.net/example/",
        ],
      }),
    ).toBe(false);
  });

  it("CASE F: disclosure guard still blocks a unit with no ad disclosure", () => {
    expect(
      publicationUnitDisclosureMissing({
        disclosure: "PR",
        bodies: [
          "河北彩花が出演する作品です。 https://otonaselect.net/example/",
        ],
      }),
    ).toBe(true);
  });

  it("accepts disclosure on a later reply and ignores parent-only absence", () => {
    expect(
      publicationUnitDisclosureMissing({
        disclosure: "PR",
        bodies: ["親投稿にはURLもPR表記も置かない。", "PR\n紹介記事はこちら\nhttps://otonaselect.net/a/"],
      }),
    ).toBe(false);
  });

  it("places plain-text PR on the WP reply and keeps FANZA and the parent URL off", () => {
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
    expect(posts[0]?.body).not.toMatch(/(?:^|[\s\n])PR(?=$|[\s\n])/);
    const wp = posts.find((p) => p.threadRole === "WP_REPLY");
    expect(wp?.body.startsWith("PR\n")).toBe(true);
    expect(wp?.body).toContain("otonaselect.net/work/");
    expect(wp?.body).not.toContain("#PR");
    expect(posts.some((p) => /al\.fanza\.co\.jp/i.test(p.body))).toBe(false);
    expect(
      publicationUnitDisclosureMissing({
        disclosure: "PR",
        bodies: posts.map((p) => p.body),
      }),
    ).toBe(false);
  });
});
