import { loadConfig } from "@ai-affiliate/config";
import { createDatabaseClient } from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { runResearchAgent } from "./agent.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient(config.databaseUrl);

  logger.info(`Starting Research Agent (env=${config.nodeEnv})`);
  await runResearchAgent({ logger, database });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] Research Agent failed: ${message}`);
  process.exitCode = 1;
});
