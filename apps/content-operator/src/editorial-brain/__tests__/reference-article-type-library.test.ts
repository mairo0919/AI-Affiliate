/**
 * Reference article-type library — LLM=0.
 */

import { describe, expect, it } from "vitest";
import {
  classifyArticleType,
  articleTypesCompatibleForSkeleton,
} from "../../article-pattern/reference-article-type.js";
import {
  writingSkeletonForArticleType,
  assertSkeletonNotCrossApplied,
  RANKING_WRITING_SKELETON,
} from "../../article-pattern/article-type-writing-skeleton.js";
import {
  getReferenceLibraryEntriesForType,
  getReferenceLibraryEntryById,
} from "../../article-pattern/reference-library/index.js";
import { noteExternalReferenceForNaturalIntro } from "../../article-pattern/natural-product-intro-policy.js";

describe("reference article-type library (LLM=0)", () => {
  it("classifies osusume staff 2553 as ranking", () => {
    expect(
      classifyArticleType({
        url: "https://osusume.dmm.co.jp/articles/staff/2553/",
        title: "松本いちかの人気・名作AVトップ10【2025年06月更新】",
        headingOutline: ["松本いちかの人気作品ランキングTOP10", "1位:...", "2位:..."],
      }),
    ).toBe("ranking");
  });

  it("keeps ranking entry in library and isolates from single_product", () => {
    const entry = getReferenceLibraryEntryById("osusume.dmm.co.jp/articles/staff/2553");
    expect(entry).toBeTruthy();
    expect(entry!.articleType).toBe("ranking");
    expect(entry!.applicableGenerationTypes).toEqual(["ranking"]);
    expect(entry!.writingSkeleton.articleType).toBe("ranking");
    // No verbatim long prose blobs stored
    const blob = JSON.stringify(entry);
    expect(blob).not.toMatch(/この作品は、小柄で華奢なボディの松本いちかが、史上最多/);
    expect(getReferenceLibraryEntriesForType("ranking")).toHaveLength(1);
    expect(getReferenceLibraryEntriesForType("single_product")).toHaveLength(0);
  });

  it("ranking skeleton must not apply to single_product generation", () => {
    expect(articleTypesCompatibleForSkeleton("single_product", "ranking")).toBe(false);
    expect(
      assertSkeletonNotCrossApplied({
        generationArticleType: "single_product",
        skeleton: RANKING_WRITING_SKELETON,
      }).ok,
    ).toBe(false);
    expect(writingSkeletonForArticleType("single_product").articleType).toBe("single_product");
  });

  it("natural-intro note keeps ranking as library learning target", () => {
    const note = noteExternalReferenceForNaturalIntro({
      url: "https://osusume.dmm.co.jp/articles/staff/2553/",
      fetched: true,
      observedGenre: "ranking_listicle",
    });
    expect(note.usableAsProductIntroSkeleton).toBe(false);
    expect(note.note).toMatch(/Reference Library articleType=ranking/);
  });
});
