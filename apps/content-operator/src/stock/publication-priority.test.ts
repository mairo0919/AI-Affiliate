import { describe, expect, it } from "vitest";
import { wordpressTargetBlocksReuse } from "./approved-stock.js";
import { futureSlotsStillOpen, orderStockByPublicationPriority } from "./publish-slot-scheduler.js";

describe("recommended publication priority", () => {
  it("assigns a new WordPress slot to recommended stock before normal stock", () => {
    const ordered = orderStockByPublicationPriority(
      [
        { productKey: "normal-old", updatedAt: new Date("2026-09-01T00:00:00Z") },
        { productKey: "popular", updatedAt: new Date("2026-09-02T00:00:00Z") },
        { productKey: "rec-10", updatedAt: new Date("2026-10-01T00:00:00Z") },
        { productKey: "rec-1", updatedAt: new Date("2026-10-02T00:00:00Z") },
        { productKey: "rec-boosted", updatedAt: new Date("2026-10-03T00:00:00Z") },
      ],
      new Map([
        ["rec-1", { recommendedRank: 1, popularRank: null }],
        ["rec-10", { recommendedRank: 10, popularRank: null }],
        ["rec-boosted", { recommendedRank: 9, popularRank: 1 }],
        ["popular", { recommendedRank: null, popularRank: 1 }],
      ]),
    );
    expect(ordered.map((row) => row.productKey)).toEqual([
      "rec-boosted",
      "rec-1",
      "rec-10",
      "popular",
      "normal-old",
    ]);
  });

  it("keeps already reserved future slots and does not backfill them", () => {
    const slots = [
      { year: 2026, month: 10, day: 6, hour: 12 },
      { year: 2026, month: 10, day: 6, hour: 21 },
      { year: 2026, month: 10, day: 6, hour: 23 },
    ];
    const reserved = new Set(["2026-10-06T12:00:00+09:00", "2026-10-06T21:00:00+09:00"]);
    expect(futureSlotsStillOpen(slots, reserved).map((slot) => slot.hour)).toEqual([23]);
  });

  it("does not reuse a recommended work that is already published or scheduled", () => {
    expect(wordpressTargetBlocksReuse([{ status: "PUBLISHED", publishedExternalId: "43" }])).toBe(true);
    expect(wordpressTargetBlocksReuse([{ status: "SCHEDULED", publishedExternalId: null }])).toBe(true);
    expect(wordpressTargetBlocksReuse([{ status: "AWAITING_APPROVAL", publishedExternalId: null }])).toBe(false);
  });
});
