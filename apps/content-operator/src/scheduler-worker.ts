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
      const stockGen =
        "skipped" in result.stockGeneration && result.stockGeneration.skipped
          ? { skipped: true as const, reason: result.stockGeneration.skipReason }
          : {
              skipped: false as const,
              generated:
                "generated" in result.stockGeneration ? result.stockGeneration.generated : 0,
              unusedAfter:
                "unusedApprovedAfter" in result.stockGeneration
                  ? result.stockGeneration.unusedApprovedAfter
                  : null,
              skipReason:
                "skipReason" in result.stockGeneration ? result.stockGeneration.skipReason : null,
            };
      const publish =
        "skipped" in result.publishSlots && result.publishSlots.skipped
          ? { skipped: true as const, reason: result.publishSlots.skipReason }
          : {
              skipped: false as const,
              reserved:
                "reserved" in result.publishSlots && Array.isArray(result.publishSlots.reserved)
                  ? result.publishSlots.reserved.length
                  : 0,
              openSlots:
                "openSlotsBeforeReserve" in result.publishSlots
                  ? result.publishSlots.openSlotsBeforeReserve
                  : null,
              eligible:
                "publicEligibleQueued" in result.publishSlots
                  ? result.publishSlots.publicEligibleQueued
                  : null,
              wpFutures:
                "wpFutureFetched" in result.publishSlots
                  ? result.publishSlots.wpFutureFetched
                  : null,
              futureReserveBudget:
                "futureReserveBudget" in result.publishSlots
                  ? result.publishSlots.futureReserveBudget
                  : null,
            };
      // When publish phase threw and was wrapped as skipped by pipeline, surface reason.
      const publishSkipReason =
        publish.skipped && "reason" in publish ? publish.reason : null;
      const stockResearchReason =
        "skipped" in result.stockResearch && result.stockResearch.skipped
          ? result.stockResearch.skipReason
          : null;
      const scheduleStatuses = result.schedules
        .map((s) => `${s.scheduleName}:${s.status}`)
        .join(",") || "none";
      const providerProbe = (result.providerProbe ?? [])
        .map((p) => `${p.key}=${p.status}`)
        .join(",") || "none";
      logger.info(
        `scheduler-worker tick complete schedules=${result.schedules.length} scheduleStatuses=${scheduleStatuses} retries=${result.retries.length} analysisSkipped=${
          "skipped" in result.analysis && result.analysis.skipped
        } contentSkipped=${"skipped" in result.content && result.content.skipped} stockResearchSkipped=${
          "skipped" in result.stockResearch && result.stockResearch.skipped
        } stockResearchReason=${stockResearchReason ?? "-"} stockSkipped=${stockGen.skipped} stockGenerated=${
          stockGen.skipped ? 0 : stockGen.generated
        } unusedApproved=${stockGen.skipped ? "-" : stockGen.unusedAfter} publishSlotsSkipped=${
          publish.skipped
        } reserved=${publish.skipped ? 0 : publish.reserved} openSlots=${
          publish.skipped ? "-" : publish.openSlots
        } publicEligible=${publish.skipped ? "-" : publish.eligible} wpFutures=${
          publish.skipped ? "-" : publish.wpFutures
        } futureBudget=${
          !publish.skipped && "futureReserveBudget" in result.publishSlots
            ? result.publishSlots.futureReserveBudget
            : "-"
        } publishSkipReason=${publishSkipReason ?? "-"} providers=${providerProbe} xPublishSkipped=${
          "skipped" in result.xPublish && result.xPublish.skipped
        }`,
      );
      if (
        "skipped" in result.stockResearch &&
        result.stockResearch.skipped &&
        result.stockResearch.skipReason === "STOCK_LOCAL_PAGE_RESEARCH_IN_SCHEDULER_FALSE"
      ) {
        // Expected on Railway: ItemList uses ResearchSchedule (schedules=N), not local HTML collect.
      }
      if (providerProbe.includes("CREDENTIAL_MISSING")) {
        logger.warn(
          "research provider credentials missing — ItemList Research cannot replenish; set DMM_API_ID and DMM_AFFILIATE_ID",
        );
      }
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
