import { describe, expect, it } from "vitest";
import { extractFanzaContentIdFromUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";
import {
  classifyCastShape,
  extractItemListCatalogFacts,
  shouldAvoidSingularPerformerFraming,
} from "./ensure-official-enrichment.js";
import { evaluateStockArticleQualityGate } from "./stock-generation-worker.js";
import { buildDeterministicTitle, selectTitleAxis } from "../wordpress/publication-metadata.js";

describe("extractFanzaContentIdFromUrl", () => {
  it("reads id from affiliate lurl wrappers", () => {
    const aff =
      "https://al.fanza.co.jp/?lurl=https%3A%2F%2Fvideo.dmm.co.jp%2Fav%2Fcontent%2F%3Fid%3Ddvaj00760&af_id=example-990&ch=api";
    expect(extractFanzaContentIdFromUrl(aff)).toBe("dvaj00760");
    expect(extractFanzaContentIdFromUrl("https://video.dmm.co.jp/av/content/?id=dvaj00761")).toBe(
      "dvaj00761",
    );
  });
});

describe("ensure-official-enrichment cast shaping", () => {
  it("extracts multi actress list from ItemList rawData", () => {
    const facts = extractItemListCatalogFacts({
      title: "フェラベスト5時間",
      iteminfo: {
        actress: [{ name: "宍戸里帆" }, { name: "依本しおり" }, { name: "川上奈々美" }],
        genre: [{ name: "ベスト・総集編" }, { name: "フェラ" }],
        maker: [{ name: "アリスJAPAN" }],
      },
      volume: "300分",
    });
    expect(facts.actors).toEqual(["宍戸里帆", "依本しおり", "川上奈々美"]);
    expect(facts.durationMinutes).toBe(300);
    expect(facts.makers[0]).toBe("アリスJAPAN");
  });

  it("classifies BEST multi-cast as BEST_COMPILATION", () => {
    expect(
      classifyCastShape({
        actors: ["宍戸里帆", "依本しおり", "川上奈々美"],
        productTitle: "おしゃぶり大好き美女たちのフェラ顔…5時間BEST",
      }),
    ).toBe("BEST_COMPILATION");
  });

  it("does not treat performers[0] as singular star for multi BEST", () => {
    expect(
      shouldAvoidSingularPerformerFraming({
        actors: ["宍戸里帆", "依本しおり"],
        productTitle: "フェラBEST5時間",
      }),
    ).toBe(true);
  });
});

describe("stock article quality gate", () => {
  const multiRaw = {
    title: "フェラBEST5時間",
    iteminfo: {
      actress: [{ name: "宍戸里帆" }, { name: "依本しおり" }, { name: "川上奈々美" }],
      genre: [{ name: "ベスト・総集編" }],
      maker: [{ name: "アリスJAPAN" }],
    },
  };

  it("fails singular performer framing in title for multi-cast BEST", () => {
    const gate = evaluateStockArticleQualityGate({
      productTitle: "フェラBEST5時間",
      rawData: multiRaw,
      writerTitle: "アリスJAPANが贈る宍戸里帆出演のフェラベスト5時間集",
      structuredContent: {
        bodyHtml: "<p>魅力を存分に味わえる濃厚な内容です。じっくり楽しみたい方におすすめです。ボリューム感のある刺激的な展開が続きます。</p>".repeat(3),
      },
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toMatch(/MULTI_PERFORMER_SINGULAR_TITLE/);
  });

  it("fails thin body for rich cast", () => {
    const gate = evaluateStockArticleQualityGate({
      productTitle: "フェラBEST5時間",
      rawData: multiRaw,
      writerTitle: "フェラBEST5時間の見どころ",
      structuredContent: { bodyHtml: "<p>短い紹介です。</p>" },
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toMatch(/THIN_ARTICLE/);
  });
  it("fails bare generic form titles like ベストと総集編", () => {
    const gate = evaluateStockArticleQualityGate({
      productTitle: "フェラBEST5時間",
      rawData: multiRaw,
      writerTitle: "ベストと総集編",
      structuredContent: {
        bodyHtml: "<p>収録時間と出演構成を整理した紹介です。公式カタログ上のジャンルとメーカーを根拠にします。</p>".repeat(4),
      },
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toMatch(/GENERIC_FORM_TITLE/);
  });
});

describe("deterministic SEO title multi-performer", () => {
  it("does not build 注目は…｜performer[0] for multi-cast BEST", () => {
    const evidence = {
      officialTitle: "おしゃぶり大好き美女たちのフェラ顔…5時間BEST",
      writerTitle: "フェラBESTの見どころ",
      performers: ["宍戸里帆", "依本しおり", "川上奈々美"],
      genres: ["ベスト・総集編", "フェラ"],
      makers: ["アリスJAPAN"],
      seriesNames: [],
      sectionHeadings: ["フェラ顔"],
      productCanonicalId: "dvaj00760",
    };
    const axis = selectTitleAxis(evidence);
    expect(["work_type", "series_maker", "feature"]).toContain(axis);
    const title = buildDeterministicTitle(evidence, axis);
    expect(title).not.toMatch(/宍戸里帆出演/);
    expect(title).not.toMatch(/^注目は.+｜宍戸里帆/);
    expect(title).not.toMatch(/^ベストと総集編$/);
  });
});

describe("itemlist description synthesis", () => {
  it("builds factual synopsis from catalog when page description is absent", async () => {
    const { synthesizeItemListDescription, extractItemListCatalogFacts } = await import(
      "./ensure-official-enrichment.js"
    );
    const facts = extractItemListCatalogFacts({
      title: "おしゃぶり大好き美女たちのフェラ顔がスケベすぎる！5時間BEST",
      volume: "300",
      iteminfo: {
        actress: [{ name: "宍戸里帆" }, { name: "依本しおり" }],
        genre: [{ name: "ベスト・総集編" }, { name: "フェラ" }],
        maker: [{ name: "アリスJAPAN" }],
      },
    });
    expect(facts.durationMinutes).toBe(300);
    const desc = synthesizeItemListDescription({
      productTitle: facts.productName!,
      actors: facts.actors,
      genres: facts.genres,
      makers: facts.makers,
      series: facts.series,
      durationMinutes: facts.durationMinutes,
    });
    expect(desc).toContain("フェラ顔");
    expect(desc).toContain("宍戸里帆");
    expect(desc).toContain("依本しおり");
    expect(desc).toMatch(/約300分/);
  });
});
