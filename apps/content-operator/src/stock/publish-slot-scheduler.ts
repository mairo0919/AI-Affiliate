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
import { listUpcomingPublishSlots } from "../wordpress/wordpress-datetime.js";
import { listApprovedStock, type ApprovedStockRow } from "./approved-stock.js";
import { loadStockRuntimeConfig } from "./stock-config.js";

export type PublishSlotScheduleResult = {
  skipped: boolean;
  skipReason: string | null;
  slotsConsidered: Array<{ date: string; hour: number }>;
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

async function alreadyReservedForSlot(
  prisma: DatabaseClient["prisma"],
  slot: string,
): Promise<boolean> {
  const rows = await prisma.publicationTarget.findMany({
    where: {
      platform: "WORDPRESS",
      status: { in: ["SCHEDULED", "PUBLISHED", "DRAFT"] },
    },
    select: { platformMetadata: true },
    take: 500,
  });
  for (const r of rows) {
    const meta = (r.platformMetadata ?? {}) as Record<string, unknown>;
    if (meta.publishSlotKey === slot || meta.scheduledAt === slot) return true;
  }
  return false;
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

  if (!runtime.stockPublishSchedulerEnabled) {
    return {
      skipped: true,
      skipReason: "STOCK_PUBLISH_SCHEDULER_ENABLED_FALSE",
      slotsConsidered: [],
      reserved: [],
      publicBlocked: [],
      otherSkipped: [],
    };
  }

  if (!deps.config.wordpressAllowFutureSchedule && !deps.config.wordpressAllowDirectPublish) {
    return {
      skipped: true,
      skipReason: "FUTURE_SCHEDULE_DISABLED",
      slotsConsidered: [],
      reserved: [],
      publicBlocked: [],
      otherSkipped: [],
    };
  }

  const slots = listUpcomingPublishSlots({
    now,
    timeZone: deps.config.publicationTimezone || "Asia/Tokyo",
    hours: runtime.publishSlotHoursJst,
    days: deps.days ?? 3,
    includePastToday: false,
  });

  const stock = await listApprovedStock(deps.database.prisma, {
    unusedOnly: true,
    limit: 200,
  });
  const publicBlocked: PublishSlotScheduleResult["publicBlocked"] = [];
  const queue: ApprovedStockRow[] = [];
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

  const publisher = createWordPressPublisherFromConfig(deps.config);
  const reserved: PublishSlotScheduleResult["reserved"] = [];
  const otherSkipped: PublishSlotScheduleResult["otherSkipped"] = [];
  let queueIdx = 0;

  for (const slot of slots) {
    const key = slotKey(slot.year, slot.month, slot.day, slot.hour);
    if (await alreadyReservedForSlot(deps.database.prisma, key)) {
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
          route: "WP_FUTURE_SCHEDULER",
          idempotencyKey: `wordpress-future:${candidate.contentVersionId}:${key}`,
          platformMetadata: {
            publishSlotKey: key,
            scheduledAt: key,
            protectedWpPosts: runtime.protectedWpPostIds,
            productKey: candidate.productKey,
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
    reserved,
    publicBlocked,
    otherSkipped,
  };
}
