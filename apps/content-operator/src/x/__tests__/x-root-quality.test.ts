import { describe, expect, it } from "vitest";
import { planXSocial } from "../social-plan.js";
import { reviewXSocialCopy } from "../social-review.js";
import { composeGroundedIntro } from "../social-write.js";
import type { XSocialPlan } from "../social-plan.js";
import { resolveCanonicalArticleImages } from "../canonical-x-source.js";
import { selectXMediaFromArticleImages } from "../x-article-media.js";

const OFFICIAL_TITLE =
  "ROCKET18周年記念ユーザーリクエスト祭り 完全主観ホラー＆下品エロ 神出鬼没！僕の精液を狙う恐怖のド変態女";

const PUBLISHED_BAD_ROOT =
  "九井スナオ出演作では、「僕のを狙う恐怖のド変態女」という状況設定が特徴です。ROCKET18周年記念ユーザーリクエスト祭り完全主観ホラー＆下品エロ神出鬼没として制作されています。";

function planFixture(partial: Partial<XSocialPlan> & Pick<XSocialPlan, "subject" | "allowedClaims">): XSocialPlan {
  return {
    contentType: "作品紹介",
    whatIsInteresting: partial.allowedClaims[0] ?? "焦点",
    corePremise: partial.allowedClaims[0] ?? null,
    primaryAppeal: partial.allowedClaims[1] ?? null,
    secondaryAppeal: null,
    concreteDetails: [],
    angle: partial.subject ? `${partial.subject}の作品` : "作品",
    readerHook: partial.allowedClaims[0] ?? "焦点",
    whyThisWork: "公式情報から確認できる",
    supportingClaims: partial.allowedClaims,
    workUnderstanding: partial.allowedClaims,
    publicationIntent: {
      needsArticleReply: true,
      relatedPostUseful: false,
      preferredReplyOrder: "wp_only",
    },
    productTitle: partial.subject ? `${partial.subject}の作品` : "作品",
    canonicalContext: {
      performers: partial.subject ? [partial.subject] : [],
      seriesName: null,
      claimCount: partial.allowedClaims.length,
      droppedAdultCount: 0,
    },
    ...partial,
  };
}

describe("1rctd00763 planner does not keep broken title debris", () => {
  it("drops the particle hole and the glued title, and keeps one official facet", () => {
    const planned = planXSocial({
      canonicalTitle: OFFICIAL_TITLE,
      productTitle: OFFICIAL_TITLE,
      performerNames: ["九井スナオ"],
      claimStatements: [],
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const blob = [
      planned.plan.corePremise,
      planned.plan.primaryAppeal,
      planned.plan.angle,
      planned.plan.whatIsInteresting,
      ...planned.plan.allowedClaims,
      ...planned.plan.workUnderstanding,
    ].join("\n");
    expect(blob).not.toContain("僕のを");
    expect(blob).not.toContain("精液");
    expect(blob).not.toContain("＆");
    expect(blob).not.toContain("下品エロ");
    expect(blob).not.toMatch(/状況設定|として制作されて|出演作では/);
    expect(blob).not.toContain("ROCKET18周年記念ユーザーリクエスト祭り完全主観ホラー");
    expect(planned.plan.subject).toBe("九井スナオ");
    expect(planned.plan.allowedClaims.every((fact) => OFFICIAL_TITLE.includes(fact))).toBe(true);
    expect(planned.plan.allowedClaims.join("\n")).toMatch(/完全主観/);
    expect(planned.plan.allowedClaims.join("\n")).toMatch(/ROCKET18周年/);
    expect((planned.plan.semanticFacts ?? []).every((fact) => fact.provenance.evidence.length > 0)).toBe(
      true,
    );
  });
});

describe("review blocks the published 1rctd00763 root", () => {
  it("fails broken phrase, title glue, and explainer template", () => {
    const plan = planFixture({
      subject: "九井スナオ",
      allowedClaims: ["僕のを狙う恐怖のド変態女", "完全主観ホラー"],
      corePremise: "僕のを狙う恐怖のド変態女",
    });
    const review = reviewXSocialCopy(PUBLISHED_BAD_ROOT, plan);
    expect(review.ok).toBe(false);
    const codes = review.findings.map((f) => f.code);
    expect(codes).toContain("BROKEN_PHRASE");
    expect(codes).toContain("TEMPLATE_EXPLAINER");
    expect(codes).toContain("TITLE_FRAGMENT_GLUE");
  });

  it("fails mechanical frames even when a word is inserted", () => {
    const plan = planFixture({
      subject: "九井スナオ",
      allowedClaims: ["完全主観ホラー"],
      productTitle: OFFICIAL_TITLE,
    });
    for (const body of [
      "九井スナオの作品は完全主観ホラーで展開されます。",
      "九井スナオが出演するシリーズ作品では、完全主観ホラーが紹介されています。",
      "完全主観ホラーで、たっぷりとした収録ボリュームが特徴の作品です。",
    ]) {
      const review = reviewXSocialCopy(body, plan);
      expect(review.ok).toBe(false);
      expect(review.findings.some((f) => f.code === "TEMPLATE_EXPLAINER" || f.code === "GENERIC_PUFFERY")).toBe(
        true,
      );
    }
  });

  it("still blocks generic puffery", () => {
    const plan = planFixture({
      subject: "九井スナオ",
      allowedClaims: ["完全主観ホラー"],
      productTitle: OFFICIAL_TITLE,
    });
    for (const body of [
      "九井スナオの作品は完全主観ホラーで、緊迫感が際立っています。",
      "九井スナオの作品は完全主観ホラーで、独特の世界観が展開されます。",
      "九井スナオの作品は完全主観ホラーで、独特の没入感が味わえます。",
      "九井スナオの完全主観ホラーはファン必見です。",
      "九井スナオの作品は完全主観ホラーで、魅力を存分に楽しめます。",
      "九井スナオの完全主観ホラーが話題になっています。",
    ]) {
      const review = reviewXSocialCopy(body, plan);
      expect(review.ok).toBe(false);
      expect(review.findings.map((finding) => finding.code)).toContain("GENERIC_PUFFERY");
    }
  });

  it("rejects fame puffery and a sentence that only repeats the fact", () => {
    const plan = planFixture({
      subject: "九井スナオ",
      allowedClaims: ["完全主観ホラー"],
    });
    const fame = reviewXSocialCopy("九井スナオの作品は完全主観ホラーで知られています。", plan);
    expect(fame.ok).toBe(false);
    expect(fame.findings.map((f) => f.code)).toContain("GENERIC_PUFFERY");
    const echo = reviewXSocialCopy(
      "九井スナオの作品は完全主観ホラーです。完全主観ホラーです。",
      plan,
    );
    expect(echo.ok).toBe(false);
    expect(echo.findings.map((f) => f.code)).toContain("TEMPLATE_EXPLAINER");
  });

  it("fails a one-fact copula and a role mismatch, and passes a two-fact sentence", () => {
    const plan = planFixture({
      subject: "九井スナオ",
      allowedClaims: ["完全主観ホラー", "ROCKET18周年記念ユーザーリクエスト祭り"],
      productTitle: OFFICIAL_TITLE,
    });
    const copula = reviewXSocialCopy("九井スナオの作品は、完全主観ホラーだ。", plan);
    expect(copula.ok).toBe(false);
    expect(copula.findings.map((f) => f.code)).toContain("TEMPLATE_EXPLAINER");
    const student = reviewXSocialCopy(
      "堀北桃愛のシリーズ作品は、あの30，000人が応募した日本一可愛い学生だ。",
      plan,
    );
    expect(student.ok).toBe(false);
    expect(student.findings.map((f) => f.code)).toContain("TEMPLATE_EXPLAINER");
    const participant = reviewXSocialCopy(
      "小那海あやのシリーズ作品は、オーディションを勝ち抜いた素人男性がガチ参加だ。",
      plan,
    );
    expect(participant.ok).toBe(false);
    const titled = reviewXSocialCopy(
      "ウブな女子大生が初めての風俗チャレンジ約6.5時間は、6.5時間の収録ボリュームだ。",
      planFixture({
        subject: null,
        allowedClaims: ["6.5時間", "SCOOP的モニタリングAV"],
        productTitle: "SCOOP的モニタリングAV ウブな女子大生が初めての風俗チャレンジ約6.5時間 神回SP",
      }),
    );
    expect(titled.ok).toBe(false);
    const natural = reviewXSocialCopy(
      "九井スナオのROCKET18周年記念ユーザーリクエスト祭りは、完全主観ホラーの作品として収録されている。",
      plan,
    );
    expect(natural.ok).toBe(true);
    const exists = reviewXSocialCopy("SCOOP的モニタリングAVは、神回SPで、6.5時間がある。", plan);
    expect(exists.ok).toBe(false);
    expect(exists.findings.map((f) => f.code)).toContain("TEMPLATE_EXPLAINER");
  });
});

describe("semantic facts keep a role and compose a clause", () => {
  const samples = [
    {
      title: OFFICIAL_TITLE,
      performers: ["九井スナオ"],
      series: null,
      includes: ["九井スナオ", "完全主観ホラー", "神出鬼没", "ROCKET18周年"],
    },
    {
      title: "SCOOP的モニタリングAV ウブな女子大生が初めての風俗チャレンジ約6.5時間 神回SP",
      performers: [],
      series: null,
      includes: ["SCOOP的モニタリングAV", "6.5時間", "風俗チャレンジ"],
    },
    {
      title: "【配信限定】巨尻巨乳の豊満なカラダ 夏川あゆみ ベスト",
      performers: ["夏川あゆみ"],
      series: null,
      includes: ["夏川あゆみ", "配信限定", "ベスト"],
    },
    {
      title:
        "【早漏素人×最強女優】「早漏改善プロジェクト、ついに本格始動」応募人数206人！撮影期間3ヶ月！オーディションを勝ち抜いた素人男性がガチ参加！早漏を治せたら女優と夢の4Pハーレム大乱交！",
      performers: ["小那海あや"],
      series: "滝沢ガレソチャンネル",
      includes: ["小那海あや", "206人", "3ヶ月", "ガチ参加"],
    },
    {
      title:
        "配信限定:ナチュポケ ありのまま解禁 REC:堀北桃愛 あの30，000人が応募した日本一可愛い学生 ミスコンファイナリストのハメ撮り",
      performers: ["堀北桃愛"],
      series: null,
      includes: ["堀北桃愛", "ナチュポケ", "学生", "出演"],
    },
    {
      title:
        "御愛顧感謝特別作品！！ シリーズ別人気企画ベストBOX 豪華5枚組100作品収録1200分 選りすぐりの名場面を一挙収録したヌキどころ満載の超充実20時間",
      performers: ["有村のぞみ"],
      series: null,
      includes: ["有村のぞみ", "5枚組", "100作品", "20時間"],
    },
  ];

  it("passes review without a one-fact copula", () => {
    for (const sample of samples) {
      const planned = planXSocial({
        canonicalTitle: sample.title,
        productTitle: sample.title,
        performerNames: sample.performers,
        seriesName: sample.series,
      });
      expect(planned.ok, sample.title).toBe(true);
      if (!planned.ok) continue;
      const body = composeGroundedIntro(planned.plan);
      const review = reviewXSocialCopy(body ?? "", planned.plan);
      expect(review.findings.map((finding) => `${finding.code}:${finding.message}`), `${sample.title}\n${body}`).toEqual([]);
      expect(body, sample.title).toBeTruthy();
      for (const piece of sample.includes) expect(body, sample.title).toContain(piece);
      expect(body).not.toMatch(/がある|の(?:シリーズ)?作品は、|するがある/);
      expect(planned.plan.semanticFacts?.every((fact) => fact.provenance.evidence.length > 0)).toBe(true);
    }
  });

  it("keeps title facts and does not adopt a puffery claim or a false subject", () => {
    const best = planXSocial({
      canonicalTitle: "小那海あや 4時間BEST",
      productTitle: "小那海あや 4時間BEST",
      performerNames: ["小那海あや"],
    });
    expect(best.ok).toBe(true);
    if (!best.ok) return;
    const bestBody = composeGroundedIntro(best.plan);
    expect(bestBody).toContain("小那海あや");
    expect(bestBody).toContain("4時間");
    expect(bestBody).not.toMatch(/^\d/u);
    expect(reviewXSocialCopy(bestBody ?? "", best.plan).ok).toBe(true);

    const series = planXSocial({
      canonicalTitle: "田舎のお母さんシリーズ2 8時間",
      productTitle: "田舎のお母さんシリーズ2 8時間",
      performerNames: [],
    });
    expect(series.ok).toBe(true);
    if (!series.ok) return;
    expect(series.plan.subject).toBeNull();
    const seriesBody = composeGroundedIntro(series.plan);
    expect(seriesBody).toBe("田舎のお母さんシリーズ2は、8時間を収録している。");
    expect(reviewXSocialCopy(seriesBody ?? "", series.plan).ok).toBe(true);

    const puff = planXSocial({
      canonicalTitle: "ギュっと！上戸まり2タイトル4時間",
      productTitle: "ギュっと！上戸まり2タイトル4時間",
      performerNames: ["上戸まり"],
      claimStatements: [{ statement: "上戸まりの魅力を存分に味わえる240分" }],
    });
    expect(puff.ok).toBe(true);
    if (!puff.ok) return;
    expect(puff.plan.semanticFacts?.map((fact) => fact.value).join("\n")).not.toMatch(/魅力|味わえ/);
    const puffBody = composeGroundedIntro(puff.plan);
    expect(puffBody).toContain("2タイトル");
    expect(puffBody).toContain("4時間");
    expect(puffBody).not.toMatch(/魅力/);
    expect(reviewXSocialCopy(puffBody ?? "", puff.plan).ok).toBe(true);
  });

  it("does not attach な to a second title or a volume number", () => {
    const volume = planXSocial({
      canonicalTitle: "女のアフター5 vol.2",
      productTitle: "女のアフター5 vol.2",
      performerNames: ["糸井瑠花"],
    });
    expect(volume.ok).toBe(true);
    if (!volume.ok) return;
    const volumeBody = composeGroundedIntro(volume.plan) ?? "";
    expect(volumeBody).toBe("糸井瑠花は、女のアフター5のvol.2に出演している。");
    const volumeReview = reviewXSocialCopy(volumeBody, volume.plan);
    expect(volumeReview.findings.map((finding) => finding.code)).toEqual([]);
    expect(reviewXSocialCopy("糸井瑠花の女のアフター5は、vol.2な作品として収録されている。", volume.plan).ok).toBe(
      false,
    );

    const paired = planXSocial({
      canonicalTitle: "ROCKET18周年記念ユーザーリクエスト祭り 無個性ゼンタイ人間化",
      productTitle: "ROCKET18周年記念ユーザーリクエスト祭り 無個性ゼンタイ人間化",
      performerNames: ["一色さら"],
    });
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;
    const pairedBody = composeGroundedIntro(paired.plan) ?? "";
    expect(pairedBody).toBe(
      "一色さらは、ROCKET18周年記念ユーザーリクエスト祭りの無個性ゼンタイ人間化に出演している。",
    );
    expect(pairedBody).not.toMatch(/な作品/);
    expect(reviewXSocialCopy(pairedBody, paired.plan).ok).toBe(true);

    const vr = planXSocial({
      canonicalTitle: "【VR】響蓮に沼る",
      productTitle: "【VR】響蓮に沼る",
      performerNames: ["響蓮"],
    });
    expect(vr.ok).toBe(true);
    if (!vr.ok) return;
    const vrBody = composeGroundedIntro(vr.plan) ?? "";
    expect(vrBody).toBe("響蓮は、VRの響蓮に沼るとして収録されている。");
    expect(vrBody).not.toMatch(/な作品/);
    expect(reviewXSocialCopy(vrBody, vr.plan).findings.map((finding) => finding.code)).toEqual([]);
  });
});

describe("X article images fall back to ALLOWED research images", () => {
  it("selects a sample for ROOT when structuredContent.images is empty", () => {
    const images = resolveCanonicalArticleImages({
      structuredImages: null,
      altBase: "作品",
      researchImages: [
        {
          id: "img-package",
          imageType: "main_large",
          sourceUrl: "https://pics.dmm.co.jp/digital/video/1rctd00763/1rctd00763pl.jpg",
          usageStatus: "ALLOWED",
        },
        {
          id: "img-sample",
          imageType: "sample_large",
          sourceUrl: "https://pics.dmm.co.jp/digital/video/1rctd00763/1rctd00763jp-1.jpg",
          usageStatus: "ALLOWED",
        },
        {
          id: "img-blocked",
          imageType: "sample_large",
          sourceUrl: "https://pics.dmm.co.jp/digital/video/1rctd00763/1rctd00763jp-2.jpg",
          usageStatus: "NOT_ALLOWED",
        },
      ],
    });
    const pick = selectXMediaFromArticleImages({ articleImages: images });
    expect(pick.decision).toBe("SAFE_IMAGE");
    expect(pick.selectedUrl).toBe(
      "https://pics.dmm.co.jp/digital/video/1rctd00763/1rctd00763jp-1.jpg",
    );
    expect(images.some((img) => img.sourceUrl.includes("jp-2"))).toBe(false);
  });

  it("keeps structuredContent.images when they already exist", () => {
    const images = resolveCanonicalArticleImages({
      structuredImages: [
        {
          role: "auxiliary",
          sourceUrl: "https://pics.dmm.co.jp/digital/video/example/examplejp-1.jpg",
          imageType: "sample_large",
          alt: "商品画像",
          researchImageId: "kept",
          usageStatus: "ALLOWED",
          provenance: "research_image",
          displayMode: "url_reference",
        },
      ],
      researchImages: [
        {
          id: "other",
          imageType: "sample_large",
          sourceUrl: "https://pics.dmm.co.jp/digital/video/other/otherjp-1.jpg",
          usageStatus: "ALLOWED",
        },
      ],
    });
    expect(images.map((img) => img.sourceUrl)).toEqual([
      "https://pics.dmm.co.jp/digital/video/example/examplejp-1.jpg",
    ]);
  });
});
