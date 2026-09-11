/**
 * CLI: re-evaluate WordPress categories from official genre Evidence.
 *
 *   wp-refresh-categories --dry-run
 *   wp-refresh-categories --apply
 *   wp-refresh-categories --ids=74,70 --apply
 */

import { loadConfig } from "@ai-affiliate/config";
import { createDatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import { refreshWordPressCategories } from "./refresh-wp-categories.js";

export async function runWpRefreshCategoriesCli(argv: string[]): Promise<void> {
  const apply = argv.includes("--apply");
  const dry = argv.includes("--dry-run") || !apply;
  const idsArg = argv.find((a) => a.startsWith("--ids="));
  const postIds = idsArg
    ? idsArg
        .slice("--ids=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const config = loadConfig();
  const database = createDatabaseClient();
  const lifecycle = new LifecycleRepository(database.prisma);
  try {
    const result = await refreshWordPressCategories({
      database,
      lifecycle,
      config,
      postIds,
      apply: apply && !dry,
    });
    const changedRows = result.rows.filter((r) => r.changed);
    console.log(
      JSON.stringify(
        {
          ok: true,
          apply: apply && !dry,
          scanned: result.scanned,
          changed: result.changed,
          stillFallback: result.stillFallback,
          readingsSynced: result.readingsSynced,
          categoryReadingsSeeded: result.categoryReadingsSeeded,
          sample: changedRows.slice(0, 12).map((r) => ({
            postId: r.postId,
            productId: r.productId,
            before: r.before,
            after: r.after,
            seriesBefore: r.seriesBefore,
            seriesAfter: r.seriesAfter,
            fallbackUsed: r.fallbackUsed,
            dateUnchanged: r.dateUnchanged,
            bodyUnchanged: r.bodyUnchanged,
          })),
          failures: result.rows.filter((r) => !r.ok).slice(0, 10),
        },
        null,
        2,
      ),
    );
  } finally {
    await database.prisma.$disconnect();
  }
}
