import { describe, expect, it } from "vitest";
import {
  deriveSeriesNamesFromEvidence,
  deriveWordPressTaxonomyFromEvidence,
  normalizeTaxonomyDisplayName,
  PRODUCT_ARTICLE_CATEGORY_FALLBACK,
} from "../evidence-taxonomy.js";
import {
  isWordPressTimezoneTokyo,
  resolveWordPressPostDates,
} from "../wordpress-datetime.js";
import {
  buildWordPressSeoAttach,
  normalizeProductCanonicalId,
} from "../wordpress-seo-attach.js";

describe("evidence-taxonomy", () => {
  it("attaches multiple performers", () => {
    const d = deriveWordPressTaxonomyFromEvidence({
      title: "共演作",
      labels: [
        { type: "actress", name: "奥田咲" },
        { type: "actress", name: "三上悠亜" },
      ],
    });
    expect(d.performers).toEqual(["奥田咲", "三上悠亜"]);
  });

  it("keeps official series and adds semantic best/compilation series", () => {
    const d = deriveWordPressTaxonomyFromEvidence({
      title: "奥田咲とエスワンベスト第6弾",
      labels: [
        { type: "actress", name: "奥田咲" },
        { type: "series", name: "エスワン" },
        { type: "genre", name: "ベスト・総集編" },
      ],
    });
    expect(d.seriesNames).toEqual(expect.arrayContaining(["エスワン", "ベスト・総集編"]));
    expect(d.categories).toContain("ベスト・総集編");
    expect(d.tags).toEqual(expect.arrayContaining(["奥田咲", "ベスト", "総集編"]));
  });

  it("normalizes BEST/ベスト/総集編 synonyms for series display", () => {
    expect(normalizeTaxonomyDisplayName("BEST")).toBe("ベスト・総集編");
    expect(normalizeTaxonomyDisplayName("ベスト盤")).toBe("ベスト・総集編");
    expect(normalizeTaxonomyDisplayName("総集編")).toBe("ベスト・総集編");
    expect(normalizeTaxonomyDisplayName("エスワン")).toBe("エスワン");
  });

  it("derives debut / complete semantic series from title evidence", () => {
    expect(
      deriveSeriesNamesFromEvidence({
        title: "新人DEBUT記念",
        labels: [],
      }),
    ).toContain("デビュー作");
    expect(
      deriveSeriesNamesFromEvidence({
        title: "完全版パッケージ",
        labels: [],
      }),
    ).toContain("完全版");
  });

  it("allows empty series when no official or semantic evidence", () => {
    const d = deriveWordPressTaxonomyFromEvidence({
      title: "ある作品の紹介",
      labels: [{ type: "actress", name: "奥田咲" }],
    });
    expect(d.seriesNames).toEqual([]);
    expect(d.categories).toEqual([PRODUCT_ARTICLE_CATEGORY_FALLBACK]);
  });

  it("supports multiple categories", () => {
    const multi = deriveWordPressTaxonomyFromEvidence({
      title: "VR企画",
      labels: [
        { type: "genre", name: "VR" },
        { type: "genre", name: "企画" },
      ],
    });
    expect(multi.categories).toEqual(expect.arrayContaining(["VR", "企画"]));
  });

  it("does not invent from empty evidence", () => {
    const empty = deriveWordPressTaxonomyFromEvidence({ title: "", labels: [] });
    expect(empty.categories).toEqual([]);
    expect(empty.tags).toEqual([]);
    expect(empty.seriesNames).toEqual([]);
  });
});

describe("provider-agnostic product keys", () => {
  it("normalizes provider-prefixed and suffix variants to same key", () => {
    expect(normalizeProductCanonicalId("fanza:ofje00230")).toBe("ofje00230");
    expect(normalizeProductCanonicalId("OFJE00230-run1")).toBe("ofje00230");
    expect(normalizeProductCanonicalId("amazon:B0TEST123")).toBe("b0test123");
  });
});

describe("wordpress-seo-attach multi-series", () => {
  it("builds multiple seriesList entries", () => {
    const attach = buildWordPressSeoAttach({
      title: "x",
      seriesNames: ["エスワン", "ベスト・総集編"],
      performers: ["奥田咲"],
      categories: ["ベスト・総集編"],
      tags: ["奥田咲", "ベスト"],
      productCanonicalId: "fanza:ofje00230",
    });
    expect(attach.seriesList.map((s) => s.name)).toEqual(["エスワン", "ベスト・総集編"]);
    expect(attach.series?.name).toBe("エスワン");
    expect(attach.productCanonicalId).toBe("ofje00230");
  });
});

describe("wordpress-datetime", () => {
  it("emits Tokyo local date and UTC date_gmt without double offset", () => {
    const instant = new Date("2026-09-09T06:00:00.000Z");
    const fields = resolveWordPressPostDates(instant, "Asia/Tokyo");
    expect(fields.date).toBe("2026-09-09T15:00:00");
    expect(fields.date_gmt).toBe("2026-09-09T06:00:00");
  });

  it("detects Asia/Tokyo timezone settings", () => {
    expect(isWordPressTimezoneTokyo({ timezone: "Asia/Tokyo" })).toBe(true);
    expect(isWordPressTimezoneTokyo({ timezone_string: "", gmt_offset: 9 })).toBe(true);
  });
});
