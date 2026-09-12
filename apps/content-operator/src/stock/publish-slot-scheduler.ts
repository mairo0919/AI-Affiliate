/**
 * WordPress future publish scheduler — separate from generation.
 * Slots: 12:00 / 21:00 / 23:00 JST (max 3/day).
 * Skip PUBLIC-blocked articles and continue to next eligible.
 * Never touches protected posts 43/46 except scheduling when PUBLIC-eligible.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import {
  createWordPressPublisherFromConfig,
} from "../adapters/publisher/wordpress-api-publisher.js";
import {
  publishContentVersionToWordPress,
  type WordPressPublishOneResult,
} from "../wordpress/wordpress-publish-path.js";
import {
  listUpcomingPublishSlots,
  publishSlotKeyFromWpLocalDate,
} from "../wordpress/wordpress-datetime.js";
import {
  listApprovedStock,
  evaluatePublicEligibilityFromStructured,
  extractProductKeyFromStructured,
  extractProviderHint,
  type ApprovedStockRow,
} from "./approved-stock.js";
import { computeFutureReserveBudget, loadStockRuntimeConfig } from "./stock-config.js";
import { confirmFanzaAffiliateImageTerms } from "./confirm-fanza-image-terms.js";

export type PublishSlotScheduleResult = {
  skipped: boolean;
  skipReason: string | null;
  slotsConsidered: Array<{ date: string; hour: number }>;
  openSlotsBeforeReserve: number;
  wpFutureFetched: number;
  wpFutureError: string | null;
  futureInventoryCount: number;
  futureTargetPosts: number;
  futureMinPosts: number;
  futureReserveBudget: number;
  unusedApprovedConsidered: number;
  publicEligibleQueued: number;
  reserved: Array<{
    slot: string;
    contentVersionId: string;
    productKey: string | null;
    externalId?: string;
    url?: string;
  }>;
  publicBlocked: Array<{ contentVersionId: string; productKey: string | null; reasons: string[] }>;
  otherSkipped: Array<{ contentVersionId: string; reason: string }>;
};

function slotKey(year: number, month: number, day: number, hour: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:00:00+09:00`;
}

async function loadReservedSlotKeysFromDb(
  prisma: DatabaseClient["prisma"],
): Promise<Set<string>> {
  const rows = await prisma.publicationTarget.findMany({
    where: {
      platform: "WORDPRESS",
      status: { in: ["SCHEDULED", "PUBLISHED", "DRAFT"] },
    },
    select: { platformMetadata: true },
    take: 2_000,
  });
  const keys = new Set<string>();
  for (const r of rows) {
    const meta = (r.platformMetadata ?? {}) as Record<string, unknown>;
    if (typeof meta.publishSlotKey === "string" && meta.publishSlotKey) {
      keys.add(meta.publishSlotKey);
    }
    if (typeof meta.scheduledAt === "string" && meta.scheduledAt) {
      keys.add(meta.scheduledAt);
    }
  }
  return keys;
}

/**
 * Operator DB may lag WP (e.g. past boost wrote futures without PublicationTarget rows).
 * Treat live WP `future` dates as reserved so we never double-book 12/21/23 slots.
 */
async function loadReservedSlotKeysFromWordPress(config: AppConfig): Promise<{
  keys: Set<string>;
  fetched: number;
  error: string | null;
}> {
  const keys = new Set<string>();
  const base = config.wordpressBaseUrl?.replace(/\/$/, "");
  const user = config.wordpressUsername;
  const pass = config.wordpressApplicationPassword;
  if (!base || !user || !pass || !config.wordpressAllowExternalRequests) {
    return { keys, fetched: 0, error: null };
  }
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  let page = 1;
  let fetched = 0;
  try {
    while (page <= 20) {
      const url = `${base}/wp-json/wp/v2/posts?status=future&per_page=100&page=${page}&orderby=date&order=asc&_fields=id,date`;
      const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!res.ok) {
        return { keys, fetched, error: `wp_future_http_${res.status}` };
      }
      const rows = (await res.json()) as Array<{ id?: number; date?: string }>;
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        fetched += 1;
        if (typeof row.date === "string") {
          const key = publishSlotKeyFromWpLocalDate(row.date);
          if (key) keys.add(key);
        }
      }
      const totalPages = Number(res.headers.get("x-wp-totalpages") || "1");
      if (page >= totalPages || rows.length < 100) break;
      page += 1;
    }
    return { keys, fetched, error: null };
  } catch (e) {
    return {
      keys,
      fetched,
      error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
    };
  }
}

async function loadReservedSlotKeys(input: {
  prisma: DatabaseClient["prisma"];
  config: AppConfig;
}): Promise<{ keys: Set<string>; wpFutureFetched: number; wpFutureError: string | null }> {
  const keys = await loadReservedSlotKeysFromDb(input.prisma);
  const fromWp = await loadReservedSlotKeysFromWordPress(input.config);
  for (const k of fromWp.keys) keys.add(k);
  return {
    keys,
    wpFutureFetched: fromWp.fetched,
    wpFutureError: fromWp.error,
  };
}

export async function runPublishSlotScheduler(deps: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  config: AppConfig;
  now?: Date;
  /** Days ahead including today. */
  days?: number;
}): Promise<PublishSlotScheduleResult> {
  const runtime = loadStockRuntimeConfig();
  const now = deps.now ?? new Date();

  const emptySkip = (skipReason: string): PublishSlotScheduleResult => ({
    skipped: true,
    skipReason,
    slotsConsidered: [],
    openSlotsBeforeReserve: 0,
    wpFutureFetched: 0,
    wpFutureError: null,
    futureInventoryCount: 0,
    futureTargetPosts: runtime.futureTargetPosts,
    futureMinPosts: runtime.futureMinPosts,
    futureReserveBudget: 0,
    unusedApprovedConsidered: 0,
    publicEligibleQueued: 0,
    reserved: [],
    publicBlocked: [],
    otherSkipped: [],
  });

  if (!runtime.stockPublishSchedulerEnabled) {
    return emptySkip("STOCK_PUBLISH_SCHEDULER_ENABLED_FALSE");
  }

  if (!deps.config.wordpressAllowFutureSchedule && !deps.config.wordpressAllowDirectPublish) {
    return emptySkip("FUTURE_SCHEDULE_DISABLED");
  }

  const horizonDays = deps.days ?? runtime.scheduleHorizonDays;
  const slots = listUpcomingPublishSlots({
    now,
    timeZone: deps.config.publicationTimezone || "Asia/Tokyo",
    hours: runtime.publishSlotHoursJst,
    days: horizonDays,
    includePastToday: false,
  });

  // Ensure APPROVED stock with trusted DMM images is PUBLIC-capable when terms verified.
  if (
    ["1", "true", "yes", "on"].includes(
      (process.env.FANZA_AFFILIATE_IMAGE_TERMS_VERIFIED ?? "").trim().toLowerCase(),
    )
  ) {
    await confirmFanzaAffiliateImageTerms({
      prisma: deps.database.prisma,
      iConfirmChecklist: true,
      actor: "wp-future-scheduler",
      contentVersionLimit: 500,
    });
  }

  const stock = await listApprovedStock(deps.database.prisma, {
    unusedOnly: true,
    limit: Math.max(300, runtime.scheduleMaxPerTick * 4),
  });
  const publicBlocked: PublishSlotScheduleResult["publicBlocked"] = [];
  const queue: Array<ApprovedStockRow & { updateExistingDraft?: boolean }> = [];
  for (const row of stock) {
    if (!row.publicEligible) {
      publicBlocked.push({
        contentVersionId: row.contentVersionId,
        productKey: row.productKey,
        reasons: row.publicBlockReasons.length
          ? row.publicBlockReasons
          : ["IMAGE_PUBLIC_ELIGIBILITY"],
      });
      continue;
    }
    queue.push(row);
  }

  // Existing WP inventory (#43/#46): keep DRAFT until PUBLIC-eligible, then promote to future.
  const protectedIds = runtime.protectedWpPostIds.map(String);
  const inventoryTargets = await deps.database.prisma.publicationTarget.findMany({
    where: {
      platform: "WORDPRESS",
      status: "DRAFT",
      publishedExternalId: { in: protectedIds },
    },
    select: {
      contentVersionId: true,
      publishedExternalId: true,
      platformMetadata: true,
    },
    take: 10,
  });
  for (const t of inventoryTargets) {
    const version = await deps.database.prisma.contentVersion.findUnique({
      where: { id: t.contentVersionId },
      select: {
        id: true,
        contentId: true,
        title: true,
        status: true,
        structuredContent: true,
        updatedAt: true,
      },
    });
    if (!version || version.status !== "APPROVED") continue;
    const pub = evaluatePublicEligibilityFromStructured(version.structuredContent);
    const row: ApprovedStockRow & { updateExistingDraft?: boolean } = {
      contentVersionId: version.id,
      contentId: version.contentId,
      title: version.title,
      productKey: extractProductKeyFromStructured(version.structuredContent),
      providerHint: extractProviderHint(version.structuredContent),
      updatedAt: version.updatedAt,
      hasWordPressTarget: true,
      publicEligible: pub.eligible,
      publicBlockReasons: pub.eligible ? [] : pub.evaluation.failureCodes,
      updateExistingDraft: true,
    };
    if (!row.publicEligible) {
      publicBlocked.push({
        contentVersionId: row.contentVersionId,
        productKey: row.productKey,
        reasons: row.publicBlockReasons,
      });
      continue;
    }
    // Prefer inventory posts early in the queue (already on production site).
    queue.unshift(row);
  }

  const publisher = createWordPressPublisherFromConfig(deps.config);
  const reserved: PublishSlotScheduleResult["reserved"] = [];
  const otherSkipped: PublishSlotScheduleResult["otherSkipped"] = [];
  let queueIdx = 0;
  const reservedLoad = await loadReservedSlotKeys({
    prisma: deps.database.prisma,
    config: deps.config,
  });
  const reservedKeys = reservedLoad.keys;
  if (reservedLoad.wpFutureError) {
    return {
      skipped: true,
      skipReason: `WP_FUTURE_COUNT_UNAVAILABLE:${reservedLoad.wpFutureError}`,
      slotsConsidered: slots.map((s) => ({
        date: `${s.year}-${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}`,
        hour: s.hour,
      })),
      openSlotsBeforeReserve: 0,
      wpFutureFetched: reservedLoad.wpFutureFetched,
      wpFutureError: reservedLoad.wpFutureError,
      futureInventoryCount: reservedLoad.wpFutureFetched,
      futureTargetPosts: runtime.futureTargetPosts,
      futureMinPosts: runtime.futureMinPosts,
      futureReserveBudget: 0,
      unusedApprovedConsidered: stock.length,
      publicEligibleQueued: queue.length,
      reserved: [],
      publicBlocked,
      otherSkipped: [],
    };
  }
  const futureInventoryCount = reservedLoad.wpFutureFetched;
  const inventoryBudget = computeFutureReserveBudget({
    currentFutureCount: futureInventoryCount,
    futureMinPosts: runtime.futureMinPosts,
    futureTargetPosts: runtime.futureTargetPosts,
    scheduleMaxPerTick: runtime.scheduleMaxPerTick,
  });
  if (!inventoryBudget.allow) {
    return {
      skipped: true,
      skipReason: inventoryBudget.reason ?? "FUTURE_AT_OR_ABOVE_TARGET",
      slotsConsidered: slots.map((s) => ({
        date: `${s.year}-${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}`,
        hour: s.hour,
      })),
      openSlotsBeforeReserve: 0,
      wpFutureFetched: reservedLoad.wpFutureFetched,
      wpFutureError: reservedLoad.wpFutureError,
      futureInventoryCount,
      futureTargetPosts: runtime.futureTargetPosts,
      futureMinPosts: runtime.futureMinPosts,
      futureReserveBudget: 0,
      unusedApprovedConsidered: stock.length,
      publicEligibleQueued: queue.length,
      reserved: [],
      publicBlocked,
      otherSkipped: [],
    };
  }
  const maxPerTick = inventoryBudget.budget;
  let openSlotsBeforeReserve = 0;
  for (const slot of slots) {
    const key = slotKey(slot.year, slot.month, slot.day, slot.hour);
    if (!reservedKeys.has(key)) openSlotsBeforeReserve += 1;
  }

  for (const slot of slots) {
    if (reserved.length >= maxPerTick) {
      break;
    }
    const key = slotKey(slot.year, slot.month, slot.day, slot.hour);
    if (reservedKeys.has(key)) {
      continue;
    }

    let placed = false;
    while (queueIdx < queue.length && !placed) {
      const candidate = queue[queueIdx++]!;
      const result: WordPressPublishOneResult = await publishContentVersionToWordPress(
        {
          config: deps.config,
          lifecycle: deps.lifecycle,
          prisma: deps.database.prisma,
          publisher,
        },
        {
          contentVersionId: candidate.contentVersionId,
          canonicalId: candidate.productKey,
          productCanonicalId: candidate.productKey,
          mode: "future",
          scheduledAt: slot.at,
          updateExistingDraft: Boolean(
            (candidate as { updateExistingDraft?: boolean }).updateExistingDraft,
          ),
          route: "WP_FUTURE_SCHEDULER",
          idempotencyKey: `wordpress-future:${candidate.contentVersionId}:${key}`,
          platformMetadata: {
            publishSlotKey: key,
            scheduledAt: key,
            protectedWpPosts: runtime.protectedWpPostIds,
            productKey: candidate.productKey,
            inventoryPromote: Boolean(
              (candidate as { updateExistingDraft?: boolean }).updateExistingDraft,
            ),
          },
        },
      );

      if (result.ok && result.published) {
        reserved.push({
          slot: key,
          contentVersionId: candidate.contentVersionId,
          productKey: candidate.productKey,
          externalId: result.externalId,
          url: result.url,
        });
        reservedKeys.add(key);
        placed = true;
      } else if (result.ok && result.skipped) {
        if (result.reason === "IMAGE_PUBLIC_ELIGIBILITY") {
          publicBlocked.push({
            contentVersionId: candidate.contentVersionId,
            productKey: candidate.productKey,
            reasons: result.gateFailures ?? [result.reason],
          });
        } else {
          otherSkipped.push({
            contentVersionId: candidate.contentVersionId,
            reason: result.reason,
          });
        }
      } else {
        otherSkipped.push({
          contentVersionId: candidate.contentVersionId,
          reason: !result.ok ? result.reason : "UNKNOWN",
        });
      }
    }
  }

  return {
    skipped: false,
    skipReason: null,
    slotsConsidered: slots.map((s) => ({
      date: `${s.year}-${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}`,
      hour: s.hour,
    })),
    openSlotsBeforeReserve,
    wpFutureFetched: reservedLoad.wpFutureFetched,
    wpFutureError: reservedLoad.wpFutureError,
    futureInventoryCount,
    futureTargetPosts: runtime.futureTargetPosts,
    futureMinPosts: runtime.futureMinPosts,
    futureReserveBudget: maxPerTick,
    unusedApprovedConsidered: stock.length,
    publicEligibleQueued: queue.length,
    reserved,
    publicBlocked,
    otherSkipped,
  };
}
