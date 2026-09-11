import { describe, expect, it } from "vitest";
import {
  extractAdultAttributeTags,
  adultTagStableSlug,
} from "../adult-taxonomy.js";
import {
  ADULT_TAXONOMY_DICTIONARY,
  adultTaxonomyAliasCount,
  adultTaxonomyCanonicalCount,
} from "../adult-taxonomy-dictionary.js";
import { deriveWordPressTaxonomyFromEvidence } from "../evidence-taxonomy.js";

describe("adult-taxonomy dictionary", () => {
  it("has canonical terms and aliases", () => {
    expect(adultTaxonomyCanonicalCount()).toBeGreaterThanOrEqual(20);
    expect(adultTaxonomyAliasCount()).toBeGreaterThanOrEqual(adultTaxonomyCanonicalCount());
    expect(ADULT_TAXONOMY_DICTIONARY.some((t) => t.canonicalName === "巨乳")).toBe(true);
    expect(ADULT_TAXONOMY_DICTIONARY.some((t) => t.canonicalName === "人妻")).toBe(true);
    expect(ADULT_TAXONOMY_DICTIONARY.some((t) => t.canonicalName === "メンエス")).toBe(true);
  });

  it("builds stable ascii-ish slugs for dictionary terms", () => {
    expect(adultTagStableSlug("巨乳")).toMatch(/^t-/);
    expect(adultTagStableSlug("メンエス")).toBe("t-menes");
    expect(adultTagStableSlug("人妻")).toBe("t-hitozuma");
  });
});

describe("extractAdultAttributeTags", () => {
  it("extracts 巨乳 and 人妻 from title compound", () => {
    const r = extractAdultAttributeTags({
      officialTitle: "巨乳人妻がメンエスで痴女る話",
    });
    expect(r.tags).toEqual(expect.arrayContaining(["巨乳", "人妻", "メンエス", "痴女"]));
    expect(r.counts.fromTitle).toBeGreaterThanOrEqual(3);
  });

  it("extracts メンエス from メンズエステ alias", () => {
    const r = extractAdultAttributeTags({
      officialTitle: "メンズエステ嬢の裏オプ",
    });
    expect(r.tags).toContain("メンエス");
  });

  it("extracts デビュー / ベスト / 総集編 from title", () => {
    const r = extractAdultAttributeTags({
      officialTitle: "新人デビューBEST総集編 完全版",
    });
    expect(r.tags).toEqual(expect.arrayContaining(["デビュー", "ベスト", "総集編", "完全版"]));
  });

  it("prefers genre source over title for same term", () => {
    const r = extractAdultAttributeTags({
      genres: ["巨乳"],
      officialTitle: "巨乳の人妻",
    });
    const hit = r.matches.find((m) => m.canonicalName === "巨乳");
    expect(hit?.source).toBe("genre");
    expect(r.tags).toContain("人妻");
  });

  it("extracts from description via dictionary only", () => {
    const r = extractAdultAttributeTags({
      officialDescription: "今回は女教師役のOLがNTRされる物語。動画やおすすめは省略。",
    });
    expect(r.tags).toEqual(expect.arrayContaining(["女教師", "OL", "NTR"]));
    expect(r.tags).not.toContain("動画");
    expect(r.tags).not.toContain("おすすめ");
  });

  it("does not invent tags without evidence text", () => {
    const r = extractAdultAttributeTags({
      officialTitle: "ある作品の紹介ページ",
      officialDescription: "詳細は公式を参照",
    });
    expect(r.tags).toEqual([]);
  });
});

describe("deriveWordPressTaxonomy adult tags", () => {
  it("puts adult attributes on tags and keeps performers out of tags by default", () => {
    const d = deriveWordPressTaxonomyFromEvidence({
      title: "巨乳人妻メンエス",
      labels: [
        { type: "actress", name: "奥田咲" },
        { type: "genre", name: "痴女" },
      ],
      officialDescription: "素人ナンパ風の企画",
    });
    expect(d.performers).toContain("奥田咲");
    expect(d.tags).toEqual(expect.arrayContaining(["巨乳", "人妻", "メンエス", "痴女"]));
    expect(d.tags).not.toContain("奥田咲");
    expect(d.categories).not.toEqual(expect.arrayContaining(["巨乳", "人妻", "メンエス"]));
  });

  it("keeps official series and never invents attribute series from genre", () => {
    const d = deriveWordPressTaxonomyFromEvidence({
      title: "奥田咲とエスワンベスト第6弾",
      labels: [
        { type: "actress", name: "奥田咲" },
        { type: "series", name: "エスワン" },
        { type: "genre", name: "ベスト・総集編" },
      ],
    });
    expect(d.seriesNames).toEqual(["エスワン"]);
    expect(d.seriesNames).not.toContain("ベスト・総集編");
    expect(d.categories).toContain("ベスト・総集編");
    expect(d.tags).toEqual(expect.arrayContaining(["ベスト", "総集編"]));
    expect(d.tags).not.toContain("奥田咲");
  });

  it("keeps adult tag デビュー and does not create attribute series デビュー作", () => {
    const d = deriveWordPressTaxonomyFromEvidence({
      title: "新人デビュー記念",
      labels: [{ type: "actress", name: "奥田咲" }],
    });
    expect(d.tags).toContain("デビュー");
    expect(d.tags).not.toContain("デビュー作");
    expect(d.seriesNames).not.toContain("デビュー作");
  });

  it("prefers genre over related_tag over title", () => {
    const r = extractAdultAttributeTags({
      genres: ["巨乳"],
      relatedTags: ["人妻"],
      officialTitle: "メンエス嬢",
    });
    expect(r.matches.find((m) => m.canonicalName === "巨乳")?.source).toBe("genre");
    expect(r.matches.find((m) => m.canonicalName === "人妻")?.source).toBe("related_tag");
    expect(r.matches.find((m) => m.canonicalName === "メンエス")?.source).toBe("title");
  });

  it("keeps distinct official related tags alongside dictionary matches", () => {
    const d = deriveWordPressTaxonomyFromEvidence({
      title: "巨乳人妻",
      labels: [
        { type: "genre", name: "痴女" },
        { type: "related_tag", name: "騎乗位" },
        { type: "related_tag", name: "フェラ" },
        { type: "related_tag", name: "手コキ" },
      ],
      officialDescription: "NTR要素あり",
    });
    expect(d.tags).toEqual(
      expect.arrayContaining(["痴女", "騎乗位", "フェラ", "手コキ", "巨乳", "人妻", "NTR"]),
    );
  });
});
