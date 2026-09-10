/**
 * FANZA official product page evidence extraction (LLM=0, no video binary).
 *
 * Priority: JSON-LD structured data → lightweight gallery DOM scrape.
 * Movie evidence is META ONLY (never download mp4/m3u8).
 */

import { imageContentKey, isTrustedDmmImageUrl } from "../../generation/article-images.js";
import {
  emptyPageCatalog,
  extractPageCatalogEvidence,
  mergeCanonicalCatalog,
  type PageCatalogEvidence,
} from "./fanza-page-catalog.js";

export type {
  CatalogFieldProvenance,
  CatalogNumberValue,
  CatalogStringValue,
  PageCatalogEvidence,
} from "./fanza-page-catalog.js";
export { mergeCanonicalCatalog, normalizeReleaseDate } from "./fanza-page-catalog.js";

export const FANZA_PAGE_EVIDENCE_SOURCE = "fanza_product_page" as const;

export type PageEvidenceImage = {
  sourceUrl: string;
  contentKey: string;
  family: "package" | "sample" | "other";
  imageType: "main_large" | "main_small" | "main_list" | "sample_large" | "sample_small" | "page_reference";
  qualityRank: number;
  originField: string;
  usageStatus: "REQUIRES_CONFIRMATION";
  provenance: typeof FANZA_PAGE_EVIDENCE_SOURCE;
};

export type PageVideoEvidence = {
  source: typeof FANZA_PAGE_EVIDENCE_SOURCE;
  type: "sample_movie_meta";
  playerUrl?: string | null;
  contentUrl?: string | null;
  thumbnailUrl?: string | null;
  uploadDate?: string | null;
  description?: string | null;
  actor?: string[] | null;
  originField: string;
  allowedForGeneration: false;
  allowedForVision: false;
};

export type PageDescriptionEvidence = {
  source: typeof FANZA_PAGE_EVIDENCE_SOURCE;
  evidenceType: "official_page_description";
  text: string;
  originField: string;
  provenance: "jsonld";
  /** Not auto-promoted to Generator fuel in this phase. */
  allowedForGeneration: false;
};

export type FanzaPageEvidence = {
  source: typeof FANZA_PAGE_EVIDENCE_SOURCE;
  contentId: string | null;
  /** Official product title from page (JSON-LD Product.name preferred). */
  productName: string | null;
  /** Provenance for productName when present. */
  productNameProvenance: "page_json_ld" | "page_dom" | null;
  productNameOriginField: string | null;
  /** Canonical catalog metadata (maker/label/series/genres/duration/release/sku). */
  catalog: PageCatalogEvidence;
  images: PageEvidenceImage[];
  uniquePackageCount: number;
  uniqueSampleSceneCount: number;
  video: PageVideoEvidence | null;
  description: PageDescriptionEvidence | null;
  actors: string[];
  extractMode: "jsonld" | "gallery_dom" | "jsonld+gallery" | "empty";
  originFields: string[];
};

export type MergedProductImageEvidence = {
  contentKey: string;
  family: "package" | "sample" | "other";
  bestUrl: string;
  imageType: string;
  qualityRank: number;
  sources: Array<"item_list" | "fanza_product_page">;
  originFields: string[];
  usageStatus: "REQUIRES_CONFIRMATION" | "ALLOWED";
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = (m[1] ?? "").trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

function flattenJsonLd(nodes: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (n: unknown) => {
    if (!n) return;
    if (Array.isArray(n)) {
      for (const x of n) visit(x);
      return;
    }
    if (typeof n !== "object") return;
    const obj = n as Record<string, unknown>;
    out.push(obj);
    if (obj["@graph"]) visit(obj["@graph"]);
    if (obj.subjectOf) visit(obj.subjectOf);
  };
  for (const n of nodes) visit(n);
  return out;
}

function typeOf(obj: Record<string, unknown>): string[] {
  const t = obj["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

function classifyPageImageUrl(
  url: string,
  originField: string,
): PageEvidenceImage | null {
  if (!isTrustedDmmImageUrl(url)) return null;
  const identity = imageContentKey(url);
  if (!identity) return null;
  let imageType: PageEvidenceImage["imageType"] = "page_reference";
  if (identity.family === "package") {
    imageType =
      identity.qualityHint >= 100
        ? "main_large"
        : identity.qualityHint >= 80
          ? "main_list"
          : "main_small";
  } else if (identity.family === "sample") {
    imageType = identity.qualityHint >= 100 ? "sample_large" : "sample_small";
  }
  return {
    sourceUrl: url.split("?")[0]!,
    contentKey: identity.contentKey,
    family: identity.family,
    imageType,
    qualityRank: identity.qualityHint,
    originField,
    usageStatus: "REQUIRES_CONFIRMATION",
    provenance: FANZA_PAGE_EVIDENCE_SOURCE,
  };
}

function dedupeImages(images: PageEvidenceImage[]): PageEvidenceImage[] {
  const best = new Map<string, PageEvidenceImage>();
  for (const img of images) {
    const prev = best.get(img.contentKey);
    if (!prev || img.qualityRank > prev.qualityRank) {
      best.set(img.contentKey, img);
    }
  }
  return [...best.values()].sort((a, b) => {
    if (a.family !== b.family) {
      if (a.family === "package") return -1;
      if (b.family === "package") return 1;
    }
    return a.contentKey.localeCompare(b.contentKey);
  });
}

/**
 * Extract all sample/package image URLs from [data-e2eid=sample-image-gallery].
 * Unlike browser research hero extract, this keeps the full gallery.
 */
export function extractGalleryImageUrls(html: string): string[] {
  const block = html.match(
    /data-e2eid=["']sample-image-gallery["'][\s\S]{0,120000}?(?=data-e2eid=["'](?!sample-image-gallery)|<\/section>|<\/div>\s*<div[^>]+data-e2eid|$)/i,
  );
  const scope = block?.[0] ?? "";
  if (!scope) return [];
  const urls: string[] = [];
  for (const m of scope.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const u = (m[1] ?? "").split("?")[0];
    if (u) urls.push(u);
  }
  for (const m of scope.matchAll(/data-src=["']([^"']+)["']/gi)) {
    const u = (m[1] ?? "").split("?")[0];
    if (u) urls.push(u);
  }
  return [...new Set(urls)];
}

export function extractFanzaPageEvidenceFromHtml(input: {
  html: string;
  contentIdHint?: string | null;
}): FanzaPageEvidence {
  const jsonLdNodes = flattenJsonLd(parseJsonLdBlocks(input.html));
  const images: PageEvidenceImage[] = [];
  const originFields: string[] = [];
  let video: PageVideoEvidence | null = null;
  let description: PageDescriptionEvidence | null = null;
  const actors: string[] = [];
  let contentId: string | null = input.contentIdHint?.trim() || null;
  let productName: string | null = null;
  let productNameProvenance: FanzaPageEvidence["productNameProvenance"] = null;
  let productNameOriginField: string | null = null;
  let usedJsonLd = false;
  let usedGallery = false;

  for (const node of jsonLdNodes) {
    const types = typeOf(node);
    if (types.includes("Product")) {
      usedJsonLd = true;
      if (typeof node.sku === "string" && node.sku.trim()) {
        contentId = contentId ?? node.sku.trim();
      }
      if (typeof node.name === "string" && node.name.trim() && !productName) {
        productName = node.name.trim();
        productNameProvenance = "page_json_ld";
        productNameOriginField = "jsonld.Product.name";
        originFields.push("jsonld.Product.name");
      }
      for (const raw of asArray(node.image as string | string[] | undefined)) {
        if (typeof raw !== "string") continue;
        const img = classifyPageImageUrl(raw, "jsonld.Product.image");
        if (img) {
          images.push(img);
          originFields.push("jsonld.Product.image");
        }
      }
      if (typeof node.description === "string" && node.description.trim() && !description) {
        description = {
          source: FANZA_PAGE_EVIDENCE_SOURCE,
          evidenceType: "official_page_description",
          text: node.description.trim(),
          originField: "jsonld.Product.description",
          provenance: "jsonld",
          allowedForGeneration: false,
        };
        originFields.push("jsonld.Product.description");
      }
    }

    if (types.includes("VideoObject")) {
      usedJsonLd = true;
      const actorNames: string[] = [];
      for (const a of asArray(node.actor as unknown)) {
        if (a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string") {
          actorNames.push(String((a as { name: string }).name).trim());
        } else if (typeof a === "string") {
          actorNames.push(a.trim());
        }
      }
      for (const n of actorNames) {
        if (n && !actors.includes(n)) actors.push(n);
      }
      video = {
        source: FANZA_PAGE_EVIDENCE_SOURCE,
        type: "sample_movie_meta",
        contentUrl: typeof node.contentUrl === "string" ? node.contentUrl : null,
        thumbnailUrl: typeof node.thumbnailUrl === "string" ? node.thumbnailUrl : null,
        uploadDate: typeof node.uploadDate === "string" ? node.uploadDate : null,
        description: typeof node.description === "string" ? node.description : null,
        actor: actorNames.length ? actorNames : null,
        playerUrl: null,
        originField: "jsonld.VideoObject",
        allowedForGeneration: false,
        allowedForVision: false,
      };
      originFields.push("jsonld.VideoObject");
      if (video.thumbnailUrl) {
        const thumb = classifyPageImageUrl(video.thumbnailUrl, "jsonld.VideoObject.thumbnailUrl");
        if (thumb) images.push(thumb);
      }
    }
  }

  // litevideo / player link (meta only)
  const lite = htmlMatchFirst(
    input.html,
    /href=["'](https?:\/\/(?:www\.)?dmm\.co\.jp\/litevideo[^"']*)["']/i,
  );
  if (lite) {
    if (!video) {
      video = {
        source: FANZA_PAGE_EVIDENCE_SOURCE,
        type: "sample_movie_meta",
        playerUrl: lite,
        contentUrl: null,
        thumbnailUrl: null,
        uploadDate: null,
        description: null,
        actor: null,
        originField: "dom.a[href*=litevideo]",
        allowedForGeneration: false,
        allowedForVision: false,
      };
    } else if (!video.playerUrl) {
      video = { ...video, playerUrl: lite };
    }
    originFields.push("dom.a[href*=litevideo]");
  }

  const galleryUrls = extractGalleryImageUrls(input.html);
  if (galleryUrls.length > 0) {
    usedGallery = true;
    for (const u of galleryUrls) {
      const img = classifyPageImageUrl(u, "dom.sample-image-gallery");
      if (img) {
        images.push(img);
        originFields.push("dom.sample-image-gallery");
      }
    }
  }

  const unique = dedupeImages(images);
  const uniquePackageCount = unique.filter((i) => i.family === "package").length;
  const uniqueSampleSceneCount = unique.filter((i) => i.family === "sample").length;

  let extractMode: FanzaPageEvidence["extractMode"] = "empty";
  if (usedJsonLd && usedGallery) extractMode = "jsonld+gallery";
  else if (usedJsonLd) extractMode = "jsonld";
  else if (usedGallery) extractMode = "gallery_dom";

  const catalog =
    extractMode === "empty"
      ? emptyPageCatalog()
      : extractPageCatalogEvidence({ html: input.html, jsonLdNodes });
  for (const g of catalog.genres) {
    originFields.push(g.originField);
  }
  for (const t of catalog.relatedTags) {
    originFields.push(t.originField);
  }
  for (const key of [
    "maker",
    "label",
    "series",
    "releaseDate",
    "manufacturerSku",
  ] as const) {
    const field = catalog[key];
    if (field) originFields.push(field.originField);
  }
  if (catalog.durationMinutes) {
    originFields.push(catalog.durationMinutes.originField);
  }

  return {
    source: FANZA_PAGE_EVIDENCE_SOURCE,
    contentId,
    productName,
    productNameProvenance,
    productNameOriginField,
    catalog,
    images: unique,
    uniquePackageCount,
    uniqueSampleSceneCount,
    video,
    description,
    actors,
    extractMode,
    originFields: [...new Set(originFields)],
  };
}

function htmlMatchFirst(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  return m?.[1] ?? null;
}

export type ItemListImageInput = {
  sourceUrl: string;
  imageType: string;
  usageStatus?: string;
};

/**
 * Merge ItemList ResearchImages + page evidence images by contentKey.
 * Page fills scenes ItemList lacks; higher quality URL wins within a key.
 */
export function mergeItemListAndPageImages(input: {
  itemListImages?: ItemListImageInput[];
  pageEvidence?: FanzaPageEvidence | null;
}): {
  merged: MergedProductImageEvidence[];
  uniquePackageCount: number;
  uniqueSampleSceneCount: number;
  duplicateExcluded: number;
} {
  type Acc = MergedProductImageEvidence & { _rawCount: number };
  const map = new Map<string, Acc>();
  let raw = 0;

  const push = (
    url: string,
    imageType: string,
    source: "item_list" | "fanza_product_page",
    originField: string,
    usageStatus: "REQUIRES_CONFIRMATION" | "ALLOWED",
    qualityOverride?: number,
  ) => {
    raw += 1;
    if (!isTrustedDmmImageUrl(url)) return;
    const identity = imageContentKey(url);
    if (!identity) return;
    const quality = qualityOverride ?? identity.qualityHint;
    const prev = map.get(identity.contentKey);
    if (!prev) {
      map.set(identity.contentKey, {
        contentKey: identity.contentKey,
        family: identity.family,
        bestUrl: url.split("?")[0]!,
        imageType,
        qualityRank: quality,
        sources: [source],
        originFields: [originField],
        usageStatus,
        _rawCount: 1,
      });
      return;
    }
    prev._rawCount += 1;
    if (!prev.sources.includes(source)) prev.sources.push(source);
    if (!prev.originFields.includes(originField)) prev.originFields.push(originField);
    if (quality > prev.qualityRank) {
      prev.bestUrl = url.split("?")[0]!;
      prev.imageType = imageType;
      prev.qualityRank = quality;
    }
    if (usageStatus === "ALLOWED") prev.usageStatus = "ALLOWED";
  };

  for (const row of input.itemListImages ?? []) {
    push(
      row.sourceUrl,
      row.imageType,
      "item_list",
      `item_list.${row.imageType}`,
      row.usageStatus === "ALLOWED" ? "ALLOWED" : "REQUIRES_CONFIRMATION",
    );
  }
  for (const img of input.pageEvidence?.images ?? []) {
    push(
      img.sourceUrl,
      img.imageType,
      "fanza_product_page",
      img.originField,
      "REQUIRES_CONFIRMATION",
      img.qualityRank,
    );
  }

  const merged = [...map.values()].map((entry): MergedProductImageEvidence => {
    const rest = { ...entry } as Acc & { _rawCount?: number };
    Reflect.deleteProperty(rest, "_rawCount");
    return rest as MergedProductImageEvidence;
  });
  const uniquePackageCount = merged.filter((m) => m.family === "package").length;
  const uniqueSampleSceneCount = merged.filter((m) => m.family === "sample").length;
  return {
    merged,
    uniquePackageCount,
    uniqueSampleSceneCount,
    duplicateExcluded: Math.max(0, raw - merged.length),
  };
}

/** Serialize for SourceDocument.metadata.pageEvidence (no HTML body). */
export function toSourceDocumentPageEvidenceMeta(evidence: FanzaPageEvidence): Record<string, unknown> {
  const officialGenres = evidence.catalog.genres.map((g) => g.value).filter(Boolean);
  const officialRelatedTags = evidence.catalog.relatedTags.map((t) => t.value).filter(Boolean);
  return {
    source: evidence.source,
    contentId: evidence.contentId,
    productName: evidence.productName,
    productNameProvenance: evidence.productNameProvenance,
    productNameOriginField: evidence.productNameOriginField,
    catalog: evidence.catalog,
    /** Provider-agnostic SSOT aliases for Analysis / taxonomy consumers. */
    officialGenres,
    officialRelatedTags,
    extractMode: evidence.extractMode,
    originFields: evidence.originFields,
    uniquePackageCount: evidence.uniquePackageCount,
    uniqueSampleSceneCount: evidence.uniqueSampleSceneCount,
    images: evidence.images.map((i) => ({
      sourceUrl: i.sourceUrl,
      contentKey: i.contentKey,
      family: i.family,
      imageType: i.imageType,
      qualityRank: i.qualityRank,
      originField: i.originField,
      usageStatus: i.usageStatus,
      provenance: i.provenance,
    })),
    video: evidence.video,
    description: evidence.description,
    actors: evidence.actors,
  };
}

/** Apply ItemList rawData into page evidence catalog (canonical, no dual schema). */
export function withMergedItemListCatalog(
  evidence: FanzaPageEvidence,
  itemListRawData: unknown,
): FanzaPageEvidence {
  const catalog = mergeCanonicalCatalog({
    pageCatalog: evidence.catalog,
    itemListRawData,
  });
  const originFields = [...evidence.originFields];
  for (const g of catalog.genres) originFields.push(g.originField);
  for (const t of catalog.relatedTags) originFields.push(t.originField);
  for (const key of ["maker", "label", "series", "releaseDate", "manufacturerSku"] as const) {
    const field = catalog[key];
    if (field) originFields.push(field.originField);
  }
  if (catalog.durationMinutes) originFields.push(catalog.durationMinutes.originField);
  return {
    ...evidence,
    catalog,
    originFields: [...new Set(originFields)],
  };
}
