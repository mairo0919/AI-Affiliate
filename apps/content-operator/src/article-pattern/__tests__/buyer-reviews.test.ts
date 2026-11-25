/**
 * 2026-11-26 user decision: buyer reviews on the work page may feed the article, attributed to buyers.
 */
import { describe, expect, it } from "vitest";
import { selectBuyerReviewsForWriter } from "../evidence-pack.js";
import type { ArticlePlan } from "../article-plan.js";
import { validateArticlePlanCompliance } from "../../editorial-brain/generation/article-plan-compliance.js";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";

const plan = {
  schemaVersion: 1 as const,
  materialDepth: "standard" as const,
  productTitle: "juq00821",
  title: { job: "editorial_headline" as const, facts: ["日下部加奈"] },
  lead: { job: "opening_facts" as const, facts: [] },
  body: [{ job: "body_facts" as const, facts: ["高級ソープ店で働く加奈", "青年・杉浦がやって来た"] }],
  buyerReviews: ["「凄く良かった」泡やローションまみれの巨大なオッパイをすりすりさせながらの濃厚なプレイが印象的だった"],
} as ArticlePlan;

const check = (sentence: string) =>
  validateArticlePlanCompliance({
    article: { title: "日下部加奈｜元職場の先輩と再会", summary: "", sections: [{ paragraphs: [`高級ソープ店で働く加奈のもとに、青年・杉浦がやって来た。${sentence}`] }] },
    articlePlan: plan,
  }).findings.filter((f) => f.code === "PLAN_UNSUPPORTED_EVAL" && f.severity === "BLOCKING");

describe("buyer reviews as attributed material", () => {
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

  it("lets a sentence repeat buyers' praise only when it names the reviews", () => {
    expect(check("買った人のレビューでは、泡まみれの濃厚なプレイが印象的だったという。")).toHaveLength(0);
    expect(check("泡まみれの濃厚なプレイが印象的だ。")).not.toHaveLength(0);
  });

  it("shows the reviews to the writer as attributed material", () => {
    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: "juq00821",
      ctaUrl: "",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: { ARTICLE_PLAN: plan },
      articleOutputContract: null,
      buyerReviews: plan.buyerReviews,
    });
    expect(prompt.userPrompt).toContain("BUYER_REVIEWS");
    expect(prompt.userPrompt).toContain("買った人のレビューでは");
    expect(JSON.stringify(prompt.userPrompt.split("BUYER_REVIEWS")[0])).not.toContain("buyerReviews");
  });
});
