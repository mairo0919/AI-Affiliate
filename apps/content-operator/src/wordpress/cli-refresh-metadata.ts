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

/**
 * Usage:
 *   wp-refresh-metadata --futures
 *   wp-refresh-metadata --ids=43,47,48
 *   wp-refresh-metadata --ids=46 --only-if-weak
 */
export async function runWpRefreshMetadataCli(argv: string[]): Promise<void> {
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
    const result = await refreshWordPressPublicationMetadata({
      database,
      lifecycle,
      config,
      externalIds: ids,
      useLlm: flags["no-llm"] !== "true",
      onlyIfWeak: flags["only-if-weak"] === "true",
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
