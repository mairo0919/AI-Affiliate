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
    expect(
      planned.plan.allowedClaims
        .filter((fact) => fact !== "九井スナオ")
        .every((fact) => OFFICIAL_TITLE.includes(fact)),
    ).toBe(true);
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

describe("planner viability uses a primary fact, not a spec readout", () => {
  function planTitle(title: string, performers: string[] = [], series: string | null = null) {
    return planXSocial({
      canonicalTitle: title,
      productTitle: title,
      performerNames: performers,
      seriesName: series,
    });
  }

  it("posts a feature or premise and drops an uncertain phrase", () => {
    const horror = planTitle(OFFICIAL_TITLE, ["九井スナオ"]);
    expect(horror.ok).toBe(true);
    if (!horror.ok) return;
    expect(horror.plan.viability).toBe("X_POSTABLE");
    expect(horror.plan.semanticFacts?.map((fact) => fact.value).join("\n")).not.toMatch(/神出鬼没/);
    const horrorBody = composeGroundedIntro(horror.plan) ?? "";
    expect(horrorBody).toBe(
      "九井スナオは、完全主観ホラーのROCKET18周年記念ユーザーリクエスト祭りに出演している。",
    );
    expect(reviewXSocialCopy(horrorBody, horror.plan).ok).toBe(true);

    const scoop = planTitle("SCOOP的モニタリングAV ウブな女子大生が初めての風俗チャレンジ約6.5時間 神回SP");
    expect(scoop.ok).toBe(true);
    if (!scoop.ok) return;
    expect(scoop.plan.viability).toBe("X_POSTABLE");
    expect(scoop.plan.semanticFacts?.some((fact) => fact.salience === "primary" && fact.value.includes("風俗チャレンジ"))).toBe(
      true,
    );
    const scoopBody = composeGroundedIntro(scoop.plan) ?? "";
    expect(scoopBody).toContain("風俗チャレンジ");
    expect(scoopBody).not.toMatch(/神回SP/);
    expect(reviewXSocialCopy(scoopBody, scoop.plan).ok).toBe(true);
    expect(
      reviewXSocialCopy("ウブな女子大生が初めての風俗チャレンジを描くSCOOP的モニタリングAV、約6.5時間。", scoop.plan).ok,
    ).toBe(false);
    expect(
      reviewXSocialCopy("ウブな女子大生が初めての風俗チャレンジを描くSCOOP的モニタリングAVは約6.5時間。", scoop.plan).ok,
    ).toBe(false);

    const audition = planTitle(
      "【早漏素人×最強女優】「早漏改善プロジェクト、ついに本格始動」応募人数206人！撮影期間3ヶ月！オーディションを勝ち抜いた素人男性がガチ参加！早漏を治せたら女優と夢の4Pハーレム大乱交！",
      ["小那海あや"],
      "滝沢ガレソチャンネル",
    );
    expect(audition.ok).toBe(true);
    if (!audition.ok) return;
    expect(audition.plan.viability).toBe("X_POSTABLE");
    const auditionBody = composeGroundedIntro(audition.plan) ?? "";
    expect(auditionBody).toContain("ガチ参加");
    expect(reviewXSocialCopy(auditionBody, audition.plan).ok).toBe(true);
  });

  it("marks runtime, BEST, and an uncertain short phrase as insufficient", () => {
    const best = planTitle("【配信限定】巨尻巨乳の豊満なカラダ 夏川あゆみ ベスト", ["夏川あゆみ"]);
    expect(best.ok).toBe(true);
    if (!best.ok) return;
    expect(best.plan.viability).toBe("X_INSUFFICIENT_MATERIAL");
    expect(best.plan.semanticFacts?.some((fact) => fact.salience === "primary")).toBe(false);
    expect(composeGroundedIntro(best.plan)).toBeNull();

    const hours = planTitle("小那海あや 4時間BEST", ["小那海あや"]);
    expect(hours.ok).toBe(true);
    if (!hours.ok) return;
    expect(hours.plan.viability).toBe("X_INSUFFICIENT_MATERIAL");
    expect(composeGroundedIntro(hours.plan)).toBeNull();
    expect(reviewXSocialCopy("小那海あやの作品は、4時間を収録している。", hours.plan).ok).toBe(false);

    const box = planTitle(
      "御愛顧感謝特別作品！！ シリーズ別人気企画ベストBOX 豪華5枚組100作品収録1200分 選りすぐりの名場面を一挙収録したヌキどころ満載の超充実20時間",
      ["有村のぞみ"],
    );
    expect(box.ok).toBe(true);
    if (!box.ok) return;
    expect(box.plan.viability).toBe("X_INSUFFICIENT_MATERIAL");
    expect(composeGroundedIntro(box.plan)).toBeNull();

    const series = planTitle("田舎のお母さんシリーズ2 8時間");
    expect(series.ok).toBe(true);
    if (!series.ok) return;
    expect(series.plan.viability).toBe("X_INSUFFICIENT_MATERIAL");
    expect(composeGroundedIntro(series.plan)).toBeNull();

    const person = planTitle(
      "配信限定:ナチュポケ ありのまま解禁 REC:堀北桃愛 あの30，000人が応募した日本一可愛い学生 ミスコンファイナリストのハメ撮り",
      ["堀北桃愛"],
    );
    expect(person.ok).toBe(true);
    if (!person.ok) return;
    expect(person.plan.viability).toBe("X_POSTABLE");
    expect(person.plan.semanticRelations?.some((relation) => relation.type === "described_as")).toBe(true);
    const personBody = composeGroundedIntro(person.plan) ?? "";
    expect(personBody).toContain("学生");
    expect(personBody).toContain("ナチュポケ");
    expect(personBody).not.toMatch(/ありのまま|ハメ撮り/);
    expect(reviewXSocialCopy(personBody, person.plan).ok).toBe(true);

    const puff = planTitle("ギュっと！上戸まり2タイトル4時間", ["上戸まり"]);
    expect(puff.ok).toBe(true);
    if (!puff.ok) return;
    expect(puff.plan.semanticFacts?.map((fact) => fact.value).join("\n")).not.toMatch(/魅力/);
    expect(puff.plan.viability).toBe("X_INSUFFICIENT_MATERIAL");
  });

  it("does not invent a relation for a volume label or an uncertain phrase", () => {
    const volume = planTitle("女のアフター5 vol.2", ["糸井瑠花"]);
    expect(volume.ok).toBe(true);
    if (!volume.ok) return;
    expect(volume.plan.viability).toBe("X_INSUFFICIENT_MATERIAL");
    expect(composeGroundedIntro(volume.plan)).toBeNull();
    expect(reviewXSocialCopy("糸井瑠花の女のアフター5は、vol.2な作品として収録されている。", volume.plan).ok).toBe(
      false,
    );

    const paired = planTitle("ROCKET18周年記念ユーザーリクエスト祭り 無個性ゼンタイ人間化", ["一色さら"]);
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;
    expect(paired.plan.viability).toBe("X_POSTABLE");
    const pairedBody = composeGroundedIntro(paired.plan) ?? "";
    expect(pairedBody).toBe(
      "一色さらは、ROCKET18周年記念ユーザーリクエスト祭りの無個性ゼンタイ人間化に出演している。",
    );
    expect(reviewXSocialCopy(pairedBody, paired.plan).ok).toBe(true);

    const vr = planTitle("【VR】響蓮に沼る", ["響蓮"]);
    expect(vr.ok).toBe(true);
    if (!vr.ok) return;
    expect(vr.plan.viability).toBe("X_INSUFFICIENT_MATERIAL");
    expect(vr.plan.semanticFacts?.map((fact) => fact.value).join("\n")).not.toMatch(/沼る/);
    expect(composeGroundedIntro(vr.plan)).toBeNull();
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
