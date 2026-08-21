import type { Logger } from "@ai-affiliate/shared";
import {
  ApiResponseError,
  AuthenticationError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  sanitizeForLog,
} from "./dmm-api-error.js";
import type {
  DmmFloorListResponse,
  DmmItemListParams,
  DmmItemListResponse,
  DmmSearchListResponse,
  DmmSearchParams,
} from "./dmm-api-types.js";

export interface DmmApiClientOptions {
  apiId: string;
  affiliateId: string;
  baseUrl: string;
  requestIntervalMs: number;
  timeoutMs?: number;
  maxRetries?: number;
  logger?: Logger;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export class DmmApiClient {
  private readonly apiId: string;
  private readonly affiliateId: string;
  private readonly baseUrl: string;
  private readonly requestIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly logger: Logger | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly nowImpl: () => number;
  private lastRequestAt = 0;

  constructor(options: DmmApiClientOptions) {
    this.apiId = options.apiId;
    this.affiliateId = options.affiliateId;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.requestIntervalMs = options.requestIntervalMs;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
    this.nowImpl = options.nowImpl ?? Date.now;
  }

  async getItemList(params: DmmItemListParams = {}): Promise<DmmItemListResponse> {
    const query = this.buildCommonQuery({
      site: params.site ?? "FANZA",
      service: params.service ?? "digital",
      floor: params.floor,
      hits: params.hits,
      offset: params.offset,
      sort: params.sort,
      keyword: params.keyword,
      cid: params.cid,
      gte_date: params.gteDate,
      lte_date: params.lteDate,
      article: params.article,
      article_id: params.articleId,
    });

    const response = await this.requestJson<DmmItemListResponse>("ItemList", query);
    this.assertItemListResponse(response);
    return response;
  }

  async getFloorList(): Promise<DmmFloorListResponse> {
    const response = await this.requestJson<DmmFloorListResponse>(
      "FloorList",
      this.buildCommonQuery({}),
    );
    if (!isRecord(response) || !isRecord(response.result) || !Array.isArray(response.result.site)) {
      throw new ApiResponseError("FloorList response format is invalid", { endpoint: "FloorList" });
    }
    return response;
  }

  async getActressSearch(params: DmmSearchParams = {}): Promise<DmmSearchListResponse> {
    return this.requestJson<DmmSearchListResponse>(
      "ActressSearch",
      this.buildCommonQuery({
        floor: params.floor,
        hits: params.hits,
        offset: params.offset,
        keyword: params.keyword,
        initial: params.initial,
        sort: params.sort,
      }),
    );
  }

  async getGenreSearch(params: DmmSearchParams = {}): Promise<DmmSearchListResponse> {
    return this.requestJson<DmmSearchListResponse>(
      "GenreSearch",
      this.buildCommonQuery({
        floor: params.floor ?? "videoa",
        hits: params.hits,
        offset: params.offset,
        initial: params.initial,
      }),
    );
  }

  async getMakerSearch(params: DmmSearchParams = {}): Promise<DmmSearchListResponse> {
    return this.requestJson<DmmSearchListResponse>(
      "MakerSearch",
      this.buildCommonQuery({
        floor: params.floor ?? "videoa",
        hits: params.hits,
        offset: params.offset,
        initial: params.initial,
      }),
    );
  }

  async getSeriesSearch(params: DmmSearchParams = {}): Promise<DmmSearchListResponse> {
    return this.requestJson<DmmSearchListResponse>(
      "SeriesSearch",
      this.buildCommonQuery({
        floor: params.floor ?? "videoa",
        hits: params.hits,
        offset: params.offset,
        initial: params.initial,
      }),
    );
  }

  private buildCommonQuery(params: Record<string, string | number | undefined>): URLSearchParams {
    const query = new URLSearchParams();
    query.set("api_id", this.apiId);
    query.set("affiliate_id", this.affiliateId);
    query.set("output", "json");

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === "") {
        continue;
      }
      query.set(key, String(value));
    }
    return query;
  }

  private async requestJson<T>(endpoint: string, query: URLSearchParams): Promise<T> {
    await this.enforceRateLimit();

    const url = `${this.baseUrl}/${endpoint}?${query.toString()}`;
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.maxRetries) {
      attempt += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const safeKeys = [...query.keys()].filter((key) => key !== "api_id" && key !== "affiliate_id");
        this.logger?.debug(
          `DMM request endpoint=${endpoint} attempt=${attempt} queryKeys=${safeKeys.join(",")}`,
        );

        const response = await this.fetchImpl(url, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          if (RETRYABLE_STATUS.has(response.status) && attempt <= this.maxRetries) {
            const delayMs = this.backoffMs(attempt);
            this.logger?.warn(
              `DMM retryable HTTP status=${response.status} endpoint=${endpoint} attempt=${attempt} delayMs=${delayMs}`,
            );
            await this.sleepImpl(delayMs);
            continue;
          }

          if (response.status === 401 || response.status === 403) {
            throw new AuthenticationError(`DMM authentication failed (HTTP ${response.status})`, {
              statusCode: response.status,
              endpoint,
            });
          }
          if (response.status === 429) {
            throw new RateLimitError("DMM API rate limit exceeded", { endpoint });
          }
          throw new ApiResponseError(`DMM HTTP error (status=${response.status})`, {
            statusCode: response.status,
            endpoint,
          });
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          throw new ApiResponseError("DMM response JSON parse failed", { endpoint, cause: error });
        }

        this.assertNoApiErrorPayload(payload, endpoint);
        return payload as T;
      } catch (error) {
        lastError = error;

        if (
          error instanceof RateLimitError ||
          (error instanceof ApiResponseError &&
            error.statusCode !== undefined &&
            RETRYABLE_STATUS.has(error.statusCode))
        ) {
          if (attempt <= this.maxRetries) {
            await this.sleepImpl(this.backoffMs(attempt));
            continue;
          }
          throw error;
        }

        if (
          error instanceof AuthenticationError ||
          error instanceof ApiResponseError ||
          error instanceof RateLimitError
        ) {
          throw error;
        }

        if (this.isTimeoutError(error)) {
          if (attempt <= this.maxRetries) {
            const delayMs = this.backoffMs(attempt);
            this.logger?.warn(`DMM timeout endpoint=${endpoint} attempt=${attempt} delayMs=${delayMs}`);
            await this.sleepImpl(delayMs);
            continue;
          }
          throw new TimeoutError("DMM API request timed out", { endpoint, cause: error });
        }

        if (this.isNetworkError(error) && attempt <= this.maxRetries) {
          const delayMs = this.backoffMs(attempt);
          this.logger?.warn(
            `DMM network error endpoint=${endpoint} attempt=${attempt} delayMs=${delayMs}`,
          );
          await this.sleepImpl(delayMs);
          continue;
        }

        if (error instanceof TimeoutError || error instanceof NetworkError) {
          throw error;
        }

        throw new NetworkError("DMM API network error", { endpoint, cause: error });
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new NetworkError(
      `DMM request failed after retries: ${sanitizeForLog(String(lastError))}`,
      { endpoint, cause: lastError },
    );
  }

  private async enforceRateLimit(): Promise<void> {
    const now = this.nowImpl();
    const elapsed = now - this.lastRequestAt;
    if (this.lastRequestAt > 0 && elapsed < this.requestIntervalMs) {
      await this.sleepImpl(this.requestIntervalMs - elapsed);
    }
    this.lastRequestAt = this.nowImpl();
  }

  private backoffMs(attempt: number): number {
    return Math.min(1000 * 2 ** (attempt - 1), 8000);
  }

  private isTimeoutError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return error.name === "AbortError" || /aborted|timeout/i.test(error.message);
  }

  private isNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return (
      error.name === "TypeError" ||
      /fetch failed|network|ECONNRESET|ENOTFOUND|ECONNREFUSED/i.test(error.message)
    );
  }

  private assertNoApiErrorPayload(payload: unknown, endpoint: string): void {
    if (!isRecord(payload)) {
      throw new ApiResponseError("DMM response is not an object", { endpoint });
    }

    if (typeof payload.result === "string") {
      const message = payload.result.toLowerCase();
      if (
        message.includes("api_id") ||
        message.includes("affiliate") ||
        message.includes("認証") ||
        message.includes("auth")
      ) {
        throw new AuthenticationError("DMM API authentication failed", { endpoint });
      }
      throw new ApiResponseError("DMM API returned an error result", { endpoint });
    }

    if (isRecord(payload.result)) {
      const status = asNumber(payload.result.status);
      if (status !== undefined && status !== 200) {
        if (status === 401 || status === 403) {
          throw new AuthenticationError(`DMM API auth failed (status=${status})`, {
            endpoint,
            statusCode: status,
          });
        }
        throw new ApiResponseError(`DMM API error status=${status}`, {
          endpoint,
          statusCode: status,
        });
      }
    }
  }

  private assertItemListResponse(payload: DmmItemListResponse): void {
    if (!payload.result) {
      throw new ApiResponseError("ItemList response is missing result", { endpoint: "ItemList" });
    }
    if (payload.result.items === undefined) {
      payload.result.items = [];
    }
    if (!Array.isArray(payload.result.items)) {
      throw new ApiResponseError("ItemList items must be an array", { endpoint: "ItemList" });
    }
  }
}
