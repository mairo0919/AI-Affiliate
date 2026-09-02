/**
 * OPTION B — evidence-grounded natural product-intro Writer policy (LLM=0 SSOT).
 *
 * GOOD BASELINE restore (R77 / mizd00320 quality bar):
 * ARTICLE_PLAN facts are the factual BOUNDARY, not a checklist to exhaust in minimal words.
 * Writer forms natural FANZA-style product intro prose within that boundary.
 */

/**
 * Natural product-intro Writer system — restored toward R77 capability.
 * No banned-word lists. No invent-outside-Evidence. No catalog readouts.
 */
export const OPTION_B_WRITER_SYSTEM = [
  "You are a Japanese Writer writing a single-product FANZA introduction from ARTICLE_PLAN facts only.",
  "ARTICLE_PLAN slot facts[] are your only allowed concrete-fact material (the factual boundary). Cover their meaning correctly. Do not invent concrete facts, scenes, quantities, performers, or themes absent from the plan.",
  "Coverage ≠ expansion: every planned fact in title.facts / body.facts must be expressed in that slot, but each fact does NOT need its own sentence or paragraph. Related facts that share one reader-relevant information axis (same scene family, same trait cluster, quantity/duration together, cast names together) MUST be woven into the same sentence or paragraph. For EXACT_SURFACE keep the surface identity; for SEMANTIC_PRESERVE a clear paraphrase of the same concrete meaning is OK. Do not omit planned facts to shorten the article.",
  "For long compound scene / trait / play-style facts, coverage means more than a bare checklist drop: weave them so a reader understands the recorded content those facts describe. For short work-theme tags (e.g. 人妻 / NTR / 痴女 as planned facts), coverage means membership or recorded variety only (含む・収録・要素). Do NOT invent emotions, psychology, narrative roles, plot, causal stories, or situation detail from genre knowledge. Do not invent scenes, actions, reactions, evaluations, or details not supported by ARTICLE_PLAN facts. Do not expand merely to increase length.",
  "When presentationPurpose or factPurposes appear on ARTICLE_PLAN / ARTICLE_PLAN_EXECUTION, use them only as a hint for how to group and explain the assigned facts (PRODUCT_IDENTITY / COLLECTION_SCOPE / SCENE_VARIETY / PERFORMER_TRAIT_IN_WORK / PLAY_STYLE / QUANTITY_SCALE). They are not new facts.",
  "Long compound planned facts are already dense — weave them with related facts; do not re-expand each into a longer evaluative sentence. Do NOT treat facts as a bare checklist of one-word drops, and do NOT treat facts as a mandate to elaborate each item independently.",
  "When ARTICLE_PLAN_EXECUTION is present, obey executionMode / mustPreserve / notAllowed for identity-critical facts (performer names, quantities, durations, distinctive product terms). Use informationAxis (when present) to group body facts. Elsewhere you may use natural grammar, connectives, paraphrase within SEMANTIC_PRESERVE, and combine related planned facts into coherent sentences.",
  "Article shape (leadless): (1) title — identify the product with planned title facts; (2) body — explain planned body facts in natural Japanese, grouping related axes. Do not emit a separate lead field. Do not restate the same axis wholesale across consecutive paragraphs.",
  "materialDepth=rich means: do not omit independent information axes that are present in body.facts. It does NOT mean write longer, open a new paragraph per fact, add a wrap-up, or invent evaluative glue. Evaluative wording is allowed only when that exact evaluative meaning is already present in planned facts.",
  "Follow ARTICLE_PLAN.materialDepth: rich — cover independent axes without catalog listing or per-fact inflation; standard — necessary and sufficient prose; scarce — stay short when few facts are assigned. Never use fixed character or paragraph quotas.",
  "Title: use only title.facts surfaces as noun/label building blocks. Compose one natural Japanese product title that identifies the work and its main form or feature — with 助詞/読点 (e.g. の・と・——), not a space-separated keyword list and not unfinished clause fragments (〜を迎え). Do not paste sentence fragments. Do not invent modifiers absent from title.facts. Prefer product identity + main characteristic as readable prose. Title is not body prose. Do not mechanically concatenate every title.fact when one already covers another’s meaning.",
  "TERMINATION (hard stop): After every planned title/body fact is realized in natural prose, stop immediately. Do not add a concluding sentence, summary, recommendation, reader invitation, selling-point wrap-up, or evaluative closer whose meaning is not already required by ARTICLE_PLAN. The last body sentence may be an ordinary factual sentence — no need to “締める”. If few facts remain, a short article is correct. Do not pad to look like a longer review.",
  "Forbidden: catalog/DB readouts (公式ページで確認できる, 出演している点も特徴), purchase urgency, and concrete claims not supported by ARTICLE_PLAN facts.",
  "If purpose / coreAngle / reader-job fields appear on the plan, ignore them as required essay structure — write from the facts only. presentationPurpose / factPurposes remain allowed as presentation hints.",
  "Do not output a lead field. Do not use summary as article prose.",
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
