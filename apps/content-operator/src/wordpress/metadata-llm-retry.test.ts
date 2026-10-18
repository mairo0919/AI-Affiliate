import { describe, expect, it } from "vitest";
import { shouldCallMetadataLlm } from "./wordpress-publish-path.js";
import type { PublicationMetadata } from "./publication-metadata.js";

const now = new Date("2026-10-19T03:00:00Z");
const stored = { source: "llm" } as PublicationMetadata;

describe("shouldCallMetadataLlm", () => {
  it("calls once when there is no metadata yet", () => {
    expect(shouldCallMetadataLlm({ existing: null, existingQuality: null, metadataLlmAttemptedAt: null, now })).toBe(true);
  });

  it("does not call for failures the model cannot fix", () => {
    expect(
      shouldCallMetadataLlm({
        existing: stored,
        existingQuality: { failures: ["TAGS_MISSING", "PERFORMER_TAX_MISSING"] },
        metadataLlmAttemptedAt: null,
        now,
      }),
    ).toBe(false);
  });

  it("calls for an SEO failure at most once a day", () => {
    const quality = { failures: ["META_DESC_TOO_SHORT"] };
    expect(shouldCallMetadataLlm({ existing: stored, existingQuality: quality, metadataLlmAttemptedAt: null, now })).toBe(true);
    expect(
      shouldCallMetadataLlm({
        existing: stored,
        existingQuality: quality,
        metadataLlmAttemptedAt: "2026-10-19T02:59:00Z",
        now,
      }),
    ).toBe(false);
    expect(
      shouldCallMetadataLlm({
        existing: stored,
        existingQuality: quality,
        metadataLlmAttemptedAt: "2026-10-18T02:00:00Z",
        now,
      }),
    ).toBe(true);
  });
});
