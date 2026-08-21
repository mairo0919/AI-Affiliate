import type { Logger } from "@ai-affiliate/shared";
import type { DatabaseClient, SaveCollectionSummary } from "@ai-affiliate/database";
import { ResearchRepository } from "@ai-affiliate/database";
import type { CollectionResult } from "@ai-affiliate/shared";
import type { ResearchProvider } from "./providers/types.js";

export interface ResearchServiceDeps {
  logger: Logger;
  database: DatabaseClient;
}

export class ResearchService {
  private readonly repository: ResearchRepository;

  constructor(private readonly deps: ResearchServiceDeps) {
    this.repository = new ResearchRepository(deps.database.prisma);
  }

  async collect(provider: ResearchProvider): Promise<CollectionResult> {
    const { logger } = this.deps;
    logger.info(`Collecting via provider: ${provider.providerName}`);
    const result = await provider.collect();
    logger.info(`Collected ${result.items.length} item(s) from ${provider.providerName}`);
    return result;
  }

  async save(result: CollectionResult): Promise<SaveCollectionSummary> {
    const { logger } = this.deps;
    const summary = await this.repository.saveCollection(result);
    logger.info(
      `Saved collection: created=${summary.createdCount}, updated=${summary.updatedCount}, metrics=${summary.metricCount}, tagLinks=${summary.tagLinkCount}`,
    );
    return summary;
  }

  async collectAndSave(provider: ResearchProvider): Promise<SaveCollectionSummary> {
    const result = await this.collect(provider);
    return this.save(result);
  }
}
