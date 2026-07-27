import type { Logger } from "@ai-affiliate/shared";
import type { DatabaseClient } from "@ai-affiliate/database";

export interface ResearchAgentDeps {
  logger: Logger;
  database: DatabaseClient;
}

/**
 * Research Agent scaffold.
 * Future: TikTok / X / FANZA research, data fetch, and persistence.
 */
export async function runResearchAgent(deps: ResearchAgentDeps): Promise<void> {
  const { logger, database } = deps;

  logger.info("Research Agent started (scaffold only)");
  await database.connect();
  logger.info("Research Agent idle — research pipelines are not implemented yet");
  await database.disconnect();
}
