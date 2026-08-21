import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CollectionResult } from "@ai-affiliate/shared";
import { PrismaClient } from "@prisma/client";
import { ResearchRepository } from "./research-repository.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: resolve(rootDir, ".env") });

const prisma = new PrismaClient();
const repository = new ResearchRepository(prisma);

function buildCollection(recordedAt: Date): CollectionResult {
  return {
    providerName: "test",
    collectedAt: recordedAt,
    items: [
      {
        sourceName: "FANZA",
        sourceType: "FANZA",
        sourceBaseUrl: "https://www.dmm.co.jp",
        externalId: "test-fanza-001",
        itemType: "product",
        title: "Test FANZA Product",
        description: null,
        url: "https://example.com/fanza/1",
        publishedAt: recordedAt,
        collectedAt: recordedAt,
        rawData: { version: 1 },
        metrics: [
          { metricType: "review_count", value: 10, recordedAt },
          { metricType: "ranking", value: 5, recordedAt },
        ],
        tags: [
          { name: "テスト", type: "genre" },
          { name: "Test Maker", type: "maker" },
        ],
        images: [],
      },
      {
        sourceName: "TikTok",
        sourceType: "TIKTOK",
        sourceBaseUrl: "https://www.tiktok.com",
        externalId: "test-tiktok-001",
        itemType: "video",
        title: "Test TikTok Video",
        description: null,
        collectedAt: recordedAt,
        rawData: { version: 1 },
        metrics: [{ metricType: "view_count", value: 1000, recordedAt }],
        tags: [{ name: "テスト", type: "hashtag" }],
        images: [],
      },
      {
        sourceName: "X",
        sourceType: "X",
        sourceBaseUrl: "https://x.com",
        externalId: "test-x-001",
        itemType: "post",
        title: "Test X Post",
        description: null,
        collectedAt: recordedAt,
        rawData: { version: 1 },
        metrics: [{ metricType: "like_count", value: 20, recordedAt }],
        tags: [{ name: "テスト", type: "hashtag" }],
        images: [],
      },
    ],
  };
}

describe("ResearchRepository", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.researchImage.deleteMany();
    await prisma.researchMetric.deleteMany();
    await prisma.researchItemTag.deleteMany();
    await prisma.researchItem.deleteMany();
    await prisma.researchTag.deleteMany();
    await prisma.researchSource.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("saves mock-like collection data", async () => {
    const firstAt = new Date("2026-07-27T10:00:00.000Z");
    const summary = await repository.saveCollection(buildCollection(firstAt));

    expect(summary.itemCount).toBe(3);
    expect(summary.createdCount).toBe(3);
    expect(summary.updatedCount).toBe(0);
    expect(summary.metricCount).toBe(4);

    const items = await prisma.researchItem.findMany();
    expect(items).toHaveLength(3);
  });

  it("does not duplicate ResearchItem for the same externalId", async () => {
    const secondAt = new Date("2026-07-27T11:00:00.000Z");
    const second = buildCollection(secondAt);
    second.items[0] = {
      ...second.items[0],
      title: "Test FANZA Product Updated",
      description: null,
      rawData: { version: 2 },
    };

    const summary = await repository.saveCollection(second);

    expect(summary.createdCount).toBe(0);
    expect(summary.updatedCount).toBe(3);

    const fanzaItems = await prisma.researchItem.findMany({
      where: { externalId: "test-fanza-001" },
    });
    expect(fanzaItems).toHaveLength(1);
    expect(fanzaItems[0]?.title).toBe("Test FANZA Product Updated");
    expect(fanzaItems[0]?.description).toBeNull();
  });

  it("appends metrics as history", async () => {
    const fanzaItem = await prisma.researchItem.findFirstOrThrow({
      where: { externalId: "test-fanza-001" },
    });

    const metrics = await prisma.researchMetric.findMany({
      where: { researchItemId: fanzaItem.id },
      orderBy: { recordedAt: "asc" },
    });

    expect(metrics.length).toBeGreaterThanOrEqual(4);
    const reviewMetrics = metrics.filter((metric) => metric.metricType === "review_count");
    expect(reviewMetrics).toHaveLength(2);
  });

  it("reuses tags without duplication", async () => {
    const tags = await prisma.researchTag.findMany({
      where: { name: "テスト" },
    });

    const genreTags = tags.filter((tag) => tag.type === "genre");
    const hashtagTags = tags.filter((tag) => tag.type === "hashtag");

    expect(genreTags).toHaveLength(1);
    expect(hashtagTags).toHaveLength(1);
  });
});
