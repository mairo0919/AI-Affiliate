/**
 * APPROVED ContentVersion stock helpers (provider-agnostic).
 * Stock = APPROVED versions not yet on WORDPRESS as PUBLISHED/DRAFT/SCHEDULED.
 */

import type { DatabaseClient } from "@ai-affiliate/database";
import { normalizeProductKey } from "../daily-ops/blog-product-exclusion.js";
import {
  evaluateImagesForWordPressPublication,
  type ImagePublicationEvaluation,
} from "../publication/image-publication-eligibility.js";
import { parseArticleImages } from "../generation/article-images.js";

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
 */
export async function loadArticledProductKeys(
  prisma: DatabaseClient["prisma"],
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

  return keys;
}
