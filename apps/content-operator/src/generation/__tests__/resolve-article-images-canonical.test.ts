import { describe, expect, it, vi } from "vitest";
import { resolveArticleImagesForTopic } from "../resolve-article-images.js";

describe("resolveArticleImagesForTopic canonicalId fallback", () => {
  it("resolves ResearchImages via metadata.canonicalId when product/research links absent", async () => {
    const listResearchImagesByExternalIds = vi.fn(async () => [
      {
        id: "img-pl",
        imageType: "main_large",
        sourceUrl: "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/ofje00230/ofje00230pl.jpg",
        usageStatus: "REQUIRES_CONFIRMATION",
        researchItemExternalId: "ofje00230",
      },
      {
        id: "img-jp1",
        imageType: "sample_large",
        sourceUrl: "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/ofje00230/ofje00230jp-1.jpg",
        usageStatus: "REQUIRES_CONFIRMATION",
        researchItemExternalId: "ofje00230",
      },
    ]);

    const repo = {
      findTopicCandidate: vi.fn(async () => ({
        id: "topic1",
        title: "奥田咲ベスト",
        affiliateProductId: null,
        researchItemId: null,
        metadata: { canonicalId: "ofje00230", source: "ofje-density-v1-r1" },
      })),
      listResearchImagesByExternalIds,
      listSourceDocumentsImageReferencesByUrls: vi.fn(async () => []),
    };

    const out = await resolveArticleImagesForTopic(repo as never, "topic1");
    expect(listResearchImagesByExternalIds).toHaveBeenCalledWith(["ofje00230"]);
    expect(out.externalIdsTried).toEqual(["ofje00230"]);
    expect(out.researchImageCount).toBe(2);
    expect(out.images.some((i) => i.role === "hero")).toBe(true);
    expect(out.images.every((i) => i.usageStatus === "REQUIRES_CONFIRMATION")).toBe(true);
    expect(out.images.every((i) => i.displayMode === "url_reference")).toBe(true);
  });

  it("ignores synthetic density keys that are not product external ids", async () => {
    const repo = {
      findTopicCandidate: vi.fn(async () => ({
        id: "topic2",
        title: "t",
        affiliateProductId: null,
        researchItemId: null,
        metadata: {
          canonicalId: "ofje-density-v1-r1-cmtmpexs9000ts7x82mokg6aa",
        },
      })),
      listResearchImagesByExternalIds: vi.fn(async () => []),
    };
    const out = await resolveArticleImagesForTopic(repo as never, "topic2");
    expect(out.images).toEqual([]);
    expect(repo.listResearchImagesByExternalIds).not.toHaveBeenCalled();
  });
});
