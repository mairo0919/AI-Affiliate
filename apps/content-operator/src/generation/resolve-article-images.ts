import type { LifecycleRepository } from "@ai-affiliate/database";
import { extractProductIdFromUrl } from "../ops/page-diagnose.js";
import {
  parseArticleImages,
  selectArticleImages,
  type ArticleImage,
  type ArticleImageSelectionOptions,
} from "./article-images.js";

/**
 * Resolve product images for a Topic / AffiliateProduct.
 * Reuses ResearchImage + SourceDocument.imageReferences — no download, no new SSOT table.
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
  if (!topic?.affiliateProductId) {
    return {
      images: [],
      productId: null,
      productUrl: null,
      externalIdsTried: [],
      researchImageCount: 0,
      pageImageCount: 0,
    };
  }
  return resolveArticleImagesForProduct(repo, topic.affiliateProductId, {
    ...options,
    altBase: options?.altBase ?? shortAltFromTitle(topic.title),
  });
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
    return {
      images: [],
      productId: null,
      productUrl: null,
      externalIdsTried: [],
      researchImageCount: 0,
      pageImageCount: 0,
    };
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

function shortAltFromTitle(title: string | null | undefined): string {
  if (!title) return "商品画像";
  const cleaned = title
    .replace(/^Topic:\s*/i, "")
    .replace(/【[^】]*】/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 40) || "商品画像";
}
