import type { CollectedResearchItem, CollectionResult } from "@ai-affiliate/shared";
import type { PageCollectionProvider } from "../../jobs/collection-job-runner.js";
import { buildMockItem } from "./paginated.js";

/**
 * Dynamic mock pager for schedule CLI / integration tests.
 * Emits pages of synthetic items until the job runner stops (maxPages / maxItems).
 */
export class MockDynamicPaginatedProvider implements PageCollectionProvider {
  readonly providerName = "mock";

  constructor(
    private readonly options: {
      itemsPerPage?: number;
      titlePrefix?: string;
    } = {},
  ) {}

  async collectPage(options: {
    offset: number;
    hits: number;
    [key: string]: unknown;
  }): Promise<CollectionResult> {
    const hits = Math.max(1, Math.min(100, options.hits));
    const itemsPerPage = this.options.itemsPerPage ?? hits;
    const count = Math.min(hits, itemsPerPage);
    const prefix = this.options.titlePrefix ?? "sched-mock";
    const collectedAt = new Date();

    const items: CollectedResearchItem[] = [];
    for (let i = 0; i < count; i += 1) {
      const externalId = `${prefix}-${options.offset + i}`;
      items.push(
        buildMockItem(externalId, {
          title: `Mock ${externalId}`,
          collectedAt,
          publishedAt: collectedAt,
        }),
      );
    }

    return {
      providerName: this.providerName,
      collectedAt,
      items,
      nextOffset: options.offset + count,
      stats: {
        fetchedCount: items.length,
        mappedCount: items.length,
        skippedCount: 0,
        errorCount: 0,
      },
    };
  }
}
