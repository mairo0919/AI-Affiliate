import { describe, expect, it } from "vitest";
import {
  readScheduledInstant,
  shouldPromoteScheduledWordPressTarget,
} from "./wp-publish-status-sync.js";

describe("wordpress publish status sync", () => {
  const now = new Date("2026-10-05T03:30:00.000Z");

  it("promotes only a due post that WordPress has already published", () => {
    expect(
      shouldPromoteScheduledWordPressTarget({
        syncPublishStatus: true,
        scheduledAt: new Date("2026-10-05T03:00:00.000Z"),
        now,
        liveStatus: "publish",
      }),
    ).toBe(true);
  });

  it("leaves future slots and unmarked reservations alone", () => {
    expect(
      shouldPromoteScheduledWordPressTarget({
        syncPublishStatus: false,
        scheduledAt: new Date("2026-10-01T03:00:00.000Z"),
        now,
        liveStatus: "publish",
      }),
    ).toBe(false);
    expect(
      shouldPromoteScheduledWordPressTarget({
        syncPublishStatus: true,
        scheduledAt: new Date("2026-10-05T12:00:00.000Z"),
        now,
        liveStatus: "publish",
      }),
    ).toBe(false);
    expect(
      shouldPromoteScheduledWordPressTarget({
        syncPublishStatus: true,
        scheduledAt: new Date("2026-10-05T03:00:00.000Z"),
        now,
        liveStatus: "future",
      }),
    ).toBe(false);
  });

  it("reads the slot key when the column is empty", () => {
    const instant = readScheduledInstant({
      scheduledAt: null,
      platformMetadata: { publishSlotKey: "2026-10-05T12:00:00+09:00" },
    });
    expect(instant?.toISOString()).toBe("2026-10-05T03:00:00.000Z");
  });
});
