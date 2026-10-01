import { describe, expect, it } from "vitest";
import {
  classifyLiveWordPressStatus,
  readScheduledInstant,
  shouldSyncInternalPublished,
} from "./wp-publish-status-sync.js";

describe("wordpress publish status sync", () => {
  it("syncs only a live publish status", () => {
    expect(classifyLiveWordPressStatus({ httpStatus: 200, liveStatus: "publish" })).toBe(
      "WP_PUBLISHED_INTERNAL_SCHEDULED",
    );
    expect(shouldSyncInternalPublished("WP_PUBLISHED_INTERNAL_SCHEDULED")).toBe(true);
  });

  it("keeps future, draft, and missing rows scheduled", () => {
    expect(classifyLiveWordPressStatus({ httpStatus: 200, liveStatus: "future" })).toBe(
      "WP_FUTURE_INTERNAL_SCHEDULED",
    );
    expect(classifyLiveWordPressStatus({ httpStatus: 200, liveStatus: "draft" })).toBe(
      "WP_DRAFT_INTERNAL_SCHEDULED",
    );
    expect(classifyLiveWordPressStatus({ httpStatus: 200, liveStatus: "pending" })).toBe(
      "WP_DRAFT_INTERNAL_SCHEDULED",
    );
    expect(classifyLiveWordPressStatus({ httpStatus: 404, liveStatus: null })).toBe("WP_MISSING");
    expect(classifyLiveWordPressStatus({ httpStatus: 500, liveStatus: null })).toBe("OTHER");
    expect(shouldSyncInternalPublished("WP_FUTURE_INTERNAL_SCHEDULED")).toBe(false);
    expect(shouldSyncInternalPublished("WP_DRAFT_INTERNAL_SCHEDULED")).toBe(false);
    expect(shouldSyncInternalPublished("WP_MISSING")).toBe(false);
    expect(shouldSyncInternalPublished("OTHER")).toBe(false);
  });

  it("is idempotent: only the publish class is eligible to change", () => {
    const again = classifyLiveWordPressStatus({ httpStatus: 200, liveStatus: "publish" });
    expect(shouldSyncInternalPublished(again)).toBe(true);
    expect(shouldSyncInternalPublished("WP_FUTURE_INTERNAL_SCHEDULED")).toBe(false);
  });

  it("reads the slot key when the column is empty", () => {
    const instant = readScheduledInstant({
      scheduledAt: null,
      platformMetadata: { publishSlotKey: "2026-10-05T12:00:00+09:00" },
    });
    expect(instant?.toISOString()).toBe("2026-10-05T03:00:00.000Z");
  });
});
