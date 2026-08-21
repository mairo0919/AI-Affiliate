/**
 * Article-type-specific Writing Skeletons (abstract HOW only — never stores reference prose).
 */

import type { ReferenceArticleType } from "./reference-article-type.js";
import { NATURAL_PRODUCT_INTRO_STRUCTURE } from "./natural-product-intro-policy.js";

export type ArticleTypeWritingSkeleton = {
  schemaVersion: 1;
  articleType: ReferenceArticleType;
  /** Abstract progression — no copied sentences */
  slots: Array<{
    id: string;
    purpose: string;
    notes: string[];
  }>;
  globalAvoid: string[];
  densityNotes: string[];
  /** Isolation rule */
  doNotApplyTo: ReferenceArticleType[];
};

const SHARED_AVOID = [
  "catalog_metadata_as_body_fuel",
  "db_field_readout_narration",
  "copy_reference_prose",
  "force_use_every_evidence_item",
];

/** Ranking HOW abstracted from osusume.dmm staff ranking pattern (structure only). */
export const RANKING_WRITING_SKELETON: ArticleTypeWritingSkeleton = {
  schemaVersion: 1,
  articleType: "ranking",
  slots: [
    {
      id: "title",
      purpose: "subject_plus_ranking_frame",
      notes: ["Include subject identity + ranking frame (TOP N / 人気), not a single SKU dump."],
    },
    {
      id: "intro",
      purpose: "introduce_subject_then_announce_ranking",
      notes: [
        "Open with who/what the ranking is about.",
        "State that the piece will present ranked works (data/curation frame) without inventing metrics.",
        "Keep intro short — pull reader into the list.",
      ],
    },
    {
      id: "optional_feature_block",
      purpose: "subject_traits_before_list",
      notes: [
        "Optional mid-page block of subject traits / appeal axes before rank entries.",
        "Not required when Evidence is thin.",
      ],
    },
    {
      id: "ranking_entry_loop",
      purpose: "per_rank_product_card",
      notes: [
        "Heading hierarchy: rank + product title as H-level entry.",
        "Per entry: setup (what the work is) → concrete highlight → short takeaway.",
        "Typical entry length: a few short paragraphs — not a full single_product essay.",
        "Show product name clearly in the heading; body may restate identity lightly once.",
        "Optional user-voice / summary bullets after entry — only if Evidence supports.",
        "CTA near each entry (続きを見る / product link) without inventing offers.",
        "Image slot per entry when available — display only, no invented observation.",
        "Tempo: similar density across ranks; clear switch to next rank heading.",
      ],
    },
    {
      id: "rank_transition",
      purpose: "switch_to_next_product",
      notes: ["Use rank heading as the switch — avoid filler bridges between entries."],
    },
    {
      id: "optional_closing",
      purpose: "wrap_or_omit",
      notes: [
        "Closing may restate subject appeal or omit if list already ends cleanly.",
        "Do not invent a grand summary beyond Evidence.",
      ],
    },
  ],
  globalAvoid: [
    ...SHARED_AVOID,
    "apply_single_product_skeleton_to_ranking",
    "pad_entries_to_match_reference_word_count",
    "same_highlight_restated_across_all_ranks",
  ],
  densityNotes: [
    "Ranking = many short product cards, not one long single_product article.",
    "Entry length should stay compact and even across ranks.",
  ],
  doNotApplyTo: ["single_product", "new_release", "recommendation", "comparison", "roundup"],
};

/** Single-product HOW — points at Natural Product Intro (user quality bar). */
export const SINGLE_PRODUCT_WRITING_SKELETON: ArticleTypeWritingSkeleton = {
  schemaVersion: 1,
  articleType: "single_product",
  slots: NATURAL_PRODUCT_INTRO_STRUCTURE.slots.map((s) => ({
    id: s.id,
    purpose: s.purpose,
    notes: [s.note],
  })),
  globalAvoid: [
    ...SHARED_AVOID,
    "apply_ranking_skeleton_to_single_product",
    "force_3_or_4_body_paragraphs",
    "compress_rich_evidence_to_one_paragraph_for_brevity",
    "shorter_is_better_as_goal",
  ],
  densityNotes: [NATURAL_PRODUCT_INTRO_STRUCTURE.densityNote],
  doNotApplyTo: ["ranking", "roundup", "comparison"],
};

const PLACEHOLDER = (articleType: ReferenceArticleType): ArticleTypeWritingSkeleton => ({
  schemaVersion: 1,
  articleType,
  slots: [
    {
      id: "placeholder",
      purpose: "reserved_for_future_type_specific_skeleton",
      notes: ["Not used for current single_product generation."],
    },
  ],
  globalAvoid: [...SHARED_AVOID, "apply_before_type_skeleton_defined"],
  densityNotes: ["Skeleton for this article type is reserved — do not invent."],
  doNotApplyTo: ["single_product", "ranking"],
});

export function writingSkeletonForArticleType(
  articleType: ReferenceArticleType,
): ArticleTypeWritingSkeleton {
  switch (articleType) {
    case "ranking":
      return RANKING_WRITING_SKELETON;
    case "single_product":
      return SINGLE_PRODUCT_WRITING_SKELETON;
    case "roundup":
      return PLACEHOLDER("roundup");
    case "comparison":
      return PLACEHOLDER("comparison");
    case "new_release":
      return PLACEHOLDER("new_release");
    case "recommendation":
      return PLACEHOLDER("recommendation");
  }
}

export function assertSkeletonNotCrossApplied(input: {
  generationArticleType: ReferenceArticleType;
  skeleton: ArticleTypeWritingSkeleton;
}): { ok: boolean; reason: string | null } {
  if (input.skeleton.articleType !== input.generationArticleType) {
    return {
      ok: false,
      reason: `skeleton_type_${input.skeleton.articleType}_incompatible_with_generation_${input.generationArticleType}`,
    };
  }
  if (input.skeleton.doNotApplyTo.includes(input.generationArticleType)) {
    return {
      ok: false,
      reason: `skeleton_explicitly_forbidden_for_${input.generationArticleType}`,
    };
  }
  return { ok: true, reason: null };
}
