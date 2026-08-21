import { ValidationError } from "./dmm-api-error.js";
import type { DmmItemListParams } from "./dmm-api-types.js";

export interface FanzaQueryInput {
  service?: string;
  floor?: string;
  keyword?: string;
  sort?: string;
  hits?: number;
  offset?: number;
  fromDate?: string;
  toDate?: string;
  site?: string;
}

export interface ResolvedFanzaQuery {
  site: string;
  service: string;
  floor: string;
  keyword?: string;
  sort: string;
  hits: number;
  offset: number;
  gteDate?: string;
  lteDate?: string;
}

export function clampHits(hits: number | undefined, fallback: number): number {
  const value = hits ?? fallback;
  if (!Number.isFinite(value) || value < 1) {
    throw new ValidationError("hits must be an integer between 1 and 100");
  }
  if (value > 100) {
    return 100;
  }
  return Math.floor(value);
}

export function resolveFanzaQuery(
  input: FanzaQueryInput,
  defaults: { service: string; floor: string; hits: number },
): ResolvedFanzaQuery {
  const hits = clampHits(input.hits, defaults.hits);
  const offset = Math.max(1, Math.floor(input.offset ?? 1));

  return {
    site: input.site ?? "FANZA",
    service: input.service ?? defaults.service,
    floor: input.floor ?? defaults.floor,
    keyword: input.keyword,
    sort: input.sort ?? "rank",
    hits,
    offset,
    gteDate: input.fromDate,
    lteDate: input.toDate,
  };
}

export function toItemListParams(query: ResolvedFanzaQuery): DmmItemListParams {
  return {
    site: query.site,
    service: query.service,
    floor: query.floor,
    hits: query.hits,
    offset: query.offset,
    sort: query.sort,
    keyword: query.keyword,
    gteDate: query.gteDate,
    lteDate: query.lteDate,
  };
}

export function computeNextOffset(options: {
  offset: number;
  fetchedCount: number;
  hits: number;
  totalCount?: number;
}): number | null {
  if (options.fetchedCount <= 0 || options.fetchedCount < options.hits) {
    return null;
  }
  const next = options.offset + options.fetchedCount;
  if (options.totalCount !== undefined && next > options.totalCount) {
    return null;
  }
  return next;
}
