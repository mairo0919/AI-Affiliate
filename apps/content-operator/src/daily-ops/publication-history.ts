/**
 * Channel publication history + Tokyo-day quota helpers (existing models only).
 * Blog channel SSOT for new publishes is WORDPRESS; BLOGGER rows remain readable
 * for historical duplicate / mix awareness during transition.
 */

import type { DatabaseClient } from "@ai-affiliate/database";
import { tokyoDateString } from "../daily-blog/idempotency.js";
import { normalizeProductKey } from "./blog-product-exclusion.js";
import type { ChannelPublicationRecord } from "./channel-duplicate.js";
import type { MixHistoryEntry } from "./content-mix.js";
import { normalizeMixSlot } from "./content-mix.js";
import type { XPostRoute } from "./x-route.js";

/** Active blog publication platform + legacy Blogger history. */
export const BLOG_PUBLICATION_PLATFORMS = ["WORDPRESS", "BLOGGER"] as const;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function dayBoundsUtc(dayKey: string, timeZone: string): { start: Date; end: Date } {
  // Approximate: interpret dayKey as Tokyo civil date → UTC window via formatter offset.
  // Use noon UTC on dayKey ± 14h as safe envelope, then filter with tokyoDateString.
  const base = new Date(`${dayKey}T00:00:00+09:00`);
  const start = new Date(base.getTime() - 12 * 3600_000);
  const end = new Date(base.getTime() + 36 * 3600_000);
  void timeZone;
  return { start, end };
}

export async function loadChannelPublicationHistory(
  prisma: DatabaseClient["prisma"],
  options?: { limit?: number },
): Promise<ChannelPublicationRecord[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 300, 1000));
  const out: ChannelPublicationRecord[] = [];

  const blogTargets = await prisma.publicationTarget.findMany({
    where: {
      platform: { in: [...BLOG_PUBLICATION_PLATFORMS] },
      status: { in: ["PUBLISHED", "DRAFT", "AWAITING_APPROVAL"] },
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      publishedAt: true,
      createdAt: true,
      platformMetadata: true,
    },
  });
  const seenBlogCid = new Set<string>();
  for (const t of blogTargets) {
    const meta = asRecord(t.platformMetadata);
    const rawCid =
      (typeof meta.canonicalId === "string" && meta.canonicalId) ||
      (typeof meta.productCanonicalId === "string" && meta.productCanonicalId) ||
      (typeof meta.externalId === "string" && meta.externalId) ||
      null;
    const cid = normalizeProductKey(rawCid) ?? (rawCid ? String(rawCid).trim().toLowerCase() : null);
    if (!cid) continue;
    if (seenBlogCid.has(cid)) continue;
    seenBlogCid.add(cid);
    const when = t.publishedAt ?? t.createdAt;
    out.push({
      channel: "BLOG",
      canonicalId: cid,
      publishedAt: when.toISOString(),
    });
  }

  const xPubs = await prisma.xPublication.findMany({
    where: { status: { in: ["PUBLISHED", "PARTIALLY_PUBLISHED"] }, publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    take: limit,
    include: {
      researchItem: { select: { externalId: true } },
      posts: { where: { sequence: 1 }, take: 1, select: { bodyHash: true } },
    },
  });
  for (const p of xPubs) {
    if (!p.publishedAt) continue;
    out.push({
      channel: "X",
      canonicalId: p.researchItem.externalId,
      publishedAt: p.publishedAt.toISOString(),
      bodyFingerprint: p.posts[0]?.bodyHash ?? null,
    });
  }

  return out;
}

export async function countBlogPublishedOnTokyoDay(
  prisma: DatabaseClient["prisma"],
  dayKey: string,
  timeZone: string,
): Promise<number> {
  const { start, end } = dayBoundsUtc(dayKey, timeZone);
  // Count DRAFT + PUBLISHED + AWAITING_APPROVAL so manual-review holds still consume the daily slot.
  const rows = await prisma.publicationTarget.findMany({
    where: {
      platform: { in: [...BLOG_PUBLICATION_PLATFORMS] },
      status: { in: ["PUBLISHED", "DRAFT", "AWAITING_APPROVAL"] },
      OR: [
        { publishedAt: { gte: start, lt: end } },
        { publishedAt: null, createdAt: { gte: start, lt: end } },
      ],
    },
    select: { publishedAt: true, createdAt: true },
  });
  return rows.filter((r) => {
    const at = r.publishedAt ?? r.createdAt;
    return at && tokyoDateString(at, timeZone) === dayKey;
  }).length;
}

export async function countXPublishedOnTokyoDay(
  prisma: DatabaseClient["prisma"],
  dayKey: string,
  timeZone: string,
): Promise<number> {
  const { start, end } = dayBoundsUtc(dayKey, timeZone);
  const rows = await prisma.xPublication.findMany({
    where: {
      status: { in: ["PUBLISHED", "PARTIALLY_PUBLISHED"] },
      publishedAt: { gte: start, lt: end },
    },
    select: { publishedAt: true },
  });
  return rows.filter((r) => r.publishedAt && tokyoDateString(r.publishedAt, timeZone) === dayKey)
    .length;
}

export async function loadRecentMixHistory(
  prisma: DatabaseClient["prisma"],
  limit = 14,
): Promise<MixHistoryEntry[]> {
  const rows = await prisma.publicationTarget.findMany({
    where: {
      platform: { in: [...BLOG_PUBLICATION_PLATFORMS] },
      publishedAt: { not: null },
    },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: { publishedAt: true, platformMetadata: true },
  });
  const out: MixHistoryEntry[] = [];
  for (const r of rows) {
    const meta = asRecord(r.platformMetadata);
    const slot = normalizeMixSlot(meta.mixSlot ?? meta.blogMixSlot);
    if (slot) {
      out.push({
        slot,
        at: r.publishedAt?.toISOString() ?? new Date().toISOString(),
      });
    }
  }
  return out;
}

export async function loadRecentXMixHistory(
  prisma: DatabaseClient["prisma"],
  limit = 14,
): Promise<MixHistoryEntry[]> {
  const rows = await prisma.xPublication.findMany({
    where: { status: { in: ["PUBLISHED", "PARTIALLY_PUBLISHED"] }, publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: { publishedAt: true, strategyVersion: true },
  });
  const out: MixHistoryEntry[] = [];
  for (const r of rows) {
    const parts = (r.strategyVersion ?? "").split("|");
    let slot = null as ReturnType<typeof normalizeMixSlot>;
    for (const p of parts) {
      slot = normalizeMixSlot(p);
      if (slot) break;
    }
    if (slot) {
      out.push({
        slot,
        at: r.publishedAt?.toISOString() ?? new Date().toISOString(),
      });
    }
  }
  return out;
}

/** Actress keys from recent BLOG publications (soft diversity). */
export async function loadRecentBlogActressKeys(
  prisma: DatabaseClient["prisma"],
  limit = 20,
): Promise<string[]> {
  const rows = await prisma.publicationTarget.findMany({
    where: {
      platform: { in: [...BLOG_PUBLICATION_PLATFORMS] },
      status: { in: ["PUBLISHED", "DRAFT"] },
    },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: { platformMetadata: true },
  });
  const keys: string[] = [];
  for (const r of rows) {
    const meta = asRecord(r.platformMetadata);
    if (typeof meta.actressKey === "string" && meta.actressKey.trim()) {
      keys.push(meta.actressKey.trim());
    }
  }
  return [...new Set(keys)];
}

export async function loadRecentXRoutes(
  prisma: DatabaseClient["prisma"],
  limit = 14,
): Promise<XPostRoute[]> {
  const rows = await prisma.xPublication.findMany({
    where: { status: { in: ["PUBLISHED", "PARTIALLY_PUBLISHED"] } },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: { strategyVersion: true, posts: { take: 1, select: { body: true } } },
  });
  // Route is stored in strategyVersion suffix or inferred from body URL host — prefer metadata later.
  // Default soft balance: treat unknown as DIRECT_AFFILIATE.
  return rows.map((r) => {
    const body = r.posts[0]?.body ?? "";
    if (/blogger\.com|blogspot\.com|wordpress|\/\?p=/i.test(body)) return "BLOG_TRAFFIC" as const;
    return "DIRECT_AFFILIATE" as const;
  });
}
