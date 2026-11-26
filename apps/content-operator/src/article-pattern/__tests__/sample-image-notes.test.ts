import { describe, expect, it } from "vitest";
import { parseSampleImageNotes, pickSampleImageUrls } from "../sample-image-notes.js";
import type { ArticlePlan } from "../article-plan.js";
import { validateArticlePlanCompliance } from "../../editorial-brain/generation/article-plan-compliance.js";

describe("sample image notes", () => {
  it("takes one large still per scene, spread across the set", () => {
    const images = Array.from({ length: 20 }, (_, i) => [
      { family: "sample", contentKey: `s${i}`, imageType: "sample_small", sourceUrl: `https://x/${i}.jpg` },
      { family: "sample", contentKey: `s${i}`, imageType: "sample_large", sourceUrl: `https://x/jp-${i}.jpg` },
    ]).flat();
    const urls = pickSampleImageUrls([{ family: "package", sourceUrl: "https://x/pl.jpg" }, ...images]);
    expect(urls).toHaveLength(8);
    expect(urls[0]).toBe("https://x/jp-0.jpg");
    expect(urls.at(-1)).toBe("https://x/jp-17.jpg");
    expect(urls.every((u) => u.includes("jp-"))).toBe(true);
  });

  it("keeps short string notes only", () => {
    expect(parseSampleImageNotes({ notes: ["濡れた白いTシャツ", 3, "", "x".repeat(200)] })).toEqual(["濡れた白いTシャツ"]);
    expect(parseSampleImageNotes(null)).toEqual([]);
  });

  it("lets a sentence use an image detail only when it names the sample images", () => {
    const plan = {
      schemaVersion: 1 as const,
      materialDepth: "standard" as const,
      productTitle: "sivr00493",
      title: { job: "editorial_headline" as const, facts: ["夢乃あいか"] },
      lead: { job: "opening_facts" as const, facts: [] },
      body: [{ job: "body_facts" as const, facts: ["銭湯の看板巨乳お姉ちゃん", "番台にいたあいかお姉ちゃん"] }],
      imageNotes: ["浴槽の中で女性が男性の上にまたがり、上目遣いで印象的な表情を見せている"],
    } as ArticlePlan;
    const blocking = (sentence: string) =>
      validateArticlePlanCompliance({
        article: { title: "夢乃あいか｜銭湯の看板お姉ちゃん", summary: "", sections: [{ paragraphs: [`番台にいたあいかお姉ちゃんは銭湯の看板巨乳お姉ちゃんだ。${sentence}`] }] },
        articlePlan: plan,
      }).findings.filter((f) => f.severity === "BLOCKING");
    expect(blocking("サンプル画像では、浴槽の中で上目遣いの印象的な表情を見せている。")).toHaveLength(0);
    expect(blocking("浴槽の中で上目遣いの印象的な表情を見せている。")).not.toHaveLength(0);
  });
});
