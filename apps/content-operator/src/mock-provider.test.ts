import { afterEach, describe, expect, it } from "vitest";
import { MockResearchProvider } from "./providers/mock/index.js";

describe("MockResearchProvider", () => {
  afterEach(() => {
    delete process.env.RESEARCH_MOCK_MULTI_SOURCE;
  });

  it("returns FANZA-only mock items by default", async () => {
    const provider = new MockResearchProvider();
    expect(await provider.healthCheck()).toBe(true);

    const result = await provider.collect();
    expect(result.items).toHaveLength(1);
    expect(result.items.map((item) => item.sourceType)).toEqual(["FANZA"]);

    for (const item of result.items) {
      expect(item.metrics.length).toBeGreaterThan(0);
      expect(item.tags.length).toBeGreaterThan(0);
      expect(item.externalId.length).toBeGreaterThan(0);
    }
  });

  it("returns FANZA, TikTok, and X when RESEARCH_MOCK_MULTI_SOURCE=true", async () => {
    process.env.RESEARCH_MOCK_MULTI_SOURCE = "true";
    const result = await new MockResearchProvider().collect();
    expect(result.items).toHaveLength(3);
    const types = result.items.map((item) => item.sourceType).sort();
    expect(types).toEqual(["FANZA", "TIKTOK", "X"]);
  });
});
