/**
 * Persist FANZA product page evidence into SourceDocument + ResearchImage (URL only).
 * No BLOG generation, no Brain, no Draft update, no LLM.
 */

import type { LifecycleRepository } from "@ai-affiliate/database";
import type { ResearchRepository } from "@ai-affiliate/database";
import {
  fetchFanzaPageEvidence,
  type FetchFanzaPageEvidenceOptions,
  type PageEvidenceFetchResult,
} from "../providers/fanza/fanza-page-evidence-fetch.js";
import {
  mergeItemListAndPageImages,
  toSourceDocumentPageEvidenceMeta,
  withMergedItemListCatalog,
  type FanzaPageEvidence,
  type MergedProductImageEvidence,
} from "../providers/fanza/fanza-page-evidence.js";

export type IngestFanzaPageEvidenceResult = {
  fetch: PageEvidenceFetchResult;
  evidence: FanzaPageEvidence | null;
  sourceDocumentId: string | null;
  researchItemId: string | null;
  researchImagesUpserted: number;
  merged: MergedProductImageEvidence[];
  uniquePackageCount: number;
  uniqueSampleSceneCount: number;
  duplicateExcluded: number;
  videoMetaPresent: boolean;
  descriptionPresent: boolean;
  movieBinaryRequests: 0;
  officialGenres?: string[];
  officialRelatedTags?: string[];
};

const PAGE_IMAGE_USAGE_NOTE =
  "Page evidence (JSON-LD/gallery). Official usage scope varies. Confirm before ad use. URL reference only; no binary store.";

/** Page images remain REQUIRES_CONFIRMATION — see publication/image-usage-decision.ts. */

export async function ingestFanzaPageEvidence(input: {
  lifecycle: LifecycleRepository;
  research: ResearchRepository;
  productUrl: string;
  contentId: string;
  fetchOptions: Omit<FetchFanzaPageEvidenceOptions, "url" | "contentIdHint">;
  /** When true (default), upsert page sample/package URLs onto ResearchItem. */
  upsertResearchImages?: boolean;
}): Promise<IngestFanzaPageEvidenceResult> {
  const fetch = await fetchFanzaPageEvidence({
    ...input.fetchOptions,
    url: input.productUrl,
    contentIdHint: input.contentId,
  });

  const evidence = fetch.evidence;
  if (!evidence || evidence.extractMode === "empty") {
    // Fail closed: leave ItemList data untouched.
    const itemList = await input.research.findItemByExternalId(input.contentId);
    const merge = mergeItemListAndPageImages({
      itemListImages: (itemList?.images ?? []).map((i) => ({
        sourceUrl: i.sourceUrl,
        imageType: i.imageType,
        usageStatus: i.usageStatus,
      })),
      pageEvidence: null,
    });
    return {
      fetch,
      evidence: null,
      sourceDocumentId: null,
      researchItemId: itemList?.id ?? null,
      researchImagesUpserted: 0,
      merged: merge.merged,
      uniquePackageCount: merge.uniquePackageCount,
      uniqueSampleSceneCount: merge.uniqueSampleSceneCount,
      duplicateExcluded: merge.duplicateExcluded,
      videoMetaPresent: false,
      descriptionPresent: false,
      movieBinaryRequests: 0,
    };
  }

  // Merge ItemList catalog into canonical pageEvidence.catalog (no dual schema).
  const itemListForCatalog = await input.research.findItemByExternalId(input.contentId);
  const evidenceForPersist = withMergedItemListCatalog(
    evidence,
    itemListForCatalog?.rawData ?? null,
  );

  // Persist structured page evidence on SourceDocument (no raw HTML).
  const existingDocs = await input.lifecycle.listSourceDocumentsImageReferencesByUrls([
    input.productUrl,
  ]);
  let sourceDocumentId = existingDocs[0]?.id ?? null;

  const imageReferences = evidenceForPersist.images.map((i) => i.sourceUrl);
  const pageEvidenceMeta = toSourceDocumentPageEvidenceMeta(evidenceForPersist);
  const metaPatch = {
    pageEvidence: {
      ...pageEvidenceMeta,
      // Clear ItemList synthesis stigma when official page Evidence is persisted.
      synthesizedFrom: null,
      fetchedAt: new Date().toISOString(),
      fetchMode: fetch.fetchMode,
      browserFallbackUsed: fetch.browserFallbackUsed,
      externalRequestCount: fetch.externalRequestCount,
      movieBinaryRequests: 0,
    },
    imageReferences,
    rawHtmlStored: false,
  };

  if (sourceDocumentId) {
    await input.lifecycle.updateSourceDocumentMetadata(sourceDocumentId, metaPatch);
  } else {
    const created = await input.lifecycle.createSourceDocument({
      sourceKey: "fanza-page-evidence",
      documentType: "product",
      externalId: input.contentId,
      url: input.productUrl,
      title: `FANZA page evidence: ${input.contentId}`,
      robotsAllowed: true,
      normalizedText: [
        `contentId: ${input.contentId}`,
        `productName: ${evidenceForPersist.productName ?? "absent"}`,
        `extractMode: ${evidenceForPersist.extractMode}`,
        `uniqueSampleScenes: ${evidenceForPersist.uniqueSampleSceneCount}`,
        `uniquePackage: ${evidenceForPersist.uniquePackageCount}`,
        evidenceForPersist.description ? `description: present` : `description: absent`,
        evidenceForPersist.video ? `videoMeta: present` : `videoMeta: absent`,
        evidenceForPersist.catalog.maker
          ? `maker: ${evidenceForPersist.catalog.maker.value}`
          : `maker: absent`,
      ].join("\n"),
      metadata: {
        role: "page_evidence",
        ...metaPatch,
      },
    });
    sourceDocumentId = created.id;
  }

  // Ensure ResearchItem exists without DMM ItemList (page evidence path).
  let researchItem = await input.research.findItemByExternalId(input.contentId);
  if (!researchItem) {
    const title =
      evidenceForPersist.productName?.trim() ||
      `FANZA ${evidenceForPersist.contentId ?? input.contentId}`;
    const actorTags = (evidenceForPersist.actors ?? evidenceForPersist.video?.actor ?? [])
      .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      .map((name) => ({ type: "actress", name: name.trim() }));
    await input.research.saveCollection({
      providerName: "fanza-page-evidence",
      collectedAt: new Date(),
      items: [
        {
          sourceName: "fanza-page-evidence",
          sourceType: "FANZA",
          sourceBaseUrl: "https://video.dmm.co.jp/",
          externalId: input.contentId,
          itemType: "PRODUCT",
          title: title,
          description: null, // official description lives on SourceDocument.pageEvidence only
          url: input.productUrl,
          collectedAt: new Date(),
          rawData: {
            contentId: input.contentId,
            source: "fanza_product_page",
            affiliateURL: input.productUrl,
          },
          metrics: [],
          tags: actorTags,
          images: evidenceForPersist.images.map((img) => ({
            imageType: img.imageType,
            sourceUrl: img.sourceUrl,
            size: `page:${img.originField}`,
            usageStatus: "REQUIRES_CONFIRMATION" as const,
            usageNote: PAGE_IMAGE_USAGE_NOTE,
          })),
        },
      ],
    });
    researchItem = await input.research.findItemByExternalId(input.contentId);
  }

  let researchImagesUpserted = 0;
  let researchItemId: string | null = researchItem?.id ?? null;
  if (input.upsertResearchImages !== false) {
    const upsert = await input.research.upsertImagesForExternalId({
      externalId: input.contentId,
      images: evidenceForPersist.images.map((img) => ({
        imageType: img.imageType,
        sourceUrl: img.sourceUrl,
        size: `page:${img.originField}`,
        usageStatus: "REQUIRES_CONFIRMATION" as const,
        usageNote: PAGE_IMAGE_USAGE_NOTE,
      })),
    });
    researchImagesUpserted = upsert.upserted;
    researchItemId = upsert.researchItemId ?? researchItemId;
  }

  const itemList = await input.research.findItemByExternalId(input.contentId);
  researchItemId = researchItemId ?? itemList?.id ?? null;

  // Persist official genres / related tags onto ResearchItem (SSOT for Analysis / WP).
  const officialGenres = evidenceForPersist.catalog.genres
    .map((g) => g.value.trim())
    .filter(Boolean);
  const officialRelatedTags = evidenceForPersist.catalog.relatedTags
    .map((t) => t.value.trim())
    .filter((t) => {
      if (!t) return false;
      // Do not mirror performer names into related_tag taxonomy.
      const actors = new Set(
        (evidenceForPersist.actors ?? []).map((a) => a.replace(/\s+/g, "").toLowerCase()),
      );
      return !actors.has(t.replace(/\s+/g, "").toLowerCase());
    });
  const taxonomyTags = [
    ...officialGenres.map((name) => ({ type: "genre", name })),
    ...officialRelatedTags.map((name) => ({ type: "related_tag", name })),
  ];
  if (taxonomyTags.length >= 0) {
    await input.research.upsertTagsForExternalId({
      externalId: input.contentId,
      tags: taxonomyTags,
      replaceTypes: ["genre", "related_tag"],
    });
  }
  await input.research.patchRawDataOfficialAttributes({
    externalId: input.contentId,
    officialGenres,
    officialRelatedTags,
  });

  const merge = mergeItemListAndPageImages({
    itemListImages: (itemList?.images ?? []).map((i) => ({
      sourceUrl: i.sourceUrl,
      imageType: i.imageType,
      usageStatus: i.usageStatus,
    })),
    pageEvidence: evidenceForPersist,
  });

  return {
    fetch,
    evidence: evidenceForPersist,
    sourceDocumentId,
    researchItemId,
    researchImagesUpserted,
    merged: merge.merged,
    uniquePackageCount: merge.uniquePackageCount,
    uniqueSampleSceneCount: merge.uniqueSampleSceneCount,
    duplicateExcluded: merge.duplicateExcluded,
    videoMetaPresent: Boolean(evidenceForPersist.video),
    descriptionPresent: Boolean(evidenceForPersist.description),
    movieBinaryRequests: 0,
    officialGenres,
    officialRelatedTags,
  };
}
