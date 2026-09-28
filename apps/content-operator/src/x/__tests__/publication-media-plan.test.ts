import { describe, expect, it } from "vitest";
import { planPostMediaIds } from "../publication-media-plan.js";

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
