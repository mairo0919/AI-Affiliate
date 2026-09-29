/**
 * Daily FANZA ItemList demand collection.
 * Appends snapshots. Does not replace FANZA_INTERNAL_SEARCH or FANZA_RECOMMENDED_PRODUCT.
 * API sort=rank is FANZA_API_POPULAR, not the affiliate-admin recommended TOP10.
 */

import type { AppConfig } from "@ai-affiliate/config";
import { requireDmmCredentials } from "@ai-affiliate/config";
import type { DatabaseClient } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { DmmApiClient } from "../providers/fanza/dmm-api-client.js";
import type { DmmItem, DmmNamedEntity } from "../providers/fanza/dmm-api-types.js";
import { DEFAULT_RELEASE_AGE_THRESHOLDS } from "./release-age.js";
import { loadDailyCandidatePool } from "./candidate-pool.js";
import { appendDemandObservations } from "./demand-store.js";
import {
  FANZA_API_GENRE_POPULAR,
  FANZA_API_MAKER_POPULAR,
  FANZA_API_NEW,
  FANZA_API_PERFORMER_POPULAR,
  FANZA_API_POPULAR,
  FANZA_API_REVIEW,
  FANZA_API_SERIES_POPULAR,
  DEMAND_SEGMENT_SOURCES,
  normalizeDemandText,
  type DemandObservationDraft,
  type DemandSemanticType,
  type DemandSource,
} from "./demand-signal.js";

const GLOBAL_HITS = 100;
const SEGMENT_HITS = 20;
const SITE = "FANZA";
const SERVICE = "digital";
const FLOOR = "videoa";

const GLOBAL_LISTS = [
  { source: FANZA_API_POPULAR, sort: "rank" },
  { source: FANZA_API_NEW, sort: "date" },
  { source: FANZA_API_REVIEW, sort: "review" },
] as const;

const SEGMENT_LISTS = [
  { source: FANZA_API_PERFORMER_POPULAR, article: "actress", kind: "performer" },
  { source: FANZA_API_GENRE_POPULAR, article: "genre", kind: "genre" },
  { source: FANZA_API_SERIES_POPULAR, article: "series", kind: "series" },
  { source: FANZA_API_MAKER_POPULAR, article: "maker", kind: "maker" },
] as const;

const FORMAT_GENRES = new Set(
  ["ハイビジョン", "4K", "8K", "VR", "独占配信", "サンプル動画", "配信専用", "単体作品", "セット商品"].map(
    (name) => normalizeDemandText(name),
  ),
);

export type SegmentTargets = {
  performers: string[];
  genres: string[];
  series: string[];
  makers: string[];
};

type NamedId = { id: string; name: string };

export function jstDayStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return new Date(`${pick("year")}-${pick("month")}-${pick("day")}T00:00:00+09:00`);
}

export function itemListProvenance(sort: string, extra?: string): string {
  const base = `DMM ItemList site=${SITE} service=${SERVICE} floor=${FLOOR} sort=${sort} hits=${extra ? SEGMENT_HITS : GLOBAL_HITS}`;
  return extra ? `${base} ${extra}` : base;
}

export function itemListToDemandRows(input: {
  source: DemandSource;
  items: DmmItem[];
  observedAt: Date;
  provenance: string;
  keyword?: string | null;
  semanticType?: DemandSemanticType | null;
}): { rows: DemandObservationDraft[]; skipped: number; titles: string[] } {
  const rows: DemandObservationDraft[] = [];
  const seen = new Set<string>();
  const titles: string[] = [];
  let skipped = 0;
  for (const item of input.items) {
    const contentId = item.content_id?.trim() ?? "";
    const title = item.title?.trim() ?? "";
    if (!contentId || !title) {
      skipped += 1;
      continue;
    }
    const key = contentId.toLowerCase();
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    if (rows.length >= 100) break;
    rows.push({
      source: input.source,
      scope: "video",
      contentId,
      keyword: input.keyword ?? null,
      rank: rows.length + 1,
      semanticType: input.semanticType ?? null,
      provenance: input.provenance,
      observedAt: input.observedAt,
    });
    titles.push(title);
  }
  return { rows, skipped, titles };
}

function asNamed(value: DmmNamedEntity | DmmNamedEntity[] | undefined): NamedId[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const out: NamedId[] = [];
  for (const row of list) {
    const name = row.name?.trim() ?? "";
    const id = row.id;
    if (!name || (typeof id !== "number" && typeof id !== "string")) continue;
    out.push({ id: String(id), name });
  }
  return out;
}

export function harvestArticleIds(items: DmmItem[]): {
  performers: NamedId[];
  genres: NamedId[];
  series: NamedId[];
  makers: NamedId[];
} {
  const buckets = {
    performers: new Map<string, NamedId>(),
    genres: new Map<string, NamedId>(),
    series: new Map<string, NamedId>(),
    makers: new Map<string, NamedId>(),
  };
  for (const item of items) {
    const info = item.iteminfo;
    if (!info) continue;
    for (const row of asNamed(info.actress)) buckets.performers.set(normalizeDemandText(row.name), row);
    for (const row of asNamed(info.genre)) buckets.genres.set(normalizeDemandText(row.name), row);
    for (const row of asNamed(info.series)) buckets.series.set(normalizeDemandText(row.name), row);
    for (const row of asNamed(info.maker)) buckets.makers.set(normalizeDemandText(row.name), row);
  }
  return {
    performers: [...buckets.performers.values()],
    genres: [...buckets.genres.values()],
    series: [...buckets.series.values()],
    makers: [...buckets.makers.values()],
  };
}

export function pickSegmentTargets(
  tags: Array<{ type: string; name: string }>,
  limits: { performer: number; genre: number; series: number; maker: number } = {
    performer: 6,
    genre: 6,
    series: 4,
    maker: 4,
  },
): SegmentTargets {
  const counts = new Map<string, { type: string; name: string; count: number }>();
  for (const tag of tags) {
    const type = tag.type.toLowerCase();
    const name = tag.name.trim();
    if (!name) continue;
    const key = `${type}|${normalizeDemandText(name)}`;
    if (type === "genre" && FORMAT_GENRES.has(normalizeDemandText(name))) continue;
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { type, name, count: 1 });
  }
  const take = (type: string, limit: number) =>
    [...counts.values()]
      .filter((row) => row.type === type)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"))
      .slice(0, limit)
      .map((row) => row.name);
  return {
    performers: take("actress", limits.performer),
    genres: take("genre", limits.genre),
    series: take("series", limits.series),
    makers: take("maker", limits.maker),
  };
}

function findId(rows: NamedId[], name: string): string | null {
  const key = normalizeDemandText(name);
  return rows.find((row) => normalizeDemandText(row.name) === key)?.id ?? null;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/api_id=[^&\s]+/gi, "api_id=[redacted]")
    .replace(/affiliate_id=[^&\s]+/gi, "affiliate_id=[redacted]")
    .slice(0, 300);
}

export type DemandListStat = {
  returned: number;
  uniqueRanks: number;
  uniqueContentIds: number;
  titlesPresent: number;
};

export type DemandCollectionSummary = {
  skipped: boolean;
  reason?: string;
  inserted: Record<string, number>;
  stats: Record<string, DemandListStat>;
  errors: string[];
  observedAt: string | null;
};

export async function runScheduledFanzaDemandCollection(deps: {
  prisma: DatabaseClient["prisma"];
  config: AppConfig;
  logger: Logger;
  now?: Date;
  client?: DmmApiClient;
}): Promise<DemandCollectionSummary> {
  const now = deps.now ?? new Date();
  const inserted: Record<string, number> = {};
  const stats: Record<string, DemandListStat> = {};
  const errors: string[] = [];
  let credentials: { apiId: string; affiliateId: string };
  try {
    credentials = requireDmmCredentials(deps.config);
  } catch (error) {
    return { skipped: true, reason: safeError(error), inserted, stats, errors, observedAt: null };
  }

  const dayStart = jstDayStart(now);
  const apiSources: DemandSource[] = [
    ...GLOBAL_LISTS.map((list) => list.source),
    ...DEMAND_SEGMENT_SOURCES,
  ];
  const already = await deps.prisma.demandObservation.findMany({
    where: { observedAt: { gte: dayStart }, source: { in: [...apiSources] } },
    distinct: ["source"],
    select: { source: true },
  });
  const done = new Set(already.map((row) => row.source));
  if (apiSources.every((source) => done.has(source))) {
    return { skipped: true, reason: "already_collected_today", inserted, stats, errors, observedAt: null };
  }

  const client =
    deps.client ??
    new DmmApiClient({
      apiId: credentials.apiId,
      affiliateId: credentials.affiliateId,
      baseUrl: deps.config.dmmApiBaseUrl,
      requestIntervalMs: deps.config.fanzaRequestIntervalMs,
      timeoutMs: deps.config.fanzaRequestTimeoutMs,
      maxRetries: deps.config.fanzaMaxRetries,
      logger: deps.logger,
    });

  const observedAt = now;
  const harvestedItems: DmmItem[] = [];

  for (const list of GLOBAL_LISTS) {
    if (done.has(list.source)) continue;
    try {
      const response = await client.getItemList({
        site: SITE,
        service: SERVICE,
        floor: FLOOR,
        sort: list.sort,
        hits: GLOBAL_HITS,
        offset: 1,
      });
      const items = response.result?.items ?? [];
      harvestedItems.push(...items);
      const mapped = itemListToDemandRows({
        source: list.source,
        items,
        observedAt,
        provenance: itemListProvenance(list.sort),
      });
      stats[list.source] = listStat(mapped.rows, mapped.titles.length);
      if (mapped.rows.length === 0) {
        errors.push(`${list.source}: empty`);
        continue;
      }
      const saved = await appendDemandObservations(deps.prisma, mapped.rows);
      if ("errors" in saved) {
        errors.push(`${list.source}: ${saved.errors.join("; ")}`);
        continue;
      }
      inserted[list.source] = saved.inserted;
      deps.logger.info(`demand collection ${list.source} inserted=${saved.inserted} skippedItems=${mapped.skipped}`);
    } catch (error) {
      errors.push(`${list.source}: ${safeError(error)}`);
      deps.logger.warn(`demand collection ${list.source} failed: ${safeError(error)}`);
    }
  }

  const needSegment = SEGMENT_LISTS.some((list) => !done.has(list.source));
  if (needSegment) {
    try {
      await collectSegments({
        prisma: deps.prisma,
        client,
        logger: deps.logger,
        observedAt,
        done,
        harvested: harvestArticleIds(harvestedItems),
        inserted,
        stats,
        errors,
      });
    } catch (error) {
      errors.push(`segment: ${safeError(error)}`);
      deps.logger.warn(`demand collection segment failed: ${safeError(error)}`);
    }
  }

  if (errors.length > 0) {
    deps.logger.warn(`demand collection errors=${errors.length}`);
  }
  return { skipped: false, inserted, stats, errors, observedAt: observedAt.toISOString() };
}

function listStat(rows: DemandObservationDraft[], titlesPresent: number): DemandListStat {
  return {
    returned: rows.length,
    uniqueRanks: new Set(rows.map((row) => `${row.keyword ?? ""}|${row.rank}`)).size,
    uniqueContentIds: new Set(rows.map((row) => `${row.keyword ?? ""}|${row.contentId}`)).size,
    titlesPresent,
  };
}

async function collectSegments(input: {
  prisma: DatabaseClient["prisma"];
  client: DmmApiClient;
  logger: Logger;
  observedAt: Date;
  done: Set<string>;
  harvested: ReturnType<typeof harvestArticleIds>;
  inserted: Record<string, number>;
  stats: Record<string, DemandListStat>;
  errors: string[];
}): Promise<void> {
  const { pool } = await loadDailyCandidatePool(input.prisma, {
    releaseAge: DEFAULT_RELEASE_AGE_THRESHOLDS,
    limit: 80,
    now: input.observedAt,
  });
  const ids = [...new Set(pool.map((candidate) => candidate.researchItemId).filter(Boolean))];
  const items = ids.length
    ? await input.prisma.researchItem.findMany({
        where: { id: { in: ids } },
        select: { tags: { select: { researchTag: { select: { type: true, name: true } } } } },
      })
    : [];
  const tags = items.flatMap((item) =>
    item.tags.map((tag) => ({ type: tag.researchTag.type, name: tag.researchTag.name })),
  );
  const targets = pickSegmentTargets(tags);
  const namesBySource: Record<(typeof SEGMENT_LISTS)[number]["source"], string[]> = {
    [FANZA_API_PERFORMER_POPULAR]: targets.performers,
    [FANZA_API_GENRE_POPULAR]: targets.genres,
    [FANZA_API_SERIES_POPULAR]: targets.series,
    [FANZA_API_MAKER_POPULAR]: targets.makers,
  };
  const idsBySource = {
    [FANZA_API_PERFORMER_POPULAR]: input.harvested.performers,
    [FANZA_API_GENRE_POPULAR]: input.harvested.genres,
    [FANZA_API_SERIES_POPULAR]: input.harvested.series,
    [FANZA_API_MAKER_POPULAR]: input.harvested.makers,
  };

  for (const list of SEGMENT_LISTS) {
    if (input.done.has(list.source)) continue;
    const rows: DemandObservationDraft[] = [];
    for (const name of namesBySource[list.source]) {
      let articleId = findId(idsBySource[list.source], name);
      if (!articleId && list.article === "actress") {
        try {
          articleId = await findActressId(input.client, name);
        } catch (error) {
          input.errors.push(`${list.source}: ${name}: ${safeError(error)}`);
          continue;
        }
      }
      if (!articleId) {
        input.errors.push(`${list.source}: unresolved ${name}`);
        continue;
      }
      try {
        const response = await input.client.getItemList({
          site: SITE,
          service: SERVICE,
          floor: FLOOR,
          sort: "rank",
          hits: SEGMENT_HITS,
          offset: 1,
          article: list.article,
          articleId,
        });
        const mapped = itemListToDemandRows({
          source: list.source,
          items: response.result?.items ?? [],
          observedAt: input.observedAt,
          provenance: itemListProvenance(
            "rank",
            `article=${list.article} article_id=${articleId}`,
          ),
          keyword: name,
          semanticType: list.kind === "performer" ? "PERFORMER" : list.kind === "genre" ? "GENRE" : "OTHER",
        });
        rows.push(...mapped.rows);
      } catch (error) {
        input.errors.push(`${list.source}: ${name}: ${safeError(error)}`);
      }
    }
    input.stats[list.source] = listStat(rows, rows.length);
    if (rows.length === 0) {
      input.errors.push(`${list.source}: empty`);
      continue;
    }
    const saved = await appendDemandObservations(input.prisma, rows);
    if ("errors" in saved) {
      input.errors.push(`${list.source}: ${saved.errors.join("; ")}`);
      continue;
    }
    input.inserted[list.source] = saved.inserted;
    input.logger.info(`demand collection ${list.source} inserted=${saved.inserted}`);
  }
}

async function findActressId(client: DmmApiClient, name: string): Promise<string | null> {
  const response = await client.getActressSearch({ keyword: name, hits: 20, floor: FLOOR });
  const rows = asNamed(response.result?.actress);
  return findId(rows, name);
}
