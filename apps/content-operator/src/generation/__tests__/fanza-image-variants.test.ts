import { describe, expect, it } from "vitest";
import { imageContentKey, selectArticleImagesWithReport } from "../article-images.js";
import {
  parseImageDimensions,
  proposeMaxOfficialImageUrl,
} from "../fanza-image-variants.js";
import { rewriteHtmlImageUrls } from "../../wordpress/upgrade-wp-image-resolution.js";

describe("imageContentKey underscore CIDs", () => {
  it("groups package ps/pl for h_1711… ids", () => {
    const ps = imageContentKey(
      "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084ps.jpg",
    );
    const pl = imageContentKey(
      "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084pl.jpg",
    );
    expect(ps?.contentKey).toBe("h_1711mgtd00084:package");
    expect(pl?.contentKey).toBe("h_1711mgtd00084:package");
    expect(pl!.qualityHint).toBeGreaterThan(ps!.qualityHint);
  });

  it("groups strip and jp sample variants for underscore CIDs", () => {
    const strip = imageContentKey(
      "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084-10.jpg",
    );
    const jp = imageContentKey(
      "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084jp-10.jpg",
    );
    expect(strip?.contentKey).toBe("h_1711mgtd00084:sample:10");
    expect(jp?.contentKey).toBe("h_1711mgtd00084:sample:10");
    expect(jp!.qualityHint).toBeGreaterThan(strip!.qualityHint);
  });

  it("selectArticleImages keeps only max variant for underscore CIDs", () => {
    const report = selectArticleImagesWithReport({
      researchImages: [
        {
          id: "1",
          imageType: "sample_small",
          sourceUrl:
            "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084-1.jpg",
          usageStatus: "ALLOWED",
        },
        {
          id: "2",
          imageType: "sample_large",
          sourceUrl:
            "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084jp-1.jpg",
          usageStatus: "ALLOWED",
        },
        {
          id: "3",
          imageType: "main_small",
          sourceUrl:
            "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084ps.jpg",
          usageStatus: "ALLOWED",
        },
        {
          id: "4",
          imageType: "main_large",
          sourceUrl:
            "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084pl.jpg",
          usageStatus: "ALLOWED",
        },
      ],
    });
    const urls = report.selected.map((s) => s.sourceUrl);
    expect(urls.some((u) => u.includes("jp-1"))).toBe(true);
    expect(urls.some((u) => u.includes("pl.jpg"))).toBe(true);
    expect(urls.some((u) => /mgtd00084-1\.jpg$/.test(u))).toBe(false);
    expect(urls.some((u) => u.endsWith("ps.jpg"))).toBe(false);
  });
});

describe("proposeMaxOfficialImageUrl", () => {
  it("upgrades ps→pl and strip→jp", () => {
    const pkg = proposeMaxOfficialImageUrl(
      "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/ofje00230/ofje00230ps.jpg",
    );
    expect(pkg?.toUrl).toContain("ofje00230pl.jpg");
    const strip = proposeMaxOfficialImageUrl(
      "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084-3.jpg",
    );
    expect(strip?.toUrl).toContain("h_1711mgtd00084jp-3.jpg");
  });
});

describe("parseImageDimensions", () => {
  it("reads PNG IHDR", () => {
    // Minimal 1x1 PNG
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
      "hex",
    );
    expect(parseImageDimensions(png)).toEqual({ width: 1, height: 1 });
  });
});

describe("rewriteHtmlImageUrls", () => {
  it("replaces src and drops duplicate content-key figures", () => {
    const html = [
      `<figure class="blog-sample"><img src="https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084-1.jpg" /></figure>`,
      `<figure class="blog-sample"><img src="https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084jp-1.jpg" /></figure>`,
      `<p>本文は残る</p>`,
    ].join("\n");
    const map = new Map([
      [
        "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084-1.jpg",
        "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084jp-1.jpg",
      ],
    ]);
    const out = rewriteHtmlImageUrls(html, map);
    expect(out.replacedCount).toBe(1);
    expect(out.removedDuplicateCount).toBe(1);
    expect(out.html).toContain("jp-1.jpg");
    expect(out.html).toContain("本文は残る");
    expect(out.html.match(/<figure/g)?.length).toBe(1);
  });
});
