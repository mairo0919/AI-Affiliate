/**
 * Long-running scheduler worker for Railway / always-on hosts.
 * Reuses SchedulerPipeline — does not invent a second scheduler.
 *
 * Interval from SCHEDULER_POLL_INTERVAL_MS (default 15m). Timezone via schedules DB + PUBLICATION_TIMEZONE.
 */
import { loadConfig } from "@ai-affiliate/config";
import { createDatabaseClient } from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { SchedulerPipeline } from "./schedules/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const config = loadConfig({ requireDatabaseUrl: true });
  const logger = createLogger(config.logLevel);
  const intervalMs = Math.max(
    60_000,
    Number.parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS ?? `${15 * 60_000}`, 10) || 15 * 60_000,
  );

  logger.info(
    `scheduler-worker starting intervalMs=${intervalMs} timezone=${config.publicationTimezone} nodeEnv=${config.nodeEnv}`,
  );

  const database = createDatabaseClient();
  await database.connect();
  const pipeline = new SchedulerPipeline({ logger, database, config });

  let stopping = false;
  const stop = () => {
    stopping = true;
    logger.info("scheduler-worker stop signal received");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!stopping) {
    const started = Date.now();
    try {
      const result = await pipeline.run();
      logger.info(
        `scheduler-worker tick complete schedules=${result.schedules.length} retries=${result.retries.length} analysisSkipped=${
          "skipped" in result.analysis && result.analysis.skipped
        } contentSkipped=${"skipped" in result.content && result.content.skipped} stockResearchSkipped=${
          "skipped" in result.stockResearch && result.stockResearch.skipped
        } stockSkipped=${
          "skipped" in result.stockGeneration && result.stockGeneration.skipped
        } publishSlotsSkipped=${
          "skipped" in result.publishSlots && result.publishSlots.skipped
        } reserved=${
          "reserved" in result.publishSlots && Array.isArray(result.publishSlots.reserved)
            ? result.publishSlots.reserved.length
            : 0
        } xPublishSkipped=${"skipped" in result.xPublish && result.xPublish.skipped}`,
      );
    } catch (error) {
      logger.error(
        `scheduler-worker tick failed message=${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const elapsed = Date.now() - started;
    const wait = Math.max(5_000, intervalMs - elapsed);
    if (stopping) break;
    await sleep(wait);
  }

  await database.disconnect();
  logger.info("scheduler-worker exited");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
