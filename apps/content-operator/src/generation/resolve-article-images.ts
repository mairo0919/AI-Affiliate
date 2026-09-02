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

  return { ...EMPTY_RESOLUTION };
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

  return {
    images: resolved.images.length > 0 ? resolved.images : stored,
    source: resolved.images.length > 0 ? "resolved" : stored.length ? "structured" : "none",
    meta: {
      productId: resolved.productId,
      externalIdsTried: resolved.externalIdsTried,
      researchImageCount: resolved.researchImageCount,
      pageImageCount: resolved.pageImageCount,
    },
  };
}

function resolveTopicResearchItemId(topic: {
  researchItemId?: string | null;
  metadata?: unknown;
}): string | null {
  const direct = topic.researchItemId?.trim();
  if (direct) return direct;
  const meta =
    topic.metadata && typeof topic.metadata === "object" && !Array.isArray(topic.metadata)
      ? (topic.metadata as Record<string, unknown>)
      : null;
  const fromMeta = typeof meta?.researchItemId === "string" ? meta.researchItemId.trim() : "";
  return fromMeta || null;
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
