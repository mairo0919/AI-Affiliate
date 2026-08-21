import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@ai-affiliate/config";
import { assertValidDmmAffiliateId, loadConfig } from "@ai-affiliate/config";
import { createDatabaseClient, ResearchRepository } from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { DmmApiClient } from "./dmm-api-client.js";
import { ConfigurationError, ValidationError } from "./dmm-api-error.js";
import type { DmmItemListResponse } from "./dmm-api-types.js";
import { mapDmmItemToCollected, mapDmmItemsToCollected } from "./fanza-mapper.js";
import { FanzaResearchProvider } from "./fanza-provider.js";
import { clampHits, resolveFanzaQuery } from "./fanza-query.js";

loadConfig({ requireDatabaseUrl: false });

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), "utf8")) as T;
}

function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    logLevel: "error",
    databaseUrl: process.env.DATABASE_URL ?? "",
    postgresDb: "ai_affiliate",
    postgresUser: "ai_affiliate",
    postgresPassword: "ai_affiliate_dev",
    postgresPort: "5432",
    dmmApiId: "test-api-id",
    dmmAffiliateId: "test-affiliate-990",
    dmmApiBaseUrl: "https://api.dmm.com/affiliate/v3",
    fanzaDefaultService: "digital",
    fanzaDefaultFloor: "videoa",
    fanzaDefaultHits: 100,
    fanzaRequestIntervalMs: 0,
    fanzaRequestTimeoutMs: 15_000,
    fanzaMaxRetries: 3,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fanza-mapper", () => {
  const fixture = loadFixture<DmmItemListResponse>("item-list-success.json");
  const items = fixture.result?.items ?? [];

  it("maps a successful response to CollectedResearchItem", () => {
    const mapped = mapDmmItemsToCollected(items, { sort: "rank", firstPosition: 1 });
    expect(mapped.items).toHaveLength(2);
  });

  it("uses content_id as externalId", () => {
    expect(mapDmmItemToCollected(items[0]!).item?.externalId).toBe("mizd00320");
  });

  it("prefers affiliateURL for ResearchItem.url", () => {
    const item = mapDmmItemToCollected(items[0]!).item;
    expect(item?.url).toContain("al.fanza.co.jp");
  });

  it("does not store description text", () => {
    expect(mapDmmItemToCollected(items[0]!).item?.description).toBeNull();
  });

  it("does not store review body text", () => {
    const raw = mapDmmItemToCollected(items[0]!).item?.rawData;
    expect(raw).not.toHaveProperty("review_text");
    expect(raw).not.toHaveProperty("reviewBody");
  });

  it("maps actress/genre/maker/series tags", () => {
    const tags = mapDmmItemToCollected(items[0]!).item?.tags ?? [];
    const types = new Set(tags.map((tag) => tag.type));
    expect(types.has("actress")).toBe(true);
    expect(types.has("genre")).toBe(true);
    expect(types.has("maker")).toBe(true);
    expect(types.has("series")).toBe(true);
  });

  it("does not create zero metrics for missing fields", () => {
    const metricTypes =
      mapDmmItemToCollected(items[1]!).item?.metrics.map((metric) => metric.metricType) ?? [];
    expect(metricTypes).not.toContain("reviewCount");
    expect(metricTypes).not.toContain("price");
  });

  it("sets safe image usageStatus", () => {
    const images = mapDmmItemToCollected(items[0]!).item?.images ?? [];
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(["REQUIRES_CONFIRMATION", "UNKNOWN", "NOT_ALLOWED", "ALLOWED"]).toContain(
        image.usageStatus,
      );
      expect(image.usageStatus).not.toBe("ALLOWED");
    }
  });

  it("continues when one item lacks content_id", () => {
    const mapped = mapDmmItemsToCollected([{ title: "broken" }, items[0]!], { sort: "date" });
    expect(mapped.skippedCount).toBe(1);
    expect(mapped.items).toHaveLength(1);
  });
});

describe("fanza-query", () => {
  it("clamps hits above 100", () => {
    expect(clampHits(150, 100)).toBe(100);
  });

  it("rejects invalid hits", () => {
    expect(() => clampHits(0, 100)).toThrow(ValidationError);
  });

  it("resolves defaults", () => {
    const query = resolveFanzaQuery({}, { service: "digital", floor: "videoa", hits: 20 });
    expect(query.service).toBe("digital");
    expect(query.floor).toBe("videoa");
    expect(query.hits).toBe(20);
    expect(query.offset).toBe(1);
  });
});

describe("affiliate ID validation", () => {
  it("accepts suffix 990-999", () => {
    expect(() => assertValidDmmAffiliateId("example-990")).not.toThrow();
    expect(() => assertValidDmmAffiliateId("example-999")).not.toThrow();
  });

  it("rejects invalid suffix without echoing secret", () => {
    try {
      assertValidDmmAffiliateId("example-123");
      throw new Error("expected failure");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("configuration incomplete");
      expect(message).not.toContain("example-123");
    }
  });
});

describe("FanzaResearchProvider", () => {
  it("collects a single page via mocked client", async () => {
    const success = loadFixture<DmmItemListResponse>("item-list-success.json");
    const fetchImpl = vi.fn(async () => jsonResponse(success));
    const client = new DmmApiClient({
      apiId: "test-api-id",
      affiliateId: "test-affiliate-990",
      baseUrl: "https://api.dmm.com/affiliate/v3",
      requestIntervalMs: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async () => undefined,
    });

    const provider = new FanzaResearchProvider({
      config: createTestConfig(),
      logger: createLogger("error"),
      client,
    });

    const result = await provider.collect({ hits: 2, sort: "rank" });
    expect(result.items).toHaveLength(2);
    expect(result.stats?.mappedCount).toBe(2);
    expect(result.nextOffset).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("dry-run path collects without requiring DB", async () => {
    const success = loadFixture<DmmItemListResponse>("item-list-success.json");
    const fetchImpl = vi.fn(async () => jsonResponse(success));
    const client = new DmmApiClient({
      apiId: "test-api-id",
      affiliateId: "test-affiliate-990",
      baseUrl: "https://api.dmm.com/affiliate/v3",
      requestIntervalMs: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async () => undefined,
    });
    const provider = new FanzaResearchProvider({
      config: createTestConfig({ databaseUrl: "" }),
      logger: createLogger("error"),
      client,
    });

    const result = await provider.collect({ hits: 2 });
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("healthCheck reports configuration incomplete when credentials are missing", async () => {
    const provider = new FanzaResearchProvider({
      config: createTestConfig({ dmmApiId: undefined, dmmAffiliateId: undefined }),
      logger: createLogger("error"),
    });

    await expect(provider.healthCheck()).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("requires credit display config", () => {
    const provider = new FanzaResearchProvider({
      config: createTestConfig(),
      logger: createLogger("error"),
    });
    expect(provider.credit.creditRequired).toBe(true);
    expect(provider.credit.creditText).toBeNull();
    expect(provider.credit.creditUrl).toBeNull();
  });
});

describe("Fanza persistence", () => {
  const database = createDatabaseClient();
  const repository = new ResearchRepository(database.prisma);

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      return;
    }
    await database.connect();
  });

  afterAll(async () => {
    if (!process.env.DATABASE_URL) {
      return;
    }
    await database.disconnect();
  });

  it.skipIf(!process.env.DATABASE_URL)(
    "does not duplicate ResearchItem and appends metrics on re-fetch",
    async () => {
      const fixture = loadFixture<DmmItemListResponse>("item-list-success.json");
      const externalIds = (fixture.result?.items ?? [])
        .map((item) => item.content_id)
        .filter((id): id is string => Boolean(id));

      await database.prisma.researchImage.deleteMany({
        where: { researchItem: { externalId: { in: externalIds } } },
      });
      await database.prisma.researchMetric.deleteMany({
        where: { researchItem: { externalId: { in: externalIds } } },
      });
      await database.prisma.researchItemTag.deleteMany({
        where: { researchItem: { externalId: { in: externalIds } } },
      });
      await database.prisma.researchItem.deleteMany({
        where: { externalId: { in: externalIds } },
      });

      const first = mapDmmItemsToCollected(fixture.result?.items ?? [], {
        sort: "rank",
        firstPosition: 1,
        collectedAt: new Date("2026-07-28T01:00:00.000Z"),
        recordedAt: new Date("2026-07-28T01:00:00.000Z"),
      });

      const firstSummary = await repository.saveCollection({
        providerName: "fanza",
        collectedAt: new Date("2026-07-28T01:00:00.000Z"),
        items: first.items,
      });
      expect(firstSummary.createdCount).toBeGreaterThan(0);
      expect(firstSummary.imageCount).toBeGreaterThan(0);

      const second = mapDmmItemsToCollected(fixture.result?.items ?? [], {
        sort: "rank",
        firstPosition: 1,
        collectedAt: new Date("2026-07-28T02:00:00.000Z"),
        recordedAt: new Date("2026-07-28T02:00:00.000Z"),
      });

      const secondSummary = await repository.saveCollection({
        providerName: "fanza",
        collectedAt: new Date("2026-07-28T02:00:00.000Z"),
        items: second.items,
      });
      expect(secondSummary.createdCount).toBe(0);
      expect(secondSummary.updatedCount).toBe(first.items.length);

      const item = await database.prisma.researchItem.findFirstOrThrow({
        where: { externalId: "mizd00320" },
        include: { metrics: true, images: true },
      });
      expect(item.description).toBeNull();
      expect(item.images.length).toBeGreaterThan(0);
      expect(item.images[0]?.usageStatus).toBe("REQUIRES_CONFIRMATION");

      const rankingMetrics = item.metrics.filter((metric) => metric.metricType === "rankingPosition");
      expect(rankingMetrics.length).toBeGreaterThanOrEqual(2);
    },
  );
});
