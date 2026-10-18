import { describe, expect, it } from "vitest";
import {
  allocateXPostSlots,
  buildXPostSlotsForDay,
  countWaitingRecommendedSlots,
  listUpcomingXPostSlots,
  planXPostScheduleHorizon,
  type XScheduleCandidate,
} from "../x-post-schedule.js";

const HOURS = [21, 22, 23];

function pass(cid: string, rank: number, recommendedForDay: string | null = null): XScheduleCandidate {
  return { canonicalId: cid, contentVersionId: `cv-${cid}`, pass: true, rank, recommendedForDay };
}

describe("X recommended slot", () => {
  it("puts the day's recommended work at 22:00 and keeps it out of 21:00", () => {
    const plan = allocateXPostSlots({
      slots: buildXPostSlotsForDay({ dayKey: "2026-10-20", hours: HOURS, mainHour: 23 }),
      candidates: [pass("rec", 5, "2026-10-20"), pass("a", 0), pass("b", 1)],
      maxStandardPostsPerDay: 3,
      dayKey: "2026-10-20",
      recommendedHour: 22,
    });
    expect(plan.map((a) => [a.hour, a.candidate?.canonicalId ?? null])).toEqual([
      [21, "a"],
      [22, "rec"],
      [23, "b"],
    ]);
  });

  it("leaves 22:00 empty instead of filling it with normal work", () => {
    const plan = allocateXPostSlots({
      slots: buildXPostSlotsForDay({ dayKey: "2026-10-20", hours: HOURS, mainHour: 23 }),
      candidates: [pass("a", 0), pass("b", 1), pass("c", 2)],
      maxStandardPostsPerDay: 3,
      dayKey: "2026-10-20",
      recommendedHour: 22,
    });
    const slot22 = plan.find((a) => a.hour === 22)!;
    expect(slot22.status).toBe("EMPTY");
    expect(slot22.reason).toBe("recommended_not_ready");
    expect(plan.filter((a) => a.status === "ASSIGNED").map((a) => a.candidate?.canonicalId)).toEqual(["a", "b"]);
  });

  it("treats a past day's recommended work as normal work", () => {
    const plan = allocateXPostSlots({
      slots: buildXPostSlotsForDay({ dayKey: "2026-10-21", hours: HOURS, mainHour: 23 }),
      candidates: [pass("old-rec", 0, "2026-10-20")],
      maxStandardPostsPerDay: 3,
      dayKey: "2026-10-21",
      recommendedHour: 22,
    });
    expect(plan[0]!.candidate?.canonicalId).toBe("old-rec");
  });

  it("does not book later days' recommended slots in the horizon", () => {
    const now = new Date("2026-10-20T10:00:00+09:00");
    const plan = planXPostScheduleHorizon({
      now,
      candidates: ["a", "b", "c", "d", "e", "f", "g"].map((cid, i) => pass(cid, i)),
      maxStandardPostsPerDay: 3,
      hours: HOURS,
      mainHour: 23,
      dayCount: 3,
      recommendedHour: 22,
    });
    const booked22 = plan.filter((a) => a.hour === 22 && a.status === "ASSIGNED");
    expect(booked22).toEqual([]);
    expect(plan.filter((a) => a.status === "ASSIGNED")).toHaveLength(6);
  });

  it("counts later days' recommended slots as waiting so no copy is generated for them yet", () => {
    const slots = listUpcomingXPostSlots({
      now: new Date("2026-10-20T10:00:00+09:00"),
      dayCount: 3,
      hours: HOURS,
      mainHour: 23,
    });
    expect(countWaitingRecommendedSlots(slots, 22, "2026-10-20")).toBe(2);
    expect(countWaitingRecommendedSlots(slots, null, "2026-10-20")).toBe(0);
  });
});
