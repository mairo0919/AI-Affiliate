/**
 * FANZA_API_POPULAR as a Research discovery source.
 * Uses the existing DMM ItemList client, mapper, and ResearchRepository.
 * Does not ingest NEW, REVIEW, or segment lists.
 */

import type { AppConfig } from "@ai-affiliate/config";
import { requireDmmCredentials } from "@ai-affiliate/config";
import { ResearchRepository, type DatabaseClient } from "@ai-affiliate/database";
import type { CollectedResearchItem, JsonValue, Logger } from "@ai-affiliate/shared";
import { DmmApiClient } from "../providers/fanza/dmm-api-client.js";
import type { DmmItem } from "../providers/fanza/dmm-api-types.js";
import { mapDmmItemToCollected } from "../providers/fanza/fanza-mapper.js";
import { loadLatestDemandSnapshot } from "./demand-store.js";
import { FANZA_API_POPULAR } from "./demand-signal.js";
import { jstDayStart } from "./demand-collector.js";

export const POPULAR_DISCOVERY_DAILY_CAP = 20;
const DISCOVERY_SOURCE_KEY = "demandDiscoverySource";

export type PopularDiscoveryResult = {
  created: number;
  skippedExisting: number;
  skippedByCap: number;
  fetched: number;
  analyzed: number;
  candidates: number;
  contentIds: string[];
  errors: string[];
};

export function selectPopularDiscoveries(input: {
  ranked: Array<{ contentId: string; rank: number }>;
  existingExternalIds: ReadonlySet<string>;
  alreadyCreatedToday: number;
  cap?: number;
}): { selected: Array<{ contentId: string; rank: number }>; skippedExisting: number; skippedByCap: number } {
  const cap = Math.max(0, input.cap ?? POPULAR_DISCOVERY_DAILY_CAP);
  const remaining = Math.max(0, cap - Math.max(0, input.alreadyCreatedToday));
  const ordered = input.ranked
    .map((row) => ({ contentId: row.contentId.trim(), rank: row.rank }))
    .filter((row) => row.contentId && Number.isInteger(row.rank) && row.rank >= 1)
    .sort((a, b) => a.rank - b.rank || a.contentId.localeCompare(b.contentId));
  const seen = new Set<string>();
  const missing: Array<{ contentId: string; rank: number }> = [];
  let skippedExisting = 0;
  for (const row of ordered) {
    const key = row.contentId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (input.existingExternalIds.has(key)) {
      skippedExisting += 1;
      continue;
    }
    missing.push(row);
  }
  return {
    selected: missing.slice(0, remaining),
    skippedExisting,
    skippedByCap: Math.max(0, missing.length - remaining),
  };
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/api_id=[^&\s]+/gi, "api_id=[redacted]")
    .replace(/affiliate_id=[^&\s]+/gi, "affiliate_id=[redacted]")
    .slice(0, 300);
}

function stampDiscovery(item: CollectedResearchItem): CollectedResearchItem {
  const raw =
    item.rawData && typeof item.rawData === "object" && !Array.isArray(item.rawData)
      ? { ...(item.rawData as Record<string, JsonValue>), [DISCOVERY_SOURCE_KEY]: FANZA_API_POPULAR }
      : { [DISCOVERY_SOURCE_KEY]: FANZA_API_POPULAR };
  return { ...item, rawData: raw };
}

export async function runFanzaPopularDemandDiscovery(deps: {
  prisma: DatabaseClient["prisma"];
  config: AppConfig;
  logger: Logger;
  now?: Date;
  client?: DmmApiClient;
  cap?: number;
  onCreated?: (contentIds: string[]) => Promise<{ analyzed: number; candidates: number } | void>;
}): Promise<PopularDiscoveryResult> {
  const now = deps.now ?? new Date();
  const empty: PopularDiscoveryResult = {
    created: 0,
    skippedExisting: 0,
    skippedByCap: 0,
    fetched: 0,
    analyzed: 0,
    candidates: 0,
    contentIds: [],
    errors: [],
  };
  let credentials: { apiId: string; affiliateId: string };
  try {
    credentials = requireDmmCredentials(deps.config);
  } catch (error) {
    return { ...empty, errors: [safeError(error)] };
  }

  const snapshot = await loadLatestDemandSnapshot(deps.prisma);
  const ranked = snapshot
    .filter((row) => row.source === FANZA_API_POPULAR && row.contentId)
    .map((row) => ({ contentId: row.contentId!, rank: row.rank }));
  if (ranked.length === 0) return empty;

  const ids = [...new Set(ranked.map((row) => row.contentId))];
  const existingRows = await deps.prisma.researchItem.findMany({
    where: { externalId: { in: ids } },
    select: { externalId: true },
  });
  const existing = new Set(existingRows.map((row) => row.externalId.trim().toLowerCase()));
  const dayStart = jstDayStart(now);
  const alreadyCreatedToday = await deps.prisma.researchItem.count({
    where: {
      createdAt: { gte: dayStart },
      rawData: { path: [DISCOVERY_SOURCE_KEY], equals: FANZA_API_POPULAR },
    },
  });
  const picked = selectPopularDiscoveries({
    ranked,
    existingExternalIds: existing,
    alreadyCreatedToday,
    cap: deps.cap,
  });
  if (picked.selected.length === 0) {
    return {
      ...empty,
      skippedExisting: picked.skippedExisting,
      skippedByCap: picked.skippedByCap,
    };
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

  const collected: CollectedResearchItem[] = [];
  const contentIds: string[] = [];
  const errors: string[] = [];
  for (const row of picked.selected) {
    try {
      const response = await client.getItemList({
        site: "FANZA",
        service: "digital",
        floor: "videoa",
        cid: row.contentId,
        hits: 1,
      });
      const item = (response.result?.items ?? []).find(
        (entry: DmmItem) => entry.content_id?.trim().toLowerCase() === row.contentId.toLowerCase(),
      );
      if (!item?.content_id || !item.title?.trim()) {
        errors.push(`${row.contentId}: api_miss`);
        continue;
      }
      const mapped = mapDmmItemToCollected(item, {
        collectedAt: now,
        recordedAt: now,
        includeRankingMetric: true,
        rankingPosition: row.rank,
      });
      if (!mapped.item) {
        errors.push(`${row.contentId}: map_failed`);
        continue;
      }
      collected.push(stampDiscovery(mapped.item));
      contentIds.push(mapped.item.externalId);
    } catch (error) {
      errors.push(`${row.contentId}: ${safeError(error)}`);
    }
  }

  if (collected.length === 0) {
    return {
      ...empty,
      skippedExisting: picked.skippedExisting,
      skippedByCap: picked.skippedByCap,
      errors,
    };
  }

  const research = new ResearchRepository(deps.prisma);
  const saved = await research.saveCollection({
    providerName: "fanza",
    collectedAt: now,
    items: collected,
  });
  let analyzed = 0;
  let candidates = 0;
  if (saved.createdCount > 0 && deps.onCreated) {
    try {
      const attached = await deps.onCreated(contentIds);
      analyzed = attached?.analyzed ?? 0;
      candidates = attached?.candidates ?? 0;
    } catch (error) {
      errors.push(`analysis: ${safeError(error)}`);
    }
  }
  deps.logger.info(
    `popular demand discovery created=${saved.createdCount} fetched=${collected.length} skippedExisting=${picked.skippedExisting} skippedByCap=${picked.skippedByCap} analyzed=${analyzed} candidates=${candidates}`,
  );
  return {
    created: saved.createdCount,
    skippedExisting: picked.skippedExisting,
    skippedByCap: picked.skippedByCap,
    fetched: collected.length,
    analyzed,
    candidates,
    contentIds,
    errors,
  };
}
