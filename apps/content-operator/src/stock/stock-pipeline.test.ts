import { describe, expect, it } from "vitest";
import {
  listUpcomingPublishSlots,
  publishSlotKeyFromWpLocalDate,
  resolveWordPressScheduledSlotDates,
} from "../wordpress/wordpress-datetime.js";
import { loadStockRuntimeConfig } from "./stock-config.js";
import { normalizeProductKey } from "../daily-ops/blog-product-exclusion.js";
import { isLikelyFanzaContentId, extractContentIdsFromHtml } from "./local-page-collector.js";

describe("stock config + publish slots", () => {
  it("defaults continuous gen + 90d horizon with future inventory band", () => {
    const cfg = loadStockRuntimeConfig({});
    expect(cfg.minApprovedStock).toBe(0);
    expect(cfg.generationBatch).toBe(3);
    expect(cfg.maxGenerationsPerDay).toBe(48);
    expect(cfg.scheduleHorizonDays).toBe(90);
    expect(cfg.scheduleMaxPerTick).toBe(3);
    expect(cfg.futureTargetPosts).toBe(45);
    expect(cfg.futureMinPosts).toBe(30);
    expect(cfg.researchSoftTarget).toBe(500);
    expect(cfg.localPageResearchInScheduler).toBe(false);
    expect(cfg.publishSlotHoursJst).toEqual([12, 21, 23]);
    expect(cfg.protectedWpPostIds).toEqual([43, 46]);
  });

  it("clamps scheduleMaxPerTick to generationBatch even if env is higher", () => {
    const cfg = loadStockRuntimeConfig({
      WORDPRESS_SCHEDULE_MAX_PER_TICK: "15",
      STOCK_GENERATION_BATCH: "3",
    });
    expect(cfg.scheduleMaxPerTick).toBe(3);
  });

  it("lists slots across 90-day horizon", () => {
    const now = new Date("2026-09-09T01:00:00.000Z");
    const slots = listUpcomingPublishSlots({
      now,
      hours: [12, 21, 23],
      days: 90,
    });
    expect(slots.length).toBeGreaterThan(200);
    expect(slots.length).toBeLessThanOrEqual(270);
  });

  it("lists remaining JST slots after morning", () => {
    // 2026-09-09 10:00 JST
    const now = new Date("2026-09-09T01:00:00.000Z");
    const slots = listUpcomingPublishSlots({
      now,
      hours: [12, 21, 23],
      days: 2,
    });
    expect(slots[0]).toMatchObject({ year: 2026, month: 9, day: 9, hour: 12 });
    expect(slots.some((s) => s.day === 9 && s.hour === 21)).toBe(true);
    expect(slots.some((s) => s.day === 9 && s.hour === 23)).toBe(true);
    expect(slots.some((s) => s.day === 10 && s.hour === 12)).toBe(true);
  });

  it("skips past slots today", () => {
    // 2026-09-09 22:00 JST
    const now = new Date("2026-09-09T13:00:00.000Z");
    const slots = listUpcomingPublishSlots({
      now,
      hours: [12, 21, 23],
      days: 1,
    });
    expect(slots.map((s) => s.hour)).toEqual([23]);
  });

  it("builds WP date fields for 21:00 JST", () => {
    const dates = resolveWordPressScheduledSlotDates({
      year: 2026,
      month: 9,
      day: 9,
      hour: 21,
    });
    expect(dates.date).toBe("2026-09-09T21:00:00");
    expect(dates.date_gmt).toBe("2026-09-09T12:00:00");
  });

  it("maps WP local future date to publishSlotKey", () => {
    expect(publishSlotKeyFromWpLocalDate("2026-09-12T12:00:00")).toBe(
      "2026-09-12T12:00:00+09:00",
    );
    expect(publishSlotKeyFromWpLocalDate("2026-09-17T21:00:00")).toBe(
      "2026-09-17T21:00:00+09:00",
    );
    expect(publishSlotKeyFromWpLocalDate("bad")).toBeNull();
  });

  it("keeps product key provider-agnostic", () => {
    expect(normalizeProductKey("fanza:ofje00230")).toBe("ofje00230");
    expect(normalizeProductKey("adult-b:XYZ123")).toBe("xyz123");
  });
});

describe("local page cid extraction", () => {
  it("filters gtm noise", () => {
    expect(isLikelyFanzaContentId("gtm-nhfbh7q")).toBe(false);
    expect(isLikelyFanzaContentId("ssis00123")).toBe(true);
    expect(isLikelyFanzaContentId("h_1472instv00732")).toBe(true);
  });

  it("extracts product ids only", () => {
    const html =
      'a?id=gtm-foo&x <a href="https://video.dmm.co.jp/av/content/?id=ssis00777">';
    expect(extractContentIdsFromHtml(html)).toEqual(["ssis00777"]);
  });
});
