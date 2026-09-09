import type { LifecycleRepository } from "@ai-affiliate/database";
import { extractProductIdFromUrl } from "../ops/page-diagnose.js";
import {
  parseArticleImages,
  selectArticleImages,
  type ArticleImage,
  type ArticleImageSelectionOptions,
} from "./article-images.js";

const EMPTY_RESOLUTION = {
  images: [] as ArticleImage[],
  productId: null as string | null,
  productUrl: null as string | null,
  externalIdsTried: [] as string[],
  researchImageCount: 0,
  pageImageCount: 0,
};

/**
 * Resolve product images for a Topic / AffiliateProduct.
 * Reuses ResearchImage + SourceDocument.imageReferences — no download, no new SSOT table.
 *
 * Prefer AffiliateProduct when linked; otherwise resolve via Topic.researchItemId
 * (page-evidence ingest path without AffiliateProduct bootstrap).
 * Last resort: Topic.metadata.canonicalId / productCanonicalId → ResearchImage by externalId.
 */
export async function resolveArticleImagesForTopic(
  repo: LifecycleRepository,
  topicId: string,
  options?: ArticleImageSelectionOptions,
): Promise<{
  images: ArticleImage[];
  productId: string | null;
  productUrl: string | null;
  externalIdsTried: string[];
  researchImageCount: number;
  pageImageCount: number;
}> {
  const topic = await repo.findTopicCandidate(topicId);
  if (!topic) {
    return { ...EMPTY_RESOLUTION };
  }

  if (topic.affiliateProductId) {
    return resolveArticleImagesForProduct(repo, topic.affiliateProductId, {
      ...options,
      altBase: options?.altBase ?? shortAltFromTitle(topic.title),
    });
  }

  const researchItemId = resolveTopicResearchItemId(topic);
  if (researchItemId) {
    return resolveArticleImagesForResearchItem(repo, researchItemId, {
      ...options,
      altBase: options?.altBase ?? shortAltFromTitle(topic.title),
    });
  }

  const externalIds = resolveTopicCanonicalExternalIds(topic);
  if (externalIds.length > 0) {
    return resolveArticleImagesByExternalIds(repo, externalIds, {
      ...options,
      altBase: options?.altBase ?? shortAltFromTitle(topic.title),
    });
  }

  return { ...EMPTY_RESOLUTION };
}

/**
 * Resolve images by FANZA/DMM product external ids (e.g. ofje00230).
 * Does not mutate ResearchImage.usageStatus.
 */
export async function resolveArticleImagesByExternalIds(
  repo: LifecycleRepository,
  externalIds: string[],
  options?: ArticleImageSelectionOptions,
): Promise<{
  images: ArticleImage[];
  productId: string | null;
  productUrl: string | null;
  externalIdsTried: string[];
  researchImageCount: number;
  pageImageCount: number;
}> {
  const externalIdsTried = [
    ...new Set(externalIds.map((id) => id.trim().toLowerCase()).filter(Boolean)),
  ];
  if (externalIdsTried.length === 0) {
    return { ...EMPTY_RESOLUTION };
  }

  const researchImages = await repo.listResearchImagesByExternalIds(externalIdsTried);
  const images = selectArticleImages({
    researchImages,
    pageImageUrls: [],
    options,
  });

  const primary = externalIdsTried[0]!;
  return {
    images,
    productId: null,
    productUrl: `https://video.dmm.co.jp/av/content/?id=${primary}`,
    externalIdsTried,
    researchImageCount: researchImages.length,
    pageImageCount: 0,
  };
}

export async function resolveArticleImagesForProduct(
  repo: LifecycleRepository,
  affiliateProductId: string,
  options?: ArticleImageSelectionOptions,
): Promise<{
  images: ArticleImage[];
  productId: string | null;
  productUrl: string | null;
  externalIdsTried: string[];
  researchImageCount: number;
  pageImageCount: number;
}> {
  const product = await repo.findAffiliateProduct(affiliateProductId);
  if (!product) {
    return { ...EMPTY_RESOLUTION };
  }

  const externalIds = new Set<string>();
  if (product.externalProductId?.trim()) {
    externalIds.add(product.externalProductId.trim());
  }
  const cidFromUrl = product.url ? extractProductIdFromUrl(product.url) : null;
  if (cidFromUrl) externalIds.add(cidFromUrl);

  const externalIdsTried = [...externalIds];
  const researchImages = await repo.listResearchImagesByExternalIds(externalIdsTried);

  const urlCandidates = [product.url].filter((u): u is string => Boolean(u?.trim()));
  const pageDocs = await repo.listSourceDocumentsImageReferencesByUrls(urlCandidates);
  const pageImageUrls = pageDocs.flatMap((d) => d.imageReferences);

  const images = selectArticleImages({
    researchImages,
    pageImageUrls,
    options: {
      ...options,
      altBase: options?.altBase ?? shortAltFromTitle(product.title),
    },
  });

  return {
    images,
    productId: product.id,
    productUrl: product.url,
    externalIdsTried,
    researchImageCount: researchImages.length,
    pageImageCount: pageImageUrls.length,
  };
}

/**
 * Resolve images from ResearchItem when Topic has no AffiliateProduct.
 * Same selectArticleImages / dedupe path as the product resolver.
 */
export async function resolveArticleImagesForResearchItem(
  repo: LifecycleRepository,
  researchItemId: string,
  options?: ArticleImageSelectionOptions,
): Promise<{
  images: ArticleImage[];
  productId: string | null;
  productUrl: string | null;
  externalIdsTried: string[];
  researchImageCount: number;
  pageImageCount: number;
}> {
  const item = await repo.findResearchItem(researchItemId);
  if (!item) {
    return { ...EMPTY_RESOLUTION };
  }

  const researchImages = await repo.listResearchImagesByResearchItemId(item.id);
  const externalIdsTried = item.externalId?.trim() ? [item.externalId.trim()] : [];

  const urlCandidates = [item.url].filter((u): u is string => Boolean(u?.trim()));
  const pageDocs = await repo.listSourceDocumentsImageReferencesByUrls(urlCandidates);
  const pageImageUrls = pageDocs.flatMap((d) => d.imageReferences);

  const images = selectArticleImages({
    researchImages,
    pageImageUrls,
    options: {
      ...options,
      altBase: options?.altBase ?? shortAltFromTitle(item.title),
    },
  });

  return {
    images,
    productId: null,
    productUrl: item.url,
    externalIdsTried,
    researchImageCount: researchImages.length,
    pageImageCount: pageImageUrls.length,
  };
}

/**
 * Prefer stored structuredContent.images; optionally refresh from product SSOT.
 */
export async function resolveImagesForContentVersion(
  repo: LifecycleRepository,
  contentVersionId: string,
  options?: ArticleImageSelectionOptions & { refresh?: boolean },
): Promise<{
  images: ArticleImage[];
  source: "structured" | "resolved" | "none";
  meta: Record<string, unknown>;
}> {
  const version = await repo.findContentVersion(contentVersionId);
  if (!version) {
    return { images: [], source: "none", meta: { error: "content_version_not_found" } };
  }

  const structured = (version.structuredContent ?? {}) as Record<string, unknown>;
  const stored = parseArticleImages(structured.images);
  if (stored.length > 0 && !options?.refresh) {
    return { images: stored, source: "structured", meta: { storedCount: stored.length } };
  }

  const content = await repo.findContent(version.contentId);
  if (!content?.topicCandidateId) {
    const fromVersionOnly = collectCanonicalIdsFromStructured(structured);
    if (fromVersionOnly.length > 0) {
      const byCid = await resolveArticleImagesByExternalIds(repo, fromVersionOnly, {
        ...options,
        altBase: options?.altBase ?? shortAltFromTitle(version.title),
      });
      if (byCid.images.length > 0) {
        return {
          images: byCid.images,
          source: "resolved",
          meta: {
            ...byCid,
            fallback: "content_version_canonical_ids_no_topic",
          },
        };
      }
    }
    return {
      images: stored,
      source: stored.length ? "structured" : "none",
      meta: { note: "no_topic_on_content" },
    };
  }

  const resolved = await resolveArticleImagesForTopic(repo, content.topicCandidateId, {
    ...options,
    altBase: options?.altBase ?? shortAltFromTitle(version.title),
  });

  if (resolved.images.length > 0) {
    return {
      images: resolved.images,
      source: "resolved",
      meta: {
        productId: resolved.productId,
        externalIdsTried: resolved.externalIdsTried,
        researchImageCount: resolved.researchImageCount,
        pageImageCount: resolved.pageImageCount,
      },
    };
  }

  // Topic unresolved — try product ids on the ContentVersion itself.
  const fromVersion = collectCanonicalIdsFromStructured(structured);
  if (fromVersion.length > 0) {
    const byCid = await resolveArticleImagesByExternalIds(repo, fromVersion, {
      ...options,
      altBase: options?.altBase ?? shortAltFromTitle(version.title),
    });
    if (byCid.images.length > 0) {
      return {
        images: byCid.images,
        source: "resolved",
        meta: {
          productId: byCid.productId,
          externalIdsTried: byCid.externalIdsTried,
          researchImageCount: byCid.researchImageCount,
          pageImageCount: byCid.pageImageCount,
          fallback: "content_version_canonical_ids",
        },
      };
    }
  }

  return {
    images: stored,
    source: stored.length ? "structured" : "none",
    meta: {
      productId: resolved.productId,
      externalIdsTried: resolved.externalIdsTried,
      researchImageCount: resolved.researchImageCount,
      pageImageCount: resolved.pageImageCount,
    },
  };
}

function topicMetadata(topic: { metadata?: unknown }): Record<string, unknown> | null {
  return topic.metadata && typeof topic.metadata === "object" && !Array.isArray(topic.metadata)
    ? (topic.metadata as Record<string, unknown>)
    : null;
}

function resolveTopicResearchItemId(topic: {
  researchItemId?: string | null;
  metadata?: unknown;
}): string | null {
  const direct = topic.researchItemId?.trim();
  if (direct) return direct;
  const meta = topicMetadata(topic);
  const fromMeta = typeof meta?.researchItemId === "string" ? meta.researchItemId.trim() : "";
  return fromMeta || null;
}

/** FANZA-like product ids from Topic metadata when product/research links are absent. */
function resolveTopicCanonicalExternalIds(topic: {
  metadata?: unknown;
}): string[] {
  const meta = topicMetadata(topic);
  if (!meta) return [];
  const ids: string[] = [];
  for (const key of ["canonicalId", "productCanonicalId", "cid", "externalProductId"]) {
    const v = meta[key];
    if (typeof v === "string" && v.trim() && looksLikeProductExternalId(v)) {
      ids.push(v.trim().toLowerCase());
    }
  }
  return [...new Set(ids)];
}

function collectCanonicalIdsFromStructured(structured: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const key of ["productCanonicalId", "canonicalId", "cid", "externalProductId"]) {
    const v = structured[key];
    if (typeof v === "string" && v.trim() && looksLikeProductExternalId(v)) {
      ids.push(v.trim().toLowerCase());
    }
  }
  const imageMeta =
    structured.imageMeta && typeof structured.imageMeta === "object"
      ? (structured.imageMeta as Record<string, unknown>)
      : null;
  if (imageMeta) {
    const tried = imageMeta.externalIdsTried;
    if (Array.isArray(tried)) {
      for (const id of tried) {
        if (typeof id === "string" && looksLikeProductExternalId(id)) {
          ids.push(id.trim().toLowerCase());
        }
      }
    }
  }
  return [...new Set(ids)];
}

/**
 * Prefer real FANZA cids (e.g. ofje00230). Reject synthetic ops keys like
 * `ofje-density-v1-r1-<cuid>` used only for duplicate gates.
 */
function looksLikeProductExternalId(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v || v.length < 4 || v.length > 32) return false;
  if (v.includes("-") && /c[a-z0-9]{20,}/.test(v)) return false;
  if (/^ofje-density|^tmp-|^test-/.test(v)) return false;
  return /^[a-z][a-z0-9]{2,31}$/.test(v);
}

function shortAltFromTitle(title: string | null | undefined): string {
  if (!title) return "商品画像";
  const cleaned = title
    .replace(/^Topic:\s*/i, "")
    .replace(/【[^】]*】/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 40) || "商品画像";
}
