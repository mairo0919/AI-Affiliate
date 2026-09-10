/**
 * Re-evaluate WordPress categories from Research Evidence genres.
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
  PRODUCT_ARTICLE_CATEGORY_FALLBACK,
  type EvidenceTaxonomyLabel,
} from "./evidence-taxonomy.js";

export type CategoryRefreshRow = {
  postId: string;
  productId: string | null;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  before: string[];
  after: string[];
  changed: boolean;
  dateUnchanged: boolean;
  bodyUnchanged: boolean;
  fallbackUsed: boolean;
};

async function loadEvidenceLabels(
  prisma: DatabaseClient["prisma"],
  productCanonicalId: string | null,
): Promise<EvidenceTaxonomyLabel[]> {
  if (!productCanonicalId?.trim()) return [];
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
    if (!item?.tags?.length) return [];
    return item.tags.map((t) => ({
      type: t.researchTag.type,
      name: t.researchTag.name,
    }));
  } catch {
    return [];
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

async function fetchCategoryNames(
  config: AppConfig,
  postId: string,
): Promise<{ categories: string[]; date: string | null; content: string } | null> {
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
  return {
    categories,
    date: j.date ?? null,
    content: j.content?.raw || "",
  };
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
}> {
  const publisher = createWordPressPublisherFromConfig(deps.config) as WordPressApiPublisher;
  const ids =
    deps.postIds && deps.postIds.length > 0
      ? deps.postIds.map(String)
      : await listProductPostIds(deps.config);

  const rows: CategoryRefreshRow[] = [];
  let changed = 0;
  let stillFallback = 0;

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
    const evidenceLabels = await loadEvidenceLabels(deps.database.prisma, productCanonicalId);
    const derived = deriveWordPressTaxonomyFromEvidence({
      labels: evidenceLabels,
      title: version.title,
      subtitle: typeof structured.subtitle === "string" ? structured.subtitle : null,
      officialDescription:
        typeof structured.officialDescription === "string" ? structured.officialDescription : null,
      allowCategoryFallback: true,
    });

    const snap = await fetchCategoryNames(deps.config, postId);
    const before = snap?.categories ?? [];
    const after = derived.categories;
    const same =
      before.length === after.length &&
      before.every((c) => after.includes(c)) &&
      after.every((c) => before.includes(c));

    if (after.includes(PRODUCT_ARTICLE_CATEGORY_FALLBACK)) stillFallback += 1;

    if (same) {
      rows.push({
        postId,
        productId: productCanonicalId,
        ok: true,
        skipped: true,
        reason: "UNCHANGED",
        before,
        after,
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
        const id = await publisher.ensureTerm({ taxonomyRestBase: "categories", name });
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
          changed: false,
          dateUnchanged: true,
          bodyUnchanged: true,
          fallbackUsed: derived.categoryFallbackUsed,
        });
        continue;
      }
      await publisher.updateMetadataOnly({
        externalId: postId,
        categoryIds,
      });
      const afterSnap = await fetchCategoryNames(deps.config, postId);
      rows.push({
        postId,
        productId: productCanonicalId,
        ok: true,
        before,
        after: afterSnap?.categories ?? after,
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
        changed: false,
        dateUnchanged: true,
        bodyUnchanged: true,
        fallbackUsed: derived.categoryFallbackUsed,
      });
    }
  }

  return { rows, scanned: ids.length, changed, stillFallback };
}
