/**
 * Reconcile internal WordPress targets with the live post status.
 * Only status=publish becomes internal PUBLISHED.
 * Title, body, slug, and scheduledAt are never written.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";

export type WordPressReconciliationClass =
  | "WP_PUBLISHED_INTERNAL_SCHEDULED"
  | "WP_FUTURE_INTERNAL_SCHEDULED"
  | "WP_DRAFT_INTERNAL_SCHEDULED"
  | "WP_MISSING"
  | "OTHER";

export function classifyLiveWordPressStatus(input: {
  httpStatus: number | null;
  liveStatus: string | null;
}): WordPressReconciliationClass {
  if (input.httpStatus === 404) return "WP_MISSING";
  if (input.httpStatus == null || input.httpStatus >= 400) return "OTHER";
  const status = (input.liveStatus ?? "").trim().toLowerCase();
  if (status === "publish") return "WP_PUBLISHED_INTERNAL_SCHEDULED";
  if (status === "future") return "WP_FUTURE_INTERNAL_SCHEDULED";
  if (status === "draft" || status === "pending") return "WP_DRAFT_INTERNAL_SCHEDULED";
  return "OTHER";
}

export function shouldSyncInternalPublished(kind: WordPressReconciliationClass): boolean {
  return kind === "WP_PUBLISHED_INTERNAL_SCHEDULED";
}

export function readScheduledInstant(input: {
  scheduledAt: Date | null;
  platformMetadata: unknown;
}): Date | null {
  if (input.scheduledAt) return input.scheduledAt;
  const meta =
    input.platformMetadata && typeof input.platformMetadata === "object"
      ? (input.platformMetadata as Record<string, unknown>)
      : {};
  const raw =
    (typeof meta.scheduledAt === "string" && meta.scheduledAt) ||
    (typeof meta.publishSlotKey === "string" && meta.publishSlotKey) ||
    null;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

export async function promoteDueWordPressSchedules(input: {
  prisma: DatabaseClient["prisma"];
  config: AppConfig;
  logger: Logger;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<{
  checked: number;
  promoted: number;
  counts: Record<WordPressReconciliationClass, number>;
}> {
  const now = input.now ?? new Date();
  const counts: Record<WordPressReconciliationClass, number> = {
    WP_PUBLISHED_INTERNAL_SCHEDULED: 0,
    WP_FUTURE_INTERNAL_SCHEDULED: 0,
    WP_DRAFT_INTERNAL_SCHEDULED: 0,
    WP_MISSING: 0,
    OTHER: 0,
  };
  const base = input.config.wordpressBaseUrl?.replace(/\/$/, "");
  const user = input.config.wordpressUsername;
  const pass = input.config.wordpressApplicationPassword;
  if (!base || !user || !pass || !input.config.wordpressAllowExternalRequests) {
    return { checked: 0, promoted: 0, counts };
  }

  const rows = await input.prisma.publicationTarget.findMany({
    where: {
      platform: "WORDPRESS",
      status: "SCHEDULED",
      publishedExternalId: { not: null },
    },
    select: {
      id: true,
      scheduledAt: true,
      publishedAt: true,
      publishedExternalId: true,
      platformMetadata: true,
    },
    take: 80,
  });

  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const fetchImpl = input.fetchImpl ?? fetch;
  let promoted = 0;
  for (const row of rows) {
    const externalId = row.publishedExternalId;
    if (!externalId || !/^\d+$/.test(externalId)) {
      counts.OTHER += 1;
      continue;
    }
    let httpStatus: number | null = null;
    let liveStatus: string | null = null;
    try {
      const res = await fetchImpl(
        `${base}/wp-json/wp/v2/posts/${externalId}?_fields=id,status`,
        { headers: { Authorization: `Basic ${auth}` } },
      );
      httpStatus = res.status;
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        liveStatus = typeof body.status === "string" ? body.status : null;
      }
    } catch {
      counts.OTHER += 1;
      continue;
    }
    const kind = classifyLiveWordPressStatus({ httpStatus, liveStatus });
    counts[kind] += 1;
    if (!shouldSyncInternalPublished(kind)) continue;
    const scheduledAt = readScheduledInstant(row);
    const publishedAt =
      row.publishedAt ??
      (scheduledAt && scheduledAt.getTime() <= now.getTime() ? scheduledAt : now);
    const updated = await input.prisma.publicationTarget.updateMany({
      where: { id: row.id, status: "SCHEDULED" },
      data: { status: "PUBLISHED", publishedAt },
    });
    promoted += updated.count;
  }
  input.logger.info(
    `wordpress publish status sync checked=${rows.length} promoted=${promoted} publish=${counts.WP_PUBLISHED_INTERNAL_SCHEDULED} future=${counts.WP_FUTURE_INTERNAL_SCHEDULED} draft=${counts.WP_DRAFT_INTERNAL_SCHEDULED} missing=${counts.WP_MISSING} other=${counts.OTHER}`,
  );
  return { checked: rows.length, promoted, counts };
}
