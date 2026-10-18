import { describe, expect, it } from "vitest";
import { loadPriorReviewFindings, reviewFindingsRationale } from "./canonical-article-pipeline.js";
import { buildOptionBBloggerGeneratorPrompt } from "../editorial-brain/generation/option-b-blogger-prompt.js";

describe("reviewFindingsRationale", () => {
  it("lists only failed reviews' findings for the revision", () => {
    const text = reviewFindingsRationale([
      { reviewType: "claim-consistency", result: "FAILED", findings: [{ message: "出演者が公式情報にない" }] },
      { reviewType: "seo-basic", result: "PASSED", findings: [{ message: "ok" }] },
      { reviewType: "writing-quality", result: "FAILED", findings: ["見出しが作品名の切り貼り"] },
    ]);
    expect(text).toContain("[claim-consistency] 出演者が公式情報にない");
    expect(text).toContain("[writing-quality] 見出しが作品名の切り貼り");
    expect(text).not.toContain("seo-basic");
  });

  it("loads findings from this work's rejected versions only", async () => {
    const lifecycle = {
      prisma: {
        contentVersion: {
          findMany: async () => [
            { id: "v1", structuredContent: { productCanonicalId: "MIDA00805" } },
            { id: "v2", structuredContent: { productCanonicalId: "other001" } },
          ],
        },
        qualityReviewRecord: {
          findMany: async (args: { where: { contentVersionId: { in: string[] } } }) => {
            expect(args.where.contentVersionId.in).toEqual(["v1"]);
            return [{ reviewType: "factual-consistency", result: "FAILED", findings: [{ message: "収録時間が違う" }] }];
          },
        },
      },
    };
    expect(await loadPriorReviewFindings(lifecycle, "mida00805")).toEqual(["[factual-consistency] 収録時間が違う"]);
  });

  it("shows the writer the official blurb and the earlier findings", () => {
    const { userPrompt } = buildOptionBBloggerGeneratorPrompt({
      productTitle: "作品",
      ctaUrl: "https://example.com",
      articleFormat: "single-product",
      generationAuthority: {},
      officialDescription: "松本いちかのMOODYZベスト第2弾！",
      priorReviewFindings: ["[factual-consistency] 収録時間が違う"],
    });
    expect(userPrompt).toContain("OFFICIAL_DESCRIPTION");
    expect(userPrompt).toContain("MOODYZベスト第2弾");
    expect(userPrompt).toContain("PRIOR_REVIEW_FINDINGS");
    expect(userPrompt).toContain("収録時間が違う");
  });
});
