import { describe, expect, it } from "vitest";
import {
  deriveWordPressTaxonomyFromEvidence,
  PRODUCT_ARTICLE_CATEGORY_FALLBACK,
} from "../evidence-taxonomy.js";
import {
  isWordPressTimezoneTokyo,
  resolveWordPressPostDates,
} from "../wordpress-datetime.js";

describe("evidence-taxonomy", () => {
  it("attaches multiple performers and does not invent series", () => {
    const d = deriveWordPressTaxonomyFromEvidence({
      title: "奥田咲ベスト",
      labels: [
        { type: "actress", name: "奥田咲" },
        { type: "actress", name: "三上悠亜" },
        { type: "genre", name: "ベスト・総集編" },
      ],
    });
    expect(d.performers).toEqual(["奥田咲", "三上悠亜"]);
    expect(d.seriesName).toBeNull();
    expect(d.categories).toContain("ベスト・総集編");
    expect(d.tags).toEqual(expect.arrayContaining(["奥田咲", "三上悠亜", "ベスト"]));
  });

  it("attaches series only when evidence has series label", () => {
    const withSeries = deriveWordPressTaxonomyFromEvidence({
      title: "x",
      labels: [{ type: "series", name: "エスワン" }],
    });
    expect(withSeries.seriesName).toBe("エスワン");
    expect(withSeries.tags).toContain("エスワン");

    const without = deriveWordPressTaxonomyFromEvidence({
      title: "x",
      labels: [{ type: "actress", name: "奥田咲" }],
    });
    expect(without.seriesName).toBeNull();
  });

  it("supports multiple categories from evidence and uses fallback when none match", () => {
    const multi = deriveWordPressTaxonomyFromEvidence({
      title: "VR企画",
      labels: [
        { type: "genre", name: "VR" },
        { type: "genre", name: "企画" },
      ],
    });
    expect(multi.categories).toEqual(expect.arrayContaining(["VR", "企画"]));
    expect(multi.categoryFallbackUsed).toBe(false);

    const fallback = deriveWordPressTaxonomyFromEvidence({
      title: "ある作品の紹介",
      labels: [{ type: "actress", name: "奥田咲" }],
    });
    expect(fallback.categories).toEqual([PRODUCT_ARTICLE_CATEGORY_FALLBACK]);
    expect(fallback.categoryFallbackUsed).toBe(true);
  });

  it("does not invent categories/tags from empty evidence", () => {
    const empty = deriveWordPressTaxonomyFromEvidence({
      title: "",
      labels: [],
      allowCategoryFallback: true,
    });
    expect(empty.categories).toEqual([]);
    expect(empty.tags).toEqual([]);
    expect(empty.performers).toEqual([]);
  });
});

describe("wordpress-datetime", () => {
  it("emits Tokyo local date and UTC date_gmt without double offset", () => {
    // 2026-09-09 15:00 JST = 2026-09-09 06:00 UTC
    const instant = new Date("2026-09-09T06:00:00.000Z");
    const fields = resolveWordPressPostDates(instant, "Asia/Tokyo");
    expect(fields.date).toBe("2026-09-09T15:00:00");
    expect(fields.date_gmt).toBe("2026-09-09T06:00:00");
  });

  it("detects Asia/Tokyo timezone settings", () => {
    expect(isWordPressTimezoneTokyo({ timezone_string: "Asia/Tokyo" })).toBe(true);
    expect(isWordPressTimezoneTokyo({ timezone: "Asia/Tokyo" })).toBe(true);
    expect(isWordPressTimezoneTokyo({ timezone_string: "", gmt_offset: 9 })).toBe(true);
    expect(isWordPressTimezoneTokyo({ timezone_string: "UTC", gmt_offset: 0 })).toBe(false);
  });
});
