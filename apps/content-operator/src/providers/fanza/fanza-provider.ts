import type { AppConfig } from "@ai-affiliate/config";
import { requireDmmCredentials } from "@ai-affiliate/config";
import type { CollectionResult, Logger } from "@ai-affiliate/shared";
import { FANZA_CREDIT_CONFIG } from "@ai-affiliate/shared";
import type { ResearchProvider } from "../types.js";
import { DmmApiClient } from "./dmm-api-client.js";
import { ConfigurationError, ApiResponseError } from "./dmm-api-error.js";
import { mapDmmItemsToCollected } from "./fanza-mapper.js";
import {
  computeNextOffset,
  resolveFanzaQuery,
  toItemListParams,
  type FanzaQueryInput,
} from "./fanza-query.js";

export type FanzaCollectOptions = FanzaQueryInput;

export interface FanzaCollectStats {
  fetchedCount: number;
  mappedCount: number;
  skippedCount: number;
  errorCount: number;
  nextOffset: number | null;
  offset: number;
  hits: number;
}

export interface FanzaProviderDeps {
  config: AppConfig;
  logger: Logger;
  client?: DmmApiClient;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export class FanzaResearchProvider implements ResearchProvider {
  readonly providerName = "fanza";
  readonly credit = FANZA_CREDIT_CONFIG;

  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly injectedClient: DmmApiClient | undefined;
  private clientInstance: DmmApiClient | undefined;
  private lastStats: FanzaCollectStats = {
    fetchedCount: 0,
    mappedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    nextOffset: null,
    offset: 1,
    hits: 0,
  };

  constructor(deps: FanzaProviderDeps) {
    this.config = deps.config;
    this.logger = deps.logger;
    this.injectedClient = deps.client;
  }

  getLastStats(): FanzaCollectStats {
    return this.lastStats;
  }

  getClient(): DmmApiClient {
    return this.getOrCreateClient();
  }

  async healthCheck(): Promise<boolean> {
    try {
      requireDmmCredentials(this.config);
    } catch (error) {
      throw new ConfigurationError(
        error instanceof Error ? error.message : "DMM configuration incomplete",
        { cause: error },
      );
    }

    const response = await this.getOrCreateClient().getItemList({
      site: "FANZA",
      service: this.config.fanzaDefaultService,
      floor: this.config.fanzaDefaultFloor,
      hits: 1,
      offset: 1,
      sort: "date",
    });

    if (!response.result || !Array.isArray(response.result.items)) {
      throw new ApiResponseError("FANZA healthCheck received invalid ItemList response", {
        endpoint: "ItemList",
      });
    }

    this.logger.info(
      `Provider ${this.providerName} health ok (items=${response.result.items.length}, endpoint=ItemList)`,
    );
    return true;
  }

  /**
   * Collect a single page of FANZA items (max 100).
   * Use `nextOffset` from the result/stats for subsequent pages.
   */
  async collect(options: FanzaCollectOptions = {}): Promise<CollectionResult> {
    const client = this.getOrCreateClient();
    const query = resolveFanzaQuery(options, {
      service: this.config.fanzaDefaultService,
      floor: this.config.fanzaDefaultFloor,
      hits: this.config.fanzaDefaultHits,
    });

    if ((options.hits ?? 0) > 100) {
      this.logger.warn(`FANZA hits=${options.hits} exceeds 100; clamped to 100 for this page`);
    }

    this.logger.info(
      `FANZA collect endpoint=ItemList service=${query.service} floor=${query.floor} offset=${query.offset} hits=${query.hits} sort=${query.sort}`,
    );

    const startedAt = Date.now();
    const response = await client.getItemList(toItemListParams(query));
    const rawItems = response.result?.items ?? [];
    const firstPosition = asNumber(response.result?.first_position) ?? query.offset;
    const totalCount = asNumber(response.result?.total_count);
    const collectedAt = new Date();

    const mapped = mapDmmItemsToCollected(rawItems, {
      collectedAt,
      recordedAt: collectedAt,
      sort: query.sort,
      firstPosition,
      logger: this.logger,
    });

    const nextOffset = computeNextOffset({
      offset: query.offset,
      fetchedCount: rawItems.length,
      hits: query.hits,
      totalCount,
    });

    this.lastStats = {
      fetchedCount: rawItems.length,
      mappedCount: mapped.items.length,
      skippedCount: mapped.skippedCount,
      errorCount: mapped.errorCount,
      nextOffset,
      offset: query.offset,
      hits: query.hits,
    };

    this.logger.info(
      `FANZA collect finished fetched=${rawItems.length} mapped=${mapped.items.length} skipped=${mapped.skippedCount} errors=${mapped.errorCount} nextOffset=${nextOffset ?? "null"} elapsedMs=${Date.now() - startedAt}`,
    );

    return {
      providerName: this.providerName,
      collectedAt,
      items: mapped.items,
      nextOffset,
      stats: {
        fetchedCount: rawItems.length,
        mappedCount: mapped.items.length,
        skippedCount: mapped.skippedCount,
        errorCount: mapped.errorCount,
      },
    };
  }

  private getOrCreateClient(): DmmApiClient {
    if (this.clientInstance) {
      return this.clientInstance;
    }
    if (this.injectedClient) {
      this.clientInstance = this.injectedClient;
      return this.clientInstance;
    }

    const credentials = requireDmmCredentials(this.config);
    this.clientInstance = new DmmApiClient({
      apiId: credentials.apiId,
      affiliateId: credentials.affiliateId,
      baseUrl: this.config.dmmApiBaseUrl,
      requestIntervalMs: this.config.fanzaRequestIntervalMs,
      timeoutMs: this.config.fanzaRequestTimeoutMs,
      maxRetries: this.config.fanzaMaxRetries,
      logger: this.logger,
    });
    return this.clientInstance;
  }
}
