/**
 * OPTION B — natural FANZA-style product intro policy (LLM=0 SSOT).
 *
 * r29: Generator receives only OPTION_B_GENERATOR_POLICY (one short line).
 * Longer policy objects below remain for tests / Brain / docs — not injected into Generator walls.
 */

/** Single Generator-facing policy (MERGE of prior natural / grounded / length / scope walls). */
export const OPTION_B_GENERATOR_POLICY =
  "EvidencePackの事実だけを使い、自然な日本語の商品紹介を書く。必要な具体情報を選び、新しい情報がある限り自然に展開する。事実を捏造しない。";

/** Structural sample derived from the user-provided mizd quality bar (NOT fixed copy). */
export const NATURAL_PRODUCT_INTRO_STRUCTURE = {
  schemaVersion: 1 as const,
  name: "natural_product_intro",
  source: "user_quality_bar_mizd00320",
  slots: [
    {
      id: "opening",
      purpose: "name_the_product_with_its_clearest_feature",
      note: "Lead: product overall content/composition.",
    },
    {
      id: "body_content",
      purpose: "compose_concrete_evidence_into_natural_intro",
      note: "Advance to concrete content not yet used.",
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

/**
 * @deprecated Generator no longer injects this wall (r29). Retained for tests/Brain docs.
 */
export const EVIDENCE_DRIVEN_LENGTH_POLICY = {
  principle: "ARTICLE_LENGTH_EQUALS_EVIDENCE_DRIVEN",
  minimalSufficientMeans:
    "Each paragraph/sentence must carry new concrete information or a clear editorial role — not 'write as short as possible'.",
  richEvidenceGuidance:
    "When many distinct concrete families exist, compose a natural multi-paragraph product intro. Do not shrink for 'brevity'.",
  thinEvidenceGuidance: "When concrete families are few, stop once they are used — do not pad.",
  informationProgression: [
    "P1: overall product content / composition",
    "P2: advance to concrete recorded scenes / quantities / settings / traits",
    "P3 (optional): Evidence-based product placement only if new info remains",
  ] as const,
  paddingForbidden: [
    "reintroduce_performer_name_without_new_fact",
    "restate_title_or_series_label_as_development",
    "repeat_that_it_is_a_best_collection",
    "restate_same_quantity_or_duration_family",
    "empty_connecting_sentence_with_no_new_info",
    "empty_evaluation_sentence_with_no_new_info",
    "reuse_same_evidence_family_to_fill_length",
  ] as const,
  notGoals: [
    "write_as_short_as_possible",
    "force_one_paragraph_when_evidence_is_rich",
    "fixed_paragraph_count",
  ] as const,
} as const;

/**
 * @deprecated Generator no longer injects this wall (r29). Retained for tests/docs.
 */
export const GROUNDED_PROMOTION_POLICY = {
  allowedWhenGrounded: [
    "魅せる",
    "楽しめる",
    "見どころ",
    "魅力",
    "まとめた",
    "詰め込んだ",
    "収録",
  ],
  forbidEvaluationOnlySentence: true,
  examplesUngroundedForbid: [
    "刺激的なシーンが多数収録",
    "魅力を存分に味わえる",
    "見逃せない作品",
  ],
  seriesPersonaRule:
    "TITLE_LABEL / SERIES_CONCEPT / PRODUCT_PERSONA are product-scoped. Quote as work/series/concept — never performer reputation.",
} as const;

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
} as const;

/** @deprecated Not injected into Generator (r29). Kept for tests / observe helpers. */
export const NATURAL_INTRO_FORBIDDEN_NARRATION = [
  "公開ページで確認できる",
  "公開ページ上で確認できる",
  "出演している点も特徴です",
  "収録作品数は",
  "作品内容の概要",
  "メーカー／レーベルとして",
  "販売／配信状態は",
  "という特徴を持つキャラクターが登場",
  "の要素も見られます",
  "AVAILABLE",
  "SUPPORTED",
] as const;

/** Internal skeleton avoid tags — not dumped per-slot into Generator (r29). */
export const NATURAL_INTRO_GLOBAL_AVOID = [
  "catalog_metadata_as_body_fuel",
  "db_field_readout_narration",
  "force_use_every_evidence_item",
  "same_quantity_or_duration_restated_across_paragraphs",
  "same_performer_or_identity_restated_across_paragraphs",
  "meta_section_headings_like_作品内容の概要",
  "generic_feature_shell",
  "availability_as_development",
  "maker_only_paragraph",
  "title_restatement_as_development",
  "same_fact_paraphrase_padding",
  "mechanical_evidence_readout",
  "ungrounded_evaluation_only_sentence",
  "series_persona_expanded_as_feature_character_appears",
  "title_label_elevated_to_performer_reputation",
  "title_label_elevated_to_character_trait_evaluation",
  "compress_rich_evidence_to_one_paragraph_for_brevity",
  "shorter_is_better_as_goal",
  "pad_with_empty_connecting_or_evaluation_sentences",
  "reuse_evidence_family_to_fill_length",
] as const;

/** @deprecated Unused at runtime (r28 DEAD). Kept for docs. */
export const OPTION_B_BRAIN_PRIORITIES = [
  "factual_grounding_no_contradiction",
  "no_same_fact_repetition",
  "information_progression_across_paragraphs",
  "reads_as_ordinary_product_intro",
  "not_unnatural_ai_catalog_prose",
] as const;

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
