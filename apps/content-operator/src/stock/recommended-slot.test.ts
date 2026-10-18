import { describe, expect, it } from "vitest";
import { computeStockRefillNeed, loadStockRuntimeConfig } from "./stock-config.js";
import { slotQueueKind } from "./publish-slot-scheduler.js";
import { isHeldForRecommendedSlot } from "./approved-stock.js";
import { rankRecommendedCandidates } from "./stock-generation-worker.js";

describe("normal stock refill", () => {
  const base = { refillBelow: 9, refillTarget: 21 };

  it("does nothing while usable stock is at or above the threshold", () => {
    expect(computeStockRefillNeed({ ...base, usableStock: 9, normalGeneratedToday: 0 })).toBe(0);
    expect(computeStockRefillNeed({ ...base, usableStock: 30, normalGeneratedToday: 0 })).toBe(0);
  });

  it("refills up to the target once stock drops below the threshold", () => {
    expect(computeStockRefillNeed({ ...base, usableStock: 8, normalGeneratedToday: 0 })).toBe(13);
  });

  it("keeps refilling to the target after a refill started today", () => {
    expect(computeStockRefillNeed({ ...base, usableStock: 15, normalGeneratedToday: 3 })).toBe(6);
    expect(computeStockRefillNeed({ ...base, usableStock: 21, normalGeneratedToday: 9 })).toBe(0);
  });

  it("reads the refill and recommended settings from env", () => {
    const runtime = loadStockRuntimeConfig({
      STOCK_REFILL_BELOW: "5",
      STOCK_REFILL_TARGET: "14",
      WP_RECOMMENDED_SLOT_HOUR_JST: "21",
      RECOMMENDED_MAX_ATTEMPTS_PER_DAY: "2",
    });
    expect(runtime.stockRefillBelow).toBe(5);
    expect(runtime.stockRefillTarget).toBe(14);
    expect(runtime.recommendedSlotHourJst).toBe(21);
    expect(runtime.recommendedMaxAttemptsPerDay).toBe(2);
    const defaults = loadStockRuntimeConfig({});
    expect(defaults.stockRefillBelow).toBe(9);
    expect(defaults.stockRefillTarget).toBe(21);
    expect(defaults.recommendedSlotHourJst).toBe(22);
  });
});

describe("WordPress recommended slot", () => {
  const today = "2026-10-20";

  it("fills today's recommended hour only from the recommended queue and waits on later days", () => {
    const slot = (day: number, hour: number) => ({ year: 2026, month: 10, day, hour });
    expect(slotQueueKind(slot(20, 22), { recommendedHour: 22, todayJst: today })).toBe("recommended");
    expect(slotQueueKind(slot(21, 22), { recommendedHour: 22, todayJst: today })).toBe("wait");
    expect(slotQueueKind(slot(20, 21), { recommendedHour: 22, todayJst: today })).toBe("normal");
  });

  it("holds a recommended version for its day and releases it afterwards", () => {
    const rec = { publicationRole: "RECOMMENDED", recommendedForDay: today };
    expect(isHeldForRecommendedSlot(rec, today)).toBe(true);
    expect(isHeldForRecommendedSlot(rec, "2026-10-21")).toBe(false);
    expect(isHeldForRecommendedSlot({ publicationRole: null, recommendedForDay: null }, today)).toBe(false);
  });

  it("orders recommended candidates by popular rank and ignores unranked works", () => {
    const ranked = rankRecommendedCandidates([
      { id: "b", popularRank: 7 },
      { id: "none", popularRank: null },
      { id: "a", popularRank: 2 },
    ]);
    expect(ranked.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
