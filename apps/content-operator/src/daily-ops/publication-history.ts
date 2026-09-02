/**
 * Channel publication history + Tokyo-day quota helpers (existing models only).
 */

import type { DatabaseClient } from "@ai-affiliate/database";
import { tokyoDateString } from "../daily-blog/idempotency.js";
import type { ChannelPublicationRecord } from "./channel-duplicate.js";
import type { MixHistoryEntry } from "./content-mix.js";
import { normalizeMixSlot } from "./content-mix.js";
import type { XPostRoute } from "./x-route.js";

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
    where: { platform: "BLOGGER", status: { in: ["PUBLISHED", "DRAFT"] }, publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: {
      publishedAt: true,
      platformMetadata: true,
    },
  });
  for (const t of blogTargets) {
    const meta = asRecord(t.platformMetadata);
    const cid =
      (typeof meta.canonicalId === "string" && meta.canonicalId) ||
      (typeof meta.externalId === "string" && meta.externalId);
    if (!cid || !t.publishedAt) continue;
    out.push({
      channel: "BLOG",
      canonicalId: cid,
      publishedAt: t.publishedAt.toISOString(),
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
  const rows = await prisma.publicationTarget.findMany({
    where: {
      platform: "BLOGGER",
      status: "PUBLISHED",
      publishedAt: { gte: start, lt: end },
    },
    select: { publishedAt: true },
  });
  return rows.filter((r) => r.publishedAt && tokyoDateString(r.publishedAt, timeZone) === dayKey)
    .length;
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
    where: { platform: "BLOGGER", publishedAt: { not: null } },
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
    where: { platform: "BLOGGER", status: { in: ["PUBLISHED", "DRAFT"] } },
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
    if (/blogger\.com|blogspot\.com/i.test(body)) return "BLOG_TRAFFIC" as const;
    return "DIRECT_AFFILIATE" as const;
  });
}
