import { describe, expect, it } from "vitest";
import {
  buildBodyProgressionPlan,
  compactCollectionScopeFacts,
  detectThemeSourceResolution,
  expandThemeEnumerationFacts,
} from "../body-progression.js";

describe("body progression (plan-time)", () => {
  it("expands theme enumeration compounds into membership labels", () => {
    const facts = expandThemeEnumerationFacts([
      "奥田咲",
      "人妻・NTR・痴女・追撃ピストンなどを収録",
      "8時間",
    ]);
    expect(facts).toContain("人妻");
    expect(facts).toContain("NTR");
    expect(facts).toContain("痴女");
    expect(facts).toContain("追撃ピストン");
    expect(facts.some((f) => f.includes("などを収録"))).toBe(false);
  });

  it("compacts redundant collection-scope restatements", () => {
    const facts = compactCollectionScopeFacts([
      "最新12タイトルの全コーナーを収録",
      "今回は彼女の最新12タイトル",
      "最新12タイトル全コーナー入りベスト",
      "55コーナー",
      "8時間",
      "人妻",
    ]);
    const titleish = facts.filter((f) => /12タイトル|全コーナー/.test(f));
    expect(titleish.length).toBeLessThanOrEqual(1);
    expect(facts).toContain("人妻");
    expect(facts).toContain("8時間");
  });

  it("detects theme_labels_only when SOURCE has no scene verbs", () => {
    expect(
      detectThemeSourceResolution(["人妻", "NTR", "痴女", "追撃ピストン", "8時間"]),
    ).toBe("theme_labels_only");
    const plan = buildBodyProgressionPlan({
      bodyFacts: [
        "ベスト第6弾",
        "8時間",
        "55コーナー",
        "人妻",
        "NTR",
        "痴女",
        "追撃ピストン",
        "低身長なのにグラマラスボディ",
      ],
      materialDepth: "rich",
    });
    expect(plan.themeSourceResolution).toBe("theme_labels_only");
    expect(plan.sourceResolution).toBe("THEME_LEVEL_EVIDENCE");
    expect(plan.axes.map((a) => a.role)).toEqual(["open", "develop", "close"]);
    expect(plan.writerNote).toMatch(/sourceResolution=THEME_LEVEL_EVIDENCE/);
    expect(plan.axes.find((a) => a.role === "close")?.guidance).toMatch(
      /Stopping after develop is OK|Do not force wrap-up/,
    );
  });
});
