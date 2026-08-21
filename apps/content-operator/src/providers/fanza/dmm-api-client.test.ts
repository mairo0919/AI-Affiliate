import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DmmApiClient } from "./dmm-api-client.js";
import {
  AuthenticationError,
  RateLimitError,
  TimeoutError,
  sanitizeForLog,
  toSafeErrorMessage,
} from "./dmm-api-error.js";

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), "utf8")) as T;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createClient(fetchImpl: typeof fetch, maxRetries = 3): DmmApiClient {
  return new DmmApiClient({
    apiId: "test-api-id",
    affiliateId: "test-affiliate-990",
    baseUrl: "https://api.dmm.com/affiliate/v3",
    requestIntervalMs: 0,
    maxRetries,
    fetchImpl,
    sleepImpl: async () => undefined,
  });
}

describe("DmmApiClient", () => {
  it("detects API error responses as authentication failures", async () => {
    const errorBody = loadFixture("item-list-api-error.json");
    const fetchImpl = vi.fn(async () => jsonResponse(errorBody));
    const client = createClient(fetchImpl as unknown as typeof fetch);

    await expect(client.getItemList({ hits: 1 })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("retries on 429 then succeeds", async () => {
    const success = loadFixture("item-list-success.json");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limit", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse(success));

    const client = createClient(fetchImpl as unknown as typeof fetch);
    const response = await client.getItemList({ hits: 2 });
    expect(response.result?.items).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 then succeeds", async () => {
    const success = loadFixture("item-list-success.json");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("error", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(success));

    const client = createClient(fetchImpl as unknown as typeof fetch);
    await expect(client.getItemList({ hits: 1 })).resolves.toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 400", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad request", { status: 400 }));
    const client = createClient(fetchImpl as unknown as typeof fetch);

    await expect(client.getItemList({ hits: 1 })).rejects.toMatchObject({
      code: "api_response",
      statusCode: 400,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("handles timeout errors", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    });
    const client = createClient(fetchImpl as unknown as typeof fetch, 0);

    await expect(client.getItemList({ hits: 1 })).rejects.toBeInstanceOf(TimeoutError);
  });

  it("does not include credentials in error messages", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed for api_id=secret-api affiliate_id=secret-aff");
    });
    const client = new DmmApiClient({
      apiId: "secret-api",
      affiliateId: "secret-aff",
      baseUrl: "https://api.dmm.com/affiliate/v3",
      requestIntervalMs: 0,
      maxRetries: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async () => undefined,
    });

    try {
      await client.getItemList({ hits: 1 });
      throw new Error("expected failure");
    } catch (error) {
      const message = toSafeErrorMessage(error);
      expect(message).not.toContain("secret-api");
      expect(message).not.toContain("secret-aff");
      expect(sanitizeForLog("https://example.com?api_id=secret-api&affiliate_id=secret-aff")).toContain(
        "[redacted]",
      );
    }
  });

  it("exposes SeriesSearch method", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ result: { status: 200, series: [] } }),
    );
    const client = createClient(fetchImpl as unknown as typeof fetch);
    await client.getSeriesSearch({ floor: "videoa", hits: 1 });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("SeriesSearch");
  });

  it("throws RateLimitError after exhausted 429 retries", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limit", { status: 429 }));
    const client = createClient(fetchImpl as unknown as typeof fetch, 0);
    await expect(client.getItemList({ hits: 1 })).rejects.toBeInstanceOf(RateLimitError);
  });
});
