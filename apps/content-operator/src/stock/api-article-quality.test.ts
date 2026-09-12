import { describe, expect, it } from "vitest";
import {
  classifyCastShape,
  extractItemListCatalogFacts,
  shouldAvoidSingularPerformerFraming,
} from "./ensure-official-enrichment.js";
import { evaluateStockArticleQualityGate } from "./stock-generation-worker.js";
import { buildDeterministicTitle, selectTitleAxis } from "../wordpress/publication-metadata.js";

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
  });
});
