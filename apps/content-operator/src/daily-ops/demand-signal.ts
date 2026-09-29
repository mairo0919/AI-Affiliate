/**
 * FANZA demand observations used only to order article candidates.
 * Keywords are not article facts, not SEO query sources, and not X evidence.
 */

export const FANZA_RECOMMENDED_PRODUCT = "FANZA_RECOMMENDED_PRODUCT";
export const FANZA_INTERNAL_SEARCH = "FANZA_INTERNAL_SEARCH";

export const DEMAND_SEMANTIC_TYPES = ["PERFORMER", "GENRE", "THEME", "OTHER"] as const;
export type DemandSemanticType = (typeof DEMAND_SEMANTIC_TYPES)[number];

export type DemandObservationDraft = {
  source: typeof FANZA_RECOMMENDED_PRODUCT | typeof FANZA_INTERNAL_SEARCH;
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
  matchedDemandKeywords?: string[];
  bestInternalSearchRank?: number | null;
  /** Informative only. Selection does not drop NO_NATURAL_QUERY. */
  seoQueryStatus?: "VALID" | "NO_NATURAL_QUERY" | null;
};

const DELIMITERS = /[\s　、。,.|｜/／・「」『』【】\[\]()（）:：;；!！?？]+/;

export function normalizeDemandText(value: string): string {
  return value.normalize("NFKC").replace(/[\s　・]/g, "").toLowerCase();
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
    errors.push(`${where}: source must be FANZA_RECOMMENDED_PRODUCT or FANZA_INTERNAL_SEARCH`);
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows };
}

function contentKey(contentId: string): string {
  return contentId.trim().toLowerCase();
}

function keywordKey(keyword: string): string {
  return normalizeDemandText(keyword);
}

/** Latest observation per contentId or keyword. Older rows stay in the input. */
export function selectLatestDemandSnapshot(rows: DemandObservationDraft[]): DemandObservationDraft[] {
  const recommended = new Map<string, DemandObservationDraft>();
  const search = new Map<string, DemandObservationDraft>();
  const ordered = rows.slice().sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  for (const row of ordered) {
    if (row.source === FANZA_RECOMMENDED_PRODUCT && row.contentId) {
      const key = contentKey(row.contentId);
      if (!recommended.has(key)) recommended.set(key, row);
      continue;
    }
    if (row.source === FANZA_INTERNAL_SEARCH && row.keyword) {
      const key = keywordKey(row.keyword);
      if (key && !search.has(key)) search.set(key, row);
    }
  }
  return [...recommended.values(), ...search.values()];
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

export function demandTier(fields: DemandPriorityFields): 1 | 2 | 3 {
  if (validRecommendedRank(fields.recommendedRank) != null) return 1;
  if (validMatchedSearchRank(fields.bestInternalSearchRank, fields.matchedDemandKeywords) != null) {
    return 2;
  }
  return 3;
}

function compareSearchTie(a: DemandPriorityFields, b: DemandPriorityFields): number {
  const left = validMatchedSearchRank(a.bestInternalSearchRank, a.matchedDemandKeywords);
  const right = validMatchedSearchRank(b.bestInternalSearchRank, b.matchedDemandKeywords);
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

/** Lower recommended rank, then lower matched search rank. 0 means use the existing score sort. */
export function compareDemandPriority(a: DemandPriorityFields, b: DemandPriorityFields): number {
  const leftTier = demandTier(a);
  const rightTier = demandTier(b);
  if (leftTier !== rightTier) return leftTier - rightTier;
  if (leftTier === 1) {
    const leftRank = validRecommendedRank(a.recommendedRank)!;
    const rightRank = validRecommendedRank(b.recommendedRank)!;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return compareSearchTie(a, b);
  }
  if (leftTier === 2) return compareSearchTie(a, b);
  return 0;
}

export function demandPriorityReason(fields: DemandPriorityFields): string {
  const recommended = validRecommendedRank(fields.recommendedRank);
  const search = validMatchedSearchRank(fields.bestInternalSearchRank, fields.matchedDemandKeywords);
  const keywords = (fields.matchedDemandKeywords ?? []).join(",");
  if (recommended != null && search != null) {
    return `FANZA_RECOMMENDED_PRODUCT rank=${recommended}; internal_search_tiebreak rank=${search}; keywords=${keywords}`;
  }
  if (recommended != null) {
    return `FANZA_RECOMMENDED_PRODUCT rank=${recommended}`;
  }
  if (search != null) {
    return `FANZA_INTERNAL_SEARCH_MATCH rank=${search}; keywords=${keywords}`;
  }
  return "NORMAL";
}

export function priorityFieldsForWork(
  contentId: string,
  observations: DemandObservationDraft[],
  surface: WorkEvidenceSurface,
): {
  recommendedRank: number | null;
  matchedDemandKeywords: string[];
  bestInternalSearchRank: number | null;
} {
  const latest = selectLatestDemandSnapshot(observations);
  const cid = contentKey(contentId);
  const recommended = latest.find(
    (row) =>
      row.source === FANZA_RECOMMENDED_PRODUCT &&
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
  return {
    recommendedRank: recommended ? recommended.rank : null,
    matchedDemandKeywords: matched.map((row) => row.keyword),
    bestInternalSearchRank: matched[0]?.rank ?? null,
  };
}
