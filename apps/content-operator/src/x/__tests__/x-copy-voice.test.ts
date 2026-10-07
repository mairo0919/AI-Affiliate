import { describe, expect, it } from "vitest";
import { reviewXSocialCopy } from "../social-review.js";
import { buildXSocialWriterPrompts, X_SOCIAL_WRITER_PROMPT_VERSION } from "../social-write.js";
import type { XSocialPlan } from "../social-plan.js";
import {
  chooseXCopyArchetype,
  copiesOfficialDescription,
  X_COPY_ARCHETYPES,
  type XCopyArchetype,
} from "../x-copy-voice.js";
import { classifyXCopyOutcome, maxNewXCopyCandidatesForRefill } from "../x-copy-artifact.js";
import { resolveNormalXProductUrl } from "../x-normal-destination.js";

function planFor(performer: string, fact: string): XSocialPlan {
  return {
    subject: performer,
    contentType: "作品紹介",
    whatIsInteresting: fact,
    angle: fact,
    readerHook: fact,
    whyThisWork: fact,
    supportingClaims: [fact],
    workUnderstanding: [fact],
    corePremise: fact,
    primaryAppeal: null,
    secondaryAppeal: null,
    concreteDetails: [],
    allowedClaims: [performer, fact],
    publicationIntent: {
      needsArticleReply: false,
      relatedPostUseful: false,
      preferredReplyOrder: null,
    },
    productTitle: `${performer} ${fact}`,
    canonicalContext: {
      performers: [performer],
      seriesName: null,
      claimCount: 1,
      droppedAdultCount: 0,
    },
  };
}

const WORKS: Array<{ performer: string; fact: string; archetype: XCopyArchetype; body: string }> = [
  { performer: "九井スナオ", fact: "完全主観ホラー", archetype: "SHORT_REACTION", body: "九井スナオのやつ、普通によかった。" },
  { performer: "糸井瑠花", fact: "女のアフター5", archetype: "FOUND_IT", body: "糸井瑠花の新しいの出てる。あとで見ようと思って一応保存。" },
  { performer: "小那海あや", fact: "オーディション", archetype: "ONE_LINER", body: "小那海あやの新作これか。" },
  { performer: "一色さら", fact: "無個性ゼンタイ人間化", archetype: "PERSONAL_PREFERENCE", body: "一色さらのこういう設定、個人的には結構好き。" },
  { performer: "夏川あゆみ", fact: "ベスト", archetype: "LOW_EXPECTATION", body: "夏川あゆみ、タイトルだけ見た時はそこまでだったけど少し気になった。" },
  { performer: "堀北桃愛", fact: "学生", archetype: "CASUAL_REVIEW", body: "堀北桃愛のやつ昨日見た。個人的にはこの人の方がよかった。" },
  { performer: "有村のぞみ", fact: "総集編", archetype: "QUESTION", body: "有村のぞみって最近こういうの多いな。" },
  { performer: "藤森里穂", fact: "メンズエステ", archetype: "PERFORMER_COMMENT", body: "藤森里穂の新しいやつ出てた。この人はこういう方が個人的には好き。" },
  { performer: "広瀬美結", fact: "ゼンタイ", archetype: "SHORT_REACTION", body: "広瀬美結、なんか普通に見てしまった。" },
  { performer: "加藤ツバキ", fact: "人間化", archetype: "FOUND_IT", body: "加藤ツバキのやつ出てた。とりあえず保存だけした。" },
  { performer: "逢沢みゆ", fact: "タクシー", archetype: "ONE_LINER", body: "逢沢みゆのこれ、こういうのでいいんだよ。" },
  { performer: "響蓮", fact: "8K", archetype: "QUESTION", body: "響蓮のシリーズ、前にも似たのなかったっけ。" },
  { performer: "八木奈々", fact: "メンズエステ", archetype: "PERSONAL_PREFERENCE", body: "八木奈々のメンズエステ系、自分はこういうのが好きかも。" },
  { performer: "天川そら", fact: "VR", archetype: "LOW_EXPECTATION", body: "天川そらのVR、最初はそこまでだった。内容見たらちょっと気になった。" },
  { performer: "希月あまね", fact: "デビュー", archetype: "CASUAL_REVIEW", body: "希月あまねのやつ見た。笑ったけど普通によかった。" },
  { performer: "青空ひかり", fact: "飲み会", archetype: "PERFORMER_COMMENT", body: "青空ひかりの新しいの。自分はこの人の方が好き。" },
  { performer: "美園和花", fact: "同棲", archetype: "SHORT_REACTION", body: "美園和花の同棲のやつ、なんかよかった。" },
  { performer: "森日向子", fact: "新作", archetype: "FOUND_IT", body: "森日向子の新しいの出てる。あとで見る。" },
  { performer: "石川澪", fact: "先輩", archetype: "ONE_LINER", body: "石川澪の新作、これでいい。" },
  { performer: "河北彩花", fact: "組み合わせ", archetype: "QUESTION", body: "河北彩花のこの組み合わせ、久しぶりに見た気がする。" },
];

describe("personal X copy voice", () => {
  it("accepts 20 short personal samples and rejects promo paste", () => {
    expect(WORKS).toHaveLength(20);
    const openings = WORKS.map((work) => work.body.slice(0, 6));
    expect(new Set(openings).size).toBeGreaterThanOrEqual(12);
    expect(WORKS.some((work) => work.body.length <= 20)).toBe(true);
    expect(WORKS.every((work) => !/\p{Extended_Pictographic}/u.test(work.body))).toBe(true);
    expect(WORKS.every((work) => !/詳細はこちら|今すぐチェック|必見|刺さる|沼る/u.test(work.body))).toBe(true);

    for (const work of WORKS) {
      const plan = planFor(work.performer, work.fact);
      const review = reviewXSocialCopy(work.body, plan, {
        officialDescription: `${work.fact}を公式の説明文として長く切り出した文章です。ここを貼らない。`,
      });
      expect(review.ok, `${work.body} ${review.findings.map((f) => `${f.code}:${f.message}`).join(",")}`).toBe(true);
    }

    const pasted = reviewXSocialCopy(
      "九井スナオは、完全主観ホラーの長い公式説明をそのまま貼った文章です。",
      planFor("九井スナオ", "完全主観ホラー"),
      { officialDescription: "完全主観ホラーの長い公式説明をそのまま貼った文章です。追加の説明。" },
    );
    expect(pasted.findings.map((f) => f.code)).toContain("OFFICIAL_DESCRIPTION_COPY");

    const ai = reviewXSocialCopy("九井スナオのやつ、刺さる。必見。", planFor("九井スナオ", "完全主観ホラー"));
    expect(ai.findings.map((f) => f.code)).toContain("AI_PHRASE_DETECTED");

    const ad = reviewXSocialCopy("九井スナオ、気になる人はこちら。今すぐチェック。", planFor("九井スナオ", "完全主観ホラー"));
    expect(ad.findings.map((f) => f.code)).toContain("AD_COPY_DETECTED");

    const emoji = reviewXSocialCopy("九井スナオの新しいやつ出てた🔥👀🔞", planFor("九井スナオ", "完全主観ホラー"));
    expect(emoji.findings.map((f) => f.code)).toContain("EMOJI_OVERUSE");

    const hash = reviewXSocialCopy("九井スナオの新しいやつ出てた #おすすめ", planFor("九井スナオ", "完全主観ホラー"));
    expect(hash.findings.map((f) => f.code)).toContain("HASHTAG");

    const recent = reviewXSocialCopy("九井スナオのやつ、普通によかった。", planFor("九井スナオ", "完全主観ホラー"), {
      recentBodies: ["九井スナオのやつ、別の日も見た。"],
    });
    expect(recent.findings.map((f) => f.code)).toContain("TOO_SIMILAR_TO_RECENT_POST");
  });

  it("rotates archetypes without another model call and keeps the existing cost gates", () => {
    const recent = X_COPY_ARCHETYPES.slice(0, X_COPY_ARCHETYPES.length - 1);
    expect(chooseXCopyArchetype("same-seed", recent)).toBe("QUESTION");
    const prompts = buildXSocialWriterPrompts(planFor("九井スナオ", "完全主観ホラー"));
    expect(X_COPY_ARCHETYPES.some((name) => prompts.userPrompt.includes(name))).toBe(true);
    expect(prompts.systemInstruction).toContain("個人Xアカウント");
    expect(prompts.systemInstruction).not.toContain("http");
    expect(X_SOCIAL_WRITER_PROMPT_VERSION).toBe("v3");
    expect(maxNewXCopyCandidatesForRefill(0)).toBe(0);
    expect(classifyXCopyOutcome({ passesGate: false, failureClass: "QUALITY_FAILURE" })).toBe(
      "REJECTED_QUALITY",
    );
    expect(
      copiesOfficialDescription(
        "完全主観ホラーの長い公式説明をそのまま貼った",
        "完全主観ホラーの長い公式説明をそのまま貼った文章",
        ["九井スナオ"],
      ),
    ).toBe(true);
  });

  it("keeps the official normal product URL helper off affiliate hosts", () => {
    const url = resolveNormalXProductUrl({
      canonicalCid: "dvaj00760",
      officialContentId: "dvaj00760",
      officialProductUrl: "https://video.dmm.co.jp/av/content/?id=dvaj00760",
    });
    expect(url.ok).toBe(true);
    if (!url.ok) return;
    expect(url.url).toContain("dmm.co.jp");
    expect(url.url).not.toMatch(/affiliate|af_id|otonaselect/i);
  });
});
