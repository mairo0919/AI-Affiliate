import { describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import { MockXPublishingProvider } from "../providers/mock-provider.js";
import { prepareArticleImageForXUpload } from "../live/x-media-prepare.js";
import { JUVR00281_FROZEN_SMOKE } from "../one-shot-live-smoke.js";

loadConfig({ requireDatabaseUrl: false });

describe("X media upload + createPost media_ids", () => {
  it("mock uploadMedia is idempotent and createPost accepts mediaIds", async () => {
    const mock = new MockXPublishingProvider({ accountId: "acc-1", username: "t" });
    const a = await mock.uploadMedia!({
      sourceUrl: JUVR00281_FROZEN_SMOKE.mediaUrl,
      idempotencyKey: "media-1",
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      mimeType: "image/jpeg",
    });
    const b = await mock.uploadMedia!({
      sourceUrl: JUVR00281_FROZEN_SMOKE.mediaUrl,
      idempotencyKey: "media-1",
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      mimeType: "image/jpeg",
    });
    expect(a.mediaId).toBe(b.mediaId);

    const post = await mock.createPost({
      text: JUVR00281_FROZEN_SMOKE.body,
      mediaIds: [a.mediaId],
      idempotencyKey: "post-1",
    });
    expect(post.postId).toBeTruthy();
  });

  it("frozen smoke body has affiliate URL and no #PR", () => {
    expect(JUVR00281_FROZEN_SMOKE.body).toContain(JUVR00281_FROZEN_SMOKE.affiliateUrl);
    expect(/#PR\b/i.test(JUVR00281_FROZEN_SMOKE.body)).toBe(false);
    expect(JUVR00281_FROZEN_SMOKE.mediaMode).toBe("SAFE_IMAGE");
    expect(JUVR00281_FROZEN_SMOKE.mediaRole).toBe("hero");
  });

  it("prepareArticleImageForXUpload sniffs jpeg and skips scale under limit", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, ...Buffer.alloc(100)]);
    const prepared = await prepareArticleImageForXUpload({
      sourceUrl: "https://example.test/x.jpg",
      bytes: jpeg,
      mimeType: "application/octet-stream",
    });
    expect(prepared.mimeType).toBe("image/jpeg");
    expect(prepared.scaled).toBe(false);
  });
});
