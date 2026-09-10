/**
 * Add Evidence-backed adult attribute tags to existing WP posts without
 * changing title, body, schedule date, or post ID.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import {
  createWordPressPublisherFromConfig,
  type WordPressApiPublisher,
} from "../adapters/publisher/wordpress-api-publisher.js";
import {
  extractAdultAttributeTags,
  adultTagStableSlug,
  type ExtractAdultAttributeTagsResult,
} from "./adult-taxonomy.js";
import { ADULT_TAXONOMY_DICTIONARY } from "./adult-taxonomy-dictionary.js";
import { deriveWordPressTaxonomyFromEvidence, type EvidenceTaxonomyLabel } from "./evidence-taxonomy.js";
import { DEFAULT_FUTURE_METADATA_REFRESH_IDS } from "./refresh-wp-metadata.js";

export { DEFAULT_FUTURE_METADATA_REFRESH_IDS };

export type AdultTagRefreshRow = {
  externalId: string;
  contentVersionId: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  beforeTags: string[];
  afterTags: string[];
  addedTags: string[];
  extraction?: ExtractAdultAttributeTagsResult["counts"];
  dateUnchanged?: boolean;
  bodyUnchanged?: boolean;
  categoryUnchanged?: boolean;
  performersUnchanged?: boolean;
  seriesUnchanged?: boolean;
};

async function loadEvidencePack(
  prisma: DatabaseClient["prisma"],
  lifecycle: LifecycleRepository,
  productCanonicalId: string | null,
): Promise<{
  labels: EvidenceTaxonomyLabel[];
  officialTitle: string | null;
  officialDescription: string | null;
  pageGenres: string[];
}> {
  if (!productCanonicalId?.trim()) {
    return { labels: [], officialTitle: null, officialDescription: null, pageGenres: [] };
  }
  const cid = productCanonicalId.trim().toLowerCase();
  let labels: EvidenceTaxonomyLabel[] = [];
  let officialTitle: string | null = null;
  let officialDescription: string | null = null;
  const pageGenres: string[] = [];
  try {
    const item = await prisma.researchItem.findFirst({
      where: {
        OR: [
          { externalId: { equals: cid, mode: "insensitive" } },
          { externalId: { startsWith: cid, mode: "insensitive" } },
        ],
      },
      orderBy: { collectedAt: "desc" },
      include: { tags: { include: { researchTag: true } } },
    });
    if (item?.tags?.length) {
      labels = item.tags.map((t) => ({
        type: t.researchTag.type,
        name: t.researchTag.name,
      }));
    }
    if (typeof item?.title === "string" && item.title.trim()) {
      officialTitle = item.title.trim();
    }
    if (typeof item?.description === "string" && item.description.trim()) {
      officialDescription = item.description.trim();
    }
  } catch {
    /* ignore */
  }

  try {
    const doc = await lifecycle.findLatestSourceDocumentByUrlContains(cid);
    const meta =
      doc?.metadata && typeof doc.metadata === "object" && !Array.isArray(doc.metadata)
        ? (doc.metadata as Record<string, unknown>)
        : {};
    const pe =
      meta.pageEvidence && typeof meta.pageEvidence === "object"
        ? (meta.pageEvidence as Record<string, unknown>)
        : null;
    if (pe) {
      if (typeof pe.productName === "string" && pe.productName.trim()) {
        officialTitle = pe.productName.trim();
      }
      const desc = pe.description;
      if (desc && typeof desc === "object" && typeof (desc as { text?: unknown }).text === "string") {
        officialDescription = String((desc as { text: string }).text).trim() || null;
      }
      const catalog =
        pe.catalog && typeof pe.catalog === "object"
          ? (pe.catalog as Record<string, unknown>)
          : null;
      const genres = catalog && Array.isArray(catalog.genres) ? catalog.genres : [];
      for (const g of genres) {
        if (typeof g === "string" && g.trim()) pageGenres.push(g.trim());
        else if (g && typeof g === "object" && typeof (g as { name?: unknown }).name === "string") {
          pageGenres.push(String((g as { name: string }).name).trim());
        }
      }
    }
  } catch {
    /* ignore */
  }

  return { labels, officialTitle, officialDescription, pageGenres };
}

async function fetchWpTaxonomySnapshot(
  config: AppConfig,
  externalId: string,
): Promise<{
  title: string;
  date: string | null;
  content: string;
  tags: string[];
  tagIds: number[];
  categories: string[];
  performers: string[];
  series: string[];
} | null> {
  const base = String(config.wordpressBaseUrl ?? "").replace(/\/$/, "");
  const user = config.wordpressUsername;
  const pass = String(config.wordpressApplicationPassword ?? "").replace(/\s+/g, "");
  if (!base || !user || !pass) return null;
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const ns = config.wordpressApiNamespace || "wp/v2";
  const res = await fetch(`${base}/wp-json/${ns}/posts/${externalId}?context=edit`, {
    headers: { Authorization: `Basic ${auth}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const j = (await res.json()) as {
    title?: { raw?: string; rendered?: string };
    date?: string;
    content?: { raw?: string; rendered?: string };
    categories?: number[];
    tags?: number[];
    performer?: number[];
    series?: number[];
  };
  const termNames = async (ids: number[] | undefined, tax: string) => {
    if (!ids?.length) return [] as Array<{ id: number; name: string }>;
    const r = await fetch(
      `${base}/wp-json/${ns}/${tax}?include=${ids.join(",")}&per_page=100&_fields=id,name`,
      { headers: { Authorization: `Basic ${auth}` } },
    ).catch(() => null);
    if (!r || !r.ok) return [];
    const rows = (await r.json()) as Array<{ id?: number; name?: string }>;
    return rows
      .filter((x) => x.id && x.name)
      .map((x) => ({ id: Number(x.id), name: String(x.name) }));
  };
  const [tagRows, catRows, perfRows, seriesRows] = await Promise.all([
    termNames(j.tags, "tags"),
    termNames(j.categories, "categories"),
    termNames(j.performer, "performer"),
    termNames(j.series, "series"),
  ]);
  return {
    title: j.title?.raw || j.title?.rendered || "",
    date: j.date ?? null,
    content: j.content?.raw || j.content?.rendered || "",
    tags: tagRows.map((t) => t.name),
    tagIds: tagRows.map((t) => t.id),
    categories: catRows.map((t) => t.name),
    performers: perfRows.map((t) => t.name),
    series: seriesRows.map((t) => t.name),
  };
}

export async function refreshAdultAttributeTagsOnWordPress(deps: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  config: AppConfig;
  externalIds: Array<string | number>;
}): Promise<{
  rows: AdultTagRefreshRow[];
  totals: {
    updated: number;
    skipped: number;
    failed: number;
    tagsAdded: number;
    fromGenre: number;
    fromTitle: number;
    fromDescription: number;
  };
}> {
  const publisher = createWordPressPublisherFromConfig(deps.config) as WordPressApiPublisher;
  const rows: AdultTagRefreshRow[] = [];
  let tagsAdded = 0;
  let fromGenre = 0;
  let fromTitle = 0;
  let fromDescription = 0;

  for (const rawId of deps.externalIds) {
    const externalId = String(rawId);
    const target = await deps.database.prisma.publicationTarget.findFirst({
      where: { platform: "WORDPRESS", publishedExternalId: externalId },
      select: { contentVersionId: true },
    });
    if (!target) {
      rows.push({
        externalId,
        contentVersionId: "",
        ok: false,
        reason: "PUBLICATION_TARGET_NOT_FOUND",
        beforeTags: [],
        afterTags: [],
        addedTags: [],
      });
      continue;
    }

    const version = await deps.database.prisma.contentVersion.findUnique({
      where: { id: target.contentVersionId },
      select: { id: true, title: true, structuredContent: true },
    });
    if (!version) {
      rows.push({
        externalId,
        contentVersionId: target.contentVersionId,
        ok: false,
        reason: "CONTENT_VERSION_NOT_FOUND",
        beforeTags: [],
        afterTags: [],
        addedTags: [],
      });
      continue;
    }

    const structured =
      version.structuredContent && typeof version.structuredContent === "object"
        ? (version.structuredContent as Record<string, unknown>)
        : {};
    const productCanonicalId =
      (typeof structured.productCanonicalId === "string" && structured.productCanonicalId) ||
      (typeof structured.productKey === "string" && structured.productKey) ||
      null;

    const pack = await loadEvidencePack(deps.database.prisma, deps.lifecycle, productCanonicalId);
    const before = await fetchWpTaxonomySnapshot(deps.config, externalId);
    if (!before) {
      rows.push({
        externalId,
        contentVersionId: version.id,
        ok: false,
        reason: "WP_FETCH_FAILED",
        beforeTags: [],
        afterTags: [],
        addedTags: [],
      });
      continue;
    }

    const derived = deriveWordPressTaxonomyFromEvidence({
      labels: pack.labels,
      title: pack.officialTitle || version.title || before.title,
      officialDescription: pack.officialDescription,
      extraPerformers: before.performers,
      extraSeriesNames: before.series,
      allowCategoryFallback: true,
      excludePerformersFromTags: true,
    });

    // Also run explicit adult extraction for reporting counts (same sources).
    const extraction = extractAdultAttributeTags({
      genres: [
        ...pack.pageGenres,
        ...pack.labels.filter((l) => /^(genre|category)$/i.test(l.type)).map((l) => l.name),
      ],
      attributes: pack.labels.filter((l) => /^(attribute|keyword)$/i.test(l.type)).map((l) => l.name),
      officialTitle: pack.officialTitle || version.title || before.title,
      officialDescription: pack.officialDescription,
    });

    const beforeSet = new Set(before.tags.map((t) => t.replace(/\s+/g, "").toLowerCase()));
    const mergedNames = [...before.tags];
    const addedTags: string[] = [];
    for (const t of derived.tags) {
      const key = t.replace(/\s+/g, "").toLowerCase();
      if (beforeSet.has(key)) continue;
      // Prefer adult attribute + format tags; skip performer-looking duplicates already in performer tax
      if (before.performers.some((p) => p.replace(/\s+/g, "").toLowerCase() === key)) continue;
      mergedNames.push(t);
      addedTags.push(t);
      beforeSet.add(key);
    }

    // Normalize legacy mis-tag デビュー作 → デビュー (series form should not sit on post_tag).
    let normalizedExisting = false;
    const debutIdx = mergedNames.findIndex((t) => t === "デビュー作");
    if (debutIdx >= 0) {
      normalizedExisting = true;
      if (!beforeSet.has("デビュー")) {
        mergedNames[debutIdx] = "デビュー";
        if (!addedTags.includes("デビュー")) addedTags.push("デビュー");
        beforeSet.add("デビュー");
      } else {
        mergedNames.splice(debutIdx, 1);
      }
      for (let i = mergedNames.length - 1; i >= 0; i -= 1) {
        if (mergedNames[i] === "デビュー作") mergedNames.splice(i, 1);
      }
    }

    const beforeKey = before.tags.map((t) => t.replace(/\s+/g, "").toLowerCase()).sort().join("|");
    const afterKey = mergedNames.map((t) => t.replace(/\s+/g, "").toLowerCase()).sort().join("|");
    if (addedTags.length === 0 && beforeKey === afterKey && !normalizedExisting) {
      rows.push({
        externalId,
        contentVersionId: version.id,
        ok: true,
        skipped: true,
        reason: "NO_NEW_ADULT_TAGS",
        beforeTags: before.tags,
        afterTags: before.tags,
        addedTags: [],
        extraction: extraction.counts,
        dateUnchanged: true,
        bodyUnchanged: true,
        categoryUnchanged: true,
        performersUnchanged: true,
        seriesUnchanged: true,
      });
      continue;
    }

    try {
      const ensure = publisher.ensureTerm.bind(publisher);
      const tagIds: number[] = [];
      const dictNames = new Set(ADULT_TAXONOMY_DICTIONARY.map((t) => t.canonicalName));
      for (const name of mergedNames) {
        const id = await ensure({
          taxonomyRestBase: "tags",
          name,
          slug: dictNames.has(name) ? adultTagStableSlug(name) : null,
        });
        if (id) tagIds.push(id);
      }
      // Intentionally do not re-attach removed legacy tags via before.tagIds
      // (e.g. series-form デビュー作 that we replaced with デビュー).

      await publisher.updateMetadataOnly({
        externalId,
        // title omitted — preserve schedule title
        tagIds,
      });

      const after = await fetchWpTaxonomySnapshot(deps.config, externalId);
      tagsAdded += addedTags.length;
      for (const added of addedTags) {
        const m = extraction.matches.find((x) => x.canonicalName === added);
        if (!m) continue;
        if (m.source === "genre") fromGenre += 1;
        else if (m.source === "title") fromTitle += 1;
        else if (m.source === "description") fromDescription += 1;
      }

      rows.push({
        externalId,
        contentVersionId: version.id,
        ok: true,
        beforeTags: before.tags,
        afterTags: after?.tags ?? mergedNames,
        addedTags,
        extraction: extraction.counts,
        dateUnchanged: Boolean(after && before.date === after.date),
        bodyUnchanged: Boolean(after && before.content === after.content),
        categoryUnchanged: Boolean(
          after &&
            JSON.stringify(after.categories) === JSON.stringify(before.categories),
        ),
        performersUnchanged: Boolean(
          after &&
            JSON.stringify(after.performers) === JSON.stringify(before.performers),
        ),
        seriesUnchanged: Boolean(
          after && JSON.stringify(after.series) === JSON.stringify(before.series),
        ),
      });
    } catch (error) {
      rows.push({
        externalId,
        contentVersionId: version.id,
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
        beforeTags: before.tags,
        afterTags: before.tags,
        addedTags,
        extraction: extraction.counts,
      });
    }
  }

  return {
    rows,
    totals: {
      updated: rows.filter((r) => r.ok && !r.skipped).length,
      skipped: rows.filter((r) => r.skipped).length,
      failed: rows.filter((r) => !r.ok).length,
      tagsAdded,
      fromGenre,
      fromTitle,
      fromDescription,
    },
  };
}
