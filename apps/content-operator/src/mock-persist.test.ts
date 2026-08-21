import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import { createDatabaseClient, ResearchRepository } from "@ai-affiliate/database";
import { MockResearchProvider } from "./providers/mock/index.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
process.chdir(rootDir);
loadConfig();

describe("MockResearchProvider persistence", () => {
  const database = createDatabaseClient();
  const repository = new ResearchRepository(database.prisma);

  beforeAll(async () => {
    await database.connect();
    await database.prisma.researchMetric.deleteMany({
      where: {
        researchItem: {
          externalId: {
            in: ["fanza-mock-product-001", "tiktok-mock-video-001", "x-mock-post-001"],
          },
        },
      },
    });
    await database.prisma.researchItemTag.deleteMany({
      where: {
        researchItem: {
          externalId: {
            in: ["fanza-mock-product-001", "tiktok-mock-video-001", "x-mock-post-001"],
          },
        },
      },
    });
    await database.prisma.researchItem.deleteMany({
      where: {
        externalId: {
          in: ["fanza-mock-product-001", "tiktok-mock-video-001", "x-mock-post-001"],
        },
      },
    });
  });

  afterAll(async () => {
    await database.disconnect();
  });

  it("saves MockResearchProvider data", async () => {
    const result = await new MockResearchProvider().collect();
    const summary = await repository.saveCollection(result);

    expect(summary.itemCount).toBe(3);
    expect(summary.createdCount).toBe(3);

    const saved = await database.prisma.researchItem.findMany({
      where: {
        externalId: {
          in: ["fanza-mock-product-001", "tiktok-mock-video-001", "x-mock-post-001"],
        },
      },
    });
    expect(saved).toHaveLength(3);
  });
});
