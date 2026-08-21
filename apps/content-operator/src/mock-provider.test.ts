import { describe, expect, it } from "vitest";
import { MockResearchProvider } from "./providers/mock/index.js";

describe("MockResearchProvider", () => {
  it("returns FANZA, TikTok, and X mock items with metrics and tags", async () => {
    const provider = new MockResearchProvider();
    expect(await provider.healthCheck()).toBe(true);

    const result = await provider.collect();
    expect(result.items).toHaveLength(3);

    const types = result.items.map((item) => item.sourceType).sort();
    expect(types).toEqual(["FANZA", "TIKTOK", "X"]);

    for (const item of result.items) {
      expect(item.metrics.length).toBeGreaterThan(0);
      expect(item.tags.length).toBeGreaterThan(0);
      expect(item.externalId.length).toBeGreaterThan(0);
    }
  });
});
