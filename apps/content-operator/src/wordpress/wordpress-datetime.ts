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

  const read = (fmt: Intl.DateTimeFormat, d: Date) => {
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
  };

  return {
    date: formatYmdHms(read(localFmt, now)),
    date_gmt: formatYmdHms(read(utcFmt, now)),
  };
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
