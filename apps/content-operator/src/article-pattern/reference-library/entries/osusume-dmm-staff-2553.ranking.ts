/**
 * Reference Library entry: FANZAみんおす 松本いちか人気・名作AVトップ10
 * Source: https://osusume.dmm.co.jp/articles/staff/2553/
 * Article type: ranking
 *
 * ABSTRACT ONLY — no copied body sentences from the source article.
 * Must NOT be applied to single_product generation.
 */

import type { ReferenceLibraryEntry } from "../../reference-library-types.js";
import { RANKING_WRITING_SKELETON } from "../../article-type-writing-skeleton.js";

export const REF_OSUSUME_DMM_STAFF_2553: ReferenceLibraryEntry = {
  schemaVersion: 1,
  referenceId: "osusume.dmm.co.jp/articles/staff/2553",
  sourceUrl: "https://osusume.dmm.co.jp/articles/staff/2553/",
  articleType: "ranking",
  titleObserved: "松本いちかの人気・名作AVトップ10【2025年06月更新】",
  learnedAbstract: {
    overallStructure: [
      "title_with_subject_and_ranking_frame",
      "short_subject_intro",
      "announce_ranking_purpose",
      "optional_subject_feature_block_with_subheads",
      "ranked_product_entries_1_to_n",
      "optional_light_closing_or_end_on_last_entry",
    ],
    introPattern: [
      "open_with_subject_identity_and_appeal_axes",
      "state_article_will_present_ranked_works",
      "keep_intro_short_then_enter_list",
    ],
    rankingEntryPattern: [
      "rank_heading_plus_full_product_title",
      "short_setup_what_the_work_is",
      "one_or_two_concrete_highlights",
      "brief_takeaway_line",
      "optional_user_voice_bullets",
      "inline_cta_continue_or_product_link",
    ],
    headingHierarchy: [
      "H1_article_title",
      "H2_feature_block_or_ranking_section",
      "H3_feature_axes_optional",
      "H3_or_H2_rank_N_plus_product_title",
    ],
    tempoNotes: [
      "similar_compact_length_per_rank_entry",
      "clear_break_at_next_rank_heading",
      "avoid_long_single_product_essays_inside_each_rank",
    ],
    productNamePresentation: [
      "product_title_in_rank_heading",
      "identity_restated_lightly_in_first_entry_sentence",
    ],
    featureToHighlightFlow: [
      "setup_situation_or_form",
      "concrete_scene_or_volume_highlight",
      "short_why_it_stands_in_the_list",
    ],
    ctaPlacement: [
      "near_each_rank_entry",
      "label_like_continue_reading_or_product_detail",
      "no_invented_discount_claims",
    ],
    imagePlacement: [
      "visual_slot_per_entry_when_available",
      "images_are_display_only_not_evidence_unless_observed",
    ],
    rankTransition: [
      "next_rank_heading_is_the_switch",
      "no_filler_bridge_paragraphs_between_ranks",
    ],
    closingRole: [
      "optional_or_omit",
      "list_may_end_on_final_rank_without_grand_summary",
    ],
    readerPullMechanisms: [
      "numbered_rank_curiosity",
      "compact_highlights_per_entry",
      "consistent_tempo_encourages_scrolling",
    ],
    catalogNarrationAvoidance: [
      "do_not_read_out_maker_availability_fields_as_paragraphs",
      "prefer_concrete_work_highlights_over_page_confirmation_shells",
    ],
  },
  writingSkeleton: RANKING_WRITING_SKELETON,
  applicableGenerationTypes: ["ranking"],
  ingestedAt: "2026-07-27T00:00:00.000Z",
  notes: [
    "Fetched once for structure learning; prose not stored.",
    "Do not apply this skeleton to single_product / Natural Product Intro generation.",
    "Future ranking generation should select ranking Reference + ranking Evidence Pack + this skeleton family.",
  ],
};
