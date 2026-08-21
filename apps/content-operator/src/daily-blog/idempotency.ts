/**
 * Publish/intent idempotency — survive Blogger success + DB write failure.
 */

export function dailyRunIdempotencyKey(input: {
  timezoneDate: string; // YYYY-MM-DD in Asia/Tokyo
  articleKind: "PRODUCT" | "RANKING";
  canonicalId?: string | null;
  rankingType?: string | null;
  rankingPeriod?: string | null;
}): string {
  if (input.articleKind === "RANKING") {
    return [
      "blog-daily",
      input.timezoneDate,
      "ranking",
      input.rankingType ?? "unknown",
      input.rankingPeriod ?? "na",
    ].join(":");
  }
  return ["blog-daily", input.timezoneDate, "product", input.canonicalId ?? "pending"].join(":");
}

export function publishIntentKey(input: {
  canonicalId: string;
  contentVersionId: string;
}): string {
  return `blog-publish-intent:${input.canonicalId}:${input.contentVersionId}`;
}

export function tokyoDateString(now = new Date(), timeZone = "Asia/Tokyo"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
