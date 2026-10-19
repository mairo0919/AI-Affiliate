import { describe, expect, it } from "vitest";
import { WordPressApiPublisher } from "../adapters/publisher/wordpress-api-publisher.js";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import { bodyInventory, inventoryLosses, liveCtaUrl } from "./rebuild-published-posts.js";

const CTA_URL = "https://al.fanza.co.jp/?lurl=https%3A%2F%2Fvideo.dmm.co.jp%2Fav%2Fcontent%2F%3Fid%3Dymbp00001&af_id=a-990&ch=api";
const article = {
  title: "見出し",
  sections: [{ paragraphs: ["本文です。".repeat(20)] }],
  cta: { label: "詳細を確認", url: CTA_URL },
  images: [
    { role: "hero" as const, sourceUrl: "https://pics.dmm.co.jp/a.jpg", alt: "a" },
    { role: "auxiliary" as const, sourceUrl: "https://pics.dmm.co.jp/b.jpg", alt: "b" },
  ],
};

describe("rebuild inventory", () => {
  it("counts what a reader sees, and reads the live CTA link back", () => {
    const html = formatBloggerHtml({ ...article, workTitle: "作品" } as never);
    expect(bodyInventory(html)).toMatchObject({ images: 2, ctas: 2, workTitle: 1, notes: 3 });
    expect(liveCtaUrl(html)).toBe(CTA_URL);
  });

  it("refuses a rebuild that shows fewer images, buttons, notes, or most of the text", () => {
    const before = bodyInventory(formatBloggerHtml(article as never));
    const fewerImages = bodyInventory(formatBloggerHtml({ ...article, images: [article.images[0]] } as never));
    const shorter = bodyInventory(formatBloggerHtml({ ...article, sections: [{ paragraphs: ["短い。"] }] } as never));
    expect(inventoryLosses(before, fewerImages)).toEqual(["images 2->1"]);
    expect(inventoryLosses(before, shorter)[0]).toMatch(/^text /);
    const withTitle = bodyInventory(formatBloggerHtml({ ...article, workTitle: "作品" } as never));
    expect(inventoryLosses(before, withTitle)).toEqual([]);
  });
});

describe("WordPress body and title edits", () => {
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

  it("reads the stored body and writes back only the body and title", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    expect(await publisher(calls, { content: { raw: "<p>x</p>" } }).getRawContent("43")).toBe("<p>x</p>");
    await publisher(calls, { id: 43 }).updateBodyAndTitle({ externalId: "43", content: "<p>y</p>" });
    await publisher(calls, { id: 43 }).updateBodyAndTitle({ externalId: "43", content: "<p>y</p>", title: "新しい見出し" });
    expect(calls[0]!.url).toContain("/posts/43?context=edit");
    expect(calls[0]!.init.method).toBe("GET");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ content: "<p>y</p>" });
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({ content: "<p>y</p>", title: "新しい見出し" });
  });
});
