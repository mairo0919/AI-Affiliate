import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import { auditAndUpgradeWordPressImageResolutions } from "./upgrade-wp-image-resolution.js";

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
 *   wp-upgrade-image-resolution --apply
 *   wp-upgrade-image-resolution --dry-run
 *   wp-upgrade-image-resolution --ids=74,43 --apply
 */
export async function runWpUpgradeImageResolutionCli(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const apply = flags.apply === "true" || flags["dry-run"] !== "true";
  // default apply=true when --apply; if neither, dry-run for safety unless --apply
  const doApply = flags.apply === "true";
  const config = loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const lifecycle = new LifecycleRepository(database.prisma);
    const ids = (flags.ids ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const result = await auditAndUpgradeWordPressImageResolutions({
      database,
      lifecycle,
      config,
      apply: doApply,
      postIds: ids.length > 0 ? ids : undefined,
    });
    const summary = {
      ok: true,
      apply: doApply,
      postsScanned: result.postsScanned,
      imageTotal: result.imageTotal,
      under500Count: result.under500Count,
      postsWithUnder500: result.postsWithUnder500,
      causeA: result.causeA,
      causeB: result.causeB,
      causeC: result.causeC,
      causeD: result.causeD,
      postsFixed: result.postsFixed,
      imagesReplaced: result.imagesReplaced,
      maxImprovement: result.maxImprovement,
      post74: result.post74,
      bodyTextUnchanged: result.rows.filter((r) => r.bodyTextUnchanged).length,
      dateUnchanged: result.rows.filter((r) => r.dateUnchanged).length,
      samplePosts: result.rows
        .filter((r) => r.replacedCount > 0 || r.removedDuplicateCount > 0 || r.postId === "74")
        .slice(0, 12)
        .map((r) => ({
          id: r.postId,
          status: r.status,
          productId: r.productId,
          under500: r.under500Count,
          replaced: r.replacedCount,
          removedDup: r.removedDuplicateCount,
          beforeMaxUnder500: r.beforeMaxUnder500,
          afterMaxUnder500: r.afterMaxUnder500,
          samples: r.sampleReplacements,
          skipped: r.skipped,
          reason: r.reason,
        })),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!doApply && flags["dry-run"] !== "true" && flags.apply !== "true") {
      console.error("Hint: pass --apply to write upgrades, or --dry-run explicitly.");
    }
    void apply;
  } finally {
    await database.disconnect();
  }
}
