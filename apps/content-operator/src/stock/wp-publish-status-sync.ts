/**
 * Observe WordPress after a future slot has passed.
 * Only targets explicitly marked syncPublishStatus are updated.
 * Existing reservations without that flag stay untouched.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";

export function shouldPromoteScheduledWordPressTarget(input: {
  syncPublishStatus: boolean;
  scheduledAt: Date | null;
  now: Date;
  liveStatus: string | null;
}): boolean {
  if (!input.syncPublishStatus) return false;
  if (!input.scheduledAt || input.scheduledAt.getTime() > input.now.getTime()) return false;
  return (input.liveStatus ?? "").trim().toLowerCase() === "publish";
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
}): Promise<{ checked: number; promoted: number }> {
  const now = input.now ?? new Date();
  const base = input.config.wordpressBaseUrl?.replace(/\/$/, "");
  const user = input.config.wordpressUsername;
  const pass = input.config.wordpressApplicationPassword;
  if (!base || !user || !pass || !input.config.wordpressAllowExternalRequests) {
    return { checked: 0, promoted: 0 };
  }

  const rows = await input.prisma.publicationTarget.findMany({
    where: {
      platform: "WORDPRESS",
      status: "SCHEDULED",
      publishedExternalId: { not: null },
      platformMetadata: { path: ["syncPublishStatus"], equals: true },
    },
    select: {
      id: true,
      scheduledAt: true,
      publishedExternalId: true,
      platformMetadata: true,
    },
    take: 30,
  });

  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const fetchImpl = input.fetchImpl ?? fetch;
  let promoted = 0;
  for (const row of rows) {
    const scheduledAt = readScheduledInstant(row);
    if (!scheduledAt || scheduledAt.getTime() > now.getTime()) continue;
    const externalId = row.publishedExternalId;
    if (!externalId || !/^\d+$/.test(externalId)) continue;
    let liveStatus: string | null = null;
    try {
      const res = await fetchImpl(
        `${base}/wp-json/wp/v2/posts/${externalId}?_fields=id,status`,
        { headers: { Authorization: `Basic ${auth}` } },
      );
      if (!res.ok) continue;
      const body = (await res.json()) as { status?: string };
      liveStatus = typeof body.status === "string" ? body.status : null;
    } catch {
      continue;
    }
    if (
      !shouldPromoteScheduledWordPressTarget({
        syncPublishStatus: true,
        scheduledAt,
        now,
        liveStatus,
      })
    ) {
      continue;
    }
    await input.prisma.publicationTarget.update({
      where: { id: row.id },
      data: { status: "PUBLISHED", publishedAt: now },
    });
    promoted += 1;
  }
  if (promoted > 0) {
    input.logger.info(`wordpress publish status sync promoted=${promoted} checked=${rows.length}`);
  }
  return { checked: rows.length, promoted };
}
