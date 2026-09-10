import { describe, expect, it } from "vitest";
import {
  buildDeterministicPublicationMetadata,
  evaluatePublicationMetadataQuality,
  filterMeaningfulTags,
  isBannedTag,
  looksLikeCatalogDump,
  selectTitleAxis,
} from "./publication-metadata.js";
import { deriveWordPressTaxonomyFromEvidence } from "./evidence-taxonomy.js";

describe("publication metadata", () => {
  it("selects work_type axis for VR evidence", () => {
    expect(
      selectTitleAxis({
        performers: ["天馬ゆい"],
        genres: ["VR"],
        writerTitle: "天馬ゆいのハイクオリティVR作品",
      }),
    ).toBe("work_type");
  });

  it("builds diversified title and distinct SEO/meta", () => {
    const meta = buildDeterministicPublicationMetadata({
      productCanonicalId: "ssni00100",
      performers: ["RION"],
      genres: ["エステ"],
      seriesNames: [],
      sectionHeadings: ["オイルエステの流れ", "見どころ"],
      writerTitle: "神乳女優RIONの本格エステとアロマオイルエステ",
      articleSummary: "RIONのエステ作品について整理する。",
    });
    expect(meta.title.length).toBeGreaterThan(8);
    expect(meta.title).not.toBe(meta.seoTitle);
    expect(meta.metaDescription).not.toBe(meta.title);
    expect(meta.seoTitle).toContain("オトナセレクト");
    expect(meta.categories.length).toBeGreaterThan(0);
    expect(meta.tags.length).toBeGreaterThan(0);
    expect(meta.quality.pass).toBe(true);
  });

  it("rejects catalog-dump titles and banned tags", () => {
    expect(
      looksLikeCatalogDump(
        "神業ハンドテクで絶対連続射精させてくれる追い手コキメンズエステ 八木奈々",
      ),
    ).toBe(true);
    expect(isBannedTag("動画")).toBe(true);
    expect(filterMeaningfulTags(["動画", "RION", "VR", "1"]).includes("RION")).toBe(true);
    expect(filterMeaningfulTags(["動画", "RION", "VR", "1"]).includes("動画")).toBe(false);
  });

  it("fails quality when SEO equals title", () => {
    const q = evaluatePublicationMetadataQuality(
      {
        title: "同じタイトル",
        seoTitle: "同じタイトル",
        metaDescription: "同じタイトル",
        categories: ["作品紹介"],
        tags: ["RION"],
        performers: ["RION"],
        seriesNames: [],
        titleAxis: "performer",
        productCanonicalId: "x",
      },
      { performers: ["RION"] },
    );
    expect(q.pass).toBe(false);
    expect(q.failures).toContain("SEO_TITLE_SAME_AS_TITLE");
    expect(q.failures).toContain("META_DESC_SAME_AS_TITLE");
  });
});

describe("evidence taxonomy tag quality", () => {
  it("caps mega-cast performers and keeps format tags", () => {
    const many = Array.from({ length: 20 }, (_, i) => `女優${i}`);
    const derived = deriveWordPressTaxonomyFromEvidence({
      labels: [
        ...many.map((name) => ({ type: "actress", name })),
        { type: "genre", name: "ベスト" },
        { type: "maker", name: "エスワン" },
      ],
      title: "スーパーベスト総集編",
    });
    expect(derived.performers.length).toBeLessThanOrEqual(3);
    expect(derived.tags.some((t) => t.includes("ベスト") || t === "ベスト")).toBe(true);
    expect(derived.tags).toContain("エスワン");
    expect(derived.categories).toContain("ベスト・総集編");
  });
});
