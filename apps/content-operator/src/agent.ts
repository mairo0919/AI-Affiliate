import type { Logger } from "@ai-affiliate/shared";
import type { DatabaseClient } from "@ai-affiliate/database";
import { MockResearchProvider } from "./providers/index.js";
import { assertMockResearchAllowed } from "./research/mock-research-guard.js";
import { ResearchService } from "./research-service.js";

export interface ResearchAgentDeps {
  logger: Logger;
  database: DatabaseClient;
  nodeEnv?: string;
}

/**
 * Default entry runs the mock research flow (scaffold for Phase 1).
 * Production requires RESEARCH_ALLOW_MOCK_AGENT=true.
 */
export async function runResearchAgent(deps: ResearchAgentDeps): Promise<void> {
  const { logger, database } = deps;
  assertMockResearchAllowed(deps.nodeEnv ?? process.env.NODE_ENV ?? "development");

  logger.info("Research Agent started");
  await database.connect();

  try {
    const service = new ResearchService({ logger, database });
    await service.collectAndSave(new MockResearchProvider());
  } finally {
    await database.disconnect();
  }
}
