/**
 * General (non-product) validation fixtures for profiles missing from production DB.
 * No LLM — deterministic artifacts for Shadow precision/recall observation.
 */

import type { ReviewableArtifact } from "../shadow/reviewer.js";

export type ValidationFixture = {
  sampleId: string;
  source: "fixture";
  channel: "BLOG" | "X";
  formatKey: string;
  contentType: string;
  profileTags: string[];
  selectionReason: string;
  claims: Array<{ id: string; statement: string; kind: string }>;
  openingClaimIds: string[];
  developmentClaimIds: string[];
  artifact: ReviewableArtifact;
  /** Provisional human editorial judgment for comparison (not Brain self-score) */
  humanJudgment: {
    overall: "PASS" | "REPAIR" | "REGEN";
    grounding: "ok" | "weak" | "fail";
    repetition: "ok" | "weak" | "fail";
    inference: "ok" | "weak" | "fail";
    filler: "ok" | "weak" | "fail";
    informationGain: "ok" | "weak" | "fail";
    notes: string;
  };
};

export const VALIDATION_FIXTURES: ValidationFixture[] = [
  {
    sampleId: "fixture-scarce-pass",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["scarce"],
    selectionReason: "Scarcity normal: short, dense, unsupported≈0",
    claims: [
      {
        id: "fx-s1",
        statement: "高感度ビンタが公開されている。",
        kind: "trait_or_scene",
      },
    ],
    openingClaimIds: ["fx-s1"],
    developmentClaimIds: [],
    artifact: {
      channel: "BLOG",
      title: "高感度の公開事実",
      summary: "候補判断向けの短いメモ。",
      lead: "高感度が公開されている。",
      sections: [{ paragraphs: ["ビンタを含む展開が公開されている。"], lists: [] }],
      bodyText: "",
    },
    humanJudgment: {
      overall: "PASS",
      grounding: "ok",
      repetition: "ok",
      inference: "ok",
      filler: "ok",
      informationGain: "ok",
      notes: "短いがSUPPORTEDに忠実。長さ不足で落とすべきでない。",
    },
  },
  {
    sampleId: "fixture-rich-pass",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["rich", "trait-rich"],
    selectionReason: "Rich normal: long, sequential novel supported assertions",
    claims: [
      { id: "fx-r1", statement: "高感度の反応が連続する展開が公開されている。", kind: "trait_or_scene" },
      { id: "fx-r2", statement: "顔面ビンタを含む展開が公開されている。", kind: "trait_or_scene" },
      { id: "fx-r3", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
      { id: "fx-r4", statement: "メーカーBetaの作品である。", kind: "maker" },
      { id: "fx-r5", statement: "販売／配信状態はAVAILABLEである。", kind: "availability" },
    ],
    openingClaimIds: ["fx-r1"],
    developmentClaimIds: ["fx-r2", "fx-r3", "fx-r4"],
    artifact: {
      channel: "BLOG",
      title: "高感度と顔面ビンタが候補になる理由",
      summary: "候補判断向けの短いメモ。",
      lead: "高感度の反応が連続する展開が公開されている点を先に置く。",
      sections: [
        {
          paragraphs: [
            "顔面ビンタを含む展開が公開されている事実を続ける。",
            "出演者Alphaのクレジットが確認できる。",
          ],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "PASS",
      grounding: "ok",
      repetition: "ok",
      inference: "ok",
      filler: "ok",
      informationGain: "ok",
      notes: "長いがSUPPORTEDが順次展開。長さを理由にFAILすべきでない。",
    },
  },
  {
    sampleId: "fixture-identity-heavy-clean",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["identity-heavy", "naming-risk"],
    selectionReason: "Identity-heavy without invented setting",
    claims: [
      { id: "fx-i1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
      { id: "fx-i2", statement: "メーカーBetaの作品である。", kind: "maker" },
      { id: "fx-i3", statement: "シリーズとして「アクアハント」に属する。", kind: "series" },
    ],
    openingClaimIds: ["fx-i1"],
    developmentClaimIds: ["fx-i2", "fx-i3"],
    artifact: {
      channel: "BLOG",
      title: "出演者AlphaとメーカーBeta",
      summary: "候補判断向けの短いメモ。",
      lead: "出演者Alphaがクレジットされている。",
      sections: [
        {
          paragraphs: [
            "メーカーBetaの作品である。シリーズとして「アクアハント」に属する。",
          ],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "PASS",
      grounding: "ok",
      repetition: "ok",
      inference: "ok",
      filler: "ok",
      informationGain: "ok",
      notes: "名前の列挙のみで設定推論なし → PASS相当。",
    },
  },
  {
    sampleId: "fixture-naming-risk-fail",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["naming-risk", "identity-heavy"],
    selectionReason: "Name→setting inference should FAIL",
    claims: [
      { id: "fx-n1", statement: "シリーズとして「アクアハント」に属する。", kind: "series" },
      { id: "fx-n2", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ],
    openingClaimIds: ["fx-n2"],
    developmentClaimIds: ["fx-n1"],
    artifact: {
      channel: "BLOG",
      title: "アクアハント作品",
      summary: "候補判断向けの短いメモ。",
      lead: "出演者Alphaがクレジットされている。",
      sections: [
        {
          paragraphs: [
            "「アクアハント」シリーズは屋外プールを舞台にした水着姿でのナンパ設定である。",
          ],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "REPAIR",
      grounding: "fail",
      repetition: "ok",
      inference: "fail",
      filler: "ok",
      informationGain: "weak",
      notes: "シリーズ名からの設定推論は人間もREPAIR。",
    },
  },
  {
    sampleId: "fixture-eval-risk-fail",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["evaluation-risk", "trait-rich"],
    selectionReason: "Two traits → unsupported charm gap",
    claims: [
      { id: "fx-e1", statement: "清楚な外観が示されている。", kind: "trait_or_scene" },
      { id: "fx-e2", statement: "高い感度が示されている。", kind: "trait_or_scene" },
      { id: "fx-e3", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ],
    openingClaimIds: ["fx-e1"],
    developmentClaimIds: ["fx-e2", "fx-e3"],
    artifact: {
      channel: "BLOG",
      title: "清楚と感度",
      summary: "候補判断向けの短いメモ。",
      lead: "清楚な外観が示されている。",
      sections: [
        {
          paragraphs: [
            "高い感度が示されている。ギャップが魅力である。出演者Alphaがクレジットされている。",
          ],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "REPAIR",
      grounding: "weak",
      repetition: "ok",
      inference: "fail",
      filler: "ok",
      informationGain: "ok",
      notes: "評価・ギャップ解釈はClaimに無い → REPAIR。",
    },
  },
  {
    sampleId: "fixture-eval-supported-pass",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["evaluation-risk"],
    selectionReason: "Explicit evaluation Claim should allow evaluation wording",
    claims: [
      { id: "fx-es1", statement: "清楚な外観が示されている。", kind: "trait_or_scene" },
      {
        id: "fx-es2",
        statement: "清楚な外観と高い感度のギャップが魅力である。",
        kind: "trait_or_scene",
      },
    ],
    openingClaimIds: ["fx-es1"],
    developmentClaimIds: ["fx-es2"],
    artifact: {
      channel: "BLOG",
      title: "ギャップが魅力の作品",
      summary: "候補判断向けの短いメモ。",
      lead: "清楚な外観が示されている。",
      sections: [
        {
          paragraphs: ["清楚な外観と高い感度のギャップが魅力である。"],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "PASS",
      grounding: "ok",
      repetition: "ok",
      inference: "ok",
      filler: "ok",
      informationGain: "ok",
      notes: "評価Claimがある言い換えはPASS。false positive監視対象。",
    },
  },
  {
    sampleId: "fixture-x-grounding-fail",
    source: "fixture",
    channel: "X",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "x-post",
    profileTags: ["naming-risk"],
    selectionReason: "X shares Core grounding; name-derived setting fails",
    claims: [
      { id: "fx-x1", statement: "シリーズとして「アクアハント」に属する。", kind: "series" },
    ],
    openingClaimIds: ["fx-x1"],
    developmentClaimIds: [],
    artifact: {
      channel: "X",
      body: "「アクアハント」は屋外プールを舞台にした設定。\n詳細はプロフへ",
      posts: [
        { order: 1, text: "「アクアハント」は屋外プールを舞台にした設定。" },
        { order: 2, text: "詳細はプロフへ" },
      ],
    },
    humanJudgment: {
      overall: "REPAIR",
      grounding: "fail",
      repetition: "ok",
      inference: "fail",
      filler: "ok",
      informationGain: "weak",
      notes: "XでもCore groundingは共通。hook弱さとは別軸。",
    },
  },
  {
    sampleId: "fixture-x-boundary-ok",
    source: "fixture",
    channel: "X",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "x-post",
    profileTags: ["scarce"],
    selectionReason: "X hook weakness must not invent Core grounding codes",
    claims: [
      { id: "fx-xb1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ],
    openingClaimIds: ["fx-xb1"],
    developmentClaimIds: [],
    artifact: {
      channel: "X",
      body: "Hi\nすごい！必見！チェック！",
      posts: [
        { order: 1, text: "Hi" },
        { order: 2, text: "すごい！必見！チェック！" },
      ],
    },
    humanJudgment: {
      overall: "REPAIR",
      grounding: "ok",
      repetition: "ok",
      inference: "ok",
      filler: "weak",
      informationGain: "fail",
      notes: "Channel hook/template問題。NAME_DERIVED等のCore grounding混入は不可。",
    },
  },
  // --- Phase precision fixtures (predicate / role-aware repetition) ---
  {
    sampleId: "fixture-suitability-unsupported",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["evaluation-risk"],
    selectionReason: "Trait → invented audience suitability",
    claims: [
      { id: "fx-su1", statement: "高感度の反応が連続する展開が公開されている。", kind: "trait_or_scene" },
    ],
    openingClaimIds: ["fx-su1"],
    developmentClaimIds: [],
    artifact: {
      channel: "BLOG",
      title: "高感度の展開",
      summary: "候補判断向けの短いメモ。",
      lead: "高感度の反応が連続する展開が公開されている。",
      sections: [
        {
          paragraphs: ["刺激を求める視聴者に向いています。"],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "REPAIR",
      grounding: "weak",
      repetition: "ok",
      inference: "fail",
      filler: "fail",
      informationGain: "ok",
      notes: "suitability relation unsupported → EVALUATIVE (+FILLER)",
    },
  },
  {
    sampleId: "fixture-suitability-supported",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["evaluation-risk"],
    selectionReason: "Explicit suitability Claim allows suitability wording",
    claims: [
      { id: "fx-ss1", statement: "高感度の反応が連続する展開が公開されている。", kind: "trait_or_scene" },
      { id: "fx-ss2", statement: "顔面ビンタを含む展開が公開されている。", kind: "trait_or_scene" },
      {
        id: "fx-ss3",
        statement: "刺激を求める視聴者に向いている作品である。",
        kind: "trait_or_scene",
      },
    ],
    openingClaimIds: ["fx-ss1"],
    developmentClaimIds: ["fx-ss2", "fx-ss3"],
    artifact: {
      channel: "BLOG",
      title: "高感度の展開",
      summary: "候補判断向けの短いメモ。",
      lead: "高感度の反応が連続する展開が公開されている。",
      sections: [
        {
          paragraphs: [
            "顔面ビンタを含む展開が公開されている。刺激を求める視聴者に向いている作品である。",
          ],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "PASS",
      grounding: "ok",
      repetition: "ok",
      inference: "ok",
      filler: "ok",
      informationGain: "ok",
      notes: "SUPPORTED suitability Claim → PASS",
    },
  },
  {
    sampleId: "fixture-eval-zero-gain-filler",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["evaluation-risk"],
    selectionReason: "Unsupported evaluation with zero novel supported info",
    claims: [
      { id: "fx-ez1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ],
    openingClaimIds: ["fx-ez1"],
    developmentClaimIds: [],
    artifact: {
      channel: "BLOG",
      title: "出演者Alpha",
      summary: "候補判断向けの短いメモ。",
      lead: "出演者Alphaがクレジットされている。",
      sections: [
        {
          paragraphs: ["出演者Alphaが好きな方におすすめです。"],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "REPAIR",
      grounding: "weak",
      repetition: "ok",
      inference: "fail",
      filler: "fail",
      informationGain: "weak",
      notes: "EVALUATIVE_INFERENCE + FILLER",
    },
  },
  {
    sampleId: "fixture-lead-body-full-restatement",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["scarce"],
    selectionReason: "Same claim/facet paraphrased lead→body",
    claims: [
      { id: "fx-lb1", statement: "顔面ビンタと連続展開が公開されている。", kind: "trait_or_scene" },
      { id: "fx-lb2", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ],
    openingClaimIds: ["fx-lb1"],
    developmentClaimIds: ["fx-lb2"],
    artifact: {
      channel: "BLOG",
      title: "顔面ビンタの展開",
      summary: "候補判断向けの短いメモ。",
      lead: "顔面ビンタと連続展開が公開されている。",
      sections: [
        {
          paragraphs: [
            "顔面ビンタと連続展開が公開されている点を改めて述べる。出演者Alphaがクレジットされている。",
          ],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "REPAIR",
      grounding: "ok",
      repetition: "fail",
      inference: "ok",
      filler: "ok",
      informationGain: "ok",
      notes: "FULL_RESTATEMENT of lead facets → REPETITION",
    },
  },
  {
    sampleId: "fixture-same-claim-new-facet",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["trait-rich"],
    selectionReason: "Same claimId family but different supported facets → not repetition",
    claims: [
      {
        id: "fx-sc1",
        statement: "顔面ビンタと連続展開と高感度反応が公開されている。",
        kind: "trait_or_scene",
      },
      { id: "fx-sc2", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ],
    openingClaimIds: ["fx-sc1"],
    developmentClaimIds: ["fx-sc2"],
    artifact: {
      channel: "BLOG",
      title: "顔面ビンタから高感度へ",
      summary: "候補判断向けの短いメモ。",
      lead: "高感度反応と連続展開が公開されている。",
      sections: [
        {
          paragraphs: [
            "顔面ビンタが公開されている。出演者Alphaがクレジットされている。",
          ],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "PASS",
      grounding: "ok",
      repetition: "ok",
      inference: "ok",
      filler: "ok",
      informationGain: "ok",
      notes: "PARTIAL_OVERLAP_WITH_GAIN → PASS",
    },
  },
  {
    sampleId: "fixture-title-lead-overlap-ok",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["scarce"],
    selectionReason: "Title→lead thematic overlap is role-expected",
    claims: [
      { id: "fx-tl1", statement: "高感度ビンタが公開されている。", kind: "trait_or_scene" },
    ],
    openingClaimIds: ["fx-tl1"],
    developmentClaimIds: [],
    artifact: {
      channel: "BLOG",
      title: "高感度の連続展開が候補になる理由",
      summary: "候補判断向けの短いメモ。",
      lead: "高感度が公開されている。",
      sections: [{ paragraphs: ["ビンタを含む展開が公開されている。"], lists: [] }],
      bodyText: "",
    },
    humanJudgment: {
      overall: "PASS",
      grounding: "ok",
      repetition: "ok",
      inference: "ok",
      filler: "ok",
      informationGain: "ok",
      notes: "title/lead overlap must not block",
    },
  },
  {
    sampleId: "fixture-summary-body-overlap-ok",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["scarce"],
    selectionReason: "Summary compresses body — not blocking repetition",
    claims: [
      { id: "fx-sb1", statement: "超敏感の反応が連続する展開と潮吹きが公開されている。", kind: "trait_or_scene" },
      { id: "fx-sb2", statement: "ベロキスを含む展開が公開されている。", kind: "trait_or_scene" },
      { id: "fx-sb3", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ],
    openingClaimIds: ["fx-sb1"],
    developmentClaimIds: ["fx-sb2", "fx-sb3"],
    artifact: {
      channel: "BLOG",
      title: "公開事実メモ",
      summary: "超敏感の反応が連続する展開と出演者Alphaが示される。",
      lead: "超敏感の反応が連続する展開と潮吹きが公開されている。",
      sections: [
        {
          paragraphs: [
            "ベロキスを含む展開が公開されている。",
            "出演者Alphaがクレジットされている。",
          ],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "PASS",
      grounding: "ok",
      repetition: "ok",
      inference: "ok",
      filler: "ok",
      informationGain: "ok",
      notes: "summary recap is ROLE_EXPECTED_RECAP",
    },
  },
  {
    sampleId: "fixture-summary-eval-fail",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["evaluation-risk"],
    selectionReason: "Summary may not invent unsupported evaluation",
    claims: [
      { id: "fx-se1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
      { id: "fx-se2", statement: "顔面ビンタが公開されている。", kind: "trait_or_scene" },
    ],
    openingClaimIds: ["fx-se1"],
    developmentClaimIds: ["fx-se2"],
    artifact: {
      channel: "BLOG",
      title: "公開メモ",
      summary: "出演者Alphaが魅力的でおすすめの作品。",
      lead: "出演者Alphaがクレジットされている。",
      sections: [{ paragraphs: ["顔面ビンタが公開されている。"], lists: [] }],
      bodyText: "",
    },
    humanJudgment: {
      overall: "REPAIR",
      grounding: "weak",
      repetition: "ok",
      inference: "fail",
      filler: "ok",
      informationGain: "weak",
      notes: "summary unsupported evaluation → inference failure",
    },
  },
  {
    sampleId: "fixture-body-a-then-ab",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["trait-rich"],
    selectionReason: "Body A then A+B supported — B is novel gain",
    claims: [
      { id: "fx-ab1", statement: "超敏感の反応が連続する展開と潮吹きが公開されている。", kind: "trait_or_scene" },
      { id: "fx-ab2", statement: "ベロキスを含む展開が公開されている。", kind: "trait_or_scene" },
    ],
    openingClaimIds: ["fx-ab1"],
    developmentClaimIds: ["fx-ab2"],
    artifact: {
      channel: "BLOG",
      title: "展開メモ",
      summary: "候補判断向けの短いメモ。",
      lead: "超敏感の反応が連続する展開と潮吹きが公開されている。",
      sections: [
        {
          paragraphs: ["ベロキスを含む展開が公開されている。"],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "PASS",
      grounding: "ok",
      repetition: "ok",
      inference: "ok",
      filler: "ok",
      informationGain: "ok",
      notes: "A+B with novel B → not FULL_RESTATEMENT",
    },
  },
  {
    sampleId: "fixture-cross-claim-semantic-dup",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["trait-rich"],
    selectionReason: "Different claimIds, same semantic facets → repetition",
    claims: [
      { id: "fx-cd1", statement: "顔面ビンタが公開されている。", kind: "trait_or_scene" },
      { id: "fx-cd2", statement: "顔面ビンタのシーンが公開されている。", kind: "trait_or_scene" },
      { id: "fx-cd3", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ],
    openingClaimIds: ["fx-cd1"],
    developmentClaimIds: ["fx-cd2", "fx-cd3"],
    artifact: {
      channel: "BLOG",
      title: "顔面ビンタ",
      summary: "候補判断向けの短いメモ。",
      lead: "顔面ビンタが公開されている。",
      sections: [
        {
          paragraphs: [
            "顔面ビンタが公開されていることを改めて述べる。出演者Alphaがクレジットされている。",
          ],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "REPAIR",
      grounding: "ok",
      repetition: "fail",
      inference: "ok",
      filler: "ok",
      informationGain: "ok",
      notes: "claimId違いでも同一facet再提示 → REPETITION",
    },
  },
  {
    sampleId: "fixture-title-rich-explicit-pass",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["identity-heavy", "naming-risk", "rich"],
    selectionReason:
      "Title-rich identity Claim explicitly states duration/theme facts — paraphrase must not be NAME_DERIVED",
    claims: [
      {
        id: "fx-tr1",
        statement:
          "【特別】ガンマ感謝祭 ロードキャラバン2024 新人発掘＆育成スペシャル！！ 挑戦者12名と先輩12名の1泊2日合同企画！ は公開ページ上で確認できる。",
        kind: "identity_name",
      },
      {
        id: "fx-tr2",
        statement: "メーカー／レーベルとして「ガンマ」が公開されている。",
        kind: "maker",
      },
      {
        id: "fx-tr3",
        statement: "シリーズ情報として「ロードキャラバン」が公開されている。",
        kind: "series",
      },
      {
        id: "fx-tr4",
        statement: "出演者／クリエイターとして「PerformerGamma」が記載されている。",
        kind: "performer",
      },
    ],
    openingClaimIds: ["fx-tr1", "fx-tr4"],
    developmentClaimIds: ["fx-tr2", "fx-tr3"],
    artifact: {
      channel: "BLOG",
      title: "PerformerGamma出演のロードキャラバン2024",
      summary: "新人発掘・育成をテーマにした1泊2日の合同企画。",
      lead: "PerformerGammaが出演する「【特別】ガンマ感謝祭 ロードキャラバン2024」は、新人発掘＆育成をテーマにした1泊2日の合同企画です。",
      sections: [
        {
          paragraphs: [
            "本作は「ロードキャラバン」シリーズの一環で、挑戦者12名と先輩12名が参加する特別企画です。",
            "メーカーはガンマとして公開されています。",
          ],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "PASS",
      grounding: "ok",
      repetition: "ok",
      inference: "ok",
      filler: "ok",
      informationGain: "ok",
      notes:
        "Claim本文の1泊2日/発掘育成/人数のparaphraseはDIRECT。シリーズ名語感だけの設定推論ではない。",
    },
  },
  {
    sampleId: "fixture-title-rich-extra-inference-fail",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["identity-heavy", "naming-risk", "evaluation-risk"],
    selectionReason:
      "Title facts OK, but Claim外の交流重点・評価は inference のまま残す",
    claims: [
      {
        id: "fx-te1",
        statement:
          "【特別】ガンマ感謝祭 ロードキャラバン2024 新人発掘＆育成スペシャル！！ 挑戦者12名と先輩12名の1泊2日合同企画！ は公開ページ上で確認できる。",
        kind: "identity_name",
      },
      {
        id: "fx-te2",
        statement: "シリーズ情報として「ロードキャラバン」が公開されている。",
        kind: "series",
      },
      {
        id: "fx-te3",
        statement: "出演者／クリエイターとして「PerformerGamma」が記載されている。",
        kind: "performer",
      },
    ],
    openingClaimIds: ["fx-te1", "fx-te3"],
    developmentClaimIds: ["fx-te2"],
    artifact: {
      channel: "BLOG",
      title: "PerformerGamma出演のロードキャラバン2024",
      summary: "1泊2日の合同企画として公開されている。",
      lead: "PerformerGammaが出演するロードキャラバン2024は、新人発掘＆育成をテーマにした1泊2日の合同企画です。",
      sections: [
        {
          paragraphs: [
            "このシリーズは参加者同士の交流に重点を置いた内容となっています。",
            "PerformerGammaの存在感が作品の魅力を高めています。",
          ],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "REPAIR",
      grounding: "weak",
      repetition: "ok",
      inference: "fail",
      filler: "ok",
      informationGain: "ok",
      notes:
        "明示title事実はOK。交流重点はUNSUPPORTED、存在感が魅力はEVALUATIVE。NAME_DERIVEDにtitle事実を落とさない。",
    },
  },
  {
    sampleId: "fixture-evaluative-on-supported-facet",
    source: "fixture",
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    profileTags: ["evaluation-risk", "identity-heavy"],
    selectionReason:
      "SUPPORTED performer facet + new evaluation relation → EVALUATIVE_INFERENCE",
    claims: [
      {
        id: "fx-ev1",
        statement: "出演者／クリエイターとして「PerformerDelta」が記載されている。",
        kind: "performer",
      },
      {
        id: "fx-ev2",
        statement: "シリーズ情報として「ナイトサーキット」が公開されている。",
        kind: "series",
      },
    ],
    openingClaimIds: ["fx-ev1"],
    developmentClaimIds: ["fx-ev2"],
    artifact: {
      channel: "BLOG",
      title: "PerformerDelta出演作",
      summary: "出演事実の整理。",
      lead: "PerformerDeltaがクレジットされている。",
      sections: [
        {
          paragraphs: [
            "PerformerDeltaという出演者が起用されており、その存在感が作品の魅力を高めています。",
            "シリーズとして「ナイトサーキット」が設定されている。",
          ],
          lists: [],
        },
      ],
      bodyText: "",
    },
    humanJudgment: {
      overall: "REPAIR",
      grounding: "weak",
      repetition: "ok",
      inference: "fail",
      filler: "ok",
      informationGain: "ok",
      notes: "performer facetはSUPPORTEDだが評価relationは別assertion",
    },
  },
];
