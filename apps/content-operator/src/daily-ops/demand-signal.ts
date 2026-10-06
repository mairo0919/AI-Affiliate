/**
 * FANZA demand observations used only to order article candidates.
 * Keywords are not article facts, not SEO query sources, and not X evidence.
 */

export const FANZA_RECOMMENDED_PRODUCT = "FANZA_RECOMMENDED_PRODUCT";
export const FANZA_INTERNAL_SEARCH = "FANZA_INTERNAL_SEARCH";
/** ItemList sort=rank. Not the affiliate-admin recommended TOP10. */
export const FANZA_API_POPULAR = "FANZA_API_POPULAR";
export const FANZA_API_NEW = "FANZA_API_NEW";
export const FANZA_API_REVIEW = "FANZA_API_REVIEW";
export const FANZA_API_PERFORMER_POPULAR = "FANZA_API_PERFORMER_POPULAR";
export const FANZA_API_GENRE_POPULAR = "FANZA_API_GENRE_POPULAR";
export const FANZA_API_SERIES_POPULAR = "FANZA_API_SERIES_POPULAR";
export const FANZA_API_MAKER_POPULAR = "FANZA_API_MAKER_POPULAR";

export const DEMAND_PRODUCT_LIST_SOURCES = [
  FANZA_RECOMMENDED_PRODUCT,
  FANZA_API_POPULAR,
  FANZA_API_NEW,
  FANZA_API_REVIEW,
] as const;

export const DEMAND_SEGMENT_SOURCES = [
  FANZA_API_PERFORMER_POPULAR,
  FANZA_API_GENRE_POPULAR,
  FANZA_API_SERIES_POPULAR,
  FANZA_API_MAKER_POPULAR,
] as const;

export const DEMAND_SOURCES = [
  FANZA_INTERNAL_SEARCH,
  ...DEMAND_PRODUCT_LIST_SOURCES,
  ...DEMAND_SEGMENT_SOURCES,
] as const;

export type DemandSource = (typeof DEMAND_SOURCES)[number];

export const DEMAND_SEMANTIC_TYPES = ["PERFORMER", "GENRE", "THEME", "OTHER"] as const;
export type DemandSemanticType = (typeof DEMAND_SEMANTIC_TYPES)[number];

export type SegmentDemandSignal = {
  kind: "performer" | "genre" | "series" | "maker";
  name: string;
  rank: number;
};

export type DemandObservationDraft = {
  source: DemandSource;
  scope: "video";
  contentId: string | null;
  keyword: string | null;
  rank: number;
  semanticType: DemandSemanticType | null;
  provenance: string;
  observedAt: Date;
};

export type WorkEvidenceSurface = {
  contentId: string;
  performers: string[];
  genres: string[];
  series: string[];
  campaigns: string[];
  titles: string[];
  descriptions: string[];
  features: string[];
};

export type DemandPriorityFields = {
  recommendedRank?: number | null;
  /** Latest FANZA_API_POPULAR rank. Not recommended TOP10 and not NEW/REVIEW. */
  popularRank?: number | null;
  matchedDemandKeywords?: string[];
  bestInternalSearchRank?: number | null;
  segmentSignals?: SegmentDemandSignal[];
  bestSegmentRank?: number | null;
  /** Informative only. Selection does not drop NO_NATURAL_QUERY. */
  seoQueryStatus?: "VALID" | "NO_NATURAL_QUERY" | null;
};

// Ideographic spaces are real FANZA delimiters. The escaped bracket keeps "]" inside the class.
const DELIMITERS = /[\s　、。,.|｜/／・「」『』【】\[\]()（）:：;；!！?？]+/; // eslint-disable-line no-irregular-whitespace, no-useless-escape

export function normalizeDemandText(value: string): string {
  return value.normalize("NFKC").replace(/[\s　・]/g, "").toLowerCase(); // eslint-disable-line no-irregular-whitespace
}

function demandTokens(value: string): string[] {
  return value
    .split(DELIMITERS)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function cleanList(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeDemandText(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function emptyWorkEvidenceSurface(contentId: string): WorkEvidenceSurface {
  return {
    contentId,
    performers: [],
    genres: [],
    series: [],
    campaigns: [],
    titles: [],
    descriptions: [],
    features: [],
  };
}

export function buildWorkEvidenceSurface(input: {
  contentId: string;
  titles?: string[];
  descriptions?: string[];
  performers?: string[];
  genres?: string[];
  series?: string[];
  campaigns?: string[];
  features?: string[];
}): WorkEvidenceSurface {
  return {
    contentId: input.contentId.trim(),
    performers: cleanList(input.performers ?? []),
    genres: cleanList(input.genres ?? []),
    series: cleanList(input.series ?? []),
    campaigns: cleanList(input.campaigns ?? []),
    titles: cleanList(input.titles ?? []),
    descriptions: cleanList(input.descriptions ?? []),
    features: cleanList(input.features ?? []),
  };
}

function surfaceTexts(surface: WorkEvidenceSurface): string[] {
  return [
    ...surface.performers,
    ...surface.genres,
    ...surface.series,
    ...surface.campaigns,
    ...surface.titles,
    ...surface.descriptions,
    ...surface.features,
  ];
}

/**
 * Match a demand keyword to official evidence.
 * exact, normalized exact, or the same delimited token. No substring inference.
 */
export function keywordMatchesEvidence(keyword: string, surface: WorkEvidenceSurface): boolean {
  const trimmed = keyword.trim();
  if (!trimmed) return false;
  const needle = normalizeDemandText(trimmed);
  if (!needle) return false;
  for (const text of surfaceTexts(surface)) {
    if (normalizeDemandText(text) === needle) return true;
    for (const token of demandTokens(text)) {
      if (normalizeDemandText(token) === needle) return true;
    }
  }
  return false;
}

function isSemanticType(value: string): value is DemandSemanticType {
  return (DEMAND_SEMANTIC_TYPES as readonly string[]).includes(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseDemandIngest(input: unknown):
  | { ok: true; rows: DemandObservationDraft[] }
  | { ok: false; errors: string[] } {
  if (!Array.isArray(input)) {
    return { ok: false, errors: ["ingest body must be an array"] };
  }
  const rows: DemandObservationDraft[] = [];
  const errors: string[] = [];
  input.forEach((raw, index) => {
    const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const where = `row ${index + 1}`;
    if (!row) {
      errors.push(`${where}: not an object`);
      return;
    }
    const source = readString(row.source);
    const scope = readString(row.scope) || "video";
    const provenance = readString(row.provenance);
    const observedRaw = row.observedAt;
    const observedAt =
      observedRaw instanceof Date
        ? observedRaw
        : typeof observedRaw === "string" || typeof observedRaw === "number"
          ? new Date(observedRaw)
          : null;
    const rank = typeof row.rank === "number" ? row.rank : Number.NaN;
    if (scope !== "video") {
      errors.push(`${where}: scope must be video`);
      return;
    }
    if (!provenance) {
      errors.push(`${where}: provenance is required`);
      return;
    }
    if (!observedAt || Number.isNaN(observedAt.getTime())) {
      errors.push(`${where}: observedAt is required`);
      return;
    }
    if (!Number.isInteger(rank) || rank < 1) {
      errors.push(`${where}: rank must be a positive integer`);
      return;
    }
    const semanticRaw = readString(row.semanticType);
    if (semanticRaw && !isSemanticType(semanticRaw)) {
      errors.push(`${where}: semanticType must be PERFORMER, GENRE, THEME, or OTHER`);
      return;
    }
    const semanticType = semanticRaw ? (semanticRaw as DemandSemanticType) : "OTHER";

    if (source === FANZA_RECOMMENDED_PRODUCT) {
      const contentId = readString(row.contentId);
      if (!contentId) {
        errors.push(`${where}: contentId is required`);
        return;
      }
      if (rank > 10) {
        errors.push(`${where}: recommended rank must be 1-10`);
        return;
      }
      rows.push({
        source: FANZA_RECOMMENDED_PRODUCT,
        scope: "video",
        contentId,
        keyword: null,
        rank,
        semanticType: null,
        provenance,
        observedAt,
      });
      return;
    }
    if (source === FANZA_INTERNAL_SEARCH) {
      const keyword = readString(row.keyword);
      if (!keyword) {
        errors.push(`${where}: keyword is required`);
        return;
      }
      rows.push({
        source: FANZA_INTERNAL_SEARCH,
        scope: "video",
        contentId: null,
        keyword,
        rank,
        semanticType,
        provenance,
        observedAt,
      });
      return;
    }
    if (isProductListSource(source) && source !== FANZA_RECOMMENDED_PRODUCT) {
      const contentId = readString(row.contentId);
      if (!contentId) {
        errors.push(`${where}: contentId is required`);
        return;
      }
      if (rank > 100) {
        errors.push(`${where}: API list rank must be 1-100`);
        return;
      }
      rows.push({
        source,
        scope: "video",
        contentId,
        keyword: null,
        rank,
        semanticType: null,
        provenance,
        observedAt,
      });
      return;
    }
    if (isSegmentSource(source)) {
      const contentId = readString(row.contentId);
      const keyword = readString(row.keyword);
      if (!contentId) {
        errors.push(`${where}: contentId is required`);
        return;
      }
      if (!keyword) {
        errors.push(`${where}: keyword is required`);
        return;
      }
      if (rank > 100) {
        errors.push(`${where}: segment rank must be 1-100`);
        return;
      }
      rows.push({
        source,
        scope: "video",
        contentId,
        keyword,
        rank,
        semanticType,
        provenance,
        observedAt,
      });
      return;
    }
    errors.push(`${where}: source is not a FANZA demand source`);
  });
  if (errors.length > 0) return { ok: false, errors };
  const seen = new Set<string>();
  for (const row of rows) {
    const key = observationSnapshotKey(row);
    if (seen.has(key)) {
      return { ok: false, errors: [`duplicate ${key} in one snapshot`] };
    }
    seen.add(key);
  }
  return { ok: true, rows };
}

export function isDemandSource(value: string): value is DemandSource {
  return (DEMAND_SOURCES as readonly string[]).includes(value);
}

function isProductListSource(value: string): value is (typeof DEMAND_PRODUCT_LIST_SOURCES)[number] {
  return (DEMAND_PRODUCT_LIST_SOURCES as readonly string[]).includes(value);
}

function isSegmentSource(value: string): value is (typeof DEMAND_SEGMENT_SOURCES)[number] {
  return (DEMAND_SEGMENT_SOURCES as readonly string[]).includes(value);
}

function observationSnapshotKey(row: DemandObservationDraft): string {
  const at = row.observedAt.toISOString();
  if (row.source === FANZA_INTERNAL_SEARCH) {
    return `${at}|${row.source}|${row.scope}|${keywordKey(row.keyword ?? "")}|${row.rank}`;
  }
  if (isSegmentSource(row.source)) {
    return `${at}|${row.source}|${row.scope}|${keywordKey(row.keyword ?? "")}|${row.rank}`;
  }
  return `${at}|${row.source}|${row.scope}|${row.rank}`;
}

function contentKey(contentId: string): string {
  return contentId.trim().toLowerCase();
}

function keywordKey(keyword: string): string {
  return normalizeDemandText(keyword);
}

/**
 * Latest snapshot per source.
 * Product lists use the newest observedAt as a whole.
 * Search keywords and segment lists keep the newest row for that key.
 * Older rows stay in storage; they are not returned.
 */
export function selectLatestDemandSnapshot(rows: DemandObservationDraft[]): DemandObservationDraft[] {
  const grouped = new Map<string, DemandObservationDraft[]>();
  for (const row of rows) {
    const list = grouped.get(row.source) ?? [];
    list.push(row);
    grouped.set(row.source, list);
  }
  const kept: DemandObservationDraft[] = [];
  for (const [source, group] of grouped) {
    if (source === FANZA_INTERNAL_SEARCH) {
      const latest = new Map<string, DemandObservationDraft>();
      const ordered = group.slice().sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
      for (const row of ordered) {
        if (!row.keyword) continue;
        const key = keywordKey(row.keyword);
        if (key && !latest.has(key)) latest.set(key, row);
      }
      kept.push(...latest.values());
      continue;
    }
    if (isSegmentSource(source)) {
      const newestByKeyword = new Map<string, number>();
      for (const row of group) {
        if (!row.keyword) continue;
        const key = keywordKey(row.keyword);
        const at = row.observedAt.getTime();
        const prev = newestByKeyword.get(key);
        if (prev == null || at > prev) newestByKeyword.set(key, at);
      }
      kept.push(
        ...group.filter((row) => {
          if (!row.keyword || !row.contentId) return false;
          return row.observedAt.getTime() === newestByKeyword.get(keywordKey(row.keyword));
        }),
      );
      continue;
    }
    if (!isProductListSource(source)) continue;
    const newest = Math.max(...group.map((row) => row.observedAt.getTime()));
    kept.push(
      ...group.filter((row) => row.contentId && row.observedAt.getTime() === newest),
    );
  }
  return kept;
}

export function validRecommendedRank(rank: number | null | undefined): number | null {
  if (typeof rank !== "number" || !Number.isInteger(rank)) return null;
  if (rank < 1 || rank > 10) return null;
  return rank;
}

export function validMatchedSearchRank(
  rank: number | null | undefined,
  keywords: string[] | null | undefined,
): number | null {
  if (!keywords || keywords.length === 0) return null;
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1) return null;
  return rank;
}

export function validPopularRank(rank: number | null | undefined): number | null {
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1 || rank > 100) return null;
  return rank;
}

export function validSegmentRank(rank: number | null | undefined): number | null {
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1 || rank > 100) return null;
  return rank;
}

export type PublicationPriorityClass = "RECOMMENDED" | "STRONG_DEMAND" | "NORMAL";

const PUBLICATION_PRIORITY_RANK: Record<PublicationPriorityClass, number> = {
  RECOMMENDED: 0,
  STRONG_DEMAND: 1,
  NORMAL: 2,
};

export function publicationPriorityClass(fields: DemandPriorityFields): PublicationPriorityClass {
  if (validRecommendedRank(fields.recommendedRank) != null) return "RECOMMENDED";
  if (validPopularRank(fields.popularRank) != null) return "STRONG_DEMAND";
  return "NORMAL";
}

export function demandTier(fields: DemandPriorityFields): 1 | 2 | 3 | 4 | 5 {
  if (validRecommendedRank(fields.recommendedRank) != null) return 1;
  if (validPopularRank(fields.popularRank) != null) return 2;
  if (validMatchedSearchRank(fields.bestInternalSearchRank, fields.matchedDemandKeywords) != null) {
    return 3;
  }
  if (validSegmentRank(fields.bestSegmentRank) != null) return 4;
  return 5;
}

/**
 * Add every present demand signal onto the existing totalScore.
 * Signals stay independent: a work can carry recommended, popular, search, and segment together.
 * NEW and REVIEW are not signals here.
 */
export function demandSignalBoost(fields: DemandPriorityFields): number {
  let boost = 0;
  const recommended = validRecommendedRank(fields.recommendedRank);
  if (recommended != null) boost += (11 - recommended) * 12;
  const popular = validPopularRank(fields.popularRank);
  if (popular != null) boost += (101 - popular) * 1.2;
  const search = validMatchedSearchRank(fields.bestInternalSearchRank, fields.matchedDemandKeywords);
  if (search != null) boost += Math.max(0, 21 - search) * 2;
  const segment = validSegmentRank(fields.bestSegmentRank);
  if (segment != null) boost += Math.max(0, 21 - segment);
  return boost;
}

export function demandAdjustedScore(fields: DemandPriorityFields & { totalScore?: number }): number {
  return (fields.totalScore ?? 0) + demandSignalBoost(fields);
}

/**
 * Recommended, then strong demand, then the existing adjusted score.
 * Equal scores fall through to the existing candidate sort.
 * NEW and REVIEW lists do not reorder candidates.
 */
export function compareDemandPriority(
  a: DemandPriorityFields & { totalScore?: number },
  b: DemandPriorityFields & { totalScore?: number },
): number {
  const classDelta =
    PUBLICATION_PRIORITY_RANK[publicationPriorityClass(a)] -
    PUBLICATION_PRIORITY_RANK[publicationPriorityClass(b)];
  if (classDelta !== 0) return classDelta;
  const left = demandAdjustedScore(a);
  const right = demandAdjustedScore(b);
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

/** Latest recommended and popular ranks only. Search matching still needs evidence. */
export function productDemandRanks(
  observations: DemandObservationDraft[],
): Map<string, { recommendedRank: number | null; popularRank: number | null }> {
  const ranks = new Map<string, { recommendedRank: number | null; popularRank: number | null }>();
  for (const row of selectLatestDemandSnapshot(observations)) {
    if (!row.contentId) continue;
    const key = contentKey(row.contentId);
    const current = ranks.get(key) ?? { recommendedRank: null, popularRank: null };
    if (row.source === FANZA_RECOMMENDED_PRODUCT) current.recommendedRank = row.rank;
    if (row.source === FANZA_API_POPULAR) current.popularRank = row.rank;
    ranks.set(key, current);
  }
  return ranks;
}

function formatSegmentSignals(signals: SegmentDemandSignal[] | null | undefined): string {
  const rows = (signals ?? [])
    .filter((signal) => validSegmentRank(signal.rank) != null && signal.name.trim())
    .slice()
    .sort((a, b) => a.rank - b.rank || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, "ja"));
  if (rows.length === 0) return "";
  return rows.map((signal) => `${signal.kind}:${signal.name} rank=${signal.rank}`).join(", ");
}

export function demandPriorityReason(fields: DemandPriorityFields): string {
  const parts: string[] = [];
  const recommended = validRecommendedRank(fields.recommendedRank);
  const popular = validPopularRank(fields.popularRank);
  const search = validMatchedSearchRank(fields.bestInternalSearchRank, fields.matchedDemandKeywords);
  const keywords = (fields.matchedDemandKeywords ?? []).join(",");
  const segments = formatSegmentSignals(fields.segmentSignals);
  if (recommended != null) parts.push(`FANZA_RECOMMENDED_PRODUCT rank=${recommended}`);
  if (popular != null) parts.push(`FANZA_API_POPULAR rank=${popular}`);
  if (search != null) parts.push(`FANZA_INTERNAL_SEARCH_MATCH rank=${search}; keywords=${keywords}`);
  if (segments) parts.push(`segment ${segments}`);
  if (parts.length === 0) return "NORMAL";
  return parts.join("; ");
}

export function priorityFieldsForWork(
  contentId: string,
  observations: DemandObservationDraft[],
  surface: WorkEvidenceSurface,
): {
  recommendedRank: number | null;
  popularRank: number | null;
  matchedDemandKeywords: string[];
  bestInternalSearchRank: number | null;
  segmentSignals: SegmentDemandSignal[];
  bestSegmentRank: number | null;
} {
  const latest = selectLatestDemandSnapshot(observations);
  const cid = contentKey(contentId);
  const recommended = latest.find(
    (row) =>
      row.source === FANZA_RECOMMENDED_PRODUCT &&
      row.contentId != null &&
      contentKey(row.contentId) === cid,
  );
  const popular = latest.find(
    (row) =>
      row.source === FANZA_API_POPULAR &&
      row.contentId != null &&
      contentKey(row.contentId) === cid,
  );
  const matched: Array<{ keyword: string; rank: number }> = [];
  for (const row of latest) {
    if (row.source !== FANZA_INTERNAL_SEARCH || !row.keyword) continue;
    if (!keywordMatchesEvidence(row.keyword, surface)) continue;
    matched.push({ keyword: row.keyword, rank: row.rank });
  }
  matched.sort((a, b) => a.rank - b.rank || a.keyword.localeCompare(b.keyword, "ja"));
  const segmentSignals: SegmentDemandSignal[] = [];
  for (const row of latest) {
    if (!isSegmentSource(row.source) || !row.contentId || !row.keyword) continue;
    if (contentKey(row.contentId) !== cid) continue;
    segmentSignals.push({
      kind: segmentKind(row.source),
      name: row.keyword,
      rank: row.rank,
    });
  }
  segmentSignals.sort((a, b) => a.rank - b.rank || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, "ja"));
  return {
    recommendedRank: recommended ? recommended.rank : null,
    popularRank: popular ? popular.rank : null,
    matchedDemandKeywords: matched.map((row) => row.keyword),
    bestInternalSearchRank: matched[0]?.rank ?? null,
    segmentSignals,
    bestSegmentRank: segmentSignals[0]?.rank ?? null,
  };
}

function segmentKind(source: (typeof DEMAND_SEGMENT_SOURCES)[number]): SegmentDemandSignal["kind"] {
  if (source === FANZA_API_PERFORMER_POPULAR) return "performer";
  if (source === FANZA_API_GENRE_POPULAR) return "genre";
  if (source === FANZA_API_SERIES_POPULAR) return "series";
  return "maker";
}
