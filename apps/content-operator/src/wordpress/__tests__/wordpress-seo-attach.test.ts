import { describe, expect, it } from "vitest";
import {
  buildWordPressSeoAttach,
  isSafeOgImageUrl,
  OTONASELECT_PRODUCTION_ORIGIN,
  stableTermSlug,
  truncateMetaDescription,
} from "../wordpress-seo-attach.js";

describe("wordpress-seo-attach", () => {
  it("builds stable performer slug from ascii hint", () => {
    expect(stableTermSlug("奥田咲", "p", "okuda-saki")).toBe("p-okuda-saki");
  });

  it("falls back to hash slug when ascii missing", () => {
    const a = stableTermSlug("奥田咲", "p");
    const b = stableTermSlug("奥田咲", "p");
    expect(a).toMatch(/^p-[a-f0-9]{12}$/);
    expect(a).toBe(b);
  });

  it("rejects adult CDN for OG images", () => {
    expect(
      isSafeOgImageUrl(
        "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/ofje00230/ofje00230jp-1.jpg",
      ),
    ).toBe(false);
    expect(isSafeOgImageUrl("https://otonaselect.net/wp-content/themes/otonaselect/assets/og-default.svg")).toBe(
      true,
    );
  });

  it("does not invent ratings and keeps production origin", () => {
    const attach = buildWordPressSeoAttach({
      title: "奥田咲 S1 ベスト",
      seoTitle: "奥田咲のベストを整理",
      metaDescription: "公開情報に基づく作品まとめ。",
      performers: [{ name: "奥田咲", ascii: "okuda-saki" }],
      seriesName: "S1",
      productCanonicalId: "ofje00230",
      safeOgImageUrl:
        "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/ofje00230/ofje00230pl.jpg",
      siteOrigin: "https://otonaselect.mixh.jp",
    });
    expect(attach.siteOrigin).toBe(OTONASELECT_PRODUCTION_ORIGIN);
    expect(attach.performers[0]?.stableSlug).toBe("p-okuda-saki");
    expect(attach.productCanonicalId).toBe("ofje00230");
    expect(attach.meta.otonaselect_seo_title).toBe("奥田咲のベストを整理");
    expect(attach.meta.otonaselect_safe_og_image).toBeUndefined();
    expect(attach.notes.some((n) => n.includes("safeOgImage"))).toBe(true);
    expect(JSON.stringify(attach)).not.toMatch(/aggregateRating|offers|priceCurrency/);
  });

  it("truncates description naturally", () => {
    const long = "あ".repeat(200);
    expect(truncateMetaDescription(long, 50).endsWith("…")).toBe(true);
  });
});
