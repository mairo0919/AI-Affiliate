/**
 * ARTICLE_PLAN title.facts — keep SOURCE work themes; demote bare genre/form fallback.
 */
import { describe, expect, it } from "vitest";
import {
  extractSourceTitleSafeThemes,
  isGenericTitleFallbackFact,
  isTitleEligibleFact,
  toTitleDisplayFact,
} from "../title-eligibility.js";
import { buildEvidencePack, claimStatementsFromPageEvidence } from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { buildArticlePlan } from "../article-plan.js";
import type { PageEvidenceMetaShape } from "../official-page-evidence-atoms.js";

function planFor(input: {
  productTitle: string;
  actors?: string[];
  description?: string;
  genres?: string[];
  series?: string;
}) {
  const pe = {
    productName: input.productTitle,
    description: input.description ? { text: input.description } : null,
    actors: input.actors ?? [],
    catalog: {
      genres: (input.genres ?? []).map((value) => ({
        value,
        provenance: "page",
        originField: "genre",
      })),
      series: input.series
        ? { value: input.series, provenance: "page", originField: "series" }
        : null,
    },
  } as PageEvidenceMetaShape;
  const claims = claimStatementsFromPageEvidence({
    pageEvidenceMeta: pe,
    productTitle: input.productTitle,
    actors: pe.actors,
  });
  const pack = buildEvidencePack({
    productTitle: input.productTitle,
    claims: claims.map((s, i) => ({ id: `c${i}`, statement: s, status: "SUPPORTED" as const })),
    pageEvidenceMeta: pe,
  });
  const profile = buildProductMaterialProfileFromPack(pack);
  const feas = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack,
    profile,
  });
  if (feas.deferred) {
    return {
      plan: null,
      claims,
      titleFacts: extractSourceTitleSafeThemes(input.productTitle),
      deferred: true as const,
      deferReason: feas.deferReason ?? null,
    };
  }
  const plan = buildArticlePlan({
    productTitle: input.productTitle,
    pack,
    assignment: feas.assignment,
    materialDepth: profile.materialDepth,
    profile,
  });
  return {
    plan,
    claims,
    titleFacts: plan.title.facts,
    deferred: false as const,
    deferReason: null,
  };
}

describe("title.facts SOURCE theme retention", () => {
  it("extracts contiguous SOURCE substrings only", () => {
    const src = "デカ尻挑発してくるパート家政婦BEST8時間";
    const themes = extractSourceTitleSafeThemes(src);
    expect(themes.length).toBeGreaterThan(0);
    expect(themes.every((t) => src.includes(t))).toBe(true);
    expect(themes.some((t) => /家政婦|BEST/u.test(t))).toBe(true);
    expect(themes.every((t) => !isGenericTitleFallbackFact(t))).toBe(true);
  });

  it("compacts unsafe dvaj situation into title-safe SOURCE theme", () => {
    const src = "夫婦喧嘩で家出してきた元カノと3年ぶりに再会";
    const display = toTitleDisplayFact(src);
    expect(display).toBeTruthy();
    expect(src.includes(display!)).toBe(true);
    expect(isTitleEligibleFact(display!, { productTitle: src })).toBe(true);
    expect(display).not.toMatch(/寝取り|NTR/);
  });

  it("fcss title.facts keep 家政婦BEST axis, not bare ベスト・総集編", () => {
    const { titleFacts, deferred } = planFor({
      productTitle: "デカ尻挑発してくるパート家政婦BEST8時間",
      actors: ["蘭華", "弥生みづき", "水川潤"],
      description:
        "家事代行サービスを呼んだら、むっちむちのデカ尻を無自覚に突き出してくる家政婦さんが来た！掃除中のピタパン尻にムラムラが止まらない！こだわりのお尻アングル撮影でアナル丸見え抜き差しもバッチリ。",
      genres: ["ベスト・総集編", "巨尻"],
    });
    expect(deferred).toBe(false);
    expect(titleFacts.some((f) => /家政婦|BEST/u.test(f))).toBe(true);
    expect(titleFacts).not.toContain("ベスト・総集編");
  });

  it("dvaj title.facts keep reunion/theme axis, not NTR genre shell", () => {
    const productTitle =
      "夫婦喧嘩で家出してきた元カノと3年ぶりに再会 人妻になってさらにエロくなったケツ肉で誘惑されあの頃と同じ安アパートで朝から晩までひたすら生中出しハメし続けた 幸村泉希";
    const themes = extractSourceTitleSafeThemes(productTitle);
    expect(themes.some((t) => /元カノ|再会|夫婦喧嘩|家出/.test(t))).toBe(true);
    expect(themes.every((t) => !isGenericTitleFallbackFact(t))).toBe(true);
    expect(themes.every((t) => t.length <= 36)).toBe(true);
    expect(isTitleEligibleFact(productTitle, { productTitle })).toBe(false);

    const pe = {
      productName: productTitle,
      actors: ["幸村泉希"],
      description: {
        text:
          "ある日、他の男と結婚したはずの元カノ・泉希が3年ぶりに突然やって来た。なし崩しでまた一緒に暮らし始めたのだが、目の前で美尻がぷりぷりと誘うように揺れる。",
      },
      catalog: {
        genres: [
          { value: "寝取り・寝取られ・NTR", provenance: "page", originField: "genre" },
          { value: "中出し", provenance: "page", originField: "genre" },
        ],
      },
    } as PageEvidenceMetaShape;
    const pack = buildEvidencePack({
      productTitle,
      claims: [
        { id: "c0", statement: "幸村泉希", status: "SUPPORTED" },
        { id: "c1", statement: themes[0]!, status: "SUPPORTED" },
        { id: "c2", statement: "寝取り・寝取られ・NTR", status: "SUPPORTED" },
      ],
      pageEvidenceMeta: pe,
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const feas = ensureFeasibleWritingSkeleton({
      skeleton: skeletonFromMaterialProfile(profile),
      pack,
      profile,
    });
    // If skeleton is feasible, Plan must not replace theme with NTR shell.
    if (!feas.deferred) {
      const plan = buildArticlePlan({
        productTitle,
        pack,
        assignment: feas.assignment,
        materialDepth: profile.materialDepth,
        profile,
      });
      expect(plan.title.facts.join(" ")).toMatch(/元カノ|再会|夫婦喧嘩|家出/);
      expect(plan.title.facts.every((f) => f.length <= 36)).toBe(true);
      expect(plan.title.facts).not.toContain("寝取り・寝取られ・NTR");
      expect(plan.title.facts.some((f) => f.includes("ケツ肉"))).toBe(false);
    }
  });
});
