/**
 * OPTION B — evidence-grounded natural product-intro Writer policy (LLM=0 SSOT).
 *
 * Writer is an editorial article writer, not a fact formatter.
 * ARTICLE_PLAN facts are the factual BOUNDARY and grounding material.
 * Within that boundary, select / order / relate / explain / interpret editorially.
 *
 * FACT SYSTEM (what is known / must not invent) ≠ WRITER HOW (natural prose).
 * Internal taxonomy (GENRE_TAG, sourceResolution, presentationPurpose, …) must not
 * appear as reader-facing classification prose.
 */

/**
 * Natural product-intro Writer system — short, editorial-first.
 * Keep FACT boundary; avoid mechanical HOW checklists.
 */
export const OPTION_B_WRITER_SYSTEM = [
  "You are a Japanese Writer writing a single-product FANZA adult product introduction that a reader would actually want to finish.",
  "ARTICLE_PLAN facts[] are your factual BOUNDARY: the only allowed concrete-fact source. Do not invent product-specific facts, scenes, sexual acts, relationships, performers, quantities, titles, rankings, popularity, fan reactions, or external evaluations absent from the plan.",
  "You are NOT a fact formatter and NOT a taxonomy explainer. Do not emit FACT→FACT lists, and do not write like an internal Evidence report (e.g. classifying genres/play-styles/directions as labeled categories for the reader).",
  "Write as an adult product introducer: select what matters, weave related facts into natural Japanese prose, convey erotic appeal from recorded materials, and add editorial interpretation a reader can use (volume, who it suits, soft recommendation, reader address).",
  "EDITORIAL INTERPRETATION (allowed when grounded in planned facts): volume judgments, who it suits, soft recommendation, reader address, charm summary. Examples: 「かなりボリュームのあるベスト」「まとめて見たい人にも適した」「彼女のファンはもちろん」「魅力を凝縮した作品集」. Exact wording need not appear in Evidence.",
  "EXTERNAL FACTUAL CLAIMS (forbidden unless already in planned facts): third-party/market reputation asserted as fact — e.g. ～で知られている / として知られている / 世間から評価 / ファンから高評価 / 大人気 / 話題になっている / 売れ筋 / 最高傑作と評価 / 売上No.1. Bare ファン・おすすめ・楽しめる・魅力 as editorial opinion are OK.",
  "Coverage: realize the meaning of planned title/body facts. Weave related facts into shared sentences/paragraphs. Short theme/play/body tags may be grouped naturally — do not force one sentence per fact, explain every genre, or invent scenes to fill length.",
  "When planned facts include long recorded scene/trait/play description, develop that erotic content. When planned facts are only short membership tags, treat them as product directions/membership — do not invent performed roles, story, atmosphere, or acting quality from the tag alone.",
  "SOURCE DENSITY (ARTICLE_PLAN.sourceExpansion when present): RICH may expand scene/detail across paragraphs; THEME_LEVEL prefers a concise natural intro (often ~2 paragraphs); METADATA_ONLY stays short and factual. After planned facts are naturally introduced, you MAY STOP — do not add forced wrap-up, genre summary, identity restatement, or abstract evaluation to hit a length quota. Short and complete beats long and padded. No fixed character quotas and no fixed paragraph count.",
  "Article shape (leadless): natural title; body as continuous product intro (identity → appeal/content → optional reader orientation). No separate lead field. No fixed paragraph template. No catalog/DB readout voice. No purchase urgency.",
  "Title: only title.facts as noun/label blocks. Compose one natural Japanese product title with 助詞/読点 (の・と etc.). Never add modifiers, scenes, genres, or appeal words absent from title.facts. Not a keyword list, not unfinished clauses (〜を迎え).",
  "materialDepth=rich with RICH SOURCE: develop independent axes with explanation — not one-word drops, not empty padding. scarce or thin SOURCE: stay short.",
].join(" ");

/** @deprecated r114 — Planner owns stop via ArticlePlan; not Writer-projected. */
export const OPTION_B_SLOT_STOP_CONDITION =
  "stop_when_planned_facts_fully_developed_in_prose" as const;

/** @deprecated r114 — kept for internal skeleton alignment; not injected into Writer prompt. */
export const OPTION_B_REALIZATION_COMPLETE_DUTY =
  "Stop each slot when planned facts are fully developed in prose, not at minimal mention.";

/**
 * Internal slot purpose ids (skeleton / NATURAL_PRODUCT_INTRO_STRUCTURE).
 * Not projected as Writer essay notes (r114).
 */
export const OPTION_B_WRITER_SLOT_SPEECH = {
  title: {
    purpose: "who_plus_core",
    note: "internal",
  },
  lead: {
    purpose: "opening_facts",
    note: "internal",
  },
  body: {
    purpose: "body_facts",
    note: "internal",
  },
} as const;

/** @deprecated r114 — not Writer-injected */
export const OPTION_B_EVIDENCE_VOICE_RULE =
  "Internal: facts only; do not inherit overview speech act.";

/** @deprecated r114 — alias of OPTION_B_WRITER_SYSTEM for transitional imports */
export const OPTION_B_GENERATOR_POLICY = OPTION_B_WRITER_SYSTEM;

/** @deprecated r114 */
export const OPTION_B_GENERATOR_POLICY_SCARCE = OPTION_B_WRITER_SYSTEM;

/**
 * Internal structure sample id (legacy). Writer-visible shape key is
 * WRITER_VISIBLE_ARTICLE_SHAPE — do not project this name into prompts.
 */
export const NATURAL_PRODUCT_INTRO_STRUCTURE = {
  schemaVersion: 1 as const,
  /** Internal legacy id — not Writer-visible (r110). */
  name: "natural_product_intro",
  source: "user_quality_bar_mizd00320",
  slots: [
    {
      id: "opening",
      purpose: OPTION_B_WRITER_SLOT_SPEECH.lead.purpose,
      note: OPTION_B_WRITER_SLOT_SPEECH.lead.note,
    },
    {
      id: "body_content",
      purpose: OPTION_B_WRITER_SLOT_SPEECH.body.purpose,
      note: OPTION_B_WRITER_SLOT_SPEECH.body.note,
    },
    {
      id: "ending_audience",
      purpose: "optional_product_form_context",
      note: "Only when remaining Evidence supports it. Skip when nothing new remains.",
    },
    {
      id: "cta",
      purpose: "channel_cta_widget",
      note: "System CTA widget — do not invent CTA marketing copy.",
    },
  ],
  /** Kept for skeleton/docs; Generator uses OPTION_B_GENERATOR_POLICY instead. */
  densityNote: OPTION_B_GENERATOR_POLICY,
} as const;

/** Writer-visible articleShape — natural product intro within Evidence/Plan boundary. */
export const WRITER_VISIBLE_ARTICLE_SHAPE = "natural_product_intro" as const;

/** Semantic attribution scope — classification stays in semantic-evidence.ts; not a Generator wall. */
export const TITLE_SERIES_PERSONA_SCOPE = {
  allowedSemanticTypes: ["TITLE_LABEL", "SERIES_CONCEPT", "PRODUCT_PERSONA"] as const,
  allowedMeanings: [
    "that title's works",
    "that series",
    "in-concept setting/expression",
    "product marketing label",
  ] as const,
  forbiddenMeanings: [
    "performer is known as X",
    "performer is famous for X",
    "performer has X personality",
    "X is performer's representative trait",
    "X is performer's established persona",
    "X is performer's general reputation",
  ] as const,
  failPatterns: [
    "として知られる",
    "と称される",
    "キャラクター性が際立",
    "代表的な",
    "彼女の個性としての",
  ] as const,
  seriesPersonaRule:
    "TITLE_LABEL / SERIES_CONCEPT / PRODUCT_PERSONA are product-scoped. Quote as work/series/concept — never performer reputation.",
} as const;

export type NaturalIntroReferenceNote = {
  url: string;
  fetched: boolean;
  usableAsProductIntroSkeleton: boolean;
  note: string;
};

/**
 * Note about external reference URL. Does not invent article body from failed/partial fetches.
 * Ranking listicles are kept in Reference Library as ranking-type learning — never applied to single_product.
 */
export function noteExternalReferenceForNaturalIntro(input: {
  url: string;
  fetched: boolean;
  observedGenre?: "ranking_listicle" | "single_product_intro" | "unknown";
}): NaturalIntroReferenceNote {
  if (!input.fetched) {
    return {
      url: input.url,
      fetched: false,
      usableAsProductIntroSkeleton: false,
      note: "URL content unavailable — do not invent structure or prose from it. Prefer user-provided sample.",
    };
  }
  if (input.observedGenre === "ranking_listicle") {
    return {
      url: input.url,
      fetched: true,
      usableAsProductIntroSkeleton: false,
      note: "Fetched page is ranking. Keep as Reference Library articleType=ranking for future ranking generation. Do NOT apply to single_product Natural Product Intro.",
    };
  }
  return {
    url: input.url,
    fetched: true,
    usableAsProductIntroSkeleton: input.observedGenre === "single_product_intro",
    note:
      input.observedGenre === "single_product_intro"
        ? "Single-product intro page — structure may inform Writing Skeleton after user sample."
        : "Fetched but genre unclear — do not invent; prefer user sample.",
  };
}

/** Soft Brain gain floor for natural intro (not coverage maximization). */
export function optionBNaturalIntroInformationGainFloor(): number {
  return 1;
}
