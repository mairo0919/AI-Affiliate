/**
 * Re-evaluate WordPress categories + official series from Research Evidence.
 * Syncs performer readings from FANZA ruby in rawData when present.
 * Does not rewrite body text, titles, dates, tags, or rights.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import {
  createWordPressPublisherFromConfig,
  type WordPressApiPublisher,
} from "../adapters/publisher/wordpress-api-publisher.js";
import {
  deriveWordPressTaxonomyFromEvidence,
  isAttributeSeriesName,
  PRODUCT_ARTICLE_CATEGORY_FALLBACK,
  uniqPreserve,
  type EvidenceTaxonomyLabel,
} from "./evidence-taxonomy.js";
import {
  CATEGORY_READING_MAP,
  extractPerformerReadingsFromRawData,
} from "./performer-readings.js";
import { stableTermSlug } from "./wordpress-seo-attach.js";

export type CategoryRefreshRow = {
  postId: string;
  productId: string | null;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  before: string[];
  after: string[];
  seriesBefore?: string[];
  seriesAfter?: string[];
  changed: boolean;
  dateUnchanged: boolean;
  bodyUnchanged: boolean;
  fallbackUsed: boolean;
};

type EvidenceBundle = {
  labels: EvidenceTaxonomyLabel[];
  rawData: unknown;
};

async function loadEvidenceBundle(
  prisma: DatabaseClient["prisma"],
  productCanonicalId: string | null,
): Promise<EvidenceBundle> {
  if (!productCanonicalId?.trim()) return { labels: [], rawData: null };
  const cid = productCanonicalId.trim().toLowerCase();
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
    if (!item) return { labels: [], rawData: null };
    const labels = (item.tags ?? []).map((t) => ({
      type: t.researchTag.type,
      name: t.researchTag.name,
    }));
    return { labels, rawData: item.rawData ?? null };
  } catch {
    return { labels: [], rawData: null };
  }
}

async function listProductPostIds(config: AppConfig): Promise<string[]> {
  const base = String(config.wordpressBaseUrl ?? "").replace(/\/$/, "");
  const user = config.wordpressUsername;
  const pass = String(config.wordpressApplicationPassword ?? "").replace(/\s+/g, "");
  if (!base || !user || !pass) return [];
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const ns = config.wordpressApiNamespace || "wp/v2";
  const ids: string[] = [];
  for (const status of ["publish", "future", "draft"] as const) {
    let page = 1;
    for (;;) {
      const res = await fetch(
        `${base}/wp-json/${ns}/posts?status=${status}&per_page=100&page=${page}&_fields=id`,
        { headers: { Authorization: `Basic ${auth}` } },
      );
      if (!res.ok) break;
      const rows = (await res.json()) as Array<{ id?: number }>;
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        if (row.id != null) ids.push(String(row.id));
      }
      if (rows.length < 100) break;
      page += 1;
      if (page > 20) break;
    }
  }
  return [...new Set(ids)];
}

async function fetchPostTaxonomySnapshot(
  config: AppConfig,
  postId: string,
): Promise<{
  categories: string[];
  series: string[];
  date: string | null;
  content: string;
} | null> {
  const base = String(config.wordpressBaseUrl ?? "").replace(/\/$/, "");
  const user = config.wordpressUsername;
  const pass = String(config.wordpressApplicationPassword ?? "").replace(/\s+/g, "");
  if (!base || !user || !pass) return null;
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const ns = config.wordpressApiNamespace || "wp/v2";
  const res = await fetch(`${base}/wp-json/${ns}/posts/${postId}?context=edit`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    date?: string;
    content?: { raw?: string };
    categories?: number[];
    series?: number[];
  };
  const catIds = j.categories ?? [];
  let categories: string[] = [];
  if (catIds.length > 0) {
    const r = await fetch(
      `${base}/wp-json/${ns}/categories?include=${catIds.join(",")}&per_page=100&_fields=id,name`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    if (r.ok) {
      const rows = (await r.json()) as Array<{ name?: string }>;
      categories = rows.map((x) => x.name ?? "").filter(Boolean);
    }
  }
  const seriesIds = j.series ?? [];
  let series: string[] = [];
  if (seriesIds.length > 0) {
    const r = await fetch(
      `${base}/wp-json/${ns}/series?include=${seriesIds.join(",")}&per_page=100&_fields=id,name`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    if (r.ok) {
      const rows = (await r.json()) as Array<{ name?: string }>;
      series = rows.map((x) => x.name ?? "").filter(Boolean);
    }
  }
  return {
    categories,
    series,
    date: j.date ?? null,
    content: j.content?.raw || "",
  };
}

function sameNameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c)) && b.every((c) => a.includes(c));
}

export async function refreshWordPressCategories(deps: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  config: AppConfig;
  postIds?: Array<string | number>;
  apply: boolean;
}): Promise<{
  rows: CategoryRefreshRow[];
  scanned: number;
  changed: number;
  stillFallback: number;
  readingsSynced: number;
  categoryReadingsSeeded: number;
}> {
  const publisher = createWordPressPublisherFromConfig(deps.config) as WordPressApiPublisher;
  const ids =
    deps.postIds && deps.postIds.length > 0
      ? deps.postIds.map(String)
      : await listProductPostIds(deps.config);

  const rows: CategoryRefreshRow[] = [];
  let changed = 0;
  let stillFallback = 0;
  let readingsSynced = 0;
  const readingDone = new Set<string>();

  // Seed policy category readings once (apply mode).
  let categoryReadingsSeeded = 0;
  if (deps.apply) {
    for (const [name, reading] of Object.entries(CATEGORY_READING_MAP)) {
      try {
        const id = await publisher.ensureTerm({
          taxonomyRestBase: "categories",
          name,
          meta: { otonaselect_reading_kana: reading },
        });
        if (id) categoryReadingsSeeded += 1;
      } catch {
        /* ignore */
      }
    }
  }

  for (const postId of ids) {
    const target = await deps.database.prisma.publicationTarget.findFirst({
      where: { platform: "WORDPRESS", publishedExternalId: postId },
      select: { contentVersionId: true },
    });
    if (!target) {
      rows.push({
        postId,
        productId: null,
        ok: false,
        reason: "PUBLICATION_TARGET_NOT_FOUND",
        before: [],
        after: [],
        changed: false,
        dateUnchanged: true,
        bodyUnchanged: true,
        fallbackUsed: false,
      });
      continue;
    }

    const version = await deps.database.prisma.contentVersion.findUnique({
      where: { id: target.contentVersionId },
      select: { title: true, structuredContent: true },
    });
    if (!version) {
      rows.push({
        postId,
        productId: null,
        ok: false,
        reason: "CONTENT_VERSION_NOT_FOUND",
        before: [],
        after: [],
        changed: false,
        dateUnchanged: true,
        bodyUnchanged: true,
        fallbackUsed: false,
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
    const evidence = await loadEvidenceBundle(deps.database.prisma, productCanonicalId);
    const derived = deriveWordPressTaxonomyFromEvidence({
      labels: evidence.labels,
      title: version.title,
      subtitle: typeof structured.subtitle === "string" ? structured.subtitle : null,
      officialDescription:
        typeof structured.officialDescription === "string" ? structured.officialDescription : null,
      allowCategoryFallback: true,
    });

    const snap = await fetchPostTaxonomySnapshot(deps.config, postId);
    const before = snap?.categories ?? [];
    const after = derived.categories;
    const seriesBefore = snap?.series ?? [];
    // Keep existing official series; only drop attribute series. Merge Evidence official series.
    const seriesAfter = uniqPreserve([
      ...seriesBefore.filter((s) => !isAttributeSeriesName(s)),
      ...derived.seriesNames,
    ]);
    const catsSame = sameNameSet(before, after);
    const seriesSame = sameNameSet(seriesBefore, seriesAfter);

    if (after.includes(PRODUCT_ARTICLE_CATEGORY_FALLBACK)) stillFallback += 1;

    // Sync performer readings from official ruby whenever we have them.
    const readings = extractPerformerReadingsFromRawData(evidence.rawData);
    if (deps.apply) {
      for (const p of readings) {
        const key = p.name.replace(/\s+/g, "").toLowerCase();
        if (readingDone.has(key)) continue;
        try {
          const id = await publisher.ensureTerm({
            taxonomyRestBase: "performer",
            name: p.name,
            slug: stableTermSlug(p.name, "p"),
            meta: { otonaselect_reading_kana: p.reading },
          });
          if (id) {
            readingDone.add(key);
            readingsSynced += 1;
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (catsSame && seriesSame) {
      rows.push({
        postId,
        productId: productCanonicalId,
        ok: true,
        skipped: true,
        reason: "UNCHANGED",
        before,
        after,
        seriesBefore,
        seriesAfter,
        changed: false,
        dateUnchanged: true,
        bodyUnchanged: true,
        fallbackUsed: derived.categoryFallbackUsed,
      });
      continue;
    }

    if (!deps.apply) {
      rows.push({
        postId,
        productId: productCanonicalId,
        ok: true,
        reason: "DRY_RUN",
        before,
        after,
        seriesBefore,
        seriesAfter,
        changed: true,
        dateUnchanged: true,
        bodyUnchanged: true,
        fallbackUsed: derived.categoryFallbackUsed,
      });
      changed += 1;
      continue;
    }

    try {
      const categoryIds: number[] = [];
      for (const name of after) {
        const reading = CATEGORY_READING_MAP[name];
        const id = await publisher.ensureTerm({
          taxonomyRestBase: "categories",
          name,
          meta: reading ? { otonaselect_reading_kana: reading } : undefined,
        });
        if (id) categoryIds.push(id);
      }
      if (categoryIds.length === 0) {
        rows.push({
          postId,
          productId: productCanonicalId,
          ok: false,
          reason: "NO_CATEGORY_IDS",
          before,
          after,
          seriesBefore,
          seriesAfter,
          changed: false,
          dateUnchanged: true,
          bodyUnchanged: true,
          fallbackUsed: derived.categoryFallbackUsed,
        });
        continue;
      }

      const seriesIds: number[] = [];
      for (const name of seriesAfter) {
        const id = await publisher.ensureTerm({
          taxonomyRestBase: "series",
          name,
          slug: stableTermSlug(name, "s"),
        });
        if (id) seriesIds.push(id);
      }

      await publisher.updateMetadataOnly({
        externalId: postId,
        categoryIds,
        // Always set series list (may be empty) to detach attribute series.
        seriesIds,
      });
      const afterSnap = await fetchPostTaxonomySnapshot(deps.config, postId);
      rows.push({
        postId,
        productId: productCanonicalId,
        ok: true,
        before,
        after: afterSnap?.categories ?? after,
        seriesBefore,
        seriesAfter: afterSnap?.series ?? seriesAfter,
        changed: true,
        dateUnchanged: !snap?.date || !afterSnap?.date || snap.date === afterSnap.date,
        bodyUnchanged: !snap?.content || snap.content === (afterSnap?.content ?? snap.content),
        fallbackUsed: derived.categoryFallbackUsed,
      });
      changed += 1;
    } catch (error) {
      rows.push({
        postId,
        productId: productCanonicalId,
        ok: false,
        reason: error instanceof Error ? error.message.slice(0, 200) : "UPDATE_FAILED",
        before,
        after,
        seriesBefore,
        seriesAfter,
        changed: false,
        dateUnchanged: true,
        bodyUnchanged: true,
        fallbackUsed: derived.categoryFallbackUsed,
      });
    }
  }

  return {
    rows,
    scanned: ids.length,
    changed,
    stillFallback,
    readingsSynced,
    categoryReadingsSeeded,
  };
}
