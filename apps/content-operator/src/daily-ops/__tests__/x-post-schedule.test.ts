import { describe, expect, it } from "vitest";
import {
  allocateXPostSlots,
  buildXPostSlotsForDay,
  chooseOpenXSlotForTick,
  dedupeXScheduleCandidates,
  isFutureXSlotInstant,
  jstSlotToUtcIso,
  listUpcomingXPostSlots,
  mayConsumeCandidateForSlot,
  parseXPostExtraSlotTimesJst,
  parseXPostSlotHoursJst,
  planXPostScheduleHorizon,
  tokyoDayKeyOf,
  type XScheduleCandidate,
} from "../x-post-schedule.js";

function pass(cid: string, rank = 0, cv?: string): XScheduleCandidate {
  return { canonicalId: cid, contentVersionId: cv ?? `cv-${cid}`, pass: true, rank };
}

function fail(cid: string, reason: string): XScheduleCandidate {
  return { canonicalId: cid, pass: false, skipReason: reason };
}

/** JST wall → Instant (OS TZ independent). */
function atJst(day: string, hour: number, minute = 0): Date {
  const p = (n: number) => String(n).padStart(2, "0");
  return new Date(`${day}T${p(hour)}:${p(minute)}:00+09:00`);
}

describe("x-post-schedule", () => {
  const slots = buildXPostSlotsForDay({ dayKey: "2026-09-14" });

  it("defaults to 15 and 21 JST with 21 as MAIN", () => {
    expect(slots.map((s) => ({ hour: s.hour, role: s.role }))).toEqual([
      { hour: 15, role: "SECONDARY" },
      { hour: 21, role: "MAIN" },
    ]);
    expect(slots[1]?.slotKey).toBe("2026-09-14T21:00:00+09:00");
  });

  it("parses X_POST_SLOTS_JST", () => {
    expect(parseXPostSlotHoursJst("15,21")).toEqual([15, 21]);
    expect(parseXPostSlotHoursJst(undefined)).toEqual([15, 21]);
  });

  it("JST slot → UTC is fixed (not OS timezone)", () => {
    expect(jstSlotToUtcIso("2026-09-14", 15)).toBe("2026-09-14T06:00:00.000Z");
    expect(jstSlotToUtcIso("2026-09-14", 21)).toBe("2026-09-14T12:00:00.000Z");
    expect(atJst("2026-09-14", 15).toISOString()).toBe("2026-09-14T06:00:00.000Z");
    expect(atJst("2026-09-14", 21).toISOString()).toBe("2026-09-14T12:00:00.000Z");
  });

  it("sole PASS reserves 15:00 and leaves 21:00 open", () => {
    const plan = allocateXPostSlots({
      slots,
      candidates: [pass("only-one"), fail("thin", "SOCIAL_CONTENT_TOO_THIN")],
      maxPostsPerDay: 2,
    });
    expect(plan.find((p) => p.hour === 15)?.status).toBe("ASSIGNED");
    expect(plan.find((p) => p.hour === 15)?.role).toBe("SECONDARY");
    expect(plan.find((p) => p.hour === 15)?.candidate?.canonicalId).toBe("only-one");
    expect(plan.find((p) => p.hour === 21)?.status).toBe("EMPTY");
    expect(plan.find((p) => p.hour === 21)?.reason).toBe("no_pass_for_main");
  });

  it("DAILY_X_POSTS=2 assigns 15:00 SECONDARY and 21:00 MAIN", () => {
    const plan = allocateXPostSlots({
      slots,
      candidates: [pass("best", 0), pass("second", 1), pass("third", 2)],
      maxPostsPerDay: 2,
    });
    expect(plan.find((p) => p.hour === 15)?.role).toBe("SECONDARY");
    expect(plan.find((p) => p.hour === 15)?.candidate?.canonicalId).toBe("best");
    expect(plan.find((p) => p.hour === 21)?.role).toBe("MAIN");
    expect(plan.find((p) => p.hour === 21)?.candidate?.canonicalId).toBe("second");
    expect(plan.filter((p) => p.status === "ASSIGNED")).toHaveLength(2);
  });

  it("never assigns non-PASS (SOCIAL_CONTENT_TOO_THIN / WP_NOT_PUBLIC)", () => {
    const plan = allocateXPostSlots({
      slots,
      candidates: [
        fail("a", "SOCIAL_CONTENT_TOO_THIN"),
        fail("b", "WP_NOT_PUBLIC"),
      ],
      maxPostsPerDay: 2,
    });
    expect(plan.every((p) => p.status === "EMPTY")).toBe(true);
    expect(plan.find((p) => p.hour === 21)?.reason).toBe("no_pass_candidates");
  });

  it("dedupes same CID and ContentVersion", () => {
    const deduped = dedupeXScheduleCandidates([
      pass("cid1", 0, "cv1"),
      pass("CID1", 1, "cv2"),
      pass("cid2", 2, "cv1"),
      pass("cid3", 3, "cv3"),
    ]);
    expect(deduped.map((c) => c.canonicalId)).toEqual(["cid1", "cid3"]);
  });

  it("respects maxPostsPerDay=1 by reserving only the earliest slot", () => {
    const plan = allocateXPostSlots({
      slots,
      candidates: [pass("a"), pass("b")],
      maxPostsPerDay: 1,
    });
    expect(plan.find((p) => p.hour === 15)?.candidate?.canonicalId).toBe("a");
    expect(plan.find((p) => p.hour === 21)?.status).toBe("EMPTY");
    expect(plan.find((p) => p.hour === 21)?.reason).toBe("daily_max_reached");
  });

  it("when MAIN already filled, secondary may use remaining PASS", () => {
    const plan = allocateXPostSlots({
      slots,
      candidates: [pass("afternoon")],
      maxPostsPerDay: 2,
      filledHours: [21],
    });
    expect(plan.find((p) => p.hour === 21)?.status).toBe("SKIP_SLOT");
    expect(plan.find((p) => p.hour === 15)?.candidate?.canonicalId).toBe("afternoon");
  });

  it("mayConsumeCandidateForSlot allows 15:00 to take the sole PASS", () => {
    expect(
      mayConsumeCandidateForSlot({
        targetRole: "SECONDARY",
        passCountAvailable: 1,
        mainSlotStillOpen: true,
      }).ok,
    ).toBe(true);
    expect(
      mayConsumeCandidateForSlot({
        targetRole: "MAIN",
        passCountAvailable: 1,
        mainSlotStillOpen: true,
      }).ok,
    ).toBe(true);
  });

  it("chooseOpenXSlotForTick never returns past slots (no late catch-up)", () => {
    const now = atJst("2026-09-14", 22, 0);
    const pick = chooseOpenXSlotForTick({ slots, now, filledHours: [] });
    expect(pick).toBeNull();
  });

  it("chooseOpenXSlotForTick returns next future slot before 15:00", () => {
    const now = atJst("2026-09-14", 14, 0);
    const pick = chooseOpenXSlotForTick({ slots, now, filledHours: [] });
    expect(pick?.hour).toBe(15);
  });
});

describe("x-post-schedule boundary cases (JST)", () => {
  const day = "2026-09-14";
  const next = "2026-09-15";

  it("CASE 1: 14:00 + 2 PASS → today 15:00 and today 21:00", () => {
    const now = atJst(day, 14, 0);
    const plan = planXPostScheduleHorizon({
      now,
      candidates: [pass("a", 0), pass("b", 1)],
      maxPostsPerDay: 2,
      dayCount: 2,
    });
    const todayAssigned = plan.filter((p) => p.status === "ASSIGNED" && p.dayKey === day);
    expect(todayAssigned).toHaveLength(2);
    expect(todayAssigned.find((a) => a.hour === 15)?.candidate?.canonicalId).toBe("a");
    expect(todayAssigned.find((a) => a.hour === 21)?.candidate?.canonicalId).toBe("b");
    expect(todayAssigned.every((a) => isFutureXSlotInstant(a.scheduledAt, now))).toBe(true);
    expect(todayAssigned.every((a) => a.scheduledAt.getTime() > now.getTime())).toBe(true);
  });

  it("CASE 2: 14:00 + 1 PASS → reserve today 15:00, leave 21:00 open", () => {
    const now = atJst(day, 14, 0);
    const plan = planXPostScheduleHorizon({
      now,
      candidates: [pass("only")],
      maxPostsPerDay: 2,
      dayCount: 2,
    });
    const assigned = plan.filter((p) => p.status === "ASSIGNED");
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.hour).toBe(15);
    expect(assigned[0]?.role).toBe("SECONDARY");
    expect(assigned[0]?.dayKey).toBe(day);
    expect(assigned[0]?.candidate?.canonicalId).toBe("only");
    const main = plan.find((p) => p.dayKey === day && p.hour === 21);
    expect(main?.status).toBe("EMPTY");
    expect(main?.reason).toBe("no_pass_for_main");
    expect(plan.some((p) => p.dayKey === next && p.status === "ASSIGNED")).toBe(false);
  });

  it("CASE 3: 16:00 + 2 PASS → skip past 15:00; today 21:00; rest tomorrow; no immediate", () => {
    const now = atJst(day, 16, 0);
    const upcoming = listUpcomingXPostSlots({ now, dayCount: 2 });
    expect(upcoming.some((s) => s.slotKey.startsWith(`${day}T15:`))).toBe(false);
    expect(upcoming.some((s) => s.slotKey.startsWith(`${day}T21:`))).toBe(true);

    const plan = planXPostScheduleHorizon({
      now,
      candidates: [pass("a", 0), pass("b", 1)],
      maxPostsPerDay: 2,
      dayCount: 2,
    });
    const assigned = plan.filter((p) => p.status === "ASSIGNED");
    expect(assigned.some((a) => a.dayKey === day && a.hour === 15)).toBe(false);
    expect(assigned.find((a) => a.dayKey === day && a.hour === 21)?.candidate?.canonicalId).toBe(
      "a",
    );
    // remainder → next day earliest open slot (15:00), not held for 21:00
    expect(assigned.find((a) => a.dayKey === next && a.hour === 15)?.candidate?.canonicalId).toBe(
      "b",
    );
    expect(plan.find((a) => a.dayKey === next && a.hour === 21)?.status).toBe("EMPTY");
    expect(assigned.every((a) => a.scheduledAt.getTime() > now.getTime())).toBe(true);
    // 16:00 is not a publish instant
    expect(assigned.every((a) => a.hour === 15 || a.hour === 21)).toBe(true);
  });

  it("CASE 4: 20:00 + PASS → today 21:00 only; no immediate at 20:00", () => {
    const now = atJst(day, 20, 0);
    const plan = planXPostScheduleHorizon({
      now,
      candidates: [pass("main-cand"), pass("extra")],
      maxPostsPerDay: 2,
      dayCount: 2,
    });
    const assigned = plan.filter((p) => p.status === "ASSIGNED");
    expect(assigned.find((a) => a.dayKey === day && a.hour === 21)?.candidate?.canonicalId).toBe(
      "main-cand",
    );
    expect(assigned.every((a) => a.scheduledAt.getTime() > now.getTime())).toBe(true);
    expect(assigned.every((a) => a.scheduledAt.getTime() !== now.getTime())).toBe(true);
  });

  it("CASE 5: 22:00 + PASS → no today slots; roll to tomorrow; sole PASS → tomorrow 15:00", () => {
    const now = atJst(day, 22, 0);
    expect(tokyoDayKeyOf(now)).toBe(day);
    const upcoming = listUpcomingXPostSlots({ now, dayCount: 2 });
    expect(upcoming.every((s) => !s.slotKey.startsWith(day))).toBe(true);

    const planOne = planXPostScheduleHorizon({
      now,
      candidates: [pass("only")],
      maxPostsPerDay: 2,
      dayCount: 2,
    });
    const one = planOne.filter((p) => p.status === "ASSIGNED");
    expect(one).toHaveLength(1);
    expect(one[0]?.dayKey).toBe(next);
    expect(one[0]?.hour).toBe(15);
    expect(one[0]?.candidate?.canonicalId).toBe("only");

    const planTwo = planXPostScheduleHorizon({
      now,
      candidates: [pass("a", 0), pass("b", 1)],
      maxPostsPerDay: 2,
      dayCount: 2,
    });
    const two = planTwo.filter((p) => p.status === "ASSIGNED");
    expect(two.find((a) => a.dayKey === next && a.hour === 15)?.candidate?.canonicalId).toBe("a");
    expect(two.find((a) => a.dayKey === next && a.hour === 21)?.candidate?.canonicalId).toBe("b");
    expect(two.every((a) => a.scheduledAt.getTime() > now.getTime())).toBe(true);
  });

  it("duplicate: same CID never on both 15 and 21", () => {
    const now = atJst(day, 14, 0);
    const plan = planXPostScheduleHorizon({
      now,
      candidates: [pass("same", 0, "cv-same"), pass("same", 1, "cv-other")],
      maxPostsPerDay: 2,
      dayCount: 1,
    });
    const assigned = plan.filter((p) => p.status === "ASSIGNED");
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.hour).toBe(15);
  });

  it("duplicate: usedCanonicalIds / usedContentVersionIds block re-reserve", () => {
    const now = atJst(day, 14, 0);
    const plan = planXPostScheduleHorizon({
      now,
      candidates: [pass("a", 0, "cv-a"), pass("b", 1, "cv-b")],
      maxPostsPerDay: 2,
      usedCanonicalIds: ["a"],
      usedContentVersionIds: ["cv-b"],
      dayCount: 1,
    });
    const assigned = plan.filter((p) => p.status === "ASSIGNED");
    expect(assigned).toHaveLength(0);
  });

  it("filledSlotKeys prevent re-booking SCHEDULED slots", () => {
    const now = atJst(day, 14, 0);
    const plan = planXPostScheduleHorizon({
      now,
      candidates: [pass("a"), pass("b")],
      maxPostsPerDay: 2,
      filledSlotKeys: new Set([`${day}T21:00:00+09:00`]),
      dayCount: 1,
    });
    const assigned = plan.filter((p) => p.status === "ASSIGNED");
    expect(assigned.every((a) => a.hour !== 21)).toBe(true);
    expect(assigned.find((a) => a.hour === 15)?.candidate?.canonicalId).toBe("a");
  });

  it("daily max 2 never exceeded across assigned slots for a day", () => {
    const now = atJst(day, 14, 0);
    const plan = planXPostScheduleHorizon({
      now,
      candidates: [pass("a"), pass("b"), pass("c"), pass("d")],
      maxPostsPerDay: 2,
      dayCount: 1,
    });
    const todayAssigned = plan.filter((p) => p.status === "ASSIGNED" && p.dayKey === day);
    expect(todayAssigned).toHaveLength(2);
  });

  it("parses extra HH:MM times", () => {
    expect(parseXPostExtraSlotTimesJst("23:52,23:58")).toEqual([
      { hour: 23, minute: 52 },
      { hour: 23, minute: 58 },
    ]);
  });

  it("date-scoped extra HH:MM slots apply only on that day and promote MAIN when 21 past", () => {
    const now = atJst("2026-09-14", 23, 40);
    const upcoming = listUpcomingXPostSlots({
      now,
      dayCount: 2,
      extraDayKey: "2026-09-14",
      extraTimes: [
        { hour: 23, minute: 50 },
        { hour: 23, minute: 56 },
      ],
    });
    const today = upcoming.filter((s) => s.slotKey.startsWith("2026-09-14"));
    const tomorrow = upcoming.filter((s) => s.slotKey.startsWith("2026-09-15"));
    expect(today.map((s) => s.slotKey)).toEqual([
      "2026-09-14T23:50:00+09:00",
      "2026-09-14T23:56:00+09:00",
    ]);
    expect(today.every((s) => s.kind === "EXTRA")).toBe(true);
    expect(today.at(-1)?.role).toBe("MAIN");
    expect(tomorrow.map((s) => ({ hour: s.hour, role: s.role, kind: s.kind }))).toEqual([
      { hour: 15, role: "SECONDARY", kind: "STANDARD" },
      { hour: 21, role: "MAIN", kind: "STANDARD" },
    ]);
  });

  it("same-hour minute extras do not collide in allocation", () => {
    const now = atJst("2026-09-14", 23, 40);
    const plan = planXPostScheduleHorizon({
      now,
      candidates: [pass("a", 0), pass("b", 1)],
      maxPostsPerDay: 2,
      maxExtraPostsPerDay: 2,
      hardCapPerDay: 4,
      extraDayKey: "2026-09-14",
      extraTimes: [
        { hour: 23, minute: 50 },
        { hour: 23, minute: 56 },
      ],
      dayCount: 1,
    });
    const assigned = plan.filter((p) => p.status === "ASSIGNED");
    expect(assigned).toHaveLength(2);
    expect(new Set(assigned.map((a) => a.slotKey)).size).toBe(2);
    expect(assigned.map((a) => a.candidate?.canonicalId).sort()).toEqual(["a", "b"]);
    expect(assigned.every((a) => a.kind === "EXTRA")).toBe(true);
  });

  it("EXTRA quota is separate from DAILY_X_POSTS; hard cap 4 keeps regular slots", () => {
    const now = atJst("2026-09-15", 0, 10);
    const plan = planXPostScheduleHorizon({
      now,
      candidates: [pass("a", 0), pass("b", 1), pass("c", 2), pass("d", 3), pass("e", 4)],
      maxStandardPostsPerDay: 2,
      maxExtraPostsPerDay: 2,
      hardCapPerDay: 4,
      extraDayKey: "2026-09-15",
      extraTimes: [
        { hour: 0, minute: 15 },
        { hour: 0, minute: 30 },
      ],
      dayCount: 1,
    });
    const assigned = plan.filter((p) => p.status === "ASSIGNED");
    expect(assigned).toHaveLength(4);
    expect(assigned.filter((a) => a.kind === "EXTRA")).toHaveLength(2);
    expect(assigned.filter((a) => a.kind === "STANDARD")).toHaveLength(2);
    expect(assigned.some((a) => a.slotKey.includes("T15:00:00"))).toBe(true);
    expect(assigned.some((a) => a.slotKey.includes("T21:00:00"))).toBe(true);
    expect(new Set(assigned.map((a) => a.candidate?.canonicalId)).size).toBe(4);
  });

  it("filled EXTRA does not consume regular quota for 15/21", () => {
    const now = atJst("2026-09-15", 1, 0);
    const plan = planXPostScheduleHorizon({
      now,
      candidates: [pass("a", 0), pass("b", 1)],
      maxStandardPostsPerDay: 2,
      maxExtraPostsPerDay: 2,
      hardCapPerDay: 4,
      filledSlotKeys: new Set([
        "2026-09-15T00:15:00+09:00",
        "2026-09-15T00:30:00+09:00",
      ]),
      extraDayKey: "2026-09-15",
      extraTimes: [
        { hour: 0, minute: 15 },
        { hour: 0, minute: 30 },
      ],
      dayCount: 1,
    });
    const assigned = plan.filter((p) => p.status === "ASSIGNED");
    expect(assigned).toHaveLength(2);
    expect(assigned.every((a) => a.kind === "STANDARD")).toBe(true);
    expect(assigned.map((a) => a.hour).sort((x, y) => x - y)).toEqual([15, 21]);
  });
});
