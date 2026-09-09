/**
 * Derive WordPress categories / tags / performers / series from evidence labels only.
 * Never invents performers, series, or categories without a matching evidence string.
 */

export type EvidenceTaxonomyLabel = {
  type: string;
  name: string;
};

export type DerivedWordPressTaxonomy = {
  performers: string[];
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
] as const;

/**
 * Map evidence genre/title tokens → WP category display names.
 * Only applied when the match string appears in evidence (genre name or title).
 */
const CATEGORY_EVIDENCE_RULES: Array<{ needle: RegExp; category: string }> = [
  { needle: /ベスト|総集編/, category: "ベスト・総集編" },
  { needle: /(?:^|[\s　/／])VR(?:$|[\s　/／])|ＶＲ/, category: "VR" },
  { needle: /単体作品/, category: "単体作品" },
  { needle: /企画/, category: "企画" },
];

/**
 * When no category rule matches but we still have a product article with actress/genre
 * evidence, use this single non-Uncategorized fallback (explicit policy — not inventing
 * adult niches). PUBLIC path should prefer evidence categories; fallback avoids WP default
 * Uncategorized (id=1) for product reviews.
 */
export const PRODUCT_ARTICLE_CATEGORY_FALLBACK = "作品紹介";

function uniqPreserve(names: string[]): string[] {
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

function evidenceBlob(labels: EvidenceTaxonomyLabel[], title: string): string {
  return `${title}\n${labels.map((l) => l.name).join("\n")}`;
}

/**
 * Derive taxonomy attach lists from ResearchTag-like labels + title.
 */
export function deriveWordPressTaxonomyFromEvidence(input: {
  labels: EvidenceTaxonomyLabel[];
  title?: string | null;
  /** Extra performer names already attested (e.g. structuredContent). */
  extraPerformers?: string[] | null;
  /** Extra series name already attested. */
  extraSeriesName?: string | null;
  allowCategoryFallback?: boolean;
}): DerivedWordPressTaxonomy {
  const notes: string[] = [];
  const title = input.title?.trim() ?? "";
  const labels = input.labels.filter((l) => l.name?.trim());

  const performers = uniqPreserve([
    ...labelsOfType(labels, "actress"),
    ...labelsOfType(labels, "performer"),
    ...(input.extraPerformers ?? []),
  ]);

  const seriesFromLabels = labelsOfType(labels, "series");
  const seriesName =
    (input.extraSeriesName?.trim() || null) ??
    (seriesFromLabels[0] ?? null);

  const genres = [
    ...labelsOfType(labels, "genre"),
    ...labelsOfType(labels, "category"),
  ];
  const blob = evidenceBlob(
    [...labels, ...genres.map((g) => ({ type: "genre", name: g }))],
    title,
  );

  const categories: string[] = [];
  for (const rule of CATEGORY_EVIDENCE_RULES) {
    if (rule.needle.test(blob) || genres.some((g) => rule.needle.test(g))) {
      categories.push(rule.category);
    }
  }

  let categoryFallbackUsed = false;
  const uniqueCategories = uniqPreserve(categories);
  if (uniqueCategories.length === 0 && input.allowCategoryFallback !== false) {
    // Only when we have some product evidence (performer/genre/title) — never on empty input.
    if (performers.length > 0 || genres.length > 0 || title.length > 0) {
      uniqueCategories.push(PRODUCT_ARTICLE_CATEGORY_FALLBACK);
      categoryFallbackUsed = true;
      notes.push("category_fallback_作品紹介");
    }
  }

  const tags: string[] = [];
  for (const p of performers) tags.push(p);
  if (seriesName) tags.push(seriesName);
  for (const g of genres) {
    // Keep genre as tag only when short / form-like; skip long free text
    if (g.length > 0 && g.length <= 24) tags.push(g);
  }
  for (const token of EVIDENCE_TAG_TOKENS) {
    if (blob.includes(token)) tags.push(token);
  }

  return {
    performers,
    seriesName,
    categories: uniqueCategories,
    tags: uniqPreserve(tags),
    categoryFallbackUsed,
    notes,
  };
}
