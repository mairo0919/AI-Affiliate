import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import {
  DEFAULT_FUTURE_METADATA_REFRESH_IDS,
  refreshAdultAttributeTagsOnWordPress,
} from "./refresh-adult-tags.js";

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

/**
 * Usage:
 *   wp-refresh-adult-tags --futures
 *   wp-refresh-adult-tags --ids=43,47,48
 */
export async function runWpRefreshAdultTagsCli(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const config = loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const lifecycle = new LifecycleRepository(database.prisma);
    const ids = flags.futures
      ? [...DEFAULT_FUTURE_METADATA_REFRESH_IDS]
      : (flags.ids ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    if (ids.length === 0) {
      console.error("Provide --futures or --ids=43,47,...");
      process.exitCode = 1;
      return;
    }
    const result = await refreshAdultAttributeTagsOnWordPress({
      database,
      lifecycle,
      config,
      externalIds: ids,
    });
    const summary = {
      ok: true,
      total: result.rows.length,
      updated: result.totals.updated,
      skipped: result.totals.skipped,
      failed: result.totals.failed,
      tagsAdded: result.totals.tagsAdded,
      fromGenre: result.totals.fromGenre,
      fromRelatedTag: result.totals.fromRelatedTag,
      fromTitle: result.totals.fromTitle,
      fromDescription: result.totals.fromDescription,
      dateUnchanged: result.rows.filter((r) => r.dateUnchanged).length,
      bodyUnchanged: result.rows.filter((r) => r.bodyUnchanged).length,
      categoryUnchanged: result.rows.filter((r) => r.categoryUnchanged).length,
      performersUnchanged: result.rows.filter((r) => r.performersUnchanged).length,
      seriesUnchanged: result.rows.filter((r) => r.seriesUnchanged).length,
      rows: result.rows.map((r) => ({
        id: r.externalId,
        ok: r.ok,
        skipped: r.skipped,
        reason: r.reason,
        addedTags: r.addedTags,
        beforeTags: r.beforeTags,
        afterTags: r.afterTags,
        extraction: r.extraction,
        dateUnchanged: r.dateUnchanged,
        bodyUnchanged: r.bodyUnchanged,
        categoryUnchanged: r.categoryUnchanged,
        performersUnchanged: r.performersUnchanged,
        seriesUnchanged: r.seriesUnchanged,
      })),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    await database.disconnect();
  }
}
