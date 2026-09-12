/**
 * Ensure ItemList discovery rows get official page Evidence before Writer.
 * ItemList alone is DISCOVERY/BASIC METADATA — never Writer-complete Evidence.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { LifecycleRepository, ResearchRepository } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { ingestFanzaPageEvidence } from "../ops/ingest-fanza-page-evidence.js";
import { buildFanzaCanonicalProductUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";

export type OfficialEnrichmentStatus =
  | "PAGE_ENRICHED"
  | "ALREADY_PRESENT"
  | "NEEDS_ENRICHMENT";

export interface OfficialEnrichmentResult {
  status: OfficialEnrichmentStatus;
  sourceDocumentId: string | null;
  hasDescription: boolean;
  actorCount: number;
  genreCount: number;
  fetchAttempted: boolean;
}

type PageEvidenceShape = {
  actors?: string[];
  description?: { text?: string } | null;
  catalog?: {
    genres?: Array<{ value?: string }>;
    maker?: { value?: string } | null;
    series?: { value?: string } | null;
    durationMinutes?: { value?: number } | null;
  };
  productName?: string | null;
  synthesizedFrom?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function itemInfoNames(raw: unknown): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry === "string" && entry.trim()) {
      out.push(entry.trim());
      continue;
    }
    const rec = asRecord(entry);
    const name = typeof rec?.name === "string" ? rec.name.trim() : "";
    if (name) out.push(name);
  }
  return [...new Set(out)];
}

/** Extract actress/genre/maker/series/runtime from FANZA ItemList rawData (normalize only). */
export function extractItemListCatalogFacts(rawData: unknown): {
  actors: string[];
  genres: string[];
  makers: string[];
  series: string[];
  durationMinutes: number | null;
  productName: string | null;
} {
  const raw = asRecord(rawData) ?? {};
  const iteminfo = asRecord(raw.iteminfo) ?? {};
  const volume =
    typeof raw.volume === "string"
      ? raw.volume
      : typeof raw.volume === "number"
        ? String(raw.volume)
        : null;
  const durationMatch = volume?.match(/(\d+)\s*(?:分)?/);
  const durationMinutes = durationMatch ? Number.parseInt(durationMatch[1]!, 10) : null;
  const title =
    typeof raw.title === "string"
      ? raw.title
      : typeof raw.productName === "string"
        ? raw.productName
        : null;
  return {
    actors: itemInfoNames(iteminfo.actress),
    genres: itemInfoNames(iteminfo.genre),
    makers: itemInfoNames(iteminfo.maker),
    series: itemInfoNames(iteminfo.series),
    durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : null,
    productName: title,
  };
}

export function readPageEvidenceFromDocMetadata(metadata: unknown): PageEvidenceShape | null {
  const meta = asRecord(metadata);
  const pe = meta?.pageEvidence;
  return asRecord(pe) as PageEvidenceShape | null;
}

export function classifyCastShape(input: {
  actors: string[];
  productTitle: string;
}): "SINGLE_PERFORMER" | "MULTI_PERFORMER" | "BEST_COMPILATION" | "UNKNOWN" {
  const title = input.productTitle;
  const isBest = /ベスト|総集編|\bBEST\b/i.test(title);
  if (isBest && input.actors.length !== 1) return "BEST_COMPILATION";
  if (input.actors.length >= 2) return isBest ? "BEST_COMPILATION" : "MULTI_PERFORMER";
  if (input.actors.length === 1) return isBest ? "BEST_COMPILATION" : "SINGLE_PERFORMER";
  if (isBest) return "BEST_COMPILATION";
  return "UNKNOWN";
}

/**
 * True when a single named performer must not be framed as the sole star.
 */
export function shouldAvoidSingularPerformerFraming(input: {
  actors: string[];
  productTitle: string;
}): boolean {
  const shape = classifyCastShape(input);
  if (input.actors.length <= 1) return false;
  return shape === "MULTI_PERFORMER" || shape === "BEST_COMPILATION";
}

function isUsableOfficialPageEvidence(pe: PageEvidenceShape | null): boolean {
  if (!pe) return false;
  if (!pe.description?.text?.trim()) return false;
  // Reject ItemList-only synth unless a real page fetch stamped fetchMode.
  if (pe.synthesizedFrom === "itemlist") {
    const peRec = pe as PageEvidenceShape & { fetchMode?: string };
    if (!peRec.fetchMode) return false;
  }
  return true;
}

/**
 * Official page enrichment only. Never synthesizes ItemList into Writer Evidence.
 * Missing page description → NEEDS_ENRICHMENT (ResearchItem retained).
 */
export async function ensureOfficialEnrichmentForStockItem(input: {
  lifecycle: LifecycleRepository;
  research: ResearchRepository;
  config: AppConfig;
  logger: Logger;
  canonicalId: string;
  productUrl: string;
  researchItemId: string;
  productTitle: string;
  rawData: unknown;
}): Promise<OfficialEnrichmentResult> {
  const existing = await input.lifecycle.findLatestSourceDocumentByUrlContains(input.canonicalId);
  const pe = existing ? readPageEvidenceFromDocMetadata(existing.metadata) : null;
  const actors = [...(pe?.actors ?? [])].map((a) => String(a).trim()).filter(Boolean);
  const genres = (pe?.catalog?.genres ?? [])
    .map((g) => (typeof g?.value === "string" ? g.value.trim() : ""))
    .filter(Boolean);

  if (isUsableOfficialPageEvidence(pe) && actors.length > 0) {
    return {
      status: "ALREADY_PRESENT",
      sourceDocumentId: existing?.id ?? null,
      hasDescription: true,
      actorCount: actors.length,
      genreCount: genres.length,
      fetchAttempted: false,
    };
  }

  let fetchAttempted = false;
  let sourceDocumentId = existing?.id ?? null;

  if (input.config.researchAllowExternalRequests) {
    fetchAttempted = true;
    try {
      const ingested = await ingestFanzaPageEvidence({
        lifecycle: input.lifecycle,
        research: input.research,
        // Always fetch the official product page — affiliate wrappers do not yield pageEvidence.
        productUrl: buildFanzaCanonicalProductUrl(input.canonicalId),
        contentId: input.canonicalId,
        fetchOptions: {
          confirmExternal: true,
          config: input.config,
          allowBrowserFallback: true,
        },
      });
      sourceDocumentId = ingested.sourceDocumentId ?? sourceDocumentId;
      if (ingested.evidence) {
        const hasDescription = Boolean(ingested.evidence.description?.text?.trim());
        const pageActors = [...(ingested.evidence.actors ?? [])].filter(Boolean);
        const pageGenres = (ingested.evidence.catalog?.genres ?? [])
          .map((g) => g.value)
          .filter(Boolean);
        if (hasDescription) {
          return {
            status: "PAGE_ENRICHED",
            sourceDocumentId,
            hasDescription: true,
            actorCount: pageActors.length,
            genreCount: pageGenres.length,
            fetchAttempted,
          };
        }
      }
    } catch (error) {
      input.logger.warn(
        `official page enrichment failed cid=${input.canonicalId} err=${
          error instanceof Error ? error.message.slice(0, 160) : String(error)
        }`,
      );
    }
  }

  // ItemList metadata alone is never enough for Writer.
  const catalog = extractItemListCatalogFacts(input.rawData);
  return {
    status: "NEEDS_ENRICHMENT",
    sourceDocumentId,
    hasDescription: false,
    actorCount: actors.length || catalog.actors.length,
    genreCount: genres.length || catalog.genres.length,
    fetchAttempted,
  };
}
