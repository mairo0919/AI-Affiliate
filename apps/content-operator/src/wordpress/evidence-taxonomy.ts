/**
 * Derive WordPress categories / tags / performers / series from evidence labels.
 * Provider-agnostic: operates on normalized Research/Evidence labels + title text.
 * Never invents performers, official series, or categories without matching evidence.
 */

import { extractAdultAttributeTags } from "./adult-taxonomy.js";
import { ADULT_TAXONOMY_DICTIONARY } from "./adult-taxonomy-dictionary.js";

export type EvidenceTaxonomyLabel = {
  type: string;
  name: string;
};

export type DerivedWordPressTaxonomy = {
  performers: string[];
  /** Official + semantic series groups (may be multiple). */
  seriesNames: string[];
  /** First series for backward-compatible callers. */
  seriesName: string | null;
  categories: string[];
  tags: string[];
  /** Set when no evidence-backed category could be derived. */
  categoryFallbackUsed: boolean;
  notes: string[];
};

/** Form / format descriptors allowed as tags only when present in evidence text. */
const EVIDENCE_TAG_TOKENS = [
  "ベスト",
  "総集編",
  "8時間",
  "4時間",
  "12タイトル",
  "VR",
  "単体作品",
  "企画",
  "デビュー",
  "完全版",
] as const;

/**
 * Map evidence genre/title tokens → WP category display names.
 * Only applied when the match string appears in evidence (genre name or title).
 */
const CATEGORY_EVIDENCE_RULES: Array<{ needle: RegExp; category: string }> = [
  { needle: /ベスト|総集編|\bBEST\b/i, category: "ベスト・総集編" },
  { needle: /(?:^|[\s\u3000/／])VR(?:$|[\s\u3000/／])|ＶＲ|\bVR\b/, category: "VR" },
  { needle: /単体作品/, category: "単体作品" },
  { needle: /企画/, category: "企画" },
];

/**
 * Semantic series groupings — only when evidence strongly indicates a work-group axis.
 * Synonyms collapse to one canonical series display name (no BEST/ベスト duplicate terms).
 */
const SEMANTIC_SERIES_RULES: Array<{ needle: RegExp; series: string }> = [
  {
    // BEST / ベスト / 総集編 / ベスト盤 / 長時間BEST — meaningful compilation grouping
    needle: /長時間\s*BEST|長時間ベスト|ベスト盤|ベストコレクション|総集編|\bBEST\b|ベスト/i,
    series: "ベスト・総集編",
  },
  {
    needle: /デビュー作|Debut\s*Work|\bDEBUT\b|デビュー記念|デビュー/i,
    series: "デビュー作",
  },
  {
    needle: /\d+\s*周年記念|\d+\s*周年|周年記念/,
    series: "周年記念",
  },
  {
    needle: /完全版|Complete\s*Edition|\bCOMPLETE\b/i,
    series: "完全版",
  },
];

/**
 * When no category rule matches but we still have a product article with actress/genre
 * evidence, use this single non-Uncategorized fallback (explicit policy).
 */
export const PRODUCT_ARTICLE_CATEGORY_FALLBACK = "作品紹介";

export function uniqPreserve(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = name.replace(/\s+/g, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function labelsOfType(labels: EvidenceTaxonomyLabel[], type: string): string[] {
  const t = type.toLowerCase();
  return labels
    .filter((l) => l.type.trim().toLowerCase() === t && l.name.trim())
    .map((l) => l.name.trim());
}

function evidenceBlob(labels: EvidenceTaxonomyLabel[], title: string, subtitle?: string | null): string {
  return `${title}\n${subtitle ?? ""}\n${labels.map((l) => l.name).join("\n")}`;
}

/**
 * Normalize synonym-heavy series/category display names to a single canonical form.
 */
export function normalizeTaxonomyDisplayName(name: string): string {
  const t = name.replace(/\s+/g, " ").trim();
  if (!t) return t;
  const compact = t.replace(/\s+/g, "").toLowerCase();
  if (/^(best|ベスト|ベスト盤|総集編|ベスト総集編|ベスト・総集編)$/i.test(compact) || /ベスト|総集編|best/i.test(t)) {
    if (/ベスト|総集編|best/i.test(t) && !/デビュー|vr|単体|企画|完全|周年/i.test(t)) {
      // Only collapse pure best/compilation synonyms — keep "エスワン" etc.
      if (/^(best|ベスト|ベスト盤|総集編|ベスト総集編|ベスト・総集編|best盤)$/i.test(compact)) {
        return "ベスト・総集編";
      }
    }
  }
  if (/^(debut|デビュー|デビュー作|debutwork)$/i.test(compact)) return "デビュー作";
  if (/^(完全版|complete|completeedition)$/i.test(compact)) return "完全版";
  if (/周年/.test(t)) return "周年記念";
  return t;
}

/**
 * Derive series list: official series labels first, then semantic groupings from title/evidence.
 */
export function deriveSeriesNamesFromEvidence(input: {
  labels: EvidenceTaxonomyLabel[];
  title?: string | null;
  subtitle?: string | null;
  extraSeriesNames?: string[] | null;
}): string[] {
  const title = input.title?.trim() ?? "";
  const subtitle = input.subtitle?.trim() ?? "";
  const labels = input.labels.filter((l) => l.name?.trim());
  const blob = evidenceBlob(labels, title, subtitle);

  const official = [
    ...labelsOfType(labels, "series"),
    ...(input.extraSeriesNames ?? []),
  ].map(normalizeTaxonomyDisplayName);

  const semantic: string[] = [];
  for (const rule of SEMANTIC_SERIES_RULES) {
    if (rule.needle.test(blob)) {
      semantic.push(rule.series);
    }
  }

  // Official names that are themselves best/debut synonyms collapse via normalize.
  return uniqPreserve([...official, ...semantic]);
}

/**
 * Derive taxonomy attach lists from ResearchTag-like labels + title.
 * Independent of AffiliateProvider — any provider that normalizes into labels works.
 */
export function deriveWordPressTaxonomyFromEvidence(input: {
  labels: EvidenceTaxonomyLabel[];
  title?: string | null;
  subtitle?: string | null;
  /** Official product description (Evidence SSOT). */
  officialDescription?: string | null;
  /** Extra performer names already attested (e.g. structuredContent). */
  extraPerformers?: string[] | null;
  /** Extra official series name(s) already attested. */
  extraSeriesName?: string | null;
  extraSeriesNames?: string[] | null;
  allowCategoryFallback?: boolean;
  /**
   * When true (default), do not mirror performer names into tags —
   * performer taxonomy is SSOT for "who"; tags are for "what kind of work".
   */
  excludePerformersFromTags?: boolean;
}): DerivedWordPressTaxonomy {
  const notes: string[] = [];
  const title = input.title?.trim() ?? "";
  const subtitle = input.subtitle?.trim() ?? "";
  const labels = input.labels.filter((l) => l.name?.trim());

  const performers = uniqPreserve([
    ...labelsOfType(labels, "actress"),
    ...labelsOfType(labels, "performer"),
    ...(input.extraPerformers ?? []),
  ]);

  const seriesNames = deriveSeriesNamesFromEvidence({
    labels,
    title,
    subtitle,
    extraSeriesNames: [
      ...(input.extraSeriesNames ?? []),
      ...(input.extraSeriesName?.trim() ? [input.extraSeriesName.trim()] : []),
    ],
  });

  const genres = [
    ...labelsOfType(labels, "genre"),
    ...labelsOfType(labels, "category"),
  ];
  const blob = evidenceBlob(labels, title, subtitle);

  const categories: string[] = [];
  for (const rule of CATEGORY_EVIDENCE_RULES) {
    if (rule.needle.test(blob) || genres.some((g) => rule.needle.test(g))) {
      categories.push(rule.category);
    }
  }

  let categoryFallbackUsed = false;
  const uniqueCategories = uniqPreserve(categories);
  if (uniqueCategories.length === 0 && input.allowCategoryFallback !== false) {
    if (performers.length > 0 || genres.length > 0 || title.length > 0) {
      uniqueCategories.push(PRODUCT_ARTICLE_CATEGORY_FALLBACK);
      categoryFallbackUsed = true;
      notes.push("category_fallback_作品紹介");
    }
  }

  const makers = [
    ...labelsOfType(labels, "maker"),
    ...labelsOfType(labels, "label"),
  ];

  // Adult attribute tags from genre / title / description (dictionary-backed).
  const attributeLabels = [
    ...labelsOfType(labels, "attribute"),
    ...labelsOfType(labels, "keyword"),
  ];
  const adult = extractAdultAttributeTags({
    genres,
    attributes: attributeLabels,
    officialTitle: title || subtitle || "",
    officialDescription: input.officialDescription ?? "",
    extraText: [],
  });
  if (adult.tags.length > 0) {
    notes.push(`adult_attribute_tags:${adult.tags.length}`);
  }

  // Prefer more specific situation tags (メンエス) over generic エステ when both match.
  const adultTagsFiltered = adult.tags.filter((t) => {
    if (t === "エステ" && adult.tags.includes("メンエス")) return false;
    return true;
  });

  // Tags = work attributes. Performer taxonomy is SSOT for cast.
  const tags: string[] = [];
  const excludePerformers = input.excludePerformersFromTags !== false;
  if (!excludePerformers) {
    const performerTags =
      performers.length > 5
        ? performers.slice(0, 2)
        : performers.length > 3
          ? performers.slice(0, 3)
          : performers;
    for (const p of performerTags) tags.push(p);
  }
  for (const s of seriesNames) {
    // Avoid duplicating format series as both series tax + noisy tag when adult dict covers it
    if (s === "ベスト・総集編") {
      tags.push("ベスト");
      tags.push("総集編");
    } else if (s !== "デビュー作" && s !== "完全版" && s !== "周年記念") {
      tags.push(s);
    }
  }
  for (const m of makers) {
    if (m.length > 0 && m.length <= 24) tags.push(m);
  }
  // Official genre labels that are not already collapsed into adult canonical tags
  const adultSet = new Set(adultTagsFiltered.map((t) => t.replace(/\s+/g, "").toLowerCase()));
  for (const g of genres) {
    if (g.length > 0 && g.length <= 24) {
      const n = normalizeTaxonomyDisplayName(g);
      if (!adultSet.has(n.replace(/\s+/g, "").toLowerCase())) {
        // Skip raw genre if adult dict already matched a synonym into canonical
        const covered = adult.matches.some(
          (m) =>
            m.matchedAlias.replace(/\s+/g, "").toLowerCase() ===
            g.replace(/\s+/g, "").toLowerCase(),
        );
        if (!covered) tags.push(n);
      }
    }
  }
  for (const a of adultTagsFiltered) tags.push(a);
  for (const token of EVIDENCE_TAG_TOKENS) {
    if (blob.toLowerCase().includes(token.toLowerCase()) || blob.includes(token)) {
      tags.push(token);
    }
  }
  // Normalize tag synonyms (BEST → keep ベスト token if present; collapse pure synonym tags)
  const BANNED_TAG_EXACT = new Set([
    "動画",
    "作品",
    "紹介",
    "記事",
    "おすすめ",
    "人気",
    "商品",
    "ページ",
    "AV",
    "av",
  ]);
  const adultCanonical = new Set(ADULT_TAXONOMY_DICTIONARY.map((t) => t.canonicalName));
  const normalizedTags = uniqPreserve(
    tags
      .map((t) => {
        // Adult dictionary canonicals must stay as searchable tags (デビュー ≠ series デビュー作).
        if (adultCanonical.has(t)) return t;
        if (t === "デビュー作") return "デビュー";
        const n = normalizeTaxonomyDisplayName(t);
        // Keep short form tags ベスト/総集編 as searchable tags even when series is ベスト・総集編
        if (t === "ベスト" || t === "総集編" || t === "BEST" || t === "Best")
          return t === "BEST" || t === "Best" ? "ベスト" : t;
        return n;
      })
      .filter((t) => {
        if (!t || t.length <= 1 || t.length > 32) return false;
        if (/^\d+$/.test(t)) return false;
        if (BANNED_TAG_EXACT.has(t)) return false;
        return true;
      }),
  );

  // Cap performer taxonomy on mega-casts; keep featured names only.
  const cappedPerformers = performers.length > 8 ? performers.slice(0, 3) : performers;

  if (performers.length > cappedPerformers.length) {
    notes.push(`performer_taxonomy_capped:${cappedPerformers.length}_of_${performers.length}`);
  }

  return {
    performers: cappedPerformers,
    seriesNames,
    seriesName: seriesNames[0] ?? null,
    categories: uniqueCategories,
    tags: normalizedTags,
    categoryFallbackUsed,
    notes,
  };
}
