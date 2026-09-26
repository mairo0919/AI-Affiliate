import { describe, expect, it } from "vitest";
import {
  buildDeterministicPublicationMetadata,
  buildDeterministicTitle,
  evaluatePublicationMetadataQuality,
  filterMeaningfulTags,
  isBannedTag,
  isGenericCidGuideTitle,
  looksLikeCatalogDump,
  resolveCanonicalArticleTitle,
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

  it("carries ContentVersion/Writer title as WP semantic title (does not regenerate)", () => {
    const writerTitle = "神乳女優RIONの本格エステとアロマオイルエステ";
    const meta = buildDeterministicPublicationMetadata({
      productCanonicalId: "ssni00100",
      performers: ["RION"],
      genres: ["エステ"],
      seriesNames: [],
      sectionHeadings: ["オイルエステの流れ", "見どころ"],
      writerTitle,
      articleSummary: "RIONのエステ作品について整理する。",
    });
    expect(meta.title).toBe(writerTitle);
    expect(meta.titleAuthority).toBe("content_version");
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

  it("fails quality on generic CID guide title", () => {
    expect(isGenericCidGuideTitle("作品ガイド｜1RCTD00763")).toBe(true);
    const q = evaluatePublicationMetadataQuality(
      {
        title: "作品ガイド｜1RCTD00763",
        seoTitle: "別SEO｜1RCTD00763｜オトナセレクト",
        metaDescription: "公開カタログの情報をもとに、作品の特徴を短く整理します。",
        categories: ["作品紹介"],
        tags: ["VR", "企画"],
        performers: ["女優A"],
        seriesNames: [],
        titleAxis: "highlight",
        productCanonicalId: "1rctd00763",
        titleAuthority: "anomaly_fallback",
      },
      { performers: ["女優A"], productCanonicalId: "1rctd00763" },
    );
    expect(q.pass).toBe(false);
    expect(q.failures).toContain("TITLE_GENERIC_FALLBACK");
  });

  it("anomaly fallback builds performer-grounded title but is not publishable", () => {
    const title = buildDeterministicTitle(
      {
        productCanonicalId: "1rctd00763",
        performers: ["天馬ゆい"],
        genres: ["単体作品"],
        officialTitle:
          "【長いカタログ商品名】天馬ゆい 神業ハンドテクで絶対連続射精させてくれる追い手コキメンズエステ 八木奈々",
      },
      "highlight",
    );
    expect(isGenericCidGuideTitle(title)).toBe(false);
    expect(title).toContain("天馬ゆい");
    const meta = buildDeterministicPublicationMetadata({
      productCanonicalId: "1rctd00763",
      performers: ["天馬ゆい"],
      genres: ["単体作品"],
      officialTitle:
        "【長いカタログ商品名】天馬ゆい 神業ハンドテクで絶対連続射精させてくれる追い手コキメンズエステ",
    });
    expect(meta.titleAuthority).toBe("anomaly_fallback");
    expect(isGenericCidGuideTitle(meta.title)).toBe(false);
    expect(meta.title).toContain("天馬ゆい");
    expect(meta.quality.pass).toBe(false);
    expect(meta.quality.failures).toContain("TITLE_ANOMALY_FALLBACK");
  });

  it("resolveCanonicalArticleTitle prefers Writer/ContentVersion title", () => {
    expect(
      resolveCanonicalArticleTitle({
        writerTitle: "九井スナオの主観ホラー企画を整理",
        officialTitle: "ROCKET18周年記念ユーザーリクエスト祭り …",
      }),
    ).toEqual({
      title: "九井スナオの主観ホラー企画を整理",
      authority: "content_version",
    });
    expect(
      resolveCanonicalArticleTitle({
        writerTitle: "作品ガイド｜1RCTD00763",
        productCanonicalId: "1rctd00763",
      }).authority,
    ).toBe("anomaly_fallback");
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
        titleAuthority: "content_version",
      },
      { performers: ["RION"], writerTitle: "同じタイトル" },
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
