/**
 * Editorial / Writing Pattern layer (separate from Structure Pattern).
 *
 * Structure Pattern = skeleton (hook → interest → cta_bridge, images, headings)
 * Editorial Pattern  = how to write inside that skeleton (opening, claim pick,
 *                      paragraph advance, transitions, CTA motive, title craft)
 *
 * Never stores competitor prose, quotes, or reusable sentence templates.
 * Categories (not word blacklists) drive avoidance of filler / social proof /
 * generic meta-evaluation / catalog narration.
 */

import type { ArticleStructureFeatures, ArticleWritingFeatures } from "./types.js";

export type EditorialAvoidCategory =
  | "unsupported_social_proof"
  | "generic_meta_evaluation"
  | "non_informational_filler"
  | "catalog_narration"
  | "generic_cta_boilerplate"
  | "full_product_title_copy"
  | "catalog_identity_title";

export type EditorialClaimKind =
  | "trait_or_scene"
  | "performer"
  | "series"
  | "maker"
  | "availability"
  | "identity_name"
  | "temporal_sale"
  | "other";

export type EditorialOpeningContract = {
  strategy: "strongest_concrete_trait" | "factual_identity" | "audience_framing";
  claimPriority: EditorialClaimKind[];
  claimAvoid: EditorialClaimKind[];
  maxOpeningClaims: number;
  preferTraitsEmbeddedInTitleClaims: boolean;
};

export type EditorialDevelopmentContract = {
  strategy: "deepen_interest_with_new_supported_detail";
  eachParagraphMustAdvance: boolean;
  forbidRestatePriorClaims: boolean;
  forbidCatalogMetadataDetour: boolean;
  forbidGenericMetaEvaluation: boolean;
};

export type EditorialInformationSelection = {
  priority: EditorialClaimKind[];
  omitWhenLowValue: EditorialClaimKind[];
  maxClaimsSuggested: number;
};

export type EditorialTransitionContract = {
  style: "advance_interest_to_next_supported_detail";
  requireNewAngleOrFact: boolean;
};

export type EditorialCtaMotivation = {
  strategy: "bridge_from_established_interest";
  allowNewClaims: false;
  reuseEstablishedInterestOnly: true;
};

export type EditorialTitleContract = {
  strategy: "performer_plus_concrete_trait" | "concrete_trait_focus";
  avoidCatalogIdentityOnly: boolean;
  avoidFullProductTitle: boolean;
  preferCuriosityFromSupportedTrait: boolean;
  maxApproxChars: number;
};

export type EditorialToneHints = {
  targetParagraphLength: "short" | "medium" | "mixed";
  catalogStyleMax: "low" | "balanced";
  preferScenarioOrConcreteTrait: boolean;
  lowPerformerNameRepetition: boolean;
};

export type EditorialPattern = {
  patternId: string;
  label: string;
  sampleCount: number;
  sourceObservationIds: string[];
  sourceDomains: string[];
  fingerprint: string;
  opening: EditorialOpeningContract;
  development: EditorialDevelopmentContract;
  informationSelection: EditorialInformationSelection;
  transition: EditorialTransitionContract;
  ctaMotivation: EditorialCtaMotivation;
  title: EditorialTitleContract;
  tone: EditorialToneHints;
  avoidCategories: EditorialAvoidCategory[];
  summaryRole: "list_snippet_not_body_restatement";
};

export type ObservationEditorialInput = {
  id: string;
  sourceDomain: string | null;
  features: ArticleStructureFeatures;
};

function wfOf(f: ArticleStructureFeatures): ArticleWritingFeatures {
  return f.writingFeatures;
}

function rate(xs: boolean[]): number {
  if (xs.length === 0) return 0;
  return xs.filter(Boolean).length / xs.length;
}

function topBucket(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function isSparse(f: ArticleStructureFeatures): boolean {
  return f.headingCount <= 2;
}

/**
 * Build one Editorial Pattern from a cluster of A-rated observations.
 * Only stable majority signals are promoted (not single-article quirks).
 */
export function extractEditorialPatternFromCluster(
  cluster: ObservationEditorialInput[],
  opts?: { patternId?: string; label?: string },
): EditorialPattern | null {
  if (cluster.length === 0) return null;
  const features = cluster.map((c) => c.features);
  const wfs = features.map(wfOf);
  const n = wfs.length;

  const scenarioRate = rate(wfs.map((w) => w.scenarioFramingUsed));
  const curiosityRate = rate(wfs.map((w) => w.curiosityGapUsed));
  const sparseRate = rate(features.map(isSparse));
  const catalogHighRate = rate(wfs.map((w) => w.catalogStyleLevel === "high"));
  const midFactRate = rate(wfs.map((w) => w.productFactPlacement === "mid"));
  const bridgeCtaRate = rate(wfs.map((w) => w.ctaLeadInType === "bridge_from_editorial"));
  const paraShortRate =
    wfs.reduce((acc, w) => acc + (w.paragraphLengthDistribution?.short ?? 0), 0) / n;

  // Prefer concrete-trait opening when sparse/scenario/curiosity dominate —
  // even if introHookType is often "factual" (A samples still open with identity facts).
  const openingStrategy: EditorialOpeningContract["strategy"] =
    curiosityRate >= 0.35 || scenarioRate >= 0.45 || sparseRate >= 0.5
      ? "strongest_concrete_trait"
      : topBucket(wfs.map((w) => w.introHookType)) === "audience_framing"
        ? "audience_framing"
        : "strongest_concrete_trait";

  const preferShort = paraShortRate >= 0.45 || sparseRate >= 0.5;

  const pattern: EditorialPattern = {
    patternId: opts?.patternId ?? `ed_${cluster.length}_${hashShort(cluster.map((c) => c.id).join(","))}`,
    label: opts?.label ?? (sparseRate >= 0.5 ? "sparse_editorial_interest_1" : "editorial_interest_1"),
    sampleCount: cluster.length,
    sourceObservationIds: cluster.map((c) => c.id),
    sourceDomains: [
      ...new Set(cluster.map((c) => c.sourceDomain).filter((d): d is string => Boolean(d))),
    ],
    fingerprint: [
      openingStrategy,
      sparseRate >= 0.5 ? "sparse" : "dense",
      scenarioRate >= 0.45 ? "scenario" : "noscenario",
      catalogHighRate >= 0.5 ? "catalogish" : "balanced",
      bridgeCtaRate >= 0.4 ? "bridge_cta" : "direct_cta",
    ].join("|"),
    opening: {
      strategy: openingStrategy,
      claimPriority: ["trait_or_scene", "performer", "series", "identity_name"],
      claimAvoid: ["maker", "availability", "temporal_sale"],
      maxOpeningClaims: 2,
      preferTraitsEmbeddedInTitleClaims: true,
    },
    development: {
      strategy: "deepen_interest_with_new_supported_detail",
      eachParagraphMustAdvance: true,
      forbidRestatePriorClaims: true,
      forbidCatalogMetadataDetour: true,
      forbidGenericMetaEvaluation: true,
    },
    informationSelection: {
      // Learned bias from A sparse samples: concrete interest first; maker/availability optional omit
      priority: ["trait_or_scene", "performer", "series", "identity_name", "maker"],
      omitWhenLowValue: ["availability", "maker", "temporal_sale"],
      maxClaimsSuggested: sparseRate >= 0.5 ? 4 : 6,
    },
    transition: {
      style: "advance_interest_to_next_supported_detail",
      requireNewAngleOrFact: true,
    },
    ctaMotivation: {
      strategy: "bridge_from_established_interest",
      allowNewClaims: false,
      reuseEstablishedInterestOnly: true,
    },
    title: {
      strategy: "performer_plus_concrete_trait",
      avoidCatalogIdentityOnly: true,
      avoidFullProductTitle: true,
      preferCuriosityFromSupportedTrait: true,
      maxApproxChars: 48,
    },
    tone: {
      targetParagraphLength: preferShort ? "short" : "medium",
      catalogStyleMax: catalogHighRate >= 0.6 ? "balanced" : "low",
      preferScenarioOrConcreteTrait: scenarioRate >= 0.4 || openingStrategy === "strongest_concrete_trait",
      lowPerformerNameRepetition: true,
    },
    avoidCategories: [
      "unsupported_social_proof",
      "generic_meta_evaluation",
      "non_informational_filler",
      "catalog_narration",
      "generic_cta_boilerplate",
      "full_product_title_copy",
      "catalog_identity_title",
    ],
    summaryRole: "list_snippet_not_body_restatement",
  };

  // mid product-fact placement reinforces deferring maker/series until after interest opens
  if (midFactRate >= 0.5) {
    pattern.opening.claimAvoid = [
      ...new Set<EditorialClaimKind>([...pattern.opening.claimAvoid, "maker", "series"]),
    ];
  }

  return pattern;
}

function hashShort(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 6);
}

/**
 * Cluster A observations into editorial patterns (sparse vs multi-heading).
 */
export function clusterEditorialPatterns(
  observations: ObservationEditorialInput[],
): EditorialPattern[] {
  if (observations.length === 0) return [];
  const sparse = observations.filter((o) => isSparse(o.features));
  const dense = observations.filter((o) => !isSparse(o.features));
  const out: EditorialPattern[] = [];

  if (sparse.length > 0) {
    const p = extractEditorialPatternFromCluster(sparse, {
      patternId: `ed_sparse_${hashShort(sparse.map((o) => o.id).join(","))}`,
      label: "sparse_editorial_interest_1",
    });
    if (p) out.push(p);
  }
  if (dense.length >= 2) {
    const p = extractEditorialPatternFromCluster(dense, {
      patternId: `ed_dense_${hashShort(dense.map((o) => o.id).join(","))}`,
      label: "multi_section_editorial_1",
    });
    if (p) out.push(p);
  }
  if (out.length === 0) {
    const p = extractEditorialPatternFromCluster(observations);
    if (p) out.push(p);
  }
  return out;
}

export function selectEditorialPattern(
  patterns: EditorialPattern[],
  opts?: {
    preferSparse?: boolean;
    /** When material is rich, prefer dense/multi_section editorial patterns from reference sites */
    preferDense?: boolean;
    materialDepth?: "scarce" | "standard" | "rich";
  },
): EditorialPattern | null {
  if (patterns.length === 0) return null;
  const depth = opts?.materialDepth;
  const preferDense =
    opts?.preferDense === true || depth === "rich" || opts?.preferSparse === false;
  const preferSparse = !preferDense && opts?.preferSparse !== false;
  const scored = patterns.map((p) => {
    let score = p.sampleCount * 10;
    if (preferSparse && (p.label.includes("sparse") || p.fingerprint.includes("sparse"))) {
      score += 25;
    }
    if (preferDense && (p.label.includes("multi") || p.fingerprint.includes("dense"))) {
      score += 30;
    }
    if (preferDense && p.label.includes("sparse")) score -= 10;
    if (p.opening.strategy === "strongest_concrete_trait") score += 15;
    if (p.fingerprint.includes("scenario")) score += 8;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.p ?? null;
}

/** Prompt-safe contract — categories and strategies only, no competitor prose. */
export function toEditorialPatternPromptContract(
  pattern: EditorialPattern,
): Record<string, unknown> {
  return {
    patternId: pattern.patternId,
    label: pattern.label,
    opening: pattern.opening,
    development: pattern.development,
    informationSelection: pattern.informationSelection,
    transition: pattern.transition,
    ctaMotivation: pattern.ctaMotivation,
    title: pattern.title,
    tone: pattern.tone,
    avoidCategories: pattern.avoidCategories,
    summaryRole: pattern.summaryRole,
    avoidCategoryMeanings: {
      unsupported_social_proof:
        "Do not invent popularity, fame, reputation, or 'known as' prestige without a SUPPORTED claim",
      generic_meta_evaluation:
        "Do not use empty evaluation scaffolding (sales-point / noteworthy / must-see framing without a new concrete fact)",
      non_informational_filler:
        "Do not pad with sentences that add no new SUPPORTED detail or selection angle",
      catalog_narration:
        "Do not narrate DB fields (maker/label/series/availability) as the article's main arc",
      generic_cta_boilerplate:
        "Do not end with generic 'check the page to understand more' — bridge from the interest already established",
      full_product_title_copy: "Do not paste productTitle wholesale into title/seoTitle/lead",
      catalog_identity_title:
        "Do not make title = performer + maker + series only; include a concrete SUPPORTED trait when available",
    },
    instructions: [
      "EDITORIAL PATTERN outranks vague writingPolicy hook preferences when both are present.",
      "OPENING: follow opening.strategy — start from strongest concrete trait/scene (or performer+trait), not maker/series catalog intro.",
      "Use at most opening.maxOpeningClaims new facts in lead; prefer traits embedded in long title-claims without asserting SALE/NEW from title marketing wrappers.",
      "DEVELOPMENT: each paragraph must advance with a new SUPPORTED detail or angle; never restate the prior claim; never detour into catalog metadata.",
      "TRANSITION: move interest forward to the next supported detail — do not rely on empty connective scaffolding alone.",
      "CTA: reuse established interest only; no new claims; no generic boilerplate category.",
      "TITLE: performer + concrete trait when possible; never full productTitle; never catalog-identity-only.",
      "SUMMARY: short list/search snippet — not a body restatement.",
      "Avoid the listed avoidCategories (meanings above). This is category policy, not a banned-word dictionary.",
    ],
  };
}

export function parseEditorialPatterns(raw: unknown): EditorialPattern[] {
  if (!Array.isArray(raw)) return [];
  const out: EditorialPattern[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.patternId !== "string" || !r.opening || !r.development) continue;
    out.push(entry as EditorialPattern);
  }
  return out;
}

/** Fixture detectors for v5-style failures (tests) — category signals, not a ban list. */
export function detectEditorialFailureCategories(text: string): EditorialAvoidCategory[] {
  const hits: EditorialAvoidCategory[] = [];
  if (/人気|有名|として知られ|評判/.test(text)) hits.push("unsupported_social_proof");
  if (/セールスポイント|注目すべき|魅力を活かした|おすすめできる作品/.test(text)) {
    hits.push("generic_meta_evaluation");
  }
  if (/より深く内容を把握|詳細を確認することで/.test(text)) {
    hits.push("generic_cta_boilerplate");
  }
  if (/レーベルの人気シリーズ|メーカー／レーベルとして|配信状態として/.test(text)) {
    hits.push("catalog_narration");
  }
  if (
    /出演、.+シリーズ作品/.test(text) ||
    /出演、.+の「.+」シリーズ/.test(text)
  ) {
    hits.push("catalog_identity_title");
  }
  return [...new Set(hits)];
}
