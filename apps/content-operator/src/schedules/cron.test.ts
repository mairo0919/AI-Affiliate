import { describe, expect, it } from "vitest";
import {
  CronValidationError,
  assertValidCronExpression,
  computeNextRunAt,
  isWithinGraceWindow,
} from "./cron.js";

describe("cron utils", () => {
  it("accepts valid 5-field cron expressions", () => {
    expect(assertValidCronExpression("0 8 * * *")).toBe("0 8 * * *");
    expect(assertValidCronExpression("*/5 * * * *")).toBe("*/5 * * * *");
  });

  it("rejects invalid cron expressions", () => {
    expect(() => assertValidCronExpression("not a cron")).toThrow(CronValidationError);
    expect(() => assertValidCronExpression("0 8 * *")).toThrow(CronValidationError);
    expect(() => assertValidCronExpression("0 8 * * * *")).toThrow(CronValidationError);
    expect(() => assertValidCronExpression("99 8 * * *")).toThrow(CronValidationError);
  });

  it("computes nextRunAt with timezone Asia/Tokyo", () => {
    // 2026-07-27 15:00 UTC = 2026-07-28 00:00 JST
    const after = new Date("2026-07-27T15:00:00.000Z");
    const next = computeNextRunAt({
      cronExpression: "0 8 * * *",
      timezone: "Asia/Tokyo",
      after,
    });
    // Next 08:00 JST after midnight JST on 2026-07-28 is 2026-07-28 08:00 JST = 2026-07-27 23:00 UTC
    expect(next.toISOString()).toBe("2026-07-27T23:00:00.000Z");
  });

  it("detects grace window membership", () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    const within = new Date("2026-07-28T11:50:00.000Z");
    const outside = new Date("2026-07-28T11:00:00.000Z");
    expect(isWithinGraceWindow(within, now, 15 * 60 * 1000)).toBe(true);
    expect(isWithinGraceWindow(outside, now, 15 * 60 * 1000)).toBe(false);
  });
});
