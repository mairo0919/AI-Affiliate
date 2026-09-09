/**
 * CLI: continuous stock pipeline (Research local / Generate stock / WP future slots).
 */

import { loadConfig } from "@ai-affiliate/config";
import {
  LifecycleRepository,
  ResearchRepository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import {
  runLocalFanzaPageResearchCollect,
  runStockGenerationBatch,
  runPublishSlotScheduler,
  listApprovedStock,
  countUnusedApprovedStock,
  loadStockRuntimeConfig,
  confirmFanzaAffiliateImageTerms,
} from "./index.js";

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

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export async function runLocalFanzaResearchCollectCli(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const config = loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const lifecycle = new LifecycleRepository(database.prisma);
    const research = new ResearchRepository(database.prisma);
    const seeds = (flags.seeds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const result = await runLocalFanzaPageResearchCollect({
      lifecycle,
      research,
      config,
      seedContentIds: seeds,
      maxItems: flags.max ? Number(flags.max) : undefined,
      intervalMs: flags.intervalMs ? Number(flags.intervalMs) : undefined,
      seedsOnly: flags["seeds-only"] === "true",
    });
    printJson({ ok: true, ...result });
  } finally {
    await database.disconnect();
  }
}

export async function runStockGenerateCli(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const config = loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const lifecycle = new LifecycleRepository(database.prisma);
    process.env.STOCK_CONTINUOUS = process.env.STOCK_CONTINUOUS ?? "true";
    const result = await runStockGenerationBatch({
      database,
      lifecycle,
      config,
      forceBatch: flags.batch ? Number(flags.batch) : undefined,
    });
    printJson({ ok: true, ...result });
  } finally {
    await database.disconnect();
  }
}

export async function runWpFutureScheduleCli(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const config = loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const lifecycle = new LifecycleRepository(database.prisma);
    const result = await runPublishSlotScheduler({
      database,
      lifecycle,
      config,
      days: flags.days ? Number(flags.days) : 3,
    });
    printJson({ ok: true, ...result });
  } finally {
    await database.disconnect();
  }
}

export async function runStockStatusCli(): Promise<void> {
  loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const runtime = loadStockRuntimeConfig();
    const unused = await countUnusedApprovedStock(database.prisma);
    const all = await listApprovedStock(database.prisma, { limit: 100 });
    const publicOk = all.filter((r) => r.publicEligible && !r.hasWordPressTarget);
    const publicBlocked = all.filter((r) => !r.publicEligible && !r.hasWordPressTarget);
    printJson({
      ok: true,
      runtime,
      researchItemCount: await database.prisma.researchItem.count(),
      unusedApprovedStock: unused,
      approvedTotal: all.length,
      publicEligibleUnused: publicOk.length,
      publicBlockedUnused: publicBlocked.length,
      publicBlockSamples: publicBlocked.slice(0, 10).map((r) => ({
        id: r.contentVersionId,
        productKey: r.productKey,
        reasons: r.publicBlockReasons,
      })),
    });
  } finally {
    await database.disconnect();
  }
}

/**
 * Operator asserts FANZA affiliate image terms checklist completed.
 * Usage: confirm-fanza-image-terms --i-confirm-checklist=1 --actor=ops
 */
export async function runConfirmFanzaImageTermsCli(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const result = await confirmFanzaAffiliateImageTerms({
      prisma: database.prisma,
      iConfirmChecklist:
        flags["i-confirm-checklist"] === "1" || flags["i-confirm-checklist"] === "true",
      actor: flags.actor ?? "ops-cli",
    });
    printJson(result);
    if (!result.ok) process.exitCode = 1;
  } finally {
    await database.disconnect();
  }
}

/** Full local ops tick: research collect → stock generate → future schedule. */
export async function runStockPipelineCli(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  await runLocalFanzaResearchCollectCli(argv);
  await runStockGenerateCli(["--batch", flags.batch ?? "3"]);
  await runWpFutureScheduleCli(["--days", flags.days ?? "3"]);
  await runStockStatusCli();
}
