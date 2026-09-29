import { describe, expect, it } from "vitest";
import { planPostMediaIds, resolveRootMediaUrl } from "../publication-media-plan.js";

describe("ROOT product image attachment", () => {
  it("requires mediaIds on ROOT when a product image URL was resolved", () => {
    expect(
      planPostMediaIds({
        isRoot: true,
        mediaUrl: "https://pics.dmm.co.jp/digital/video/example/examplepl.jpg",
        uploadedMediaId: "media-1",
      }),
    ).toEqual(["media-1"]);
  });

  it("refuses a text-only ROOT after an image URL was resolved", () => {
    expect(() =>
      planPostMediaIds({
        isRoot: true,
        mediaUrl: "https://pics.dmm.co.jp/digital/video/example/examplepl.jpg",
        uploadedMediaId: null,
      }),
    ).toThrow(/ROOT mediaIds is empty/);
  });

  it("allows a text-only ROOT when no image was available", () => {
    expect(
      planPostMediaIds({
        isRoot: true,
        mediaUrl: null,
        uploadedMediaId: null,
      }),
    ).toBeUndefined();
  });

  it("recovers an ALLOWED research image when the frozen snapshot has no media URL", () => {
    const url = resolveRootMediaUrl({
      snapshotUrl: null,
      fallbackImages: [
        {
          role: "auxiliary",
          sourceUrl: "https://pics.dmm.co.jp/digital/video/example/examplejp-1.jpg",
          imageType: "sample_large",
          researchImageId: "img-1",
          usageStatus: "ALLOWED",
          adopted: true,
          excludeReason: null,
          altText: "商品画像",
        },
      ],
    });
    expect(url).toContain("examplejp-1.jpg");
  });

  it("stays text-only when neither the snapshot nor official images have a URL", () => {
    expect(resolveRootMediaUrl({ snapshotUrl: null, fallbackImages: [] })).toBeNull();
  });

  it("never attaches an image to the CTA", () => {
    expect(
      planPostMediaIds({
        isRoot: false,
        mediaUrl: "https://pics.dmm.co.jp/digital/video/example/examplepl.jpg",
        uploadedMediaId: "media-1",
      }),
    ).toBeUndefined();
  });
});
