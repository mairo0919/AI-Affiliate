/**
 * 2026-11-27: the 関連タグ row text carried the chips' own markup, which became WordPress tags
 * such as border-gray-300 and class="border.
 */
import { describe, expect, it } from "vitest";
import { extractPageCatalogEvidence } from "../fanza-page-catalog.js";

describe("page catalog related tags", () => {
  it("keeps the tag words and drops the chips' markup", () => {
    const html =
      '<div>関連タグ： フェラ 熟女 &lt;a class="border border-gray-300 py-0.5 px-1 rounded text-xs text-blue-800 hover:text-red-800"&gt;巨乳&lt;/a&gt;</div>';
    const tags = extractPageCatalogEvidence({ html, jsonLdNodes: [] }).relatedTags.map((t) => t.value);
    expect(tags).toEqual(expect.arrayContaining(["フェラ", "熟女"]));
    expect(tags.filter((t) => /border|class|px-1|rounded|text-|hover|</.test(t))).toEqual([]);
  });
});

describe("officialRelatedTagNames on evidence stored before the fix", () => {
  it("stops at the first markup token", async () => {
    const { officialRelatedTagNames } = await import("../fanza-page-catalog.js");
    const tag = (value: string) => ({ value, provenance: "page_dom" as const, originField: "dom.detail.関連タグ" });
    const names = officialRelatedTagNames({ relatedTags: ["フェラ", "熟女", "<a", 'class="border', "border-gray-300", "px-1"].map(tag) } as never);
    expect(names).toEqual(["フェラ", "熟女"]);
  });
});
