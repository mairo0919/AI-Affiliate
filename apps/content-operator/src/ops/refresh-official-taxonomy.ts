/**
 * Re-fetch FANZA product page evidence for existing ResearchItems and
 * persist officialGenres / officialRelatedTags onto Research SSOT.
 * Fail-closed: on fetch/extract failure, leave existing Evidence untouched.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, LifecycleRepository, ResearchRepository } from "@ai-affiliate/database";
import { ingestFanzaPageEvidence } from "./ingest-fanza-page-evidence.js";
import { buildFanzaCanonicalProductUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type RefreshOfficialTaxonomyRow = {
  externalId: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  genreCount: number;
  relatedTagCount: number;
  genres: string[];
  relatedTags: string[];
};

export type RefreshOfficialTaxonomyResult = {
  rows: RefreshOfficialTaxonomyRow[];
  totals: {
    attempted: number;
    succeeded: number;
    skipped: number;
    failed: number;
    withGenres: number;
    withRelatedTags: number;
    genreLabelTotal: number;
    relatedTagLabelTotal: number;
    uniqueGenreCanonical: number;
    uniqueRelatedTagCanonical: number;
  };
};

function isLikelyContentId(id: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{2,40}$/i.test(id.trim());
}

export async function refreshOfficialTaxonomyForResearchItems(input: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  research: ResearchRepository;
  config: AppConfig;
  /** Limit how many items to process (default: all). */
  limit?: number;
  intervalMs?: number;
  externalIds?: string[];
}): Promise<RefreshOfficialTaxonomyResult> {
  const intervalMs = Math.max(0, input.intervalMs ?? 1200);
  let externalIds = (input.externalIds ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter((s) => isLikelyContentId(s));

  if (externalIds.length === 0) {
    const rows = await input.database.prisma.researchItem.findMany({
      select: { externalId: true },
      orderBy: { collectedAt: "desc" },
    });
    const seen = new Set<string>();
    for (const row of rows) {
      const id = row.externalId.trim().toLowerCase();
      if (!isLikelyContentId(id) || seen.has(id)) continue;
      seen.add(id);
      externalIds.push(id);
    }
  }

  if (input.limit && input.limit > 0) {
    externalIds = externalIds.slice(0, input.limit);
  }

  const rows: RefreshOfficialTaxonomyRow[] = [];
  const genreSet = new Set<string>();
  const relatedSet = new Set<string>();

  for (let i = 0; i < externalIds.length; i += 1) {
    const externalId = externalIds[i]!;
    if (intervalMs > 0) await sleep(intervalMs);
    try {
      const result = await ingestFanzaPageEvidence({
        lifecycle: input.lifecycle,
        research: input.research,
        productUrl: buildFanzaCanonicalProductUrl(externalId),
        contentId: externalId,
        fetchOptions: {
          confirmExternal: true,
          config: input.config,
          allowBrowserFallback: true,
        },
      });

      if (!result.evidence || result.evidence.extractMode === "empty") {
        rows.push({
          externalId,
          ok: false,
          skipped: true,
          reason: result.fetch.reason ?? "empty_evidence",
          genreCount: 0,
          relatedTagCount: 0,
          genres: [],
          relatedTags: [],
        });
        console.error(
          `[official-taxonomy] ${i + 1}/${externalIds.length} ${externalId} skip=${result.fetch.reason ?? "empty"}`,
        );
        continue;
      }

      const genres = result.officialGenres ?? result.evidence.catalog.genres.map((g) => g.value);
      const relatedTags =
        result.officialRelatedTags ?? result.evidence.catalog.relatedTags.map((t) => t.value);
      for (const g of genres) genreSet.add(g.replace(/\s+/g, "").toLowerCase());
      for (const t of relatedTags) relatedSet.add(t.replace(/\s+/g, "").toLowerCase());

      rows.push({
        externalId,
        ok: true,
        genreCount: genres.length,
        relatedTagCount: relatedTags.length,
        genres,
        relatedTags,
      });
      console.error(
        `[official-taxonomy] ${i + 1}/${externalIds.length} ${externalId} genres=${genres.length} related=${relatedTags.length}`,
      );
    } catch (error) {
      rows.push({
        externalId,
        ok: false,
        reason: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
        genreCount: 0,
        relatedTagCount: 0,
        genres: [],
        relatedTags: [],
      });
      console.error(
        `[official-taxonomy] ${i + 1}/${externalIds.length} ${externalId} fail=${error instanceof Error ? error.message.slice(0, 80) : String(error).slice(0, 80)}`,
      );
    }
  }

  const succeeded = rows.filter((r) => r.ok);
  return {
    rows,
    totals: {
      attempted: rows.length,
      succeeded: succeeded.length,
      skipped: rows.filter((r) => r.skipped).length,
      failed: rows.filter((r) => !r.ok && !r.skipped).length,
      withGenres: succeeded.filter((r) => r.genreCount > 0).length,
      withRelatedTags: succeeded.filter((r) => r.relatedTagCount > 0).length,
      genreLabelTotal: succeeded.reduce((n, r) => n + r.genreCount, 0),
      relatedTagLabelTotal: succeeded.reduce((n, r) => n + r.relatedTagCount, 0),
      uniqueGenreCanonical: genreSet.size,
      uniqueRelatedTagCanonical: relatedSet.size,
    },
  };
}
