import type { CollectedResearchItem, CollectionResult } from "@ai-affiliate/shared";
import type { PageCollectionProvider } from "../../jobs/collection-job-runner.js";

export interface MockPageDefinition {
  offset: number;
  items: CollectedResearchItem[];
  nextOffset: number | null;
  /** Simulate mapping errors counted in stats.errorCount */
  errorCount?: number;
  /** Throw on this page */
  throwError?: Error;
}

/**
 * Deterministic paginated provider for job tests (no external API).
 */
export class MockPaginatedProvider implements PageCollectionProvider {
  readonly providerName = "mock";

  constructor(private readonly pages: MockPageDefinition[]) {}

  async collectPage(options: {
    offset: number;
    hits: number;
  }): Promise<CollectionResult> {
    const page = this.pages.find((entry) => entry.offset === options.offset);
    if (!page) {
      return {
        providerName: this.providerName,
        collectedAt: new Date(),
        items: [],
        nextOffset: null,
        stats: {
          fetchedCount: 0,
          mappedCount: 0,
          skippedCount: 0,
          errorCount: 0,
        },
      };
    }

    if (page.throwError) {
      throw page.throwError;
    }

    const items = page.items.slice(0, options.hits);
    return {
      providerName: this.providerName,
      collectedAt: new Date(),
      items,
      nextOffset: page.nextOffset,
      stats: {
        fetchedCount: items.length,
        mappedCount: items.length,
        skippedCount: 0,
        errorCount: page.errorCount ?? 0,
      },
    };
  }
}

export function buildMockItem(
  externalId: string,
  overrides: Partial<CollectedResearchItem> = {},
): CollectedResearchItem {
  const collectedAt = new Date("2026-07-28T00:00:00.000Z");
  return {
    sourceName: "FANZA",
    sourceType: "FANZA",
    sourceBaseUrl: "https://www.dmm.co.jp",
    externalId,
    itemType: "PRODUCT",
    title: `Mock ${externalId}`,
    description: null,
    url: `https://example.com/${externalId}`,
    publishedAt: collectedAt,
    collectedAt,
    rawData: { id: externalId },
    metrics: [{ metricType: "price", value: 100, recordedAt: collectedAt }],
    tags: [{ name: "mock", type: "genre" }],
    images: [],
    ...overrides,
  };
}
