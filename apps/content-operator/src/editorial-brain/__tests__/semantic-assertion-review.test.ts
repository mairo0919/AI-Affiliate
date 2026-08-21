/**
 * General semantic grounding fixtures — product-agnostic.
 * Covers Claim entailment / inference / information gain (not phrase bans).
 */
import { describe, expect, it } from "vitest";
import { buildCoreEditorialPlan } from "../core/planner.js";
import { EDITORIAL_FAILURE_CODES } from "../core/failure-taxonomy.js";
import { reviewArtifactShadow } from "../shadow/reviewer.js";
import type { ReviewableBlogArtifact, ReviewableXArtifact } from "../shadow/reviewer.js";

function blogPlan(
  claims: Array<{ id: string; statement: string; kind: string }>,
  opts?: { opening?: string[]; development?: string[] },
) {
  const opening = opts?.opening ?? [claims[0]!.id];
  const development = opts?.development ?? claims.slice(1).map((c) => c.id);
  return buildCoreEditorialPlan({
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    availableClaims: claims,
    selectedClaims: claims,
    openingClaimIds: opening,
    hookClaimIds: opening,
    developmentClaimIds: development,
    structurePatternId: null,
    editorialPatternId: null,
  });
}

function blogArtifact(partial: {
  title?: string;
  summary?: string;
  lead: string;
  paragraphs: string[];
}): ReviewableBlogArtifact {
  return {
    channel: "BLOG",
    title: partial.title ?? "公開事実の整理",
    summary: partial.summary ?? "候補判断向けの短いメモ。",
    lead: partial.lead,
    sections: [{ paragraphs: partial.paragraphs, lists: [] }],
    bodyText: "",
  };
}

describe("semantic assertion / claim entailment (general fixtures)", () => {
  it("taxonomy includes general inference codes only", () => {
    expect(EDITORIAL_FAILURE_CODES).toEqual(
      expect.arrayContaining([
        "NAME_DERIVED_INFERENCE",
        "EVALUATIVE_INFERENCE",
        "INTERPRETIVE_INFERENCE",
        "UNSUPPORTED_INFERENCE",
      ]),
    );
    expect(EDITORIAL_FAILURE_CODES.join(",")).not.toMatch(/mina|v7|pool|福原/i);
  });

  it("1. direct paraphrase → PASS", () => {
    const claims = [
      { id: "t1", statement: "超敏感の反応が連続する展開と潮吹きが公開されている。", kind: "trait_or_scene" },
      { id: "t2", statement: "ベロキスを含む展開が公開されている。", kind: "trait_or_scene" },
      { id: "p1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims),
      claimStatements: claims,
      artifact: blogArtifact({
        summary: "候補向けの短いメモ。",
        lead: "超敏感の反応が連続する展開と潮吹きが公開されている点を先に置く。",
        paragraphs: [
          "ベロキスを含む展開が公開されている。",
          "出演者Alphaがクレジットされている事実を続ける。",
        ],
      }),
    });
    expect(review.decision).toBe("PASS");
    expect(review.metrics.supportedNovelAssertionCount).toBeGreaterThanOrEqual(2);
  });

  it("2. safe composition → PASS", () => {
    const claims = [
      { id: "t1", statement: "強い反応が連続する展開が公開されている。", kind: "trait_or_scene" },
      { id: "p1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
      { id: "t2", statement: "顔面ビンタを含む展開が公開されている。", kind: "trait_or_scene" },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "強い反応が連続する展開が公開されている点を先に置く。",
        paragraphs: [
          "出演者Alphaがクレジットされている事実を続ける。",
          "顔面ビンタを含む展開が公開されている。",
        ],
      }),
    });
    expect(review.decision).toBe("PASS");
    expect(
      review.semanticAssertions?.some((a) => a.supportType === "SAFE_COMPOSITION" || a.supportType === "DIRECT"),
    ).toBe(true);
  });

  it("3. name only → setting inference → FAIL (NAME_DERIVED)", () => {
    const claims = [
      { id: "s1", statement: "シリーズとして「アクアハント」に属する。", kind: "series" },
      { id: "p1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "出演者Alphaがクレジットされている。",
        paragraphs: [
          "「アクアハント」シリーズは屋外プールを舞台にした水着姿でのナンパ設定である。",
        ],
      }),
    });
    const codes = review.failures.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["NAME_DERIVED_INFERENCE"]));
    expect(review.decision).not.toBe("PASS");
  });

  it("4. explicit setting Claim → same text → PASS", () => {
    const claims = [
      {
        id: "s1",
        statement: "「アクアハント」シリーズは屋外プールを舞台にした水着姿でのナンパ設定である。",
        kind: "series",
      },
      { id: "p1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "水着姿でのナンパ設定が公開されている。",
        paragraphs: [
          "「アクアハント」シリーズは屋外プールを舞台にしている。",
          "出演者Alphaがクレジットされている。",
        ],
      }),
    });
    expect(review.failures.map((f) => f.code)).not.toContain("NAME_DERIVED_INFERENCE");
    expect(review.decision).toBe("PASS");
  });

  it("5. two traits → unsupported gap-as-charm → FAIL", () => {
    const claims = [
      { id: "t1", statement: "清楚な外観が示されている。", kind: "trait_or_scene" },
      { id: "t2", statement: "高い感度が示されている。", kind: "trait_or_scene" },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "清楚な外観が示されている。",
        paragraphs: ["清楚な外観と高い感度のギャップが魅力である。"],
      }),
    });
    const codes = review.failures.map((f) => f.code);
    expect(codes).toEqual(
      expect.arrayContaining(["EVALUATIVE_INFERENCE", "INTERPRETIVE_INFERENCE"]),
    );
  });

  it("6. explicit evaluation Claim → evaluation text → PASS", () => {
    const claims = [
      { id: "t1", statement: "清楚な外観が示されている。", kind: "trait_or_scene" },
      {
        id: "e1",
        statement: "清楚な外観と高い感度のギャップが魅力である。",
        kind: "trait_or_scene",
      },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "清楚な外観が示されている。",
        paragraphs: ["高い感度が示されている。ギャップが魅力である。"],
      }),
    });
    expect(review.failures.map((f) => f.code)).not.toContain("EVALUATIVE_INFERENCE");
    expect(review.decision).toBe("PASS");
  });

  it("7. same Claim semantic paraphrase across lead/body → REPETITION", () => {
    const claims = [
      { id: "t1", statement: "顔面ビンタと連続展開が公開されている。", kind: "trait_or_scene" },
      { id: "p1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "顔面ビンタと連続展開が公開されている。",
        paragraphs: [
          "顔面ビンタと連続展開が公開されている点を改めて述べる。出演者Alphaがクレジットされている。",
        ],
      }),
    });
    expect(review.failures.map((f) => f.code)).toContain("REPETITION");
  });

  it("8. different supported facts → not treated as repetition", () => {
    const claims = [
      { id: "t1", statement: "超敏感の反応が連続する展開と潮吹きが公開されている。", kind: "trait_or_scene" },
      { id: "t2", statement: "ベロキスを含む展開が公開されている。", kind: "trait_or_scene" },
      { id: "p1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "超敏感の反応が連続する展開と潮吹きが公開されている。",
        paragraphs: [
          "ベロキスを含む展開が公開されている。出演者Alphaがクレジットされている。",
        ],
      }),
    });
    expect(review.failures.map((f) => f.code)).not.toContain("REPETITION");
    expect(review.decision).toBe("PASS");
  });

  it("9. long article + many novel supported assertions → PASS", () => {
    const claims = [
      { id: "c1", statement: "高感度の反応が連続する展開が公開されている。", kind: "trait_or_scene" },
      { id: "c2", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
      { id: "c3", statement: "顔面ビンタを含む展開が公開されている。", kind: "trait_or_scene" },
      { id: "c4", statement: "メーカーBetaの作品である。", kind: "maker" },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "高感度の反応が連続する展開が公開されている点を先に置く。",
        paragraphs: [
          "出演者Alphaがクレジットされている事実を進める。",
          "顔面ビンタを含む展開が公開されている点を続ける。",
          "同じ事実の言い換えはせず、公開範囲の別角度だけを足す。",
        ],
      }),
    });
    expect(review.metrics.bodyUnits).toBeGreaterThan(80);
    expect(review.metrics.supportedNovelAssertionCount).toBeGreaterThanOrEqual(3);
    expect(review.decision).toBe("PASS");
  });

  it("10. short article + little/no information gain → FAIL", () => {
    const claims = [
      { id: "c1", statement: "高感度の反応が連続する展開が公開されている。", kind: "trait_or_scene" },
      { id: "c2", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
      { id: "c3", statement: "メーカーBetaの作品である。", kind: "maker" },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims),
      claimStatements: claims,
      artifact: blogArtifact({
        title: "紹介",
        summary: "本作品について紹介します。",
        lead: "おすすめです。",
        paragraphs: ["ぜひチェックして詳しく確認できます。"],
      }),
    });
    expect(review.decision).not.toBe("PASS");
    expect(review.failures.map((f) => f.code)).toEqual(
      expect.arrayContaining(["INFORMATION_GAIN_LOW"]),
    );
  });

  it("11. short article + scarce claims + dense supported content → PASS", () => {
    const claims = [
      { id: "c1", statement: "高感度ビンタが公開されている。", kind: "trait_or_scene" },
    ];
    const core = blogPlan(claims, { opening: ["c1"], development: [] });
    expect(core.scarcityMode).toBe(true);
    const review = reviewArtifactShadow({
      corePlan: core,
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "高感度が公開されている。",
        paragraphs: ["ビンタを含む展開が公開されている。"],
        summary: "候補判断向けの短いメモ。",
      }),
    });
    expect(review.metrics.bodyUnits).toBeLessThan(120);
    expect(review.metrics.supportedNovelAssertionCount).toBeGreaterThanOrEqual(1);
    expect(review.decision).toBe("PASS");
  });

  it("12. unsupported fabricated social proof → FAIL", () => {
    const claims = [
      { id: "c1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims, { opening: ["c1"], development: [] }),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "出演者Alphaがクレジットされている。",
        paragraphs: ["総合ランキング1位の売上No.1作品として知られている。"],
      }),
    });
    expect(review.failures.map((f) => f.code)).toContain("SOCIAL_PROOF");
  });

  it("12b. generic 人気 promotional phrasing is not SOCIAL_PROOF", () => {
    const claims = [
      { id: "c1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
      {
        id: "c2",
        statement: "10作品が収録規模として記載されている。",
        kind: "trait_or_scene",
      },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "人気の出演者Alphaがクレジットされている。",
        paragraphs: ["10作品が収録規模として記載されている。"],
      }),
    });
    expect(review.failures.map((f) => f.code)).not.toContain("SOCIAL_PROOF");
  });

  it("13. generic filler only → FILLER", () => {
    const claims = [
      { id: "c1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims, { opening: ["c1"], development: [] }),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "ぜひチェックして詳しく確認できます。",
        paragraphs: ["興味を持った方はより深く理解できます。"],
      }),
    });
    expect(review.failures.map((f) => f.code)).toContain("FILLER");
  });

  it("14. claim-count target met but semantic gain insufficient → FAIL", () => {
    // Same claim facets restated thrice — old uniqueSupportedDetailEstimate≈1–3 appearance,
    // but supportedNovelAssertionCount stays low vs target.
    const claims = [
      { id: "c1", statement: "ベロキスと超敏感の連続展開が公開されている。", kind: "trait_or_scene" },
      { id: "c2", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
      { id: "c3", statement: "メーカーBetaの作品である。", kind: "maker" },
    ];
    const core = blogPlan(claims);
    const review = reviewArtifactShadow({
      corePlan: core,
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "ベロキスと超敏感の連続展開が公開されている。",
        paragraphs: [
          "ベロキスと超敏感の連続展開が公開されている点を繰り返す。",
          "ベロキスと超敏感の連続展開が公開されていることをさらに言い換える。存在感を高める描写だ。",
        ],
      }),
    });
    expect(review.metrics.supportedNovelAssertionCount).toBeLessThan(core.informationGainTarget);
    expect(review.failures.map((f) => f.code)).toEqual(
      expect.arrayContaining(["INFORMATION_GAIN_LOW", "REPETITION"]),
    );
    expect(review.decision).not.toBe("PASS");
  });

  it("15. Blog/X share grounding (name-derived setting fails on both)", () => {
    const claims = [
      { id: "s1", statement: "シリーズとして「アクアハント」に属する。", kind: "series" },
    ];
    const coreBlog = blogPlan(claims, { opening: ["s1"], development: [] });
    const blog = reviewArtifactShadow({
      corePlan: coreBlog,
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "「アクアハント」は屋外プールを舞台にした設定である。",
        paragraphs: ["シリーズ名の言い換えのみ。"],
      }),
    });
    const xArtifact: ReviewableXArtifact = {
      channel: "X",
      body: "「アクアハント」は屋外プールを舞台にした設定である。",
      posts: [{ order: 1, text: "「アクアハント」は屋外プールを舞台にした設定である。" }],
    };
    const coreX = { ...coreBlog, channel: "X" as const };
    const x = reviewArtifactShadow({
      corePlan: coreX,
      claimStatements: claims,
      artifact: xArtifact,
    });
    expect(blog.failures.map((f) => f.code)).toContain("NAME_DERIVED_INFERENCE");
    expect(x.failures.map((f) => f.code)).toContain("NAME_DERIVED_INFERENCE");
  });

  it("16b. title-rich Claim explicit facts → not NAME_DERIVED", () => {
    const claims = [
      {
        id: "id1",
        statement:
          "【特別】ガンマ感謝祭 ロードキャラバン2024 新人発掘＆育成スペシャル！！ 挑戦者12名と先輩12名の1泊2日合同企画！ は公開ページ上で確認できる。",
        kind: "identity_name",
      },
      {
        id: "s1",
        statement: "シリーズ情報として「ロードキャラバン」が公開されている。",
        kind: "series",
      },
      {
        id: "p1",
        statement: "出演者／クリエイターとして「PerformerGamma」が記載されている。",
        kind: "performer",
      },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "挑戦者12名と先輩12名による1泊2日の合同企画です。",
        paragraphs: [
          "ロードキャラバンでは新人発掘と育成をテーマにした特別企画が公開されている。",
          "PerformerGammaのクレジットが確認できる。",
        ],
      }),
    });
    expect(review.failures.map((f) => f.code)).not.toContain("NAME_DERIVED_INFERENCE");
    expect(review.decision).toBe("PASS");
  });

  it("16c. title-rich explicit OK but extra Claim-absent focus → inference FAIL", () => {
    const claims = [
      {
        id: "id1",
        statement:
          "【特別】ガンマ感謝祭 ロードキャラバン2024 新人発掘＆育成スペシャル！！ 挑戦者12名と先輩12名の1泊2日合同企画！ は公開ページ上で確認できる。",
        kind: "identity_name",
      },
      {
        id: "s1",
        statement: "シリーズ情報として「ロードキャラバン」が公開されている。",
        kind: "series",
      },
      {
        id: "p1",
        statement: "出演者／クリエイターとして「PerformerGamma」が記載されている。",
        kind: "performer",
      },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "PerformerGammaが出演する企画は、新人発掘＆育成をテーマにした1泊2日の合同企画です。",
        paragraphs: [
          "このシリーズは参加者同士の交流に重点を置いた内容となっています。",
          "PerformerGammaの存在感が作品の魅力を高めています。",
        ],
      }),
    });
    const codes = review.failures.map((f) => f.code);
    expect(codes).not.toContain("NAME_DERIVED_INFERENCE");
    expect(codes).toEqual(expect.arrayContaining(["EVALUATIVE_INFERENCE"]));
    expect(review.decision).not.toBe("PASS");
  });

  it("16d. supported performer facet + new evaluation relation → EVALUATIVE", () => {
    const claims = [
      {
        id: "p1",
        statement: "出演者／クリエイターとして「PerformerDelta」が記載されている。",
        kind: "performer",
      },
    ];
    const review = reviewArtifactShadow({
      corePlan: blogPlan(claims, { opening: ["p1"], development: [] }),
      claimStatements: claims,
      artifact: blogArtifact({
        lead: "PerformerDeltaがクレジットされている。",
        paragraphs: [
          "PerformerDeltaという出演者が起用されており、その存在感が作品の魅力を高めています。",
        ],
      }),
    });
    expect(review.failures.map((f) => f.code)).toContain("EVALUATIVE_INFERENCE");
    expect(review.decision).not.toBe("PASS");
  });

  it("16. X hook quality is not mixed into Core grounding codes", () => {
    const claims = [
      { id: "c1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ];
    const core = {
      ...blogPlan(claims, { opening: ["c1"], development: [] }),
      channel: "X" as const,
    };
    const review = reviewArtifactShadow({
      corePlan: core,
      claimStatements: claims,
      artifact: {
        channel: "X",
        body: "Hi\nすごい！必見！チェック！",
        posts: [
          { order: 1, text: "Hi" },
          { order: 2, text: "すごい！必見！チェック！" },
        ],
      },
    });
    const codes = review.failures.map((f) => f.code);
    // Channel signals allowed
    expect(codes.some((c) => c === "OPENING" || c === "TEMPLATE_FATIGUE")).toBe(true);
    // Weak hook must not invent grounding/name-derived without setting inference
    expect(codes).not.toContain("NAME_DERIVED_INFERENCE");
  });
});
