import { describe, expect, it } from "vitest";
import {
  assertReservationExpiresAtInvariant,
  computeXProductReservationExpiresAt,
  shouldExpireReservationForPublication,
} from "./x-reservation-lifecycle.js";

describe("computeXProductReservationExpiresAt invariant", () => {
  const ttlMinutes = 30;
  const publishGraceMinutes = 180;

  it("A: created 9/14, scheduled 9/16 15:00 JST → ACTIVE through scheduledAt", () => {
    const createdAt = new Date("2026-09-14T03:00:00.000Z");
    const scheduledAt = new Date("2026-09-16T06:00:00.000Z"); // 15:00 JST
    const expiresAt = computeXProductReservationExpiresAt({
      now: createdAt,
      scheduledAt,
      ttlMinutes,
      publishGraceMinutes,
    });
    expect(expiresAt.getTime()).toBeGreaterThan(scheduledAt.getTime());
    expect(expiresAt.toISOString()).toBe("2026-09-16T09:00:00.000Z"); // scheduledAt+3h
  });

  it("B: created 9/14, scheduled 9/17 21:00 JST → ACTIVE through scheduledAt", () => {
    const createdAt = new Date("2026-09-14T03:00:00.000Z");
    const scheduledAt = new Date("2026-09-17T12:00:00.000Z"); // 21:00 JST
    const expiresAt = computeXProductReservationExpiresAt({
      now: createdAt,
      scheduledAt,
      ttlMinutes,
      publishGraceMinutes,
    });
    expect(expiresAt.getTime()).toBeGreaterThan(scheduledAt.getTime());
    expect(expiresAt.toISOString()).toBe("2026-09-17T15:00:00.000Z");
  });

  it("G: STANDARD and EXTRA future slots both survive create-time TTL", () => {
    const createdAt = new Date("2026-09-14T03:00:00.000Z");
    const standard = new Date("2026-09-16T06:00:00.000Z");
    const extra = new Date("2026-09-15T01:00:00.000Z"); // EXTRA earlier same week
    for (const scheduledAt of [standard, extra]) {
      const expiresAt = computeXProductReservationExpiresAt({
        now: createdAt,
        scheduledAt,
        ttlMinutes,
        publishGraceMinutes,
      });
      expect(expiresAt.getTime()).toBeGreaterThan(scheduledAt.getTime());
      // Flat NOW()+24h would be 9/15 03:00Z — must not win for STANDARD
      const flatRepair = new Date(createdAt.getTime() + 24 * 60 * 60_000);
      if (scheduledAt.getTime() > flatRepair.getTime()) {
        expect(expiresAt.getTime()).toBeGreaterThan(flatRepair.getTime());
      }
    }
  });

  it("rejects flat NOW()+24h when it would land before scheduledAt", () => {
    const scheduledAt = new Date("2026-09-17T12:00:00.000Z");
    const bad = new Date("2026-09-16T00:35:00.000Z"); // classic bad repair
    expect(() =>
      assertReservationExpiresAtInvariant({ expiresAt: bad, scheduledAt }),
    ).toThrow(/expiresAt invariant violated/);
  });

  it("uses now+TTL when that exceeds scheduledAt+grace", () => {
    const now = new Date("2026-09-16T05:00:00.000Z");
    const scheduledAt = new Date("2026-09-16T06:00:00.000Z");
    const expiresAt = computeXProductReservationExpiresAt({
      now,
      scheduledAt,
      ttlMinutes: 24 * 60,
      publishGraceMinutes: 180,
    });
    expect(expiresAt.toISOString()).toBe("2026-09-17T05:00:00.000Z");
  });
});

describe("shouldExpireReservationForPublication", () => {
  const grace = 180;
  const now = new Date("2026-09-16T01:00:00.000Z");
  const shortExpires = new Date("2026-09-16T00:35:00.000Z");

  it("C: before scheduledAt — future SCHEDULED reservation is not expired (extend)", () => {
    const scheduledAt = new Date("2026-09-16T06:00:00.000Z");
    const decision = shouldExpireReservationForPublication({
      now,
      expiresAt: shortExpires,
      publication: { status: "SCHEDULED", scheduledAt },
      publishGraceMinutes: grace,
    });
    expect(decision.expire).toBe(false);
    expect(decision.reason).toBe("future-scheduled-keep-alive");
    expect(decision.extendExpiresAt?.toISOString()).toBe("2026-09-16T09:00:00.000Z");
  });

  it("D: scheduledAt + grace exceeded — unused reservation expires", () => {
    const scheduledAt = new Date("2026-09-15T06:00:00.000Z");
    const decision = shouldExpireReservationForPublication({
      now: new Date("2026-09-15T10:00:00.000Z"), // past scheduledAt+3h
      expiresAt: new Date("2026-09-15T06:30:00.000Z"),
      publication: { status: "SCHEDULED", scheduledAt },
      publishGraceMinutes: grace,
    });
    expect(decision.expire).toBe(true);
    expect(decision.reason).toBe("scheduled-grace-exceeded");
  });

  it("E: terminal publication allows cleanup", () => {
    for (const status of ["PUBLISHED", "CANCELLED", "DELETED", "PUBLISHED_UNVERIFIED"]) {
      const decision = shouldExpireReservationForPublication({
        now,
        expiresAt: shortExpires,
        publication: {
          status,
          scheduledAt: new Date("2026-09-20T06:00:00.000Z"),
        },
        publishGraceMinutes: grace,
      });
      expect(decision.expire).toBe(true);
      expect(decision.reason).toBe("terminal-publication");
    }
  });
});
