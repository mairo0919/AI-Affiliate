/**
 * Baseline quality repair unit tests (deterministic).
 */
import { describe, expect, it } from "vitest";
import {
  applyBaselineQualityRepair,
  detectBaselineQualityDefects,
} from "../../editorial-brain/generation/option-b-baseline-repair.js";

describe("option-b-baseline-repair", () => {
  it("flags and drops body paragraphs that restate lead", () => {
    const article = {
      title: "北野未奈",
      summary: "黒パンストの作品です。",
      lead: "黒パンストの作品です。",
      sections: [
        {
          heading: null,
          paragraphs: ["黒パンストの作品です。", "玄関での壁ドンキスから始まる。"],
        },
      ],
    };
    const findings = detectBaselineQualityDefects({
      article,
      planFacts: ["北野未奈", "黒パンスト", "玄関での壁ドンキス"],
    });
    expect(findings.some((f) => f.code === "REPETITION")).toBe(true);
    const repaired = applyBaselineQualityRepair({
      article,
      planFacts: ["北野未奈", "黒パンスト", "玄関での壁ドンキス"],
    });
    expect(repaired.repaired).toBe(true);
    expect(repaired.article.sections[0]!.paragraphs.join("")).toMatch(/壁ドン/);
    expect(repaired.article.sections[0]!.paragraphs.join("")).not.toBe("黒パンストの作品です。");
  });

  it("drops catalog confirmation prose", () => {
    const article = {
      title: "テスト",
      summary: "紹介",
      lead: "紹介",
      sections: [
        {
          heading: null,
          paragraphs: ["出演者として 北野未奈 が公式ページで確認できる。", "玄関での壁ドンキス。"],
        },
      ],
    };
    const repaired = applyBaselineQualityRepair({
      article,
      planFacts: ["北野未奈", "玄関での壁ドンキス"],
    });
    expect(repaired.codes).toContain("CATALOG_CONFIRMATION");
    expect(repaired.article.sections.flatMap((s) => s.paragraphs).join("")).not.toMatch(
      /公式ページ/,
    );
  });
});
