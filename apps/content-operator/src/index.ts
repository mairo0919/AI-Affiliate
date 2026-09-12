import { loadConfig } from "@ai-affiliate/config";
import { createDatabaseClient } from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { runResearchAgent } from "./agent.js";
import { assertMockResearchAllowed, isDirectNodeEntry } from "./research/mock-research-guard.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  assertMockResearchAllowed(config.nodeEnv);
  const database = createDatabaseClient();

  logger.info(`Starting Research Agent (env=${config.nodeEnv})`);
  await runResearchAgent({ logger, database });
}

// Importing this module must never write to the DB. Only direct `node dist/index.js` runs main.
if (isDirectNodeEntry(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
