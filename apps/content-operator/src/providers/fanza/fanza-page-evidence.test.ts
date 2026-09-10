import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { imageContentKey, selectArticleImagesWithReport } from "../../generation/article-images.js";
import {
  extractFanzaPageEvidenceFromHtml,
  extractGalleryImageUrls,
  mergeItemListAndPageImages,
  mergeCanonicalCatalog,
  toSourceDocumentPageEvidenceMeta,
  withMergedItemListCatalog,
} from "./fanza-page-evidence.js";
import { fetchFanzaPageEvidence } from "./fanza-page-evidence-fetch.js";
import { buildEvidencePack } from "../../article-pattern/evidence-pack.js";

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/mizd00320-page-evidence.html"),
  "utf8",
);

const ITEM_LIST_ONE_SCENE = [
  {
    sourceUrl: "https://pics.dmm.co.jp/digital/video/mizd00320/mizd00320pl.jpg",
    imageType: "main_large",
    usageStatus: "REQUIRES_CONFIRMATION",
  },
  {
    sourceUrl: "https://pics.dmm.co.jp/digital/video/mizd00320/mizd00320-1.jpg",
    imageType: "sample_small",
    usageStatus: "REQUIRES_CONFIRMATION",
  },
  {
    sourceUrl: "https://pics.dmm.co.jp/digital/video/mizd00320/mizd00320jp-1.jpg",
    imageType: "sample_large",
    usageStatus: "REQUIRES_CONFIRMATION",
  },
];

describe("fanza page evidence (LLM=0 fixtures)", () => {
  it("CASE A: ItemList 1 scene + Page 1..10 → unique sample 10", () => {
    const page = extractFanzaPageEvidenceFromHtml({ html: FIXTURE, contentIdHint: "mizd00320" });
    expect(page.uniqueSampleSceneCount).toBe(10);
    const merge = mergeItemListAndPageImages({
      itemListImages: ITEM_LIST_ONE_SCENE,
      pageEvidence: page,
    });
    expect(merge.uniqueSampleSceneCount).toBe(10);
    expect(merge.uniquePackageCount).toBe(1);
  });

  it("CASE B: small + large same scene", () => {
    const a = imageContentKey(
      "https://pics.dmm.co.jp/digital/video/mizd00320/mizd00320-3.jpg",
    );
    const b = imageContentKey(
      "https://pics.dmm.co.jp/digital/video/mizd00320/mizd00320jp-3.jpg",
    );
    expect(a?.contentKey).toBe("mizd00320:sample:3");
    expect(b?.contentKey).toBe("mizd00320:sample:3");
    expect(b!.qualityHint).toBeGreaterThan(a!.qualityHint);
  });

  it("CASE C: CDN mirror duplicates", () => {
    const page = extractFanzaPageEvidenceFromHtml({
      html: `<script type="application/ld+json">${JSON.stringify({
        "@type": "Product",
        sku: "mizd00320",
        image: [
          "https://pics.dmm.co.jp/digital/video/mizd00320/mizd00320jp-1.jpg",
          "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/mizd00320/mizd00320jp-1.jpg",
        ],
      })}</script>`,
    });
    expect(page.uniqueSampleSceneCount).toBe(1);
  });

  it("CASE D: package pl/ps/pt → unique 1", () => {
    const page = extractFanzaPageEvidenceFromHtml({
      html: `<script type="application/ld+json">${JSON.stringify({
        "@type": "Product",
        image: [
          "https://pics.dmm.co.jp/digital/video/x/xpl.jpg",
          "https://pics.dmm.co.jp/digital/video/x/xps.jpg",
          "https://pics.dmm.co.jp/digital/video/x/xpt.jpg",
        ],
      })}</script>`,
    });
    expect(page.uniquePackageCount).toBe(1);
  });

  it("CASE E: VideoObject metadata saved; no binary fetch implied", () => {
    const page = extractFanzaPageEvidenceFromHtml({ html: FIXTURE });
    expect(page.video).not.toBeNull();
    expect(page.video?.type).toBe("sample_movie_meta");
    expect(page.video?.contentUrl).toMatch(/\.mp4$/);
    expect(page.video?.allowedForGeneration).toBe(false);
    expect(page.video?.thumbnailUrl).toContain("jp-2");
  });

  it("CASE F: ItemList sampleMovieURL null + Page VideoObject → movie meta present", () => {
    const page = extractFanzaPageEvidenceFromHtml({ html: FIXTURE });
    expect(page.video?.originField).toContain("jsonld.VideoObject");
  });

  it("CASE G: JSON-LD description → official_page_description", () => {
    const page = extractFanzaPageEvidenceFromHtml({ html: FIXTURE });
    expect(page.description?.evidenceType).toBe("official_page_description");
    expect(page.description?.allowedForGeneration).toBe(false);
    expect(page.description?.text.length).toBeGreaterThan(10);
  });

  it("CASE H: page extract empty → ItemList-only merge (fail closed)", () => {
    const page = extractFanzaPageEvidenceFromHtml({ html: "<html><body>no evidence</body></html>" });
    expect(page.extractMode).toBe("empty");
    const merge = mergeItemListAndPageImages({
      itemListImages: ITEM_LIST_ONE_SCENE,
      pageEvidence: page.extractMode === "empty" ? null : page,
    });
    expect(merge.uniqueSampleSceneCount).toBe(1);
    expect(merge.uniquePackageCount).toBe(1);
  });

  it("gallery extractor lists all sample imgs (not first-only)", () => {
    const urls = extractGalleryImageUrls(FIXTURE);
    expect(urls.length).toBeGreaterThanOrEqual(11);
  });

  it("fixture fetch path uses 0 external requests", async () => {
    const result = await fetchFanzaPageEvidence({
      url: "https://video.dmm.co.jp/av/content/?id=mizd00320",
      contentIdHint: "mizd00320",
      confirmExternal: false,
      config: { researchAllowExternalRequests: false } as never,
      fixtureHtml: FIXTURE,
    });
    expect(result.ok).toBe(true);
    expect(result.externalRequestCount).toBe(0);
    expect(result.movieBinaryRequests).toBe(0);
    expect(result.evidence?.uniqueSampleSceneCount).toBe(10);
  });

  it("selection preview: hero 1 + sample up to 10 (no fixed cap)", () => {
    const page = extractFanzaPageEvidenceFromHtml({ html: FIXTURE });
    const merge = mergeItemListAndPageImages({
      itemListImages: ITEM_LIST_ONE_SCENE,
      pageEvidence: page,
    });
    const { selected, excluded } = selectArticleImagesWithReport({
      researchImages: merge.merged.map((m, i) => ({
        id: `m${i}`,
        imageType: m.imageType,
        sourceUrl: m.bestUrl,
        usageStatus: m.usageStatus,
      })),
    });
    expect(selected.filter((s) => s.role === "hero")).toHaveLength(1);
    expect(selected.filter((s) => s.role === "auxiliary").length).toBe(10);
    expect(selected).toHaveLength(11);
    expect(excluded.some((e) => e.reason === "max_count_cap")).toBe(false);
  });

  it("persists productName + catalog fields with provenance priority", () => {
    const page = extractFanzaPageEvidenceFromHtml({ html: FIXTURE, contentIdHint: "mizd00320" });
    expect(page.productName).toContain("松本いちか");
    expect(page.productNameProvenance).toBe("page_json_ld");
    expect(page.catalog.maker?.value).toBe("ムーディーズ");
    expect(page.catalog.maker?.provenance).toBe("page_json_ld");
    expect(page.catalog.label?.value).toBe("MOODYZ Best");
    expect(page.catalog.label?.provenance).toBe("page_dom");
    expect(page.catalog.durationMinutes?.value).toBe(475);
    expect(page.catalog.manufacturerSku?.value).toBe("MIZD-320");
    expect(page.catalog.releaseDate?.value).toBe("2023-03-17"); // json-ld uploadDate wins over DOM
    expect(page.catalog.genres.map((g) => g.value)).toEqual(
      expect.arrayContaining(["痴女", "美少女", "女優ベスト・総集編"]),
    );
    expect(page.catalog.relatedTags.map((t) => t.value)).toEqual(
      expect.arrayContaining(["騎乗位", "杭打ち", "フェラ", "手コキ", "乳首"]),
    );
    const meta = toSourceDocumentPageEvidenceMeta(page);
    expect(meta.productName).toBe(page.productName);
    expect(meta.officialGenres).toEqual(expect.arrayContaining(["痴女"]));
    expect(meta.officialRelatedTags).toEqual(expect.arrayContaining(["フェラ", "手コキ"]));
    expect((meta.catalog as { maker: { value: string } }).maker.value).toBe("ムーディーズ");
  });

  it("merges ItemList catalog without duplicate surfaces in EvidencePack", () => {
    const page = extractFanzaPageEvidenceFromHtml({ html: FIXTURE, contentIdHint: "mizd00320" });
    const merged = withMergedItemListCatalog(page, {
      volume: "476",
      date: "2023-03-17 10:00:00",
      iteminfo: {
        maker: [{ id: 1, name: "ムーディーズ" }],
        label: [{ id: 2, name: "MOODYZ Best" }],
        genre: [
          { id: 3, name: "痴女" },
          { id: 4, name: "4時間以上作品" },
        ],
        series: [{ id: 5, name: "GETシリーズ" }],
      },
    });
    // series missing on page (----) → itemlist fills
    expect(merged.catalog.series?.value).toBe("GETシリーズ");
    expect(merged.catalog.series?.provenance).toBe("itemlist");
    // maker stays page_json_ld (higher priority than itemlist)
    expect(merged.catalog.maker?.provenance).toBe("page_json_ld");
    // duration: page_dom 475 beats itemlist volume 476
    expect(merged.catalog.durationMinutes?.value).toBe(475);
    expect(merged.catalog.genres.map((g) => g.value)).toEqual(
      expect.arrayContaining(["痴女", "4時間以上作品"]),
    );

    const pack = buildEvidencePack({
      productTitle: "令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト",
      claims: [],
      pageEvidenceMeta: toSourceDocumentPageEvidenceMeta(merged) as never,
    });
    const makers = pack.catalogMetadata.filter((c) => c.id === "catalog::maker" || c.fact === "ムーディーズ");
    // surface-deduped: at most one ムーディーズ catalog entry from catalog::maker
    expect(makers.filter((m) => m.id === "catalog::maker")).toHaveLength(1);
    expect(pack.catalogMetadata.some((c) => c.id === "catalog::durationMinutes")).toBe(true);
    expect(
      pack.catalogMetadata
        .filter((c) => c.id.startsWith("catalog::"))
        .every((c) => c.generationEligible === false),
    ).toBe(true);
    // catalog items must not land in concreteEvidence
    expect(pack.concreteEvidence.every((c) => !c.id.startsWith("catalog::"))).toBe(true);
  });

  it("catalog-only metadata does not satisfy concrete sufficiency", () => {
    const pack = buildEvidencePack({
      productTitle: "rki00500",
      claims: [],
      pageEvidenceMeta: {
        contentId: "rki00500",
        productName: "関西を代表するアイドルグループのリーダーに超激似！",
        catalog: {
          maker: { value: "ROOKIE", provenance: "page_json_ld", originField: "brand" },
          label: { value: "ROOKIE", provenance: "page_dom", originField: "label" },
          series: null,
          genres: [{ value: "そっくりさん", provenance: "page_dom", originField: "genre" }],
          relatedTags: [],
          durationMinutes: { value: 118, provenance: "page_dom", originField: "duration" },
          releaseDate: { value: "2019-08-19", provenance: "page_dom", originField: "release" },
          manufacturerSku: { value: "RKI-500", provenance: "page_dom", originField: "sku" },
        },
      },
    });
    expect(pack.catalogMetadata.length).toBeGreaterThanOrEqual(5);
    expect(pack.insufficientConcrete).toBe(true);
    expect(pack.productIdentity.title).toContain("アイドル");
  });

  it("mergeCanonicalCatalog prefers page over itemlist for same field", () => {
    const merged = mergeCanonicalCatalog({
      pageCatalog: {
        maker: {
          value: "エスワン ナンバーワンスタイル",
          provenance: "page_json_ld",
          originField: "jsonld.Product.brand.name",
        },
        label: null,
        series: null,
        genres: [],
        durationMinutes: null,
        releaseDate: null,
        manufacturerSku: null,
      },
      itemListRawData: {
        iteminfo: { maker: [{ name: "別メーカー" }] },
      },
    });
    expect(merged.maker?.value).toBe("エスワン ナンバーワンスタイル");
  });
});
