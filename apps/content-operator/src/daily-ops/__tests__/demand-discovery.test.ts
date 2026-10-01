import { describe, expect, it } from "vitest";
import { selectPopularDiscoveries } from "../demand-discovery.js";

describe("FANZA popular demand discovery", () => {
  it("keeps the best missing ranks inside the daily cap and skips existing research", () => {
    const ranked = Array.from({ length: 25 }, (_, index) => ({
      contentId: `cid-${String(index + 1).padStart(2, "0")}`,
      rank: index + 1,
    }));
    const picked = selectPopularDiscoveries({
      ranked,
      existingExternalIds: new Set(["cid-01", "cid-03"]),
      alreadyCreatedToday: 2,
      cap: 20,
    });
    expect(picked.skippedExisting).toBe(2);
    expect(picked.selected.map((row) => row.contentId)).toEqual([
      "cid-02",
      "cid-04",
      "cid-05",
      "cid-06",
      "cid-07",
      "cid-08",
      "cid-09",
      "cid-10",
      "cid-11",
      "cid-12",
      "cid-13",
      "cid-14",
      "cid-15",
      "cid-16",
      "cid-17",
      "cid-18",
      "cid-19",
      "cid-20",
    ]);
    expect(picked.skippedByCap).toBe(5);
  });

  it("does not select anything after the daily cap is full", () => {
    const picked = selectPopularDiscoveries({
      ranked: [
        { contentId: "new-1", rank: 1 },
        { contentId: "new-2", rank: 2 },
      ],
      existingExternalIds: new Set(),
      alreadyCreatedToday: 20,
      cap: 20,
    });
    expect(picked.selected).toEqual([]);
    expect(picked.skippedByCap).toBe(2);
  });
});
