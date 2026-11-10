import { describe, expect, it } from "vitest";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import { auxiliaryFindingRationale } from "../generation/canonical-article-pipeline.js";
import { evaluateStockArticleQualityGate } from "./stock-quality-gate.js";

// Published 2026-10 (ymbp00001): the headline was the official title with the performer in front.
const OFFICIAL = "借金漬けヤンママAV返済 須藤かおる";
const raw = { title: OFFICIAL, iteminfo: { actress: [{ name: "須藤かおる" }] } };
const body = {
  bodyHtml:
    "<p>結婚前に背負った借金を夫と返している人妻が、夫に内緒で高額バイトに応募する設定の作品です。</p>".repeat(10),
};

function gate(writerTitle: string) {
  return evaluateStockArticleQualityGate({
    productTitle: OFFICIAL,
    rawData: raw,
    writerTitle,
    structuredContent: body,
  });
}

describe("WP headline does not reuse the official title", () => {
  it("rejects a headline that is the official title", () => {
    const result = gate("須藤かおる 借金漬けヤンママAV返済");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/^TITLE_COPIES_OFFICIAL:run=\d+/);
  });

  it("accepts performer names and short shared words", () => {
    expect(gate("須藤かおる、借金を抱えたヤンママが夫に内緒で高額バイトへ")).toEqual({ ok: true });
  });

  it("asks the revision to rewrite only the title, and says the article prints the official title", () => {
    const text = auxiliaryFindingRationale("TITLE_COPIES_OFFICIAL:run=11");
    expect(text).toContain("TITLE_COPIES_OFFICIAL:run=11");
    expect(text).toContain("Rewrite only the title");
    expect(text).toContain("prints the official work title");
  });

  it("names the low-value headline defect, so the revision does not fall back to the official title", () => {
    // 2026-10 rewrite: told only "LOW_VALUE_ARTICLE_HEADLINE", the revision pasted the official title.
    const reason = gate("黒島玲衣が魅せる清楚な隣人の意外な一面");
    expect(reason).toEqual({ ok: false, reason: "LOW_VALUE_ARTICLE_HEADLINE:MECHANICAL_TEMPLATE" });
    const text = auxiliaryFindingRationale("LOW_VALUE_ARTICLE_HEADLINE:MECHANICAL_TEMPLATE");
    expect(text).toContain("〜が魅せる");
    expect(text).toContain("Do not fall back to the official work title");
  });
});

describe("WP article prints the official work title", () => {
  const base = {
    title: "見出し",
    sections: [{ paragraphs: ["本文です。"] }],
    cta: { label: "詳細を確認", url: "https://al.fanza.co.jp/?lurl=x&af_id=y" },
  };

  it("links the official title to the work page in place of the CTA buttons", () => {
    const html = formatBloggerHtml({ ...base, workTitle: "借金漬けヤンママ<AV>返済" });
    const titleAt = html.indexOf('class="blog-work-title"');
    expect(titleAt).toBeGreaterThan(html.indexOf("本文です。"));
    expect(html).toContain(
      '作品名：<a href="https://al.fanza.co.jp/?lurl=x&amp;af_id=y" data-otonaselect-cta="1" data-cta="work_title"',
    );
    expect(html).toContain("借金漬けヤンママ&lt;AV&gt;返済</a>");
    expect(html).not.toContain('class="blog-cta"');
  });

  it("keeps one CTA button when the official title is unknown", () => {
    expect(formatBloggerHtml(base)).not.toContain("blog-work-title");
    expect(formatBloggerHtml(base).match(/class="blog-cta"/g)).toHaveLength(1);
  });
});
