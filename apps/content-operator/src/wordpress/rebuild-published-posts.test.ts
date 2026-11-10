import { describe, expect, it } from "vitest";
import { WordPressApiPublisher } from "../adapters/publisher/wordpress-api-publisher.js";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import {
  articleProse,
  bodyInventory,
  inventoryLosses,
  isUnrenderedMarkdownBody,
  liveCtaUrl,
  restyleLiveBody,
} from "./rebuild-published-posts.js";

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
    expect(bodyInventory(html)).toMatchObject({ images: 2, links: 1, workTitle: 1, notes: 3 });
    expect(liveCtaUrl(html)).toBe(CTA_URL);
  });

  it("refuses a rebuild that shows fewer images or notes, no link to the work, or most of the text", () => {
    const before = bodyInventory(formatBloggerHtml(article as never));
    const fewerImages = bodyInventory(formatBloggerHtml({ ...article, images: [article.images[0]] } as never));
    const shorter = bodyInventory(formatBloggerHtml({ ...article, sections: [{ paragraphs: ["短い。"] }] } as never));
    expect(inventoryLosses(before, fewerImages)).toEqual(["images 2->1"]);
    expect(inventoryLosses(before, shorter)[0]).toMatch(/^text /);
    const withTitle = bodyInventory(formatBloggerHtml({ ...article, workTitle: "作品" } as never));
    expect(inventoryLosses(before, withTitle)).toEqual([]);
    const noLink = bodyInventory(formatBloggerHtml({ ...article, cta: { label: "詳細を確認", url: null } } as never));
    expect(inventoryLosses(before, noLink)).toEqual(["links 1->0"]);
  });
});

describe("keeping live text", () => {
  // Post 63 (midv00100): its live text and CTA markup predate the stored article.
  const live = [
    "<p>公開中の本文です。</p>",
    '<p class="blog-cta"><a href="https://video.dmm.co.jp/av/content/?id=midv00100">詳細を確認</a></p>',
    "<p>二段落目。</p>",
    '<p class="blog-cta"><a href="https://video.dmm.co.jp/av/content/?id=midv00100">詳細を確認</a></p>',
  ].join("\n");

  it("keeps every paragraph and puts the linked work title where the CTA buttons were", () => {
    const html = restyleLiveBody(live, "神業ハンドテク", CTA_URL)!;
    expect(articleProse(html)).toBe(articleProse(live));
    const fresh = formatBloggerHtml({ ...article, images: [], workTitle: "神業ハンドテク" } as never);
    const freshTitle = fresh.match(/<p class="blog-work-title">[\s\S]*?<\/p>/)![0];
    expect(html.match(/<p class="blog-work-title">[\s\S]*?<\/p>/g)).toEqual([freshTitle]);
    expect(html).not.toContain("blog-cta");
    expect(html.indexOf("blog-work-title")).toBeGreaterThan(html.indexOf("公開中の本文です。"));
    expect(html.indexOf("blog-work-title")).toBeLessThan(html.indexOf("二段落目。"));
  });

  it("is idempotent, and leaves a post without a link to the work alone", () => {
    const once = restyleLiveBody(live, "作品", CTA_URL)!;
    expect(restyleLiveBody(once, "作品", CTA_URL)).toBe(once);
    expect(restyleLiveBody("<p>本文</p>", "作品", CTA_URL)).toBeNull();
  });
});

describe("unrendered markdown posts", () => {
  it("recognizes a body published as markdown, and not a normal post", () => {
    // Post 214 (2026-10): image syntax and the CTA line were shown to readers as text.
    const broken = "<p>![作品（パッケージ）](https://awsimgsrc.dmm.co.jp/a.jpg)</p>\n<p>詳細を確認: https://al.fanza.co.jp/?x</p>";
    expect(isUnrenderedMarkdownBody(broken)).toBe(true);
    expect(isUnrenderedMarkdownBody("![作品](https://awsimgsrc.dmm.co.jp/a.jpg)\n\n本文\n\n詳細を確認: https://al.fanza.co.jp/?x")).toBe(true);
    expect(isUnrenderedMarkdownBody(formatBloggerHtml(article as never))).toBe(false);
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
