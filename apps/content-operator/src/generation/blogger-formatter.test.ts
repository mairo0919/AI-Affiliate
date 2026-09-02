import { describe, expect, it } from "vitest";
import {
  BLOG_CTA_CLASS,
  BLOG_HERO_CLASS,
  BLOG_SAMPLE_CLASS,
  BLOG_SAMPLE_IMG_STYLE,
  collectBodyParagraphs,
  formatBloggerHtml,
} from "./blogger-formatter.js";
import type { ArticleImage } from "./article-images.js";

const hero: ArticleImage = {
  role: "hero",
  sourceUrl: "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/halt00091/halt00091pl.jpg",
  imageType: "main_large",
  alt: "北野未奈出演作品",
  researchImageId: "h1",
  usageStatus: "REQUIRES_CONFIRMATION",
  provenance: "research_image",
  displayMode: "url_reference",
};

const sample = (n: number): ArticleImage => ({
  role: "auxiliary",
  sourceUrl: `https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/halt00091/halt00091jp-${n}.jpg`,
  imageType: "sample_large",
  alt: "北野未奈出演作品",
  researchImageId: `s${n}`,
  usageStatus: "REQUIRES_CONFIRMATION",
  provenance: "research_image",
  displayMode: "url_reference",
});

describe("formatBloggerHtml R62 layout", () => {
  it("orders hero → body → mid CTA → samples → bottom CTA (leadless)", () => {
    const html = formatBloggerHtml({
      title: "t",
      sections: [
        { heading: "見出しA", paragraphs: ["本文1"], lists: ["リスト1"] },
        { heading: "見出しB", paragraphs: ["本文2"], lists: ["リスト2"] },
      ],
      cta: { label: "作品詳細を見る", url: "https://example.invalid/p" },
      images: [hero, sample(1)],
    });

    const heroIdx = html.indexOf("halt00091pl.jpg");
    const body1Idx = html.indexOf("本文1");
    const body2Idx = html.indexOf("本文2");
    const firstCtaIdx = html.indexOf("作品詳細を見る");
    const sampleIdx = html.indexOf("halt00091jp-1.jpg");
    const lastCtaIdx = html.lastIndexOf("作品詳細を見る");

    expect(heroIdx).toBeGreaterThan(-1);
    expect(body1Idx).toBeGreaterThan(heroIdx);
    expect(body2Idx).toBeGreaterThan(body1Idx);
    expect(firstCtaIdx).toBeGreaterThan(body2Idx);
    expect(sampleIdx).toBeGreaterThan(firstCtaIdx);
    expect(lastCtaIdx).toBeGreaterThan(sampleIdx);
    expect(html.match(/作品詳細を見る/g)?.length).toBe(2);
    expect(html).not.toContain("<h2>");
    expect(html).toContain(`class="${BLOG_HERO_CLASS}"`);
    expect(html).toContain(`class="${BLOG_SAMPLE_CLASS}"`);
    expect(html).toContain(`class="${BLOG_CTA_CLASS}"`);
    expect(html.match(new RegExp(`class="${BLOG_CTA_CLASS}"`, "g"))?.length).toBe(2);
    expect(html.indexOf(BLOG_HERO_CLASS)).toBeLessThan(html.indexOf(BLOG_CTA_CLASS));
    expect(html.indexOf(`class="${BLOG_SAMPLE_CLASS}"`)).toBeGreaterThan(firstCtaIdx);
    expect(html.lastIndexOf(BLOG_CTA_CLASS)).toBeGreaterThan(sampleIdx);
  });

  it("legacy: still emits lead paragraph when present", () => {
    const html = formatBloggerHtml({
      title: "t",
      lead: "リード文",
      sections: [{ paragraphs: ["本文1"] }],
      cta: { label: "cta", url: "https://example.invalid/p" },
      images: [hero],
    });
    const heroIdx = html.indexOf("halt00091pl.jpg");
    const leadIdx = html.indexOf("リード文");
    const bodyIdx = html.indexOf("本文1");
    expect(leadIdx).toBeGreaterThan(heroIdx);
    expect(bodyIdx).toBeGreaterThan(leadIdx);
  });

  it("renders sample images at half width without ungrounded figcaptions", () => {
    const html = formatBloggerHtml({
      title: "t",
      sections: [{ paragraphs: ["body"], lists: ["給湯室での摩擦音尻コキ"] }],
      cta: { label: "cta", url: "https://example.invalid/p" },
      images: [hero, sample(1)],
    });

    expect(html).toContain(BLOG_SAMPLE_IMG_STYLE);
    expect(html).not.toContain("<figcaption");
    expect(html).not.toContain("給湯室での摩擦音尻コキ");
    expect(html).toContain('alt="北野未奈出演作品"');
    expect(html.indexOf(BLOG_SAMPLE_IMG_STYLE)).toBeGreaterThan(html.indexOf("halt00091pl.jpg"));
  });

  it("collectBodyParagraphs skips headings and merges sections", () => {
    expect(
      collectBodyParagraphs([
        { paragraphs: ["a"] },
        { paragraphs: ["", "b"] },
      ]),
    ).toEqual(["a", "b"]);
  });
});
