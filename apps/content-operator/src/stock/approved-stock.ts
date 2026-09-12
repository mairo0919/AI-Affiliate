/**
 * APPROVED ContentVersion stock helpers (provider-agnostic).
 * Stock = APPROVED versions not yet on WORDPRESS as PUBLISHED/DRAFT/SCHEDULED.
 * Live WP publish/future product CIDs are also treated as articled (DB may lag WP).
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient } from "@ai-affiliate/database";
import { normalizeProductKey } from "../daily-ops/blog-product-exclusion.js";
import {
  evaluateImagesForWordPressPublication,
  type ImagePublicationEvaluation,
} from "../publication/image-publication-eligibility.js";
import { parseArticleImages } from "../generation/article-images.js";
import { WP_SEO_META_KEYS } from "../wordpress/wordpress-seo-attach.js";

export type ApprovedStockRow = {
  contentVersionId: string;
  contentId: string;
  title: string;
  productKey: string | null;
  providerHint: string | null;
  updatedAt: Date;
  hasWordPressTarget: boolean;
  publicEligible: boolean;
  publicBlockReasons: string[];
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function extractProductKeyFromStructured(structured: unknown): string | null {
  const sc = asRecord(structured);
  const raw =
    (typeof sc.productCanonicalId === "string" && sc.productCanonicalId) ||
    (typeof sc.canonicalId === "string" && sc.canonicalId) ||
    (typeof sc.externalId === "string" && sc.externalId) ||
    null;
  return normalizeProductKey(raw);
}

export function extractProviderHint(structured: unknown): string | null {
  const sc = asRecord(structured);
  if (typeof sc.providerKey === "string" && sc.providerKey.trim()) return sc.providerKey.trim();
  if (typeof sc.affiliateProvider === "string" && sc.affiliateProvider.trim()) {
    return sc.affiliateProvider.trim();
  }
  if (typeof sc.sourceProvider === "string" && sc.sourceProvider.trim()) {
    return sc.sourceProvider.trim();
  }
  return null;
}

export function evaluatePublicEligibilityFromStructured(structured: unknown): {
  eligible: boolean;
  evaluation: ImagePublicationEvaluation;
} {
  const images = parseArticleImages(asRecord(structured).images);
  const evaluation = evaluateImagesForWordPressPublication({
    images,
    mode: "publish",
  });
  return { eligible: evaluation.pass, evaluation };
}

/**
 * List APPROVED versions. Optionally only unused stock (no WP draft/publish/schedule).
 */
export async function listApprovedStock(
  prisma: DatabaseClient["prisma"],
  options?: { unusedOnly?: boolean; limit?: number },
): Promise<ApprovedStockRow[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 200, 500));
  const versions = await prisma.contentVersion.findMany({
    where: { status: "APPROVED" },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: {
      id: true,
      contentId: true,
      title: true,
      structuredContent: true,
      updatedAt: true,
    },
  });

  const rows: ApprovedStockRow[] = [];
  for (const v of versions) {
    const targets = await prisma.publicationTarget.findMany({
      where: {
        contentVersionId: v.id,
        platform: "WORDPRESS",
        status: { in: ["PUBLISHED", "DRAFT", "SCHEDULED", "AWAITING_APPROVAL"] },
      },
      select: { id: true, status: true, publishedExternalId: true },
      take: 5,
    });
    const hasWordPressTarget = targets.some((t) => Boolean(t.publishedExternalId) || t.status === "SCHEDULED");
    if (options?.unusedOnly && hasWordPressTarget) continue;

    const pub = evaluatePublicEligibilityFromStructured(v.structuredContent);
    rows.push({
      contentVersionId: v.id,
      contentId: v.contentId,
      title: v.title,
      productKey: extractProductKeyFromStructured(v.structuredContent),
      providerHint: extractProviderHint(v.structuredContent),
      updatedAt: v.updatedAt,
      hasWordPressTarget,
      publicEligible: pub.eligible,
      publicBlockReasons: pub.eligible ? [] : pub.evaluation.failureCodes,
    });
  }
  return rows;
}

export async function countUnusedApprovedStock(
  prisma: DatabaseClient["prisma"],
): Promise<number> {
  const rows = await listApprovedStock(prisma, { unusedOnly: true, limit: 500 });
  return rows.length;
}

/**
 * Product keys already used by draft/published/future/APPROVED stock for normal articles.
 * When `config` is provided, also unions live WordPress publish+future CIDs so Railway DB
 * drift cannot re-article products already on production WP.
 */
export async function loadArticledProductKeys(
  prisma: DatabaseClient["prisma"],
  options?: { config?: AppConfig },
): Promise<Set<string>> {
  const keys = new Set<string>();

  const blogTargets = await prisma.publicationTarget.findMany({
    where: {
      platform: { in: ["WORDPRESS", "BLOGGER"] },
      status: { in: ["PUBLISHED", "DRAFT", "SCHEDULED", "AWAITING_APPROVAL"] },
    },
    select: { platformMetadata: true, contentVersionId: true },
    take: 1000,
  });
  for (const t of blogTargets) {
    const meta = asRecord(t.platformMetadata);
    const raw =
      (typeof meta.productCanonicalId === "string" && meta.productCanonicalId) ||
      (typeof meta.canonicalId === "string" && meta.canonicalId) ||
      (typeof meta.productKey === "string" && meta.productKey) ||
      null;
    const k = normalizeProductKey(raw);
    if (k) keys.add(k);
  }

  const approved = await prisma.contentVersion.findMany({
    where: { status: { in: ["APPROVED", "REVIEWING"] } },
    select: { structuredContent: true },
    take: 2000,
  });
  for (const v of approved) {
    const k = extractProductKeyFromStructured(v.structuredContent);
    if (k) keys.add(k);
  }

  // Also mark ResearchItems that already have GeneratedContent / ContentCandidate linkage
  // via externalId when present on structured content is covered above; Research externalIds
  // that map to WP live posts are covered by WP fetch below.

  if (options?.config) {
    const live = await loadWordPressLiveProductKeys(options.config);
    for (const k of live.keys) keys.add(k);
  }

  return keys;
}

/**
 * Read product CIDs from live WP publish + future posts (meta + content heuristics).
 * Does not mutate WP. Used so existing 32+17 posts block duplicate generation.
 */
export async function loadWordPressLiveProductKeys(config: AppConfig): Promise<{
  keys: Set<string>;
  publishFetched: number;
  futureFetched: number;
  error: string | null;
}> {
  const keys = new Set<string>();
  const base = config.wordpressBaseUrl?.replace(/\/$/, "");
  const user = config.wordpressUsername;
  const pass = config.wordpressApplicationPassword;
  if (!base || !user || !pass || !config.wordpressAllowExternalRequests) {
    return { keys, publishFetched: 0, futureFetched: 0, error: null };
  }
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  let publishFetched = 0;
  let futureFetched = 0;
  try {
    for (const status of ["publish", "future"] as const) {
      let page = 1;
      while (page <= 20) {
        const url = `${base}/wp-json/wp/v2/posts?status=${status}&per_page=100&page=${page}&context=edit&_fields=id,slug,content,meta`;
        const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
        if (!res.ok) {
          return {
            keys,
            publishFetched,
            futureFetched,
            error: `wp_${status}_http_${res.status}`,
          };
        }
        const rows = (await res.json()) as Array<{
          id?: number;
          slug?: string;
          content?: { raw?: string; rendered?: string };
          meta?: Record<string, unknown>;
        }>;
        if (!Array.isArray(rows) || rows.length === 0) break;
        for (const row of rows) {
          if (status === "publish") publishFetched += 1;
          else futureFetched += 1;
          const meta = asRecord(row.meta);
          const fromMetaRaw =
            meta[WP_SEO_META_KEYS.productCid] ??
            meta.productCanonicalId ??
            meta.canonicalId ??
            null;
          const fromMeta = typeof fromMetaRaw === "string" ? fromMetaRaw : null;
          const kMeta = normalizeProductKey(fromMeta);
          if (kMeta) keys.add(kMeta);

          const body = `${row.content?.raw ?? ""}\n${row.content?.rendered ?? ""}\n${row.slug ?? ""}`;
          for (const m of body.matchAll(
            /(?:content\/\?id=|[?&]id=|cid=)([a-z0-9][a-z0-9_-]{3,40})/gi,
          )) {
            const k = normalizeProductKey(m[1] ?? "");
            if (k) keys.add(k);
          }
        }
        const totalPages = Number(res.headers.get("x-wp-totalpages") || "1");
        if (page >= totalPages || rows.length < 100) break;
        page += 1;
      }
    }
    return { keys, publishFetched, futureFetched, error: null };
  } catch (e) {
    return {
      keys,
      publishFetched,
      futureFetched,
      error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
    };
  }
}
