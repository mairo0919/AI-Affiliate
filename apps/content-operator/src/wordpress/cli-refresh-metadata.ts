import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import {
  DEFAULT_FUTURE_METADATA_REFRESH_IDS,
  refreshWordPressPublicationMetadata,
} from "./refresh-wp-metadata.js";

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq <= 0) {
      flags[body] = "true";
      continue;
    }
    flags[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return flags;
}

function parseOrphanCidMap(raw: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!raw?.trim()) return map;
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const colon = t.indexOf(":");
    if (colon <= 0) continue;
    const wpId = t.slice(0, colon).trim();
    const cid = t.slice(colon + 1).trim();
    if (wpId && cid) map[wpId] = cid;
  }
  return map;
}

/**
 * Usage:
 *   wp-refresh-metadata --futures
 *   wp-refresh-metadata --ids=43,47,48
 *   wp-refresh-metadata --ids=46 --only-if-weak
 *   wp-refresh-metadata --ids=153 --orphan-cid=153:1RCTD00763
 *   wp-refresh-metadata --orphan-cid-map=153:1RCTD00763,154:1RCTD00759
 */
export async function runWpRefreshMetadataCli(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const config = loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const lifecycle = new LifecycleRepository(database.prisma);
    const orphanCidByExternalId = {
      ...parseOrphanCidMap(flags["orphan-cid-map"]),
      ...parseOrphanCidMap(flags["orphan-cid"]),
    };
    const orphanIds = Object.keys(orphanCidByExternalId);
    const ids = flags.futures
      ? [...DEFAULT_FUTURE_METADATA_REFRESH_IDS]
      : [
          ...(flags.ids ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          ...orphanIds.filter((id) => !(flags.ids ?? "").split(",").map((s) => s.trim()).includes(id)),
        ];
    if (ids.length === 0) {
      console.error("Provide --futures or --ids=43,47,... or --orphan-cid-map=153:cid,...");
      process.exitCode = 1;
      return;
    }
    const result = await refreshWordPressPublicationMetadata({
      database,
      lifecycle,
      config,
      externalIds: ids,
      useLlm: flags["no-llm"] !== "true",
      onlyIfWeak: flags["only-if-weak"] === "true",
      orphanCidByExternalId,
    });
    const summary = {
      ok: true,
      total: result.rows.length,
      updated: result.rows.filter((r) => r.ok && !r.skipped).length,
      skipped: result.rows.filter((r) => r.skipped).length,
      failed: result.rows.filter((r) => !r.ok).length,
      dateUnchanged: result.rows.filter((r) => r.dateUnchanged).length,
      bodyUnchanged: result.rows.filter((r) => r.bodyUnchanged).length,
      rows: result.rows.map((r) => ({
        id: r.externalId,
        ok: r.ok,
        skipped: r.skipped,
        reason: r.reason,
        dateUnchanged: r.dateUnchanged,
        bodyUnchanged: r.bodyUnchanged,
        before: r.before
          ? {
              title: r.before.title,
              seoTitle: r.before.seoTitle,
              seoDesc: r.before.seoDesc,
              categories: r.before.categories,
              tags: r.before.tags,
            }
          : null,
        after: r.after
          ? {
              title: r.after.title,
              seoTitle: r.after.seoTitle,
              seoDesc: r.after.seoDesc,
              categories: r.after.categories,
              tags: r.after.tags,
            }
          : null,
        axis: r.metadata?.titleAxis,
        quality: r.metadata?.quality,
      })),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    await database.disconnect();
  }
}
