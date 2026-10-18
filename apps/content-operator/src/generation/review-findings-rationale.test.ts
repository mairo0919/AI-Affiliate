import { describe, expect, it } from "vitest";
import { reviewFindingsRationale } from "./canonical-article-pipeline.js";

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
});
