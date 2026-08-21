import { describe, expect, it } from "vitest";
import { computeNextRetryAt, computeRetryDelaySeconds } from "./backoff.js";

describe("retry backoff", () => {
  it("computes exponential delay and respects max", () => {
    const random = () => 0.5; // jitter factor = 1.0
    expect(
      computeRetryDelaySeconds({
        retryAttempt: 0,
        baseDelaySeconds: 300,
        maxDelaySeconds: 3600,
        random,
      }),
    ).toBe(300);
    expect(
      computeRetryDelaySeconds({
        retryAttempt: 1,
        baseDelaySeconds: 300,
        maxDelaySeconds: 3600,
        random,
      }),
    ).toBe(600);
    expect(
      computeRetryDelaySeconds({
        retryAttempt: 10,
        baseDelaySeconds: 300,
        maxDelaySeconds: 3600,
        random,
      }),
    ).toBe(3600);
  });

  it("applies jitter within ±10%", () => {
    const low = computeRetryDelaySeconds({
      retryAttempt: 0,
      baseDelaySeconds: 1000,
      maxDelaySeconds: 10_000,
      random: () => 0,
    });
    const high = computeRetryDelaySeconds({
      retryAttempt: 0,
      baseDelaySeconds: 1000,
      maxDelaySeconds: 10_000,
      random: () => 0.999999,
    });
    expect(low).toBeCloseTo(900, 5);
    expect(high).toBeGreaterThan(1090);
    expect(high).toBeLessThanOrEqual(1100);
  });

  it("computes nextRetryAt from now", () => {
    const now = new Date("2026-07-28T00:00:00.000Z");
    const next = computeNextRetryAt({
      retryAttempt: 0,
      baseDelaySeconds: 300,
      maxDelaySeconds: 3600,
      now,
      random: () => 0.5,
    });
    expect(next.toISOString()).toBe("2026-07-28T00:05:00.000Z");
  });
});
