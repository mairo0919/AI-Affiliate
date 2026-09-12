import { describe, expect, it } from "vitest";
import {
  mergeScheduleParametersPreservingCursor,
  resolveNextRunAtAfterCollection,
  resolveNextStartOffset,
  shouldSoftFillNow,
} from "./schedule-cursor.js";

describe("schedule-cursor", () => {
  it("preserves existing startOffset when merging defaults", () => {
    const merged = mergeScheduleParametersPreservingCursor(
      { hits: 100, maxPages: 1, startOffset: 1, sort: "date" },
      { hits: 50, startOffset: 201, floor: "videoa" },
    );
    expect(merged.startOffset).toBe(201);
    expect(merged.hits).toBe(100);
    expect(merged.sort).toBe("date");
    expect(merged.floor).toBe("videoa");
  });

  it("advances to job nextOffset while below soft target", () => {
    expect(
      resolveNextStartOffset({
        jobNextOffset: 101,
        hits: 100,
        currentOffset: 1,
        fetchedCount: 100,
        researchTotal: 150,
        softTarget: 500,
      }),
    ).toEqual({ startOffset: 101, wrapped: false, atSoftTarget: false });
  });

  it("wraps to offset 1 when soft target reached", () => {
    expect(
      resolveNextStartOffset({
        jobNextOffset: 201,
        hits: 100,
        currentOffset: 101,
        fetchedCount: 100,
        researchTotal: 500,
        softTarget: 500,
      }),
    ).toEqual({ startOffset: 1, wrapped: true, atSoftTarget: true });
  });

  it("uses soft-fill interval below target and cron when wrapped/at target", () => {
    const now = new Date("2026-09-12T07:00:00.000Z");
    const cron = new Date("2026-09-12T12:00:00.000Z");
    expect(
      resolveNextRunAtAfterCollection({
        now,
        cronNextRunAt: cron,
        researchTotal: 200,
        softTarget: 500,
        softFillIntervalMs: 15 * 60_000,
        wrapped: false,
      }).toISOString(),
    ).toBe("2026-09-12T07:15:00.000Z");
    expect(
      resolveNextRunAtAfterCollection({
        now,
        cronNextRunAt: cron,
        researchTotal: 500,
        softTarget: 500,
        softFillIntervalMs: 15 * 60_000,
        wrapped: false,
      }).toISOString(),
    ).toBe(cron.toISOString());
  });

  it("soft-fills only when below target and interval elapsed", () => {
    const now = new Date("2026-09-12T08:00:00.000Z");
    expect(
      shouldSoftFillNow({
        now,
        lastRunAt: new Date("2026-09-12T07:30:00.000Z"),
        nextRunAt: new Date("2026-09-12T12:00:00.000Z"),
        researchTotal: 200,
        softTarget: 500,
        softFillIntervalMs: 15 * 60_000,
      }),
    ).toBe(true);
    expect(
      shouldSoftFillNow({
        now,
        lastRunAt: new Date("2026-09-12T07:50:00.000Z"),
        nextRunAt: new Date("2026-09-12T12:00:00.000Z"),
        researchTotal: 200,
        softTarget: 500,
        softFillIntervalMs: 15 * 60_000,
      }),
    ).toBe(false);
  });

  it("does not soft-fill when nextRunAt is already due", () => {
    const now = new Date("2026-09-12T08:05:00.000Z");
    expect(
      shouldSoftFillNow({
        now,
        lastRunAt: new Date("2026-09-12T07:49:00.000Z"),
        nextRunAt: new Date("2026-09-12T08:04:00.000Z"),
        researchTotal: 101,
        softTarget: 500,
        softFillIntervalMs: 15 * 60_000,
      }),
    ).toBe(false);
  });
});
