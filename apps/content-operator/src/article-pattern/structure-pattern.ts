/**
 * Structure Pattern layer (separate from ArticleFormat + writingPolicy).
 *
 * ArticleFormat  = type-level constraints
 * writingPolicy  = shared prose-quality constraints
 * StructurePattern = narrative flow learned from A-rated articles (how to *read*)
 *
 * Never stores competitor prose, quotes, or reusable sentence templates.
 *
 * Important: Observation.sectionOrder may include "list" whenever any <ul>/<ol>
 * appears in HTML (chrome / related / CTA widgets). That signal alone must NOT
 * become a "catalog attribute dump" generation block.
 */

import type { ArticleStructureFeatures, ArticleWritingFeatures } from "./types.js";

export type StructureImageSlot = "hero" | "auxiliary" | "none";

export type ListPurpose =
  | "none"
  | "interest_cues"
  | "decision_axes"
  | "forbidden_catalog_metadata";

export type StructureBlockGeneration = {
  /** What this block does for the reader */
  readerFunction: string;
  /** How it connects from the previous block */
  transitionFunction: string;
  /** Claim kinds this block may introduce */
  claimKindsPreferred: string[];
  /** Claim kinds this block should avoid introducing */
  claimKindsAvoid: string[];
  maxNewClaims: number;
  forbidRestatePriorClaims: boolean;
  listPurpose: ListPurpose;
  avoidCatalogMetadata: boolean;
  avoidMetaEvaluationPhrases: boolean;
  preferShortParagraphs: boolean;
};

export type StructureBlock = {
  order: number;
  /** Abstract role — not a Japanese heading template */
  role: string;
  approxChars: number;
  paragraphCountHint: number;
  /** If false, fold into continuous prose / lead — do not invent catalog H2 */
  heading: boolean;
  usesList: boolean;
  usesImage: boolean;
  imageSlot: StructureImageSlot;
  /** How claims should be used in this block */
  claimPurpose: string;
  /** When SUPPORTED claims are scarce, omit rather than pad */
  allowOmitIfClaimsScarce: boolean;
  generation: StructureBlockGeneration;
};

export type StructureImageLayout = {
  heroPosition: "before_lead" | "after_lead" | "none";
  auxiliaryPosition: "after_first_section" | "before_cta" | "none";
  preferredImageCount: number;
};

export type StructurePatternConstraints = {
  forbidSummaryRestatement: boolean;
  forbidCatalogDump: boolean;
  preferFewHeadings: boolean;
  maxSections: number;
  forbidCatalogHeadings: boolean;
  /** Do not force consumption of every SUPPORTED claim */
  claimUsage: "selective";
  maxClaimsSuggested: number;
};

export type StructurePattern = {
  patternId: string;
  label: string;
  sampleCount: number;
  sourceObservationIds: string[];
  sourceDomains: string[];
  blocks: StructureBlock[];
  imageLayout: StructureImageLayout;
  constraints: StructurePatternConstraints;
  fingerprint: string;
};

export type ObservationStructureInput = {
  id: string;
  sourceDomain: string | null;
  features: ArticleStructureFeatures;
};

function headingBucket(n: number): string {
  if (n <= 0) return "h0";
  if (n === 1) return "h1";
  if (n <= 3) return "h2_3";
  return "h4plus";
}

function lengthBucket(n: number): string {
  if (n < 900) return "short";
  if (n < 2000) return "medium";
  return "long";
}

function imageCountBucket(n: number): string {
  if (n <= 0) return "i0";
  if (n === 1) return "i1";
  if (n <= 5) return "i2_5";
  return "i6plus";
}

function dominantParaBucket(dist: {
  short: number;
  medium: number;
  long: number;
}): "short" | "medium" | "long" {
  if (dist.long >= dist.medium && dist.long >= dist.short) return "long";
  if (dist.medium >= dist.short) return "medium";
  return "short";
}

function paraCountHint(approxChars: number, paraBucket: "short" | "medium" | "long"): number {
  const avg = paraBucket === "short" ? 45 : paraBucket === "medium" ? 90 : 180;
  return Math.max(1, Math.min(5, Math.round(approxChars / avg)));
}

function hasTopImage(positions: string[], roles: string[]): boolean {
  if (roles.includes("hero") && (positions[0] === "top" || positions.includes("top"))) return true;
  return positions.filter((p) => p === "top").length > 0 && positions[0] === "top";
}

function hasMidImage(positions: string[]): boolean {
  return positions.includes("middle");
}

/**
 * True list-as-narrative only when writing craft signals a criteria/decision list —
 * NOT when sectionOrder merely saw a <ul> (chrome).
 */
function shouldIncludeNarrativeList(wf: ArticleWritingFeatures | undefined): boolean {
  if (!wf) return false;
  if (wf.productDifferentiationStyle === "criteria_based") return true;
  if (wf.ctaContext === "decision_support" && wf.sectionPurposeSequence.includes("selection_criteria")) {
    return true;
  }
  return false;
}

function makeGeneration(partial: StructureBlockGeneration): StructureBlockGeneration {
  return partial;
}

/**
 * Build narrative blocks from observation features (no prose).
 * Sparse A articles (sadist-like): hook → interest_development → cta_bridge
 * (no catalog list dump).
 */
export function extractStructureBlocksFromFeatures(
  features: ArticleStructureFeatures,
): {
  blocks: StructureBlock[];
  imageLayout: StructureImageLayout;
  fingerprint: string;
  constraints: StructurePatternConstraints;
} {
  const wf = features.writingFeatures;
  const paraBucket = dominantParaBucket(
    wf?.paragraphLengthDistribution ?? { short: 0.3, medium: 0.4, long: 0.3 },
  );
  const total = Math.max(200, features.totalLength || 800);
  const introLenRaw = features.introLength || 0;
  // Observation introLength can be tiny (title-only scrape); use a floor for generation hints
  const introLen =
    introLenRaw >= 40
      ? introLenRaw
      : Math.min(140, Math.max(60, Math.round(total * (fewHeadingsRatio(features) ? 0.12 : 0.18))));
  const fewHeadings = features.headingCount <= 2;
  const scenario = Boolean(wf?.scenarioFramingUsed);
  const criteriaList = shouldIncludeNarrativeList(wf);
  const productFactMid = (wf?.productFactPlacement ?? "mid") !== "early";
  const preferShort = paraBucket === "short" || (wf?.paragraphLengthDistribution?.short ?? 0) >= 0.5;
  const ctaBridgeStyle =
    wf?.ctaLeadInType === "bridge_from_editorial" ? "bridge_from_editorial" : "direct";
  const topImg = hasTopImage(features.imagePositions, features.imageRoles);
  const midImg = hasMidImage(features.imagePositions);
  const preferredImageCount = Math.min(
    2,
    Math.max(features.imageCount > 0 ? 1 : 0, features.imageRoles.includes("hero") ? 1 : 0),
  );

  const blocks: StructureBlock[] = [];
  let order = 1;

  // 1) Hook — strongest interest driver only (not full catalog)
  blocks.push({
    order: order++,
    role: "hook",
    approxChars: Math.min(160, Math.max(60, introLen)),
    paragraphCountHint: preferShort ? 1 : 2,
    heading: false,
    usesList: false,
    usesImage: topImg && preferredImageCount > 0,
    imageSlot: topImg ? "hero" : "none",
    claimPurpose: "strongest_interest_driver",
    allowOmitIfClaimsScarce: false,
    generation: makeGeneration({
      readerFunction: "open_with_the_single_most_interesting_confirmed_trait_or_identity",
      transitionFunction: "none_start",
      claimKindsPreferred: ["trait_or_scene", "performer", "identity_name"],
      claimKindsAvoid: ["availability", "maker", "temporal_sale"],
      maxNewClaims: 2,
      forbidRestatePriorClaims: true,
      listPurpose: "none",
      avoidCatalogMetadata: true,
      avoidMetaEvaluationPhrases: true,
      preferShortParagraphs: preferShort,
    }),
  });

  // 2) Interest development — scene/traits with meaning (not DB field readout)
  const developChars = Math.max(
    180,
    Math.round(total * (fewHeadings ? 0.55 : 0.4) - introLen * 0.3),
  );
  blocks.push({
    order: order++,
    role: "interest_development",
    approxChars: Math.min(900, developChars),
    paragraphCountHint: paraCountHint(developChars, preferShort ? "short" : paraBucket),
    heading: !fewHeadings && features.headingCount >= 3,
    usesList: false,
    usesImage: Boolean(midImg && !topImg),
    imageSlot: midImg && !topImg ? "hero" : "none",
    claimPurpose: "develop_interest_from_traits",
    allowOmitIfClaimsScarce: false,
    generation: makeGeneration({
      readerFunction: scenario
        ? "carry_reader_through_what_happens_from_evidence"
        : "develop_confirmed_differentiator_without_catalog_readout",
      transitionFunction: "deepen_hook_without_repeating_it",
      claimKindsPreferred: productFactMid
        ? ["trait_or_scene", "performer", "series"]
        : ["trait_or_scene", "performer", "series", "maker"],
      claimKindsAvoid: ["availability"],
      maxNewClaims: 3,
      forbidRestatePriorClaims: true,
      listPurpose: "none",
      avoidCatalogMetadata: true,
      avoidMetaEvaluationPhrases: true,
      preferShortParagraphs: preferShort,
    }),
  });

  // 3) Optional decision/interest cues list — NEVER catalog metadata dump
  if (criteriaList) {
    blocks.push({
      order: order++,
      role: "cue_list",
      approxChars: 120,
      paragraphCountHint: 0,
      heading: false,
      usesList: true,
      usesImage: false,
      imageSlot: "none",
      claimPurpose: "new_selection_cues_only",
      allowOmitIfClaimsScarce: true,
      generation: makeGeneration({
        readerFunction: "add_compact_NEW_selection_cues_not_already_stated_in_prose",
        transitionFunction: "compress_axes_without_restating_paragraphs",
        claimKindsPreferred: ["trait_or_scene"],
        claimKindsAvoid: ["availability", "maker", "identity_name"],
        maxNewClaims: 2,
        forbidRestatePriorClaims: true,
        listPurpose: "decision_axes",
        avoidCatalogMetadata: true,
        avoidMetaEvaluationPhrases: true,
        preferShortParagraphs: true,
      }),
    });
  }

  // 4) CTA bridge — click motive from established interest (not feature re-summary)
  blocks.push({
    order: order++,
    role: "cta_bridge",
    approxChars: ctaBridgeStyle === "bridge_from_editorial" ? 100 : 70,
    paragraphCountHint: 1,
    heading: false,
    usesList: false,
    usesImage: false,
    imageSlot: "none",
    claimPurpose: "cta_motive",
    allowOmitIfClaimsScarce: true,
    generation: makeGeneration({
      readerFunction: "bridge_from_established_interest_to_checking_the_product_page",
      transitionFunction:
        ctaBridgeStyle === "bridge_from_editorial"
          ? "bridge_from_editorial_without_restating_all_traits"
          : "direct_invite_to_verify_on_product_page",
      claimKindsPreferred: [],
      claimKindsAvoid: ["availability", "maker", "series", "trait_or_scene", "performer"],
      maxNewClaims: 0,
      forbidRestatePriorClaims: true,
      listPurpose: "none",
      avoidCatalogMetadata: true,
      avoidMetaEvaluationPhrases: true,
      preferShortParagraphs: true,
    }),
  });

  const imageLayout: StructureImageLayout = {
    heroPosition:
      preferredImageCount === 0 ? "none" : topImg ? "before_lead" : midImg ? "after_lead" : "before_lead",
    auxiliaryPosition:
      preferredImageCount >= 2 ? "after_first_section" : features.imageCount >= 6 ? "before_cta" : "none",
    preferredImageCount,
  };

  const fingerprint = [
    headingBucket(features.headingCount),
    lengthBucket(total),
    imageCountBucket(features.imageCount),
    imageLayout.heroPosition,
    scenario ? "scenario" : "noscenario",
    criteriaList ? "cuelist" : "nocuelist",
    wf?.productFactPlacement ?? "mid",
    ctaBridgeStyle,
    preferShort ? "shortpara" : "longpara",
  ].join("|");

  const maxClaimsSuggested = fewHeadings ? 4 : 6;

  return {
    blocks,
    imageLayout,
    fingerprint,
    constraints: {
      forbidSummaryRestatement: true,
      forbidCatalogDump: true,
      preferFewHeadings: fewHeadings,
      maxSections: blocks.length,
      forbidCatalogHeadings: true,
      claimUsage: "selective",
      maxClaimsSuggested,
    },
  };
}

function fewHeadingsRatio(features: ArticleStructureFeatures): boolean {
  return features.headingCount <= 2;
}

export function fingerprintSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const pa = a.split("|");
  const pb = b.split("|");
  const n = Math.max(pa.length, pb.length);
  let hit = 0;
  for (let i = 0; i < n; i++) {
    if (pa[i] && pa[i] === pb[i]) hit += 1;
  }
  return hit / n;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1]! + s[mid]!) / 2) : s[mid]!;
}

function mergeStringLists(lists: string[][]): string[] {
  const freq = new Map<string, number>();
  for (const list of lists) {
    for (const item of [...new Set(list)]) {
      freq.set(item, (freq.get(item) ?? 0) + 1);
    }
  }
  const threshold = Math.max(1, Math.ceil(lists.length / 2));
  return [...freq.entries()].filter(([, n]) => n >= threshold).map(([k]) => k);
}

function mergeGeneration(samples: StructureBlockGeneration[]): StructureBlockGeneration {
  const listPurposeFreq = new Map<ListPurpose, number>();
  for (const g of samples) {
    listPurposeFreq.set(g.listPurpose, (listPurposeFreq.get(g.listPurpose) ?? 0) + 1);
  }
  const listPurpose = [...listPurposeFreq.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  return {
    readerFunction: samples[0]!.readerFunction,
    transitionFunction: samples[0]!.transitionFunction,
    claimKindsPreferred: mergeStringLists(samples.map((g) => g.claimKindsPreferred)),
    claimKindsAvoid: mergeStringLists(samples.map((g) => g.claimKindsAvoid)),
    maxNewClaims: median(samples.map((g) => g.maxNewClaims)),
    forbidRestatePriorClaims: samples.filter((g) => g.forbidRestatePriorClaims).length >= samples.length / 2,
    listPurpose,
    avoidCatalogMetadata: samples.filter((g) => g.avoidCatalogMetadata).length >= samples.length / 2,
    avoidMetaEvaluationPhrases:
      samples.filter((g) => g.avoidMetaEvaluationPhrases).length >= samples.length / 2,
    preferShortParagraphs: samples.filter((g) => g.preferShortParagraphs).length >= samples.length / 2,
  };
}

function defaultGenerationForRole(role: string): StructureBlockGeneration {
  if (role === "cta_bridge") {
    return makeGeneration({
      readerFunction: "bridge_from_established_interest_to_checking_the_product_page",
      transitionFunction: "direct_invite_to_verify_on_product_page",
      claimKindsPreferred: [],
      claimKindsAvoid: ["availability", "maker", "series", "trait_or_scene", "performer"],
      maxNewClaims: 0,
      forbidRestatePriorClaims: true,
      listPurpose: "none",
      avoidCatalogMetadata: true,
      avoidMetaEvaluationPhrases: true,
      preferShortParagraphs: true,
    });
  }
  return makeGeneration({
    readerFunction: "develop_confirmed_differentiator_without_catalog_readout",
    transitionFunction: "deepen_hook_without_repeating_it",
    claimKindsPreferred: ["trait_or_scene", "performer"],
    claimKindsAvoid: ["availability"],
    maxNewClaims: 2,
    forbidRestatePriorClaims: true,
    listPurpose: "none",
    avoidCatalogMetadata: true,
    avoidMetaEvaluationPhrases: true,
    preferShortParagraphs: true,
  });
}

function mergeBlocks(samples: StructureBlock[][]): StructureBlock[] {
  const maxLen = Math.max(...samples.map((s) => s.length));
  const out: StructureBlock[] = [];
  for (let i = 0; i < maxLen; i++) {
    const at = samples.map((s) => s[i]).filter(Boolean) as StructureBlock[];
    if (at.length === 0) continue;
    const roleFreq = new Map<string, number>();
    for (const b of at) roleFreq.set(b.role, (roleFreq.get(b.role) ?? 0) + 1);
    const role = [...roleFreq.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    // Drop chrome-era list_attributes if somehow present
    if (role === "list_attributes") continue;
    const headingRate = at.filter((b) => b.heading).length / at.length;
    const listRate = at.filter((b) => b.usesList).length / at.length;
    const imgRate = at.filter((b) => b.usesImage).length / at.length;
    const omitRate = at.filter((b) => b.allowOmitIfClaimsScarce).length / at.length;
    const gens = at.map((b) => b.generation).filter(Boolean);
    const next: StructureBlock = {
      order: i + 1,
      role,
      approxChars: median(at.map((b) => b.approxChars)),
      paragraphCountHint: median(at.map((b) => b.paragraphCountHint)),
      heading: headingRate >= 0.5,
      usesList: listRate >= 0.5,
      usesImage: imgRate >= 0.4,
      imageSlot: imgRate >= 0.4 ? (at.find((b) => b.imageSlot !== "none")?.imageSlot ?? "none") : "none",
      claimPurpose: at[0]!.claimPurpose,
      allowOmitIfClaimsScarce: omitRate >= 0.5,
      generation: gens.length ? mergeGeneration(gens) : defaultGenerationForRole(role),
    };
    const prev = out[out.length - 1];
    if (prev && prev.role === next.role) continue;
    out.push(next);
  }
  const nonCta = out.filter((b) => b.role !== "cta_bridge");
  const merged = out.some((b) => b.role === "cta_bridge")
    ? [
        ...nonCta,
        {
          order: nonCta.length + 1,
          role: "cta_bridge",
          approxChars: 80,
          paragraphCountHint: 1,
          heading: false,
          usesList: false,
          usesImage: false,
          imageSlot: "none" as StructureImageSlot,
          claimPurpose: "cta_motive",
          allowOmitIfClaimsScarce: true,
          generation: defaultGenerationForRole("cta_bridge"),
        },
      ]
    : out;
  merged.forEach((b, idx) => {
    b.order = idx + 1;
  });
  return merged;
}

function mergeImageLayouts(layouts: StructureImageLayout[]): StructureImageLayout {
  const heroFreq = new Map<string, number>();
  const auxFreq = new Map<string, number>();
  for (const l of layouts) {
    heroFreq.set(l.heroPosition, (heroFreq.get(l.heroPosition) ?? 0) + 1);
    auxFreq.set(l.auxiliaryPosition, (auxFreq.get(l.auxiliaryPosition) ?? 0) + 1);
  }
  return {
    heroPosition: ([...heroFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      "before_lead") as StructureImageLayout["heroPosition"],
    auxiliaryPosition: ([...auxFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      "none") as StructureImageLayout["auxiliaryPosition"],
    preferredImageCount: Math.max(1, median(layouts.map((l) => l.preferredImageCount)) || 1),
  };
}

export function clusterStructurePatterns(
  observations: ObservationStructureInput[],
  options?: { minSimilarity?: number; maxPatterns?: number },
): StructurePattern[] {
  const minSim = options?.minSimilarity ?? 0.75;
  const maxPatterns = options?.maxPatterns ?? 4;
  if (observations.length === 0) return [];

  type Item = {
    obs: ObservationStructureInput;
    extracted: ReturnType<typeof extractStructureBlocksFromFeatures>;
  };
  const items: Item[] = observations.map((obs) => ({
    obs,
    extracted: extractStructureBlocksFromFeatures(obs.features),
  }));

  const clusters: Item[][] = [];
  for (const item of items) {
    let bestIdx = -1;
    let bestSim = 0;
    for (let i = 0; i < clusters.length; i++) {
      const rep = clusters[i]![0]!;
      const sim = fingerprintSimilarity(item.extracted.fingerprint, rep.extracted.fingerprint);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestSim >= minSim) {
      clusters[bestIdx]!.push(item);
    } else if (clusters.length < maxPatterns) {
      clusters.push([item]);
    } else {
      clusters[bestIdx >= 0 ? bestIdx : 0]!.push(item);
    }
  }

  return clusters.map((cluster, idx) => {
    const blocks = mergeBlocks(cluster.map((c) => c.extracted.blocks));
    const imageLayout = mergeImageLayouts(cluster.map((c) => c.extracted.imageLayout));
    const preferFew =
      cluster.filter((c) => c.extracted.constraints.preferFewHeadings).length >= cluster.length / 2;
    const maxClaimsSuggested = median(
      cluster.map((c) => c.extracted.constraints.maxClaimsSuggested),
    );
    const domains = [...new Set(cluster.map((c) => c.obs.sourceDomain).filter(Boolean))] as string[];
    const ids = cluster.map((c) => c.obs.id);
    const hasCue = blocks.some((b) => b.role === "cue_list");
    const label = preferFew
      ? hasCue
        ? `sparse_interest_with_cues_${idx + 1}`
        : `sparse_interest_flow_${idx + 1}`
      : `multi_section_interest_flow_${idx + 1}`;
    const fingerprint = cluster[0]!.extracted.fingerprint;
    return {
      patternId: `sp_${idx + 1}_${hashShort(fingerprint + ids.join(","))}`,
      label,
      sampleCount: cluster.length,
      sourceObservationIds: ids,
      sourceDomains: domains,
      blocks,
      imageLayout,
      constraints: {
        forbidSummaryRestatement: true,
        forbidCatalogDump: true,
        preferFewHeadings: preferFew,
        maxSections: blocks.length,
        forbidCatalogHeadings: true,
        claimUsage: "selective",
        maxClaimsSuggested: Math.max(3, maxClaimsSuggested || 4),
      },
      fingerprint,
    };
  });
}

function hashShort(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 8);
}

export function selectStructurePattern(
  patterns: StructurePattern[],
  options?: { claimCount?: number; preferFewHeadings?: boolean },
): StructurePattern | null {
  if (!patterns.length) return null;
  const claimCount = options?.claimCount ?? 6;
  const preferFew = options?.preferFewHeadings ?? claimCount < 8;

  const scored = patterns.map((p) => {
    let score = p.sampleCount * 10;
    if (preferFew && p.constraints.preferFewHeadings) score += 25;
    if (!preferFew && !p.constraints.preferFewHeadings) score += 10;
    // Prefer narrative interest_development over legacy catalog list patterns
    if (p.blocks.some((b) => b.role === "interest_development")) score += 15;
    if (p.blocks.some((b) => b.role === "list_attributes")) score -= 20;
    if (claimCount <= 3) score += Math.max(0, 8 - p.blocks.length) * 3;
    if (p.imageLayout.preferredImageCount > 0) score += 5;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.p ?? null;
}

/** Prompt-safe contract (no observation prose). */
export function toStructurePatternPromptContract(pattern: StructurePattern): Record<string, unknown> {
  // Article Output Contract (inline): hook→lead; other roles→sections[]. Do not confuse
  // constraints.maxSections (narrative block count) with article.sections length.
  const sectionSlots = pattern.blocks
    .filter((b) => b.role !== "hook")
    .map((b) => ({
      role: b.role,
      headingRequired: b.heading,
      optional: b.allowOmitIfClaimsScarce === true,
      usesList: b.usesList,
    }));
  const maxArticleSections = sectionSlots.length;
  const minArticleSections = Math.max(
    1,
    sectionSlots.filter((s) => !s.optional).length,
  );
  const articleOutputContract = {
    leadTarget: "lead" as const,
    leadFromRole: pattern.blocks.some((b) => b.role === "hook") ? "hook" : null,
    sectionRoles: sectionSlots.map((s) => s.role),
    expectedMinSections: minArticleSections,
    expectedMaxSections: maxArticleSections,
    headingRequirements: sectionSlots.map((s) => s.headingRequired),
    ctaTarget: "cta" as const,
    maxNarrativeBlocks: pattern.blocks.length,
    note: "expectedMaxSections bounds article.sections[]. Do NOT emit one section per narrative block. hook→lead; cta_bridge→section; article.cta is the link widget only. constraints.maxSections is narrative-block-oriented legacy naming — obey expectedMaxSections.",
  };

  return {
    patternId: pattern.patternId,
    label: pattern.label,
    claimUsage: pattern.constraints.claimUsage,
    maxClaimsSuggested: pattern.constraints.maxClaimsSuggested,
    maxNarrativeBlocks: pattern.blocks.length,
    articleOutputContract,
    blocks: pattern.blocks.map((b) => ({
      order: b.order,
      role: b.role,
      approxChars: b.approxChars,
      paragraphCountHint: b.paragraphCountHint,
      heading: b.heading,
      usesList: b.usesList,
      usesImage: b.usesImage,
      imageSlot: b.imageSlot,
      claimPurpose: b.claimPurpose,
      allowOmitIfClaimsScarce: b.allowOmitIfClaimsScarce,
      generation: b.generation,
      articleTarget: b.role === "hook" ? "lead" : "section",
    })),
    imageLayout: pattern.imageLayout,
    constraints: {
      ...pattern.constraints,
      maxArticleSections,
    },
    instructions: [
      "Follow blocks in ascending order as narrative flow (not a catalog outline).",
      `OUTPUT MAPPING: hook → lead; section roles → sections[] (${sectionSlots.map((s) => s.role).join(" → ") || "none"}); article.cta is the link widget only.`,
      `expectedSections: min=${minArticleSections} max=${maxArticleSections}. Never emit more than ${maxArticleSections} sections.`,
      "cta_bridge → a section with bridge prose (or omit when allowOmitIfClaimsScarce); never invent an extra section for hook.",
      "heading=false → section.heading=null (never \"\"); continuous prose / lead.",
      "heading=true → non-empty natural Japanese heading (never catalog labels).",
      "Do NOT invent headings like 作品の特徴と出演者 / 制作と配信情報 / 基本情報まとめ / 選択のポイント.",
      "Do NOT end with まとめ that restates claims.",
      "Do NOT mirror paragraphs into lists. If listPurpose is none, lists must be [].",
      "listPurpose=decision_axes|interest_cues → short NEW cues only; never 出演者/レーベル/シリーズ/配信状態 metadata dumps.",
      "listPurpose=forbidden_catalog_metadata → never emit such a list.",
      "avoidCatalogMetadata / avoidMetaEvaluationPhrases: no DB readout paragraphs; no 「選択のポイントとなる」-style meta evaluation.",
      "forbidRestatePriorClaims: each fact once across the article.",
      "SUPPORTED claims are permissions, not obligations — use only what the blocks need (see selectedClaims).",
      "Never reuse competitor wording — only this abstract structure is provided.",
    ],
  };
}

export function parseStructurePatterns(raw: unknown): StructurePattern[] {
  if (!Array.isArray(raw)) return [];
  const out: StructurePattern[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    if (!Array.isArray(r.blocks) || typeof r.patternId !== "string") continue;
    // Skip legacy patterns that still center on list_attributes catalog dumps
    const blocks = r.blocks as StructureBlock[];
    const legacyCatalogList =
      blocks.some((b) => b?.role === "list_attributes") &&
      !blocks.some((b) => b?.role === "interest_development");
    if (legacyCatalogList) continue;
    out.push(entry as StructurePattern);
  }
  return out;
}
