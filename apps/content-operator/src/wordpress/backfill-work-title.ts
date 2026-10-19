/**
 * Add the linked official work title to WordPress posts written before the article printed it.
 * Only inserts one block; the rest of the stored body, the title, dates, and taxonomies stay as they are.
 */

import { loadConfig, type AppConfig } from "@ai-affiliate/config";
import { createDatabaseClient, type DatabaseClient } from "@ai-affiliate/database";
import {
  createWordPressPublisherFromConfig,
  type WordPressApiPublisher,
} from "../adapters/publisher/wordpress-api-publisher.js";
import { BLOG_CTA_CLASS, BLOG_WORK_TITLE_CLASS, renderWorkTitleBlock } from "../generation/blogger-formatter.js";
import { loadEvidencePack } from "./refresh-wp-metadata.js";

export type WorkTitleInsert =
  | { changed: true; html: string; url: string }
  | { changed: false; reason: "ALREADY_PRESENT" | "NO_CTA" };

const FIRST_CTA_RE = new RegExp(`<p class="${BLOG_CTA_CLASS}"><a href="([^"]+)"`);

/** Insert the work-title block before the first CTA, linking to the same page the CTA does. */
export function insertWorkTitleBlock(html: string, officialTitle: string): WorkTitleInsert {
  if (html.includes(`class="${BLOG_WORK_TITLE_CLASS}"`)) return { changed: false, reason: "ALREADY_PRESENT" };
  const match = FIRST_CTA_RE.exec(html);
  if (!match) return { changed: false, reason: "NO_CTA" };
  const url = match[1]!.replaceAll("&#39;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  const block = renderWorkTitleBlock(officialTitle, url);
  return { changed: true, html: `${html.slice(0, match.index)}${block}\n${html.slice(match.index)}`, url };
}

export type WorkTitleBackfillRow = {
  externalId: string;
  cid: string | null;
  status: string;
  officialTitle: string | null;
  result: "UPDATED" | "WOULD_UPDATE" | "SKIPPED" | "FAILED";
  reason?: string;
};

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function backfillWorkTitleLinks(deps: {
  database: DatabaseClient;
  config: AppConfig;
  apply: boolean;
  externalIds?: string[];
}): Promise<WorkTitleBackfillRow[]> {
  const prisma = deps.database.prisma;
  const publisher = createWordPressPublisherFromConfig(deps.config) as WordPressApiPublisher;
  const targets = await prisma.publicationTarget.findMany({
    where: {
      platform: "WORDPRESS",
      status: { in: ["PUBLISHED", "SCHEDULED"] },
      publishedExternalId: deps.externalIds?.length ? { in: deps.externalIds } : { not: null },
    },
    select: { publishedExternalId: true, status: true, platformMetadata: true, contentVersion: { select: { structuredContent: true } } },
    orderBy: { createdAt: "asc" },
  });
  const rows: WorkTitleBackfillRow[] = [];
  for (const target of targets) {
    const externalId = String(target.publishedExternalId);
    const meta = rec(target.platformMetadata);
    const sc = rec(target.contentVersion.structuredContent);
    const cidRaw = meta.productCanonicalId ?? meta.canonicalId ?? sc.productCanonicalId ?? sc.canonicalId;
    const cid = typeof cidRaw === "string" && cidRaw.trim() ? cidRaw.trim() : null;
    const row: WorkTitleBackfillRow = { externalId, cid, status: target.status, officialTitle: null, result: "SKIPPED" };
    rows.push(row);
    const pack = await loadEvidencePack(prisma, cid);
    row.officialTitle = pack.officialTitle;
    if (!pack.officialTitle) {
      row.reason = "NO_OFFICIAL_TITLE";
      continue;
    }
    try {
      const raw = await publisher.getRawContent(externalId);
      const insert = insertWorkTitleBlock(raw, pack.officialTitle);
      if (!insert.changed) {
        row.reason = insert.reason;
        continue;
      }
      if (!deps.apply) {
        row.result = "WOULD_UPDATE";
        continue;
      }
      await publisher.updateContentOnly({ externalId, content: insert.html });
      row.result = "UPDATED";
    } catch (error) {
      row.result = "FAILED";
      row.reason = error instanceof Error ? error.message.slice(0, 200) : String(error);
    }
  }
  return rows;
}

/**
 * Usage:
 *   wp-backfill-work-title             (dry run: lists what would change)
 *   wp-backfill-work-title --apply
 *   wp-backfill-work-title --ids=43,47 [--apply]
 */
export async function runWpBackfillWorkTitleCli(argv: string[]): Promise<void> {
  const apply = argv.includes("--apply");
  const idsArg = argv.find((a) => a.startsWith("--ids="));
  const externalIds = idsArg
    ? idsArg.slice("--ids=".length).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const config = loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const rows = await backfillWorkTitleLinks({ database, config, apply, externalIds });
    const count = (result: WorkTitleBackfillRow["result"]) => rows.filter((r) => r.result === result).length;
    console.log(
      JSON.stringify(
        {
          apply,
          total: rows.length,
          updated: count("UPDATED"),
          wouldUpdate: count("WOULD_UPDATE"),
          skipped: count("SKIPPED"),
          failed: count("FAILED"),
          rows,
        },
        null,
        2,
      ),
    );
    if (count("FAILED") > 0) process.exitCode = 1;
  } finally {
    await database.disconnect();
  }
}
