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
  pageRelatedTags: string[];
}> {
  if (!productCanonicalId?.trim()) {
    return {
      labels: [],
      officialTitle: null,
      officialDescription: null,
      pageGenres: [],
      pageRelatedTags: [],
    };
  }
  const cid = productCanonicalId.trim().toLowerCase();
  let labels: EvidenceTaxonomyLabel[] = [];
  let officialTitle: string | null = null;
  let officialDescription: string | null = null;
  const pageGenres: string[] = [];
  const pageRelatedTags: string[] = [];
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
    const raw =
      item?.rawData && typeof item.rawData === "object" && !Array.isArray(item.rawData)
        ? (item.rawData as Record<string, unknown>)
        : null;
    if (raw) {
      for (const g of Array.isArray(raw.officialGenres) ? raw.officialGenres : []) {
        if (typeof g === "string" && g.trim()) pageGenres.push(g.trim());
      }
      for (const t of Array.isArray(raw.officialRelatedTags) ? raw.officialRelatedTags : []) {
        if (typeof t === "string" && t.trim()) pageRelatedTags.push(t.trim());
      }
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
      const pushCatalogValues = (raw: unknown, into: string[]) => {
        if (!Array.isArray(raw)) return;
        for (const g of raw) {
          let name = "";
          if (typeof g === "string") name = g.trim();
          else if (g && typeof g === "object") {
            const row = g as { value?: unknown; name?: unknown };
            if (typeof row.value === "string") name = row.value.trim();
            else if (typeof row.name === "string") name = row.name.trim();
          }
          if (!name) continue;
          const key = name.replace(/\s+/g, "").toLowerCase();
          if (into.some((x) => x.replace(/\s+/g, "").toLowerCase() === key)) continue;
          into.push(name);
        }
      };
      const catalog =
        pe.catalog && typeof pe.catalog === "object"
          ? (pe.catalog as Record<string, unknown>)
          : null;
      pushCatalogValues(catalog?.genres, pageGenres);
      pushCatalogValues(catalog?.relatedTags, pageRelatedTags);
      pushCatalogValues(pe.officialGenres, pageGenres);
      pushCatalogValues(pe.officialRelatedTags, pageRelatedTags);
    }
  } catch {
    /* ignore */
  }

  // Ensure Research labels include page catalog genres / related tags for derive.
  for (const g of pageGenres) {
    if (
      !labels.some(
        (l) =>
          /^(genre|category)$/i.test(l.type) &&
          l.name.replace(/\s+/g, "").toLowerCase() === g.replace(/\s+/g, "").toLowerCase(),
      )
    ) {
      labels.push({ type: "genre", name: g });
    }
  }
  for (const t of pageRelatedTags) {
    if (
      !labels.some(
        (l) =>
          /^related_tag$/i.test(l.type) &&
          l.name.replace(/\s+/g, "").toLowerCase() === t.replace(/\s+/g, "").toLowerCase(),
      )
    ) {
      labels.push({ type: "related_tag", name: t });
    }
  }

  return { labels, officialTitle, officialDescription, pageGenres, pageRelatedTags };
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
    fromRelatedTag: number;
    fromTitle: number;
    fromDescription: number;
  };
}> {
  const publisher = createWordPressPublisherFromConfig(deps.config) as WordPressApiPublisher;
  const rows: AdultTagRefreshRow[] = [];
  let tagsAdded = 0;
  let fromGenre = 0;
  let fromRelatedTag = 0;
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
      relatedTags: [
        ...pack.pageRelatedTags,
        ...pack.labels.filter((l) => /^related_tag$/i.test(l.type)).map((l) => l.name),
      ],
      attributes: pack.labels.filter((l) => /^(attribute|keyword)$/i.test(l.type)).map((l) => l.name),
      officialTitle: pack.officialTitle || version.title || before.title,
      officialDescription: pack.officialDescription,
    });

    const beforeSet = new Set(before.tags.map((t) => t.replace(/\s+/g, "").toLowerCase()));
    const BANNED_NOISE = new Set([
      "プレイ",
      "時間",
      "配信",
      "コキ",
      "てこき",
      "中だし",
      "動画",
      "作品",
      "紹介",
      "おすすめ",
      "av",
    ]);
    let mergedNames = before.tags.filter((t) => !BANNED_NOISE.has(t) && !BANNED_NOISE.has(t.toLowerCase()));
    const addedTags: string[] = [];
    const liveSet = new Set(mergedNames.map((t) => t.replace(/\s+/g, "").toLowerCase()));
    for (const t of derived.tags) {
      const key = t.replace(/\s+/g, "").toLowerCase();
      if (liveSet.has(key)) continue;
      if (BANNED_NOISE.has(t) || BANNED_NOISE.has(t.toLowerCase())) continue;
      if (before.performers.some((p) => p.replace(/\s+/g, "").toLowerCase() === key)) continue;
      mergedNames.push(t);
      addedTags.push(t);
      liveSet.add(key);
    }

    // Normalize legacy mis-tag デビュー作 → デビュー (series form should not sit on post_tag).
    let normalizedExisting = false;
    if (before.tags.length !== mergedNames.length) {
      normalizedExisting = true;
    }
    const debutIdx = mergedNames.findIndex((t) => t === "デビュー作");
    if (debutIdx >= 0) {
      normalizedExisting = true;
      if (!liveSet.has("デビュー")) {
        mergedNames[debutIdx] = "デビュー";
        if (!addedTags.includes("デビュー")) addedTags.push("デビュー");
        liveSet.add("デビュー");
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
        else if (m.source === "related_tag") fromRelatedTag += 1;
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
      fromRelatedTag,
      fromTitle,
      fromDescription,
    },
  };
}
