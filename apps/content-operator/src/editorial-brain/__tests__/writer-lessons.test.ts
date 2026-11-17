import { describe, expect, it } from "vitest";
import {
  avoidWordsFromFindings,
  recordWriterLesson,
  summarizeWriterLessons,
  WRITER_LESSON_KIND,
} from "../core/writer-lessons.js";
import { buildXSocialWriterPrompts } from "../../x/social-write.js";
import type { XSocialPlan } from "../../x/social-plan.js";

const at = (day: number) => new Date(Date.UTC(2026, 10, day));
const lesson = (avoid: string[], advice: string | null = null) => ({ kind: WRITER_LESSON_KIND, avoid, advice, codes: [] });

describe("writer lessons", () => {
  it("keeps people's advice and lists a word once a person removed it or two rejected drafts used it", () => {
    const lines = summarizeWriterLessons([
      { sourceType: "HUMAN_FEEDBACK", lesson: lesson(["記録されています"], "締めは人物の次の行動か問いで終える"), createdAt: at(15) },
      { sourceType: "SYSTEM_VALIDATOR", lesson: lesson(["ベッド"]), createdAt: at(16) },
      { sourceType: "SYSTEM_VALIDATOR", lesson: lesson(["ベッド", "ヤバい"]), createdAt: at(17) },
      { sourceType: "SYSTEM_VALIDATOR", lesson: { kind: "OTHER", avoid: ["無関係"] }, createdAt: at(17) },
    ]);
    expect(lines[0]).toBe("締めは人物の次の行動か問いで終える");
    expect(lines[1]).toContain("記録されています");
    expect(lines[1]).toContain("ベッド");
    expect(lines[1]).not.toContain("ヤバい");
    expect(lines.join("")).not.toContain("無関係");
  });

  it("takes the named word out of review findings and skips empty lessons", async () => {
    expect(
      avoidWordsFromFindings([
        { message: "ungrounded word: シャワー" },
        { message: "ai phrase: 没入感" },
        { message: "opening matches a recent post" },
      ]),
    ).toEqual(["シャワー", "没入感"]);
    const created: unknown[] = [];
    const db = {
      editorialExperience: {
        create: async (args: { data: Record<string, unknown> }) => created.push(args.data),
        findMany: async () => [],
      },
    };
    await recordWriterLesson(db, { channel: "X", sourceType: "SYSTEM_VALIDATOR", outcome: "SOCIAL_REVIEW_FAILED", avoid: [] });
    expect(created).toHaveLength(0);
    await recordWriterLesson(db, { channel: "X", sourceType: "SYSTEM_VALIDATOR", outcome: "SOCIAL_REVIEW_FAILED", avoid: ["シャワー"] });
    expect(created).toHaveLength(1);
  });

  it("shows the advice to the X writer", () => {
    const plan = {
      subject: "九井スナオ",
      contentType: "作品紹介",
      whatIsInteresting: "完全主観ホラー",
      angle: "完全主観ホラー",
      readerHook: "完全主観ホラー",
      whyThisWork: "完全主観ホラー",
      supportingClaims: [],
      workUnderstanding: [],
      corePremise: null,
      primaryAppeal: null,
      secondaryAppeal: null,
      concreteDetails: [],
      allowedClaims: ["完全主観ホラー"],
      publicationIntent: { needsArticleReply: false, relatedPostUseful: false, preferredReplyOrder: null },
      productTitle: "九井スナオ 完全主観ホラー",
      writerAdvice: ["次の語は使わない（過去の不合格や手直しで外したもの）: ベッド"],
      canonicalContext: { performers: ["九井スナオ"], seriesName: null, claimCount: 1, droppedAdultCount: 0 },
    } as XSocialPlan;
    expect(buildXSocialWriterPrompts(plan).userPrompt).toContain("BRAIN_ADVICE");
    expect(buildXSocialWriterPrompts({ ...plan, writerAdvice: [] }).userPrompt).not.toContain("BRAIN_ADVICE");
  });
});
