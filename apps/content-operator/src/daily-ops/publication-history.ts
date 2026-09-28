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
  const byKind = await countXPublishedByKindOnTokyoDay(prisma, dayKey, timeZone);
  return byKind.total;
}

export type XDayQuotaCounts = {
  total: number;
  standard: number;
  extra: number;
};

/** Classify a booked publication as STANDARD vs EXTRA via strategyVersion / slotKey. */
export function classifyXPublicationSlotKind(
  strategyVersion: string | null | undefined,
  at: Date | null | undefined,
  timeZone = "Asia/Tokyo",
): "STANDARD" | "EXTRA" {
  const kindMatch = /(?:^|\|)slotKind=(EXTRA|STANDARD)(?:\||$)/.exec(strategyVersion ?? "");
  if (kindMatch?.[1] === "EXTRA" || kindMatch?.[1] === "STANDARD") {
    return kindMatch[1];
  }
  const keyMatch = /(?:^|\|)slotKey=([^|]+)(?:\||$)/.exec(strategyVersion ?? "");
  const slotKey = keyMatch?.[1];
  if (slotKey) {
    const minuteMatch = /T\d{2}:(\d{2}):00\+09:00$/.exec(slotKey);
    if (minuteMatch && minuteMatch[1] !== "00") return "EXTRA";
    return "STANDARD";
  }
  if (!at) return "STANDARD";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const bag: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return Number(bag.minute ?? "0") === 0 ? "STANDARD" : "EXTRA";
}

/** Split Tokyo-day X bookings into regular vs date-scoped EXTRA quota buckets. */
export async function countXPublishedByKindOnTokyoDay(
  prisma: DatabaseClient["prisma"],
  dayKey: string,
  timeZone: string,
): Promise<XDayQuotaCounts> {
  const { start, end } = dayBoundsUtc(dayKey, timeZone);
  const rows = await prisma.xPublication.findMany({
    where: {
      status: {
        in: ["PUBLISHED", "PARTIALLY_PUBLISHED", "PUBLISHED_UNVERIFIED", "SCHEDULED"],
      },
      OR: [
        { publishedAt: { gte: start, lt: end } },
        { scheduledAt: { gte: start, lt: end } },
      ],
    },
    select: { publishedAt: true, scheduledAt: true, strategyVersion: true },
  });
  let standard = 0;
  let extra = 0;
  for (const r of rows) {
    const at = r.publishedAt ?? r.scheduledAt;
    if (!at || tokyoDateString(at, timeZone) !== dayKey) continue;
    if (classifyXPublicationSlotKind(r.strategyVersion, at, timeZone) === "EXTRA") {
      extra += 1;
    } else {
      standard += 1;
    }
  }
  return { total: standard + extra, standard, extra };
}

/** Hours (JST) already booked for X on dayKey via scheduledAt / publishedAt. */
export async function loadFilledXSlotHoursForDay(
  prisma: DatabaseClient["prisma"],
  dayKey: string,
  timeZone: string,
): Promise<Set<number>> {
  const { start, end } = dayBoundsUtc(dayKey, timeZone);
  const rows = await prisma.xPublication.findMany({
    where: {
      status: {
        in: [
          "PUBLISHED",
          "PARTIALLY_PUBLISHED",
          "PUBLISHED_UNVERIFIED",
          "SCHEDULED",
          "DRAFT",
          "PUBLISHING",
        ],
      },
      OR: [
        { publishedAt: { gte: start, lt: end } },
        { scheduledAt: { gte: start, lt: end } },
      ],
    },
    select: { publishedAt: true, scheduledAt: true, strategyVersion: true },
  });
  const hours = new Set<number>();
  for (const r of rows) {
    const at = r.publishedAt ?? r.scheduledAt;
    if (!at || tokyoDateString(at, timeZone) !== dayKey) continue;
    const fromVersion = /(?:^|\|)slotHour=(\d{1,2})(?:\||$)/.exec(r.strategyVersion ?? "");
    if (fromVersion?.[1]) {
      hours.add(Number(fromVersion[1]));
      continue;
    }
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    });
    hours.add(Number(fmt.format(at)));
  }
  return hours;
}

/** CIDs already used on X (any terminal/active status) — hard duplicate ban.
 * Includes FAILED so retry does not create a second reservation as a "new" post.
 */
export async function loadPostedXCanonicalIds(
  prisma: DatabaseClient["prisma"],
  options?: { limit?: number },
): Promise<Set<string>> {
  const limit = Math.max(1, Math.min(options?.limit ?? 500, 2000));
  const rows = await prisma.xPublication.findMany({
    where: {
      status: {
        in: [
          "PUBLISHED",
          "PARTIALLY_PUBLISHED",
          "PUBLISHED_UNVERIFIED",
          "SCHEDULED",
          "DRAFT",
          "PUBLISHING",
          "FAILED",
          "BLOCKED",
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { researchItem: { select: { externalId: true } } },
  });
  return new Set(
    rows
      .map((r) => r.researchItem.externalId?.trim().toLowerCase())
      .filter((v): v is string => Boolean(v)),
  );
}

/** ContentVersion ids already referenced by X publications (hard ban). */
export async function loadPostedXContentVersionIds(
  prisma: DatabaseClient["prisma"],
  options?: { limit?: number },
): Promise<Set<string>> {
  const limit = Math.max(1, Math.min(options?.limit ?? 500, 2000));
  const rows = await prisma.xPublication.findMany({
    where: {
      status: {
        in: [
          "PUBLISHED",
          "PARTIALLY_PUBLISHED",
          "PUBLISHED_UNVERIFIED",
          "SCHEDULED",
          "DRAFT",
          "PUBLISHING",
          "FAILED",
          "BLOCKED",
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      generatedContent: { select: { inputSnapshot: true } },
    },
  });
  const out = new Set<string>();
  for (const r of rows) {
    const snap = asRecord(r.generatedContent.inputSnapshot);
    const cv = snap.contentVersionId;
    if (typeof cv === "string" && cv.trim()) out.add(cv.trim());
  }
  return out;
}

/**
 * Booked X slotKeys across a short horizon (OS timezone independent).
 * Keys look like 2026-09-14T21:00:00+09:00.
 */
export async function loadFilledXSlotKeys(
  prisma: DatabaseClient["prisma"],
  options?: { fromDayKey?: string; dayCount?: number; timeZone?: string },
): Promise<Set<string>> {
  const timeZone = options?.timeZone ?? "Asia/Tokyo";
  const dayCount = Math.max(1, Math.min(options?.dayCount ?? 7, 14));
  const fromDay = options?.fromDayKey ?? tokyoDateString(new Date(), timeZone);
  const start = new Date(`${fromDay}T00:00:00+09:00`);
  const end = new Date(start.getTime() + dayCount * 86_400_000);
  const rows = await prisma.xPublication.findMany({
    where: {
      status: {
        in: [
          "PUBLISHED",
          "PARTIALLY_PUBLISHED",
          "PUBLISHED_UNVERIFIED",
          "SCHEDULED",
          "DRAFT",
          "PUBLISHING",
        ],
      },
      OR: [
        { publishedAt: { gte: start, lt: end } },
        { scheduledAt: { gte: start, lt: end } },
      ],
    },
    select: { publishedAt: true, scheduledAt: true, strategyVersion: true },
  });
  const keys = new Set<string>();
  for (const r of rows) {
    const fromKey = /(?:^|\|)slotKey=([^|]+)(?:\||$)/.exec(r.strategyVersion ?? "");
    if (fromKey?.[1]?.includes("T") && fromKey[1].includes("+09:00")) {
      keys.add(fromKey[1]);
      continue;
    }
    const at = r.publishedAt ?? r.scheduledAt;
    if (!at) continue;
    const day = tokyoDateString(at, timeZone);
    const fromVersion = /(?:^|\|)slotHour=(\d{1,2})(?:\||$)/.exec(r.strategyVersion ?? "");
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const bag: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== "literal") bag[p.type] = p.value;
    }
    const hour = fromVersion?.[1] ? Number(fromVersion[1]) : Number(bag.hour);
    const minute = fromVersion?.[1] ? 0 : Number(bag.minute ?? "0");
    if (!Number.isFinite(hour)) continue;
    const p = (n: number) => String(n).padStart(2, "0");
    const [y, m, d] = day.split("-");
    keys.add(`${y}-${m}-${d}T${p(hour)}:${p(minute)}:00+09:00`);
  }
  return keys;
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
