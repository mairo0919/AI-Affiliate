import { describe, expect, it } from "vitest";
import {
  listUpcomingPublishSlots,
  resolveWordPressScheduledSlotDates,
} from "../wordpress/wordpress-datetime.js";
import { loadStockRuntimeConfig } from "./stock-config.js";
import { normalizeProductKey } from "../daily-ops/blog-product-exclusion.js";
import { isLikelyFanzaContentId, extractContentIdsFromHtml } from "./local-page-collector.js";

describe("stock config + publish slots", () => {
  it("defaults min stock 9 and batch 3", () => {
    const cfg = loadStockRuntimeConfig({});
    expect(cfg.minApprovedStock).toBe(9);
    expect(cfg.generationBatch).toBe(3);
    expect(cfg.publishSlotHoursJst).toEqual([12, 21, 23]);
    expect(cfg.protectedWpPostIds).toEqual([43, 46]);
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
