import { loadConfig } from "@ai-affiliate/config";
import {
  LifecycleRepository,
  ResearchRepository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { refreshOfficialTaxonomyForResearchItems } from "./refresh-official-taxonomy.js";

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
 *   fanza-refresh-official-taxonomy
 *   fanza-refresh-official-taxonomy --limit=20 --intervalMs=1500
 *   fanza-refresh-official-taxonomy --ids=miaa00400,ofje00230
 */
export async function runFanzaRefreshOfficialTaxonomyCli(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const config = loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const lifecycle = new LifecycleRepository(database.prisma);
    const research = new ResearchRepository(database.prisma);
    const ids = (flags.ids ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const result = await refreshOfficialTaxonomyForResearchItems({
      database,
      lifecycle,
      research,
      config,
      limit: flags.limit ? Number(flags.limit) : undefined,
      intervalMs: flags.intervalMs ? Number(flags.intervalMs) : 1200,
      externalIds: ids.length > 0 ? ids : undefined,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          totals: result.totals,
          sample: result.rows
            .filter((r) => r.ok && (r.genreCount > 0 || r.relatedTagCount > 0))
            .slice(0, 8)
            .map((r) => ({
              id: r.externalId,
              genres: r.genres,
              relatedTags: r.relatedTags,
            })),
          failed: result.rows
            .filter((r) => !r.ok)
            .slice(0, 20)
            .map((r) => ({ id: r.externalId, reason: r.reason, skipped: r.skipped })),
        },
        null,
        2,
      ),
    );
    if (result.totals.failed > 0 && result.totals.succeeded === 0) process.exitCode = 1;
  } finally {
    await database.disconnect();
  }
}
