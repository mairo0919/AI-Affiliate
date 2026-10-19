import { describe, expect, it } from "vitest";
import { WordPressApiPublisher } from "../adapters/publisher/wordpress-api-publisher.js";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import { insertWorkTitleBlock } from "./backfill-work-title.js";

const CTA_URL = "https://al.fanza.co.jp/?lurl=https%3A%2F%2Fvideo.dmm.co.jp%2Fav%2Fcontent%2F%3Fid%3Dymbp00001&af_id=a-990&ch=api";
const article = {
  title: "見出し",
  sections: [{ paragraphs: ["本文です。"] }],
  cta: { label: "詳細を確認", url: CTA_URL },
};

describe("insertWorkTitleBlock", () => {
  it("gives an old post the same block a new post gets, linked to the CTA's page", () => {
    const old = formatBloggerHtml(article);
    const result = insertWorkTitleBlock(old, "借金漬けヤンママAV返済 須藤かおる");
    expect(result.changed).toBe(true);
    if (!result.changed) return;
    expect(result.url).toBe(CTA_URL);
    expect(result.html).toBe(formatBloggerHtml({ ...article, workTitle: "借金漬けヤンママAV返済 須藤かおる" }));
  });

  it("does nothing twice, and leaves a post without the standard CTA alone", () => {
    const fresh = formatBloggerHtml({ ...article, workTitle: "作品" });
    expect(insertWorkTitleBlock(fresh, "作品")).toEqual({ changed: false, reason: "ALREADY_PRESENT" });
    expect(insertWorkTitleBlock("<p>本文</p>", "作品")).toEqual({ changed: false, reason: "NO_CTA" });
  });
});

describe("WordPress content-only edits", () => {
  function publisher(calls: Array<{ url: string; init: RequestInit }>, reply: unknown) {
    return new WordPressApiPublisher({
      mode: "api",
      allowExternal: true,
      allowDirectPublish: false,
      defaultPublishMode: "draft",
      baseUrl: "https://wp.example",
      username: "u",
      applicationPassword: "p",
      apiNamespace: "wp/v2",
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(reply), { status: 200 });
      }) as unknown as typeof fetch,
    });
  }

  it("reads the stored body and writes back only the body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    expect(await publisher(calls, { content: { raw: "<p>x</p>" } }).getRawContent("43")).toBe("<p>x</p>");
    await publisher(calls, { id: 43 }).updateContentOnly({ externalId: "43", content: "<p>y</p>" });
    expect(calls[0]!.url).toContain("/posts/43?context=edit");
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[1]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ content: "<p>y</p>" });
  });
});
