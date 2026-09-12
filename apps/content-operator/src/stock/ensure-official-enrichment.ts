/**
 * Ensure ItemList discovery rows get official enrichment before Writer.
 * ItemList alone is DISCOVERY/BASIC METADATA — not complete Evidence.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { LifecycleRepository, ResearchRepository } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { ingestFanzaPageEvidence } from "../ops/ingest-fanza-page-evidence.js";
import { buildFanzaCanonicalProductUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";

export type OfficialEnrichmentStatus =
  | "PAGE_ENRICHED"
  | "ITEMLIST_SYNTHESIZED"
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

/** Extract actress/genre/maker/series/runtime from FANZA ItemList rawData. */
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
  const volume = typeof raw.volume === "string" ? raw.volume : null;
  const durationMatch = volume?.match(/(\d+)\s*分/);
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
  if (shape === "MULTI_PERFORMER" || shape === "BEST_COMPILATION") {
    // Exception: official title clearly centers one attested name and no other cast in title.
    const attested = input.actors.filter((a) => a && input.productTitle.includes(a));
    if (attested.length === 1 && input.actors.length >= 2) {
      // Still multi-cast product — do not singularize unless title exclusivity is extreme.
      return true;
    }
    return true;
  }
  return false;
}

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
  let pe = existing ? readPageEvidenceFromDocMetadata(existing.metadata) : null;
  let hasDescription = Boolean(pe?.description?.text?.trim());
  let actors = [...(pe?.actors ?? [])].map((a) => String(a).trim()).filter(Boolean);
  let genres = (pe?.catalog?.genres ?? [])
    .map((g) => (typeof g?.value === "string" ? g.value.trim() : ""))
    .filter(Boolean);

  if (hasDescription && actors.length > 0) {
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

  if (input.config.researchAllowExternalRequests && !hasDescription) {
    fetchAttempted = true;
    try {
      const ingested = await ingestFanzaPageEvidence({
        lifecycle: input.lifecycle,
        research: input.research,
        productUrl: input.productUrl || buildFanzaCanonicalProductUrl(input.canonicalId),
        contentId: input.canonicalId,
        fetchOptions: {
          confirmExternal: true,
          config: input.config,
          allowBrowserFallback: true,
        },
      });
      sourceDocumentId = ingested.sourceDocumentId ?? sourceDocumentId;
      if (ingested.evidence) {
        hasDescription = Boolean(ingested.evidence.description?.text?.trim());
        actors = [...(ingested.evidence.actors ?? [])].filter(Boolean);
        genres = (ingested.evidence.catalog?.genres ?? [])
          .map((g) => g.value)
          .filter(Boolean);
        if (hasDescription) {
          return {
            status: "PAGE_ENRICHED",
            sourceDocumentId,
            hasDescription: true,
            actorCount: actors.length,
            genreCount: genres.length,
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

  const catalog = extractItemListCatalogFacts(input.rawData);
  if (actors.length === 0) actors = catalog.actors;
  if (genres.length === 0) genres = catalog.genres;

  if (actors.length === 0 && genres.length === 0 && !hasDescription && !catalog.makers.length) {
    return {
      status: "NEEDS_ENRICHMENT",
      sourceDocumentId,
      hasDescription: false,
      actorCount: 0,
      genreCount: 0,
      fetchAttempted,
    };
  }

  // Persist ItemList-derived pageEvidence so Writer/title SSOT sees full cast.
  const synthesized: PageEvidenceShape = {
    productName: catalog.productName ?? input.productTitle,
    actors,
    description: hasDescription ? pe?.description : null,
    catalog: {
      genres: genres.map((value) => ({ value })),
      maker: catalog.makers[0] ? { value: catalog.makers[0] } : pe?.catalog?.maker ?? null,
      series: catalog.series[0] ? { value: catalog.series[0] } : pe?.catalog?.series ?? null,
      durationMinutes:
        catalog.durationMinutes != null
          ? { value: catalog.durationMinutes }
          : pe?.catalog?.durationMinutes ?? null,
    },
  };

  const metaPatch = {
    pageEvidence: {
      ...synthesized,
      synthesizedFrom: "itemlist",
      fetchedAt: new Date().toISOString(),
    },
    role: "page_evidence",
  };

  if (sourceDocumentId) {
    await input.lifecycle.updateSourceDocumentMetadata(sourceDocumentId, metaPatch);
  } else {
    const created = await input.lifecycle.createSourceDocument({
      sourceKey: "fanza-itemlist-evidence",
      documentType: "product",
      externalId: input.canonicalId,
      url: input.productUrl || buildFanzaCanonicalProductUrl(input.canonicalId),
      title: `FANZA ItemList evidence: ${input.canonicalId}`,
      robotsAllowed: true,
      normalizedText: [
        `contentId: ${input.canonicalId}`,
        `actors: ${actors.join(", ") || "absent"}`,
        `genres: ${genres.join(", ") || "absent"}`,
        hasDescription ? "description: present" : "description: absent",
      ].join("\n"),
      metadata: metaPatch,
    });
    sourceDocumentId = created.id;
  }

  return {
    status: "ITEMLIST_SYNTHESIZED",
    sourceDocumentId,
    hasDescription,
    actorCount: actors.length,
    genreCount: genres.length,
    fetchAttempted,
  };
}
