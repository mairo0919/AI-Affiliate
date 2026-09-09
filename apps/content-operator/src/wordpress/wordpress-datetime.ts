/**
 * WordPress REST date / date_gmt helpers for Asia/Tokyo wall-clock display.
 *
 * WP admin shows `date` in the site timezone. When timezone_string=Asia/Tokyo,
 * sending local Tokyo as `date` (no Z) and the UTC instant as `date_gmt`
 * avoids double conversion.
 */

export type WordPressPostDateFields = {
  /** Local civil time in site TZ, e.g. 2026-09-09T15:00:00 (no offset). */
  date: string;
  /** UTC instant, e.g. 2026-09-09T06:00:00 (WP accepts without Z). */
  date_gmt: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatYmdHms(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

function readParts(fmt: Intl.DateTimeFormat, d: Date) {
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/**
 * Format an Absolute Instant into WordPress date + date_gmt for Asia/Tokyo.
 */
export function resolveWordPressPostDates(
  now: Date = new Date(),
  timeZone = "Asia/Tokyo",
): WordPressPostDateFields {
  const localFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const utcFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  return {
    date: formatYmdHms(readParts(localFmt, now)),
    date_gmt: formatYmdHms(readParts(utcFmt, now)),
  };
}

/**
 * Build WP date fields for a Tokyo (or site TZ) civil wall-clock slot.
 * Example: 2026-09-09 21:00 JST → date local + matching date_gmt.
 */
export function resolveWordPressScheduledSlotDates(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute?: number;
  second?: number;
  timeZone?: string;
}): WordPressPostDateFields {
  const timeZone = input.timeZone ?? "Asia/Tokyo";
  const minute = input.minute ?? 0;
  const second = input.second ?? 0;
  const local = formatYmdHms({
    year: input.year,
    month: input.month,
    day: input.day,
    hour: input.hour,
    minute,
    second,
  });
  // Interpret civil time in the site TZ as an absolute Instant via offset probe.
  const probe = new Date(`${local}+09:00`);
  if (timeZone !== "Asia/Tokyo" && timeZone !== "Japan") {
    // Fallback: use Instant + re-format (caller should prefer Asia/Tokyo).
    return resolveWordPressPostDates(probe, timeZone);
  }
  return resolveWordPressPostDates(probe, timeZone);
}

/** Next publish slots (hour) on/after `now` in Asia/Tokyo. Default 12/21/23 JST. */
export function listUpcomingPublishSlots(input: {
  now?: Date;
  timeZone?: string;
  hours?: readonly number[];
  /** Include past slots earlier today (for catch-up). Default false. */
  includePastToday?: boolean;
  /** How many calendar days ahead to list (including today). */
  days?: number;
}): Array<{ year: number; month: number; day: number; hour: number; at: Date }> {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "Asia/Tokyo";
  const hours = [...(input.hours ?? [12, 21, 23])].sort((a, b) => a - b);
  const dayCount = Math.max(1, Math.min(input.days ?? 7, 30));
  const localFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const today = readParts(localFmt, now);
  const out: Array<{ year: number; month: number; day: number; hour: number; at: Date }> = [];

  // Anchor at Tokyo midnight for today, then walk civil days.
  const tokyoMidnight = new Date(
    `${today.year}-${pad2(today.month)}-${pad2(today.day)}T00:00:00+09:00`,
  );
  for (let d = 0; d < dayCount; d++) {
    const dayAnchor = new Date(tokyoMidnight.getTime() + d * 86_400_000);
    const ymd = readParts(localFmt, new Date(dayAnchor.getTime() + 12 * 3600_000));
    for (const hour of hours) {
      const at = new Date(
        `${ymd.year}-${pad2(ymd.month)}-${pad2(ymd.day)}T${pad2(hour)}:00:00+09:00`,
      );
      if (!input.includePastToday && at.getTime() <= now.getTime()) continue;
      out.push({ year: ymd.year, month: ymd.month, day: ymd.day, hour, at });
    }
  }
  return out;
}

/** True when WP settings already express Japan local time. */
export function isWordPressTimezoneTokyo(settings: {
  /** Classic option name (wp_options.timezone_string). */
  timezone_string?: string | null;
  /** WordPress REST `/wp/v2/settings` field name. */
  timezone?: string | null;
  gmt_offset?: number | string | null;
}): boolean {
  const tz = (settings.timezone_string ?? settings.timezone ?? "").trim();
  if (tz === "Asia/Tokyo" || tz === "Japan") return true;
  const offset = Number(settings.gmt_offset);
  // JST is UTC+9 with empty timezone_string on some hosts
  if (!tz && Number.isFinite(offset) && offset === 9) return true;
  return false;
}
