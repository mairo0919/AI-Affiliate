import type { Logger } from "@ai-affiliate/shared";
import type { DatabaseClient } from "@ai-affiliate/database";
import { MockResearchProvider } from "./providers/index.js";
import { ResearchService } from "./research-service.js";

export interface ResearchAgentDeps {
  logger: Logger;
  database: DatabaseClient;
}

/**
 * Default entry runs the mock research flow (scaffold for Phase 1).
 */
export async function runResearchAgent(deps: ResearchAgentDeps): Promise<void> {
  const { logger, database } = deps;

  logger.info("Research Agent started");
  await database.connect();

  try {
    const service = new ResearchService({ logger, database });
    await service.collectAndSave(new MockResearchProvider());
  } finally {
    await database.disconnect();
  }
}
