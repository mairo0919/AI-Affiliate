/**
 * r56 — one-shot LIVE smoke for daily Blog + X (Human-authorized).
 *
 *   DAILY_OPS_SMOKE=1 npx tsx src/ops/r56-daily-live-smoke.ts
 *   Optional: SMOKE_CANONICAL_ID=mizd00320
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "@ai-affiliate/config";
import {
  ContentRepository,
  createDatabaseClient,
  LifecycleRepository,
  XOptimizationRepository,
  XOpsRepository,
  XPublicationRepository,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { ContentEngine } from "../content/content-engine.js";
import { loadDailyMultiChannelConfig } from "../daily-ops/config.js";
import { runDailyMultiChannelLive } from "../daily-ops/live-orchestrator.js";
import { createLiveStack } from "../x/live/index.js";
import { createXPublishingProvider } from "../x/providers/index.js";
import { XPublicationService } from "../x/publication-service.js";

const OUT =
  process.env.OUT_DIR ||
  `/tmp/r56-daily-smoke-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (process.env.DAILY_OPS_SMOKE !== "1") {
    const msg = {
      ok: false,
      error: "Set DAILY_OPS_SMOKE=1 to authorize live smoke (Blog + X publish).",
    };
    writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(msg, null, 2));
    console.log(JSON.stringify(msg, null, 2));
    process.exitCode = 2;
    return;
  }

  const config = loadConfig();
  const daily = loadDailyMultiChannelConfig();
  const logger = createLogger("info");
  const database = createDatabaseClient();
  await database.connect();

  try {
    const lifecycle = new LifecycleRepository(database.prisma);
    const contentRepo = new ContentRepository(database.prisma);
    const contentEngine = new ContentEngine({
      logger,
      config,
      contents: contentRepo,
    });

    const providerName = config.xApiProvider.trim().toLowerCase();
    const liveStack =
      providerName === "x-api" || providerName === "api"
        ? createLiveStack({
            config,
            prisma: database.prisma,
            allowWrites:
              config.xReleaseMode === "LIMITED" || config.xReleaseMode === "FULL",
          })
        : null;
    const xProvider = createXPublishingProvider(config.xApiProvider, {
      enabled: config.xApiEnabled,
      accessToken: config.xApiAccessToken,
      accountId: config.xApiAccountId,
      baseUrl: config.xApiBaseUrl,
      timeoutMs: config.xApiTimeoutMs,
      liveProvider: liveStack?.provider,
    });
    const xPublicationService = new XPublicationService({
      logger,
      config,
      contents: contentRepo,
      publications: new XPublicationRepository(database.prisma),
      provider: xProvider,
      ops: new XOpsRepository(database.prisma),
      optimization: new XOptimizationRepository(database.prisma),
      allowSchedulerLivePublish: true,
      livePublishConfirmed: true,
      checkApiBudget: liveStack
        ? async (accountId) => liveStack.budget.checkPaidRequest(accountId)
        : undefined,
    });

    const result = await runDailyMultiChannelLive({
      logger,
      database,
      config,
      lifecycle,
      contentEngine,
      xPublicationService,
      dailyConfig: {
        ...daily,
        enabled: true,
        dryRun: false,
      },
      forceSmoke: true,
      smokeCanonicalId: process.env.SMOKE_CANONICAL_ID?.trim() || undefined,
    });

    const report = {
      round: "r56-smoke",
      flags: {
        bloggerAllowDirectPublish: config.bloggerAllowDirectPublish,
        bloggerMode: config.bloggerMode,
        xReleaseMode: config.xReleaseMode,
        xApiEnabled: config.xApiEnabled,
      },
      result,
      DAILY_SMOKE_BLOG: result.blog.published ? "YES" : "NO",
      DAILY_SMOKE_X: result.x.published ? "YES" : "NO",
    };
    writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = result.blog.published || result.x.published ? 0 : 2;
  } finally {
    await database.disconnect();
  }
}

main().catch((e) => {
  mkdirSync(OUT, { recursive: true });
  const err = { ok: false, error: e instanceof Error ? e.message : String(e) };
  writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(err, null, 2));
  console.error(e);
  process.exit(1);
});
