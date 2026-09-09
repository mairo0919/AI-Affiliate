import { describe, expect, it } from "vitest";
import {
  deriveArticleExperienceContext,
  formatWritingQualityGuidanceForWriter,
  observeWritingQualityExecution,
  parseSuccessLesson,
  POST20_MIXED_LESSONS,
  R77_SUCCESS_LESSONS,
  summarizeWritingQualityGuidance,
  type ExperienceRow,
} from "../generation/success-experience.js";
import { experienceMustNotMutateLearningRules } from "../core/retrieval.js";

function fakeExp(
  lesson: unknown,
  opts?: { id?: string; outcome?: string; sourceType?: string; confidence?: number },
): ExperienceRow {
  return {
    id: opts?.id ?? "exp1",
    outcome: opts?.outcome ?? "QUALITY_SUCCESS",
    sourceType: opts?.sourceType ?? "HUMAN_FEEDBACK",
    confidence: opts?.confidence ?? 0.9,
    lesson: lesson as object,
    failureCodes: [],
  };
}

describe("success experience lessons", () => {
  it("R77 and post20 lessons are abstract WHY patterns (no article prose templates)", () => {
    for (const lesson of [...R77_SUCCESS_LESSONS, ...POST20_MIXED_LESSONS]) {
      expect(lesson.positivePattern.length).toBeGreaterThan(40);
      expect(lesson.positivePattern).not.toMatch(/本作は奥田咲/);
      expect(lesson.humanValidated).toBe(true);
      expect(parseSuccessLesson(lesson)?.experienceKey).toBe(lesson.experienceKey);
    }
  });

  it("applies multi-theme / quantity context and skips mismatched lessons", () => {
    const ctx = deriveArticleExperienceContext({
      planFacts: ["奥田咲", "人妻", "NTR", "痴女", "追撃ピストン", "55コーナー", "8時間", "ベスト第6弾"],
      materialDepth: "rich",
    });
    expect(ctx.hasMultiThemeEvidence).toBe(true);
    expect(ctx.hasQuantityEvidence).toBe(true);
    expect(ctx.hasBestCompilationShape).toBe(true);

    const guidance = summarizeWritingQualityGuidance({
      experiences: [
        fakeExp(R77_SUCCESS_LESSONS[0], { id: "s1" }),
        fakeExp(POST20_MIXED_LESSONS[1], {
          id: "i1",
          outcome: "QUALITY_IMPROVEMENT",
        }),
        fakeExp(
          {
            ...R77_SUCCESS_LESSONS[0],
            signalType: "AUTOMATED_PASS",
            experienceKey: "auto.pass",
          },
          { id: "auto", outcome: "SUCCESS", sourceType: "SYSTEM_VALIDATOR" },
        ),
      ],
      context: ctx,
    });
    expect(guidance.appliedExperienceIds).toContain("s1");
    expect(guidance.appliedExperienceIds).toContain("i1");
    expect(guidance.skipped.some((s) => s.experienceId === "auto")).toBe(true);
    const text = formatWritingQualityGuidanceForWriter(guidance);
    expect(text).toMatch(/SUCCESS:/);
    expect(text).toMatch(/IMPROVE:/);
    expect(text).toMatch(/checklist|naturally/i);
    expect(text).not.toMatch(/本作は奥田咲/);
  });

  it("observes INJECTED vs EXECUTED separately", () => {
    const ctx = deriveArticleExperienceContext({
      planFacts: ["人妻", "NTR", "痴女", "追撃ピストン", "55コーナー", "8時間"],
      materialDepth: "rich",
    });
    const guidance = summarizeWritingQualityGuidance({
      experiences: [
        fakeExp(R77_SUCCESS_LESSONS[0], { id: "s1" }),
        fakeExp(POST20_MIXED_LESSONS[1], {
          id: "i1",
          outcome: "QUALITY_IMPROVEMENT",
        }),
      ],
      context: ctx,
    });
    const bad = observeWritingQualityExecution({
      guidance,
      bodyText:
        "本作は最新12タイトルの全コーナーです。\n人妻、NTR、痴女、追撃ピストンなど様々な方向性のエロティシズムです。\n最新12タイトルの全コーナーを網羅したベストです。",
      themeSourceResolution: "theme_labels_only",
    });
    expect(bad.every((o) => o.injected === true)).toBe(true);
    expect(bad.some((o) => o.status === "PARTIALLY_EXECUTED" || o.status === "NOT_EXECUTED")).toBe(
      true,
    );

    const better = observeWritingQualityExecution({
      guidance,
      bodyText:
        "本作は最新12タイトル全コーナー入りのベストで8時間55コーナーの構成です。\n人妻の関係性、NTRの寝取られ方向、痴女の攻めスタンス、追撃ピストンの行為スタイルが並び、同じエロさ一色ではありません。\nファンはもちろん、まとめて見たい人にも適したボリュームです。",
      themeSourceResolution: "theme_labels_only",
    });
    expect(better.some((o) => o.status === "EXECUTED")).toBe(true);
  });

  it("does not mutate LearningRules", () => {
    expect(experienceMustNotMutateLearningRules()).toEqual({
      autoPromote: false,
      writesLearningRule: false,
    });
  });
});
