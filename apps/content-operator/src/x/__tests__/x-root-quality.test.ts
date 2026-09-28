import { describe, expect, it } from "vitest";
import { planXSocial } from "../social-plan.js";
import { reviewXSocialCopy } from "../social-review.js";
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
    expect(blob).toMatch(/完全主観/);
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

  it("passes a grammatical one-hook sentence", () => {
    const plan = planFixture({
      subject: "九井スナオ",
      allowedClaims: ["完全主観ホラー"],
    });
    const review = reviewXSocialCopy(
      "九井スナオの作品は、完全主観ホラーだ。",
      plan,
    );
    expect(review.ok).toBe(true);
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
