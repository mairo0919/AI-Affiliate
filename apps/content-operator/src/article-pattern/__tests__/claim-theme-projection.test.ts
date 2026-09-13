/**
 * Claims bootstrap must project official productName / series / runtime themes
 * so BEST/総集編 titles are not performer+genre shells only.
 */
import { describe, expect, it } from "vitest";
import { claimStatementsFromPageEvidence } from "../evidence-pack.js";
import type { PageEvidenceMetaShape } from "../official-page-evidence-atoms.js";

describe("claimStatementsFromPageEvidence — official theme projection", () => {
  it("projects productName theme for BEST/家政婦 (not performer flood only)", () => {
    const pe = {
      productName: "デカ尻挑発してくるパート家政婦BEST8時間",
      actors: ["蘭華", "弥生みづき", "水川潤", "藤沢麗央"],
      catalog: {
        durationMinutes: {
          value: 496,
          provenance: "page",
          originField: "catalog.duration",
        },
        genres: [
          { value: "ベスト・総集編", provenance: "page", originField: "genre" },
          { value: "巨尻", provenance: "page", originField: "genre" },
        ],
      },
      description: {
        text:
          "家事代行サービスを呼んだら、むっちむちのデカ尻を無自覚に突き出してくる家政婦さんが来た！こだわりのお尻アングル撮影でアナル丸見え。",
      },
      extractMode: "jsonld",
      fetchMode: "browser_fallback",
    } as PageEvidenceMetaShape & { extractMode: string; fetchMode: string };

    const claims = claimStatementsFromPageEvidence({
      pageEvidenceMeta: pe,
      productTitle: pe.productName!,
      actors: pe.actors,
      maxClaims: 8,
    });

    expect(claims.some((c) => /家政婦|デカ尻/.test(c))).toBe(true);
    expect(claims.filter((c) => pe.actors!.includes(c)).length).toBeLessThanOrEqual(2);
    expect(claims.some((c) => c === "ベスト・総集編") && claims.length === 1).toBe(false);
  });

  it("projects series theme for single-performer NTR works", () => {
    const pe = {
      productName:
        "セックスレスの妻が義父に寝取られて、嫌なのに久しぶりのチ●ポに発情してしまった話 天馬ゆい",
      actors: ["天馬ゆい"],
      catalog: {
        series: {
          value:
            "セックスレスの妻が義父に寝取られて、嫌なのに久しぶりのチ●ポに発情してしまった話",
          provenance: "page",
          originField: "series",
        },
        durationMinutes: {
          value: 134,
          provenance: "page",
          originField: "duration",
        },
        genres: [
          { value: "寝取り・寝取られ・NTR", provenance: "page", originField: "genre" },
        ],
      },
      description: {
        text:
          "お互いにセックスしたいが、夫が多忙でなかなかできない夫妻。夫が出勤したあと、義父が突然訪問してくる。",
      },
    } as PageEvidenceMetaShape;

    const claims = claimStatementsFromPageEvidence({
      pageEvidenceMeta: pe,
      productTitle: pe.productName!,
      actors: pe.actors,
    });

    expect(claims.some((c) => /セックスレス|義父|寝取/.test(c))).toBe(true);
    expect(claims).toContain("天馬ゆい");
  });

  it("uses productName when official synopsis is missing (DVD box set)", () => {
    const pe = {
      productName:
        "熟女大学 SUPER BEST 最愛の妻を寝取られて…人妻NTR総集編 8作品960分フル尺収録DVD4枚組",
      actors: ["わか菜ほの", "森沢かな（飯岡かなこ）", "小早川怜子"],
      catalog: {
        durationMinutes: {
          value: 961,
          provenance: "page",
          originField: "duration",
        },
        genres: [
          { value: "ベスト・総集編", provenance: "page", originField: "genre" },
          { value: "寝取り・寝取られ・NTR", provenance: "page", originField: "genre" },
        ],
      },
      description: null,
      extractMode: "jsonld+gallery",
      fetchMode: "browser_fallback",
    } as PageEvidenceMetaShape & { extractMode: string; fetchMode: string };

    const claims = claimStatementsFromPageEvidence({
      pageEvidenceMeta: pe,
      productTitle: pe.productName!,
      actors: pe.actors,
    });

    expect(claims.some((c) => /NTR|寝取|人妻|8作品|960分|SUPER BEST/i.test(c))).toBe(
      true,
    );
    expect(claims.length).toBeGreaterThan(0);
  });
});
