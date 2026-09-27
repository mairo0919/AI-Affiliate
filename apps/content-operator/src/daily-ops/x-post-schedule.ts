/**
 * Fixed X posting schedule (JST):
 * - Regular: max DAILY_X_POSTS (default 2) — SECONDARY 15:00 + MAIN 21:00
 * - Optional date-scoped EXTRA HH:MM slots with a separate quota
 * - Hard cap = regular + extra (default 4 when extras present)
 * - Fill open future slots in wall-clock order so 15:00 is not skipped to save a PASS for 21:00
 * - SKIP thin / non-public — never force-post
 * - Past slots are never backfilled
 * - Same CID / ContentVersion must not be assigned twice
 */

export const DEFAULT_X_POST_SLOT_HOURS_JST = [15, 21] as const;
export const DEFAULT_X_MAIN_POST_SLOT_HOUR_JST = 21;
export const DEFAULT_X_POSTS_PER_DAY = 2;

export type XPostSlotRole = "MAIN" | "SECONDARY";
export type XPostSlotKind = "STANDARD" | "EXTRA";

export type XPostTimeSlot = {
  hour: number;
  role: XPostSlotRole;
  /** STANDARD = regular DAILY_X_POSTS budget; EXTRA = date-scoped separate budget. */
  kind: XPostSlotKind;
  /** e.g. 2026-09-14T21:00:00+09:00 */
  slotKey: string;
  at: Date;
};

export type XScheduleCandidate = {
  canonicalId: string;
  contentVersionId?: string | null;
  /** True only after social/WP gates PASS — false means SKIP (do not force). */
  pass: boolean;
  skipReason?: string | null;
  /** Lower is better (optional). */
  rank?: number;
};

export type XSlotAssignmentStatus = "ASSIGNED" | "EMPTY" | "SKIP_SLOT";

export type XSlotAssignment = {
  hour: number;
  role: XPostSlotRole;
  kind: XPostSlotKind;
  slotKey: string;
  scheduledAt: Date;
  status: XSlotAssignmentStatus;
  candidate: XScheduleCandidate | null;
  reason: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseXPostSlotHoursJst(
  raw: string | undefined,
  fallback: readonly number[] = DEFAULT_X_POST_SLOT_HOURS_JST,
): number[] {
  if (!raw?.trim()) return [...fallback];
  const hours = raw
    .split(/[,:\s]+/)
    .map((p) => Number.parseInt(p.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 23);
  const unique = [...new Set(hours)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : [...fallback];
}

/** One-day-only HH:MM extras. Example: "23:52,23:58". */
export type XPostExtraSlotTime = { hour: number; minute: number };

export function parseXPostExtraSlotTimesJst(raw: string | undefined): XPostExtraSlotTime[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: XPostExtraSlotTime[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(part.trim());
    if (!m) continue;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) continue;
    const key = `${hour}:${minute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ hour, minute });
  }
  return out.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
}

export function parseXPostExtraSlotsDayJst(raw: string | undefined): string | null {
  const day = raw?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function slotRoleForHour(
  hour: number,
  mainHour: number = DEFAULT_X_MAIN_POST_SLOT_HOUR_JST,
): XPostSlotRole {
  return hour === mainHour ? "MAIN" : "SECONDARY";
}

/** Build civil-time slots for a Tokyo dayKey (YYYY-MM-DD). */
export function buildXPostSlotsForDay(input: {
  dayKey: string;
  hours?: readonly number[];
  mainHour?: number;
  /** Only applied when equal to dayKey — never leaks to other days. */
  extraDayKey?: string | null;
  extraTimes?: readonly XPostExtraSlotTime[];
}): XPostTimeSlot[] {
  const hours = [...(input.hours ?? DEFAULT_X_POST_SLOT_HOURS_JST)].sort((a, b) => a - b);
  const mainHour = input.mainHour ?? DEFAULT_X_MAIN_POST_SLOT_HOUR_JST;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.dayKey.trim());
  if (!m) throw new Error(`invalid dayKey: ${input.dayKey}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dayKey = `${year}-${pad2(month)}-${pad2(day)}`;
  const slots: XPostTimeSlot[] = hours.map((hour) => {
    const slotKey = `${dayKey}T${pad2(hour)}:00:00+09:00`;
    return {
      hour,
      role: slotRoleForHour(hour, mainHour),
      kind: "STANDARD" as const,
      slotKey,
      at: new Date(slotKey),
    };
  });

  const extrasApply =
    Boolean(input.extraDayKey) &&
    input.extraDayKey === dayKey &&
    (input.extraTimes?.length ?? 0) > 0;
  if (extrasApply) {
    const standardKeys = new Set(slots.map((s) => s.slotKey));
    for (const t of input.extraTimes ?? []) {
      const slotKey = `${dayKey}T${pad2(t.hour)}:${pad2(t.minute)}:00+09:00`;
      if (standardKeys.has(slotKey)) continue;
      slots.push({
        hour: t.hour,
        role: "SECONDARY",
        kind: "EXTRA",
        slotKey,
        at: new Date(slotKey),
      });
      standardKeys.add(slotKey);
    }
  }

  return slots.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** When open slots have no MAIN (e.g. 21:00 already past), promote the latest. Prefer STANDARD. */
export function ensureMainSlotPresent(slots: XPostTimeSlot[]): XPostTimeSlot[] {
  if (slots.length === 0) return slots;
  if (slots.some((s) => s.role === "MAIN")) return slots;
  const preferStandard = slots.filter((s) => s.kind !== "EXTRA");
  const pool = preferStandard.length > 0 ? preferStandard : slots;
  const latest = [...pool].sort((a, b) => a.at.getTime() - b.at.getTime()).at(-1);
  if (!latest) return slots;
  return slots.map((s) => (s.slotKey === latest.slotKey ? { ...s, role: "MAIN" as const } : s));
}

function candidateKey(c: XScheduleCandidate): string {
  return `${c.canonicalId.toLowerCase()}|${c.contentVersionId ?? ""}`;
}

/**
 * Deduplicate by CID and ContentVersion (hard ban within allocation).
 * Keeps first occurrence in input order.
 */
export function dedupeXScheduleCandidates(
  candidates: XScheduleCandidate[],
  usedCanonicalIds?: Iterable<string>,
  usedContentVersionIds?: Iterable<string>,
): XScheduleCandidate[] {
  const usedCid = new Set(
    [...(usedCanonicalIds ?? [])].map((c) => c.trim().toLowerCase()).filter(Boolean),
  );
  const usedCv = new Set(
    [...(usedContentVersionIds ?? [])].map((c) => c.trim()).filter(Boolean),
  );
  const seenKey = new Set<string>();
  const out: XScheduleCandidate[] = [];
  for (const c of candidates) {
    const cid = c.canonicalId.trim().toLowerCase();
    if (!cid) continue;
    if (usedCid.has(cid)) continue;
    const cv = c.contentVersionId?.trim() || null;
    if (cv && usedCv.has(cv)) continue;
    const key = candidateKey({ ...c, canonicalId: cid, contentVersionId: cv });
    if (seenKey.has(key) || seenKey.has(`${cid}|`)) continue;
    // Also block second row with same CID even if CV differs
    if ([...seenKey].some((k) => k.startsWith(`${cid}|`))) continue;
    if (cv && [...seenKey].some((k) => k.endsWith(`|${cv}`))) continue;
    seenKey.add(key);
    usedCid.add(cid);
    if (cv) usedCv.add(cv);
    out.push({ ...c, canonicalId: cid, contentVersionId: cv });
  }
  return out;
}

function sortPass(candidates: XScheduleCandidate[]): XScheduleCandidate[] {
  return [...candidates].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
}

/**
 * Core allocation:
 * 1. Open slots are filled in wall-clock order (15:00 SECONDARY before 21:00 MAIN)
 * 2. Each open slot takes the next PASS while its quota remains
 * 3. A sole PASS is reserved on the earliest open slot, not held back for a later MAIN
 * 4. Non-PASS never assigned (SKIP / force-post forbidden)
 * 5. STANDARD and EXTRA use separate quotas; total hard-capped
 * Keys by slotKey (not hour) so same-hour minute extras do not collide.
 */
export function allocateXPostSlots(input: {
  slots: XPostTimeSlot[];
  candidates: XScheduleCandidate[];
  /** Max STANDARD assignments for the day (default 2). Legacy alias: maxPostsPerDay. */
  maxPostsPerDay?: number;
  maxStandardPostsPerDay?: number;
  /** Max EXTRA assignments for the day (default 0). */
  maxExtraPostsPerDay?: number;
  /** Total STANDARD+EXTRA hard cap (default = standard + extra). */
  hardCapPerDay?: number;
  /** Hours already filled today (SCHEDULED/PUBLISHED) — legacy hour granularity. */
  filledHours?: ReadonlySet<number> | readonly number[];
  /** Preferred: exact slotKeys already booked. */
  filledSlotKeys?: ReadonlySet<string> | Iterable<string>;
  usedCanonicalIds?: Iterable<string>;
  usedContentVersionIds?: Iterable<string>;
}): XSlotAssignment[] {
  const maxStandard = Math.max(
    0,
    Math.min(
      input.maxStandardPostsPerDay ?? input.maxPostsPerDay ?? DEFAULT_X_POSTS_PER_DAY,
      10,
    ),
  );
  const maxExtra = Math.max(0, Math.min(input.maxExtraPostsPerDay ?? 0, 10));
  const hardCap = Math.max(
    0,
    Math.min(input.hardCapPerDay ?? maxStandard + maxExtra, 20),
  );
  const filledHours = new Set(
    input.filledHours instanceof Set
      ? [...input.filledHours]
      : [...(input.filledHours ?? [])],
  );
  const filledKeys = new Set(
    input.filledSlotKeys instanceof Set
      ? [...input.filledSlotKeys]
      : [...(input.filledSlotKeys ?? [])],
  );
  const isFilled = (s: XPostTimeSlot) =>
    filledKeys.has(s.slotKey) ||
    // Legacy: hour fill only applies to exact :00 standard slots.
    (filledHours.has(s.hour) && /T\d{2}:00:00\+09:00$/.test(s.slotKey));

  const deduped = dedupeXScheduleCandidates(
    input.candidates,
    input.usedCanonicalIds,
    input.usedContentVersionIds,
  );
  const pass = sortPass(deduped.filter((c) => c.pass));

  const byKey = new Map<string, XSlotAssignment>();
  let assignedStandard = 0;
  let assignedExtra = 0;
  let assignedCount = 0;

  const kindOf = (s: XPostTimeSlot): XPostSlotKind => s.kind ?? "STANDARD";
  const canAssign = (kind: XPostSlotKind): boolean => {
    if (assignedCount >= hardCap) return false;
    if (kind === "EXTRA") return assignedExtra < maxExtra;
    return assignedStandard < maxStandard;
  };
  const markAssigned = (kind: XPostSlotKind) => {
    assignedCount += 1;
    if (kind === "EXTRA") assignedExtra += 1;
    else assignedStandard += 1;
  };
  const budgetExhaustedReason = (kind: XPostSlotKind): string => {
    if (kind === "EXTRA") {
      if (assignedExtra >= maxExtra) return "extra_quota_reached";
      return "daily_hard_cap_reached";
    }
    if (assignedStandard >= maxStandard) return "daily_max_reached";
    return "daily_hard_cap_reached";
  };

  const push = (a: XSlotAssignment) => {
    byKey.set(a.slotKey, a);
  };

  // Earliest open slot first. Do not park the only PASS on a later MAIN.
  const queue = [...pass];
  const ordered = [...input.slots].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const slot of ordered) {
    const kind = kindOf(slot);
    if (isFilled(slot)) {
      push({
        hour: slot.hour,
        role: slot.role,
        kind,
        slotKey: slot.slotKey,
        scheduledAt: slot.at,
        status: "SKIP_SLOT",
        candidate: null,
        reason: "already_filled",
      });
      continue;
    }
    const allowed = canAssign(kind);
    const cand = allowed ? queue.shift() ?? null : null;
    if (cand) {
      markAssigned(kind);
      push({
        hour: slot.hour,
        role: slot.role,
        kind,
        slotKey: slot.slotKey,
        scheduledAt: slot.at,
        status: "ASSIGNED",
        candidate: cand,
        reason:
          kind === "EXTRA"
            ? "extra_slot"
            : slot.role === "MAIN"
              ? "main_slot"
              : "secondary_slot",
      });
    } else {
      push({
        hour: slot.hour,
        role: slot.role,
        kind,
        slotKey: slot.slotKey,
        scheduledAt: slot.at,
        status: "EMPTY",
        candidate: null,
        reason: pass.length === 0
          ? "no_pass_candidates"
          : !allowed
            ? budgetExhaustedReason(kind)
            : slot.role === "MAIN"
              ? "no_pass_for_main"
              : "no_pass_for_secondary",
      });
    }
  }

  // Stable wall-clock order
  return input.slots.map((s) => {
    const existing = byKey.get(s.slotKey);
    if (existing) return existing;
    return {
      hour: s.hour,
      role: s.role,
      kind: kindOf(s),
      slotKey: s.slotKey,
      scheduledAt: s.at,
      status: "EMPTY" as const,
      candidate: null,
      reason: "unplanned_slot",
    };
  });
}

/**
 * A PASS may be reserved on the slot being planned, including 15:00 SECONDARY.
 * Holding the only PASS for a later MAIN is what left same-day 15:00 without a reservation.
 */
export function mayConsumeCandidateForSlot(input: {
  targetRole: XPostSlotRole;
  passCountAvailable: number;
  mainSlotStillOpen: boolean;
}): { ok: boolean; reason: string } {
  void input.passCountAvailable;
  void input.mainSlotStillOpen;
  if (input.targetRole === "MAIN") {
    return { ok: true, reason: "main_may_consume" };
  }
  return { ok: true, reason: "secondary_may_consume" };
}

/** Tokyo wall-clock hour for Instant. */
export function tokyoHourOf(now: Date, timeZone = "Asia/Tokyo"): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  });
  return Number(fmt.format(now));
}

/**
 * Pick the next *future* open slot for this tick.
 * Past slots are never returned — no late catch-up / immediate backfill.
 */
export function chooseOpenXSlotForTick(input: {
  slots: XPostTimeSlot[];
  filledHours?: ReadonlySet<number> | readonly number[];
  now: Date;
}): XPostTimeSlot | null {
  const filled = new Set(
    input.filledHours instanceof Set
      ? [...input.filledHours]
      : [...(input.filledHours ?? [])],
  );
  const openFuture = input.slots
    .filter((s) => !filled.has(s.hour) && s.at.getTime() > input.now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  return openFuture[0] ?? null;
}

/** Tokyo civil dayKey (YYYY-MM-DD) for Instant. */
export function tokyoDayKeyOf(now: Date, timeZone = "Asia/Tokyo"): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return `${bag.year}-${bag.month}-${bag.day}`;
}

function addTokyoDays(dayKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey.trim());
  if (!m) throw new Error(`invalid dayKey: ${dayKey}`);
  const base = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`);
  const next = new Date(base.getTime() + days * 86_400_000);
  return tokyoDayKeyOf(next);
}

/**
 * Upcoming JST slots strictly after `now` (no past / no late catch-up).
 * OS timezone independent — wall clock via +09:00 / Asia/Tokyo.
 */
export function listUpcomingXPostSlots(input: {
  now: Date;
  /** Calendar days to scan including today (default 3). */
  dayCount?: number;
  hours?: readonly number[];
  mainHour?: number;
  /** Already booked slotKeys (e.g. 2026-09-14T21:00:00+09:00). */
  filledSlotKeys?: ReadonlySet<string> | Iterable<string>;
  /** Date-scoped extras: only injected when dayKey === extraDayKey. */
  extraDayKey?: string | null;
  extraTimes?: readonly XPostExtraSlotTime[];
}): XPostTimeSlot[] {
  const dayCount = Math.max(1, Math.min(input.dayCount ?? 3, 14));
  const filled = new Set(
    input.filledSlotKeys instanceof Set
      ? [...input.filledSlotKeys]
      : [...(input.filledSlotKeys ?? [])],
  );
  const startDay = tokyoDayKeyOf(input.now);
  const out: XPostTimeSlot[] = [];
  for (let d = 0; d < dayCount; d++) {
    const dayKey = addTokyoDays(startDay, d);
    const daySlots = ensureMainSlotPresent(
      buildXPostSlotsForDay({
        dayKey,
        hours: input.hours,
        mainHour: input.mainHour,
        extraDayKey: input.extraDayKey,
        extraTimes: input.extraTimes,
      }).filter((slot) => {
        if (slot.at.getTime() <= input.now.getTime()) return false;
        if (filled.has(slot.slotKey)) return false;
        return true;
      }),
    );
    out.push(...daySlots);
  }
  return out;
}

export type XHorizonAssignment = XSlotAssignment & {
  dayKey: string;
};

/**
 * Multi-day horizon allocation (boundary-aware):
 * - Never assigns past slots
 * - Never implies immediate backfill
 * - Per Tokyo day: earliest open slot first (15:00 SECONDARY, then 21:00 MAIN)
 * - Sole PASS reserves the earliest open future slot
 * - Leftover PASS rolls to later days' earliest upcoming slots
 */
export function planXPostScheduleHorizon(input: {
  now: Date;
  candidates: XScheduleCandidate[];
  maxPostsPerDay?: number;
  maxStandardPostsPerDay?: number;
  maxExtraPostsPerDay?: number;
  hardCapPerDay?: number;
  dayCount?: number;
  hours?: readonly number[];
  mainHour?: number;
  filledSlotKeys?: ReadonlySet<string> | Iterable<string>;
  usedCanonicalIds?: Iterable<string>;
  usedContentVersionIds?: Iterable<string>;
  extraDayKey?: string | null;
  extraTimes?: readonly XPostExtraSlotTime[];
}): XHorizonAssignment[] {
  const upcoming = listUpcomingXPostSlots({
    now: input.now,
    dayCount: input.dayCount,
    hours: input.hours,
    mainHour: input.mainHour,
    filledSlotKeys: input.filledSlotKeys,
    extraDayKey: input.extraDayKey,
    extraTimes: input.extraTimes,
  });

  const byDay = new Map<string, XPostTimeSlot[]>();
  for (const slot of upcoming) {
    const dayKey = slot.slotKey.slice(0, 10);
    const list = byDay.get(dayKey) ?? [];
    list.push(slot);
    byDay.set(dayKey, list);
  }

  const usedCid = new Set(
    [...(input.usedCanonicalIds ?? [])].map((c) => c.trim().toLowerCase()).filter(Boolean),
  );
  const usedCv = new Set(
    [...(input.usedContentVersionIds ?? [])].map((c) => c.trim()).filter(Boolean),
  );

  let pool = dedupeXScheduleCandidates(input.candidates, usedCid, usedCv).filter((c) => c.pass);
  const out: XHorizonAssignment[] = [];

  const maxStandard =
    input.maxStandardPostsPerDay ?? input.maxPostsPerDay ?? DEFAULT_X_POSTS_PER_DAY;
  const configuredExtra = input.maxExtraPostsPerDay;
  const extraTimesLen = input.extraTimes?.length ?? 0;

  const dayKeys = [...byDay.keys()].sort();
  for (const dayKey of dayKeys) {
    const daySlots = byDay.get(dayKey) ?? [];
    if (daySlots.length === 0 || pool.length === 0) continue;

    const isExtraDay = Boolean(input.extraDayKey) && input.extraDayKey === dayKey;
    const maxExtra =
      configuredExtra != null
        ? isExtraDay
          ? configuredExtra
          : 0
        : isExtraDay
          ? extraTimesLen
          : 0;
    const hardCap =
      input.hardCapPerDay != null
        ? isExtraDay
          ? input.hardCapPerDay
          : maxStandard
        : maxStandard + maxExtra;

    const dayPlan = allocateXPostSlots({
      slots: daySlots,
      candidates: pool,
      maxStandardPostsPerDay: maxStandard,
      maxExtraPostsPerDay: maxExtra,
      hardCapPerDay: hardCap,
      usedCanonicalIds: usedCid,
      usedContentVersionIds: usedCv,
    });

    for (const a of dayPlan) {
      if (a.status === "ASSIGNED" && a.candidate) {
        usedCid.add(a.candidate.canonicalId.toLowerCase());
        if (a.candidate.contentVersionId) usedCv.add(a.candidate.contentVersionId);
      }
      out.push({ ...a, dayKey });
    }

    pool = pool.filter((c) => {
      const cid = c.canonicalId.toLowerCase();
      if (usedCid.has(cid)) return false;
      if (c.contentVersionId && usedCv.has(c.contentVersionId)) return false;
      return true;
    });
  }

  return out;
}

/** True when scheduled Instant is strictly in the future (no late publishNow). */
export function isFutureXSlotInstant(scheduledAt: Date, now: Date): boolean {
  return scheduledAt.getTime() > now.getTime();
}

/** JST civil slot → UTC ISO (OS timezone independent). */
export function jstSlotToUtcIso(dayKey: string, hour: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey.trim());
  if (!m) throw new Error(`invalid dayKey: ${dayKey}`);
  const at = new Date(
    `${m[1]}-${m[2]}-${m[3]}T${pad2(hour)}:00:00+09:00`,
  );
  return at.toISOString();
}
