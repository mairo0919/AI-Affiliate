/**
 * 2026-11-29 user decision: buyer reviews feed the story again, as plain narration without naming them.
 */
import { describe, expect, it } from "vitest";
import { selectBuyerReviewsForWriter } from "../evidence-pack.js";
import type { ArticlePlan } from "../article-plan.js";
import { validateArticlePlanCompliance } from "../../editorial-brain/generation/article-plan-compliance.js";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";
import { OPTION_B_WRITER_SYSTEM } from "../natural-product-intro-policy.js";

const plan = {
  schemaVersion: 1 as const,
  materialDepth: "standard" as const,
  productTitle: "juq00502",
  title: { job: "editorial_headline" as const, facts: ["森日向子"] },
  lead: { job: "opening_facts" as const, facts: [] },
  body: [{ job: "body_facts" as const, facts: ["夫は兄に日向子を托す", "1度だけと頼んだはずが2人は何度も身体を重ねる"] }],
  buyerReviews: ["「最高峰」義兄への嫌悪感から愛情に変わる。風呂での追い種付け、後半の本番前に結婚指輪を外す"],
} as ArticlePlan;

const blocking = (sentence: string) =>
  validateArticlePlanCompliance({
    article: { title: "森日向子｜危険日の托卵", summary: "", sections: [{ paragraphs: [`夫は兄に日向子を托す。${sentence}`] }] },
    articlePlan: plan,
  }).findings.filter((f) => f.severity === "BLOCKING" && !f.code.startsWith("PLAN_TITLE"));

describe("buyer reviews as story material", () => {
  it("keeps the most helpful non-negative reviews, trimmed", () => {
    const picked = selectBuyerReviewsForWriter([
      { title: "残念", comment: "暗い", rating: 1, helpfulCount: 50 },
      { title: "最高", comment: "濃厚なキス", rating: 5, helpfulCount: 3 },
      { title: null, comment: "あ".repeat(400), rating: null, helpfulCount: 9 },
    ]);
    expect(picked).toHaveLength(2);
    expect(picked[0]!.length).toBeLessThanOrEqual(281);
    expect(picked[1]).toBe("「最高」濃厚なキス");
  });

  it("lets a sentence tell what reviews say happens, without naming them", () => {
    expect(blocking("最後の交わりの前、日向子は結婚指輪を外す。").map((f) => [f.code, f.message])).toEqual([]);
  });

  it("shows the reviews to the writer as unattributed material and asks for the story to go on", () => {
    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: "juq00502",
      ctaUrl: "",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: { ARTICLE_PLAN: plan },
      articleOutputContract: null,
      buyerReviews: plan.buyerReviews,
    });
    expect(prompt.userPrompt).toContain("BUYER_REVIEWS");
    expect(prompt.userPrompt).toContain("Never mention reviews");
    expect(OPTION_B_WRITER_SYSTEM).not.toContain("one clause at most");
    expect(OPTION_B_WRITER_SYSTEM).toContain("Follow what happens in order");
  });
});
