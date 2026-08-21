import type { AnalyticsAggregate, AnalyticsSnapshot } from "@ai-affiliate/database";

/** Canonical metric keys for cross-channel aggregation */
export const CANONICAL_METRIC_KEYS = [
  "impressions",
  "views",
  "clicks",
  "ctr",
  "engagement",
  "likes",
  "repost",
  "comments",
  "bookmark",
  "article_open",
  "read_time",
  "external_click",
  "publication_age",
] as const;

export type CanonicalMetricKey = (typeof CANONICAL_METRIC_KEYS)[number];

const ALIASES: Record<string, CanonicalMetricKey> = {
  impressions: "impressions",
  impression: "impressions",
  views: "views",
  view: "views",
  pageviews: "views",
  page_views: "views",
  pageViews: "views",
  clicks: "clicks",
  click: "clicks",
  ctr: "ctr",
  click_through_rate: "ctr",
  engagement: "engagement",
  likes: "likes",
  like: "likes",
  favorites: "likes",
  repost: "repost",
  reposts: "repost",
  retweets: "repost",
  shares: "repost",
  comments: "comments",
  comment: "comments",
  replies: "comments",
  bookmark: "bookmark",
  bookmarks: "bookmark",
  bookmarks_count: "bookmark",
  article_open: "article_open",
  articleOpens: "article_open",
  article_opens: "article_open",
  opens: "article_open",
  read_time: "read_time",
  readTime: "read_time",
  read_time_seconds: "read_time",
  averageReadTime: "read_time",
  external_click: "external_click",
  externalClicks: "external_click",
  external_clicks: "external_click",
  outbound_clicks: "external_click",
  publication_age: "publication_age",
  publicationAge: "publication_age",
  publication_age_hours: "publication_age",
};

export interface NormalizedSnapshotMetrics {
  canonical: Partial<Record<CanonicalMetricKey, number>>;
  platformSpecific: Record<string, number>;
}

export function normalizeSnapshotMetrics(
  metrics: Record<string, unknown>,
): NormalizedSnapshotMetrics {
  const canonical: Partial<Record<CanonicalMetricKey, number>> = {};
  const platformSpecific: Record<string, number> = {};

  for (const [rawKey, rawValue] of Object.entries(metrics)) {
    const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (!Number.isFinite(num)) continue;
    const mapped = ALIASES[rawKey] ?? ALIASES[rawKey.toLowerCase()];
    if (mapped) {
      canonical[mapped] = (canonical[mapped] ?? 0) + num;
    } else {
      platformSpecific[rawKey] = num;
    }
  }

  if (
    canonical.ctr === undefined &&
    canonical.clicks !== undefined &&
    (canonical.impressions ?? canonical.views)
  ) {
    const denom = canonical.impressions ?? canonical.views ?? 0;
    if (denom > 0) canonical.ctr = canonical.clicks / denom;
  }

  return { canonical, platformSpecific };
}

export function sumCanonical(
  rows: NormalizedSnapshotMetrics[],
): Partial<Record<CanonicalMetricKey, number>> {
  const out: Partial<Record<CanonicalMetricKey, number>> = {};
  for (const row of rows) {
    for (const key of CANONICAL_METRIC_KEYS) {
      const v = row.canonical[key];
      if (v === undefined) continue;
      if (key === "ctr" || key === "publication_age" || key === "read_time") {
        // averaged later
        continue;
      }
      out[key] = (out[key] ?? 0) + v;
    }
  }

  const ctrs = rows.map((r) => r.canonical.ctr).filter((v): v is number => v !== undefined);
  if (ctrs.length > 0) out.ctr = ctrs.reduce((a, b) => a + b, 0) / ctrs.length;
  else if (out.clicks && (out.impressions ?? out.views)) {
    const denom = out.impressions ?? out.views ?? 0;
    out.ctr = denom > 0 ? out.clicks / denom : 0;
  }

  const ages = rows
    .map((r) => r.canonical.publication_age)
    .filter((v): v is number => v !== undefined);
  if (ages.length > 0) out.publication_age = ages.reduce((a, b) => a + b, 0) / ages.length;

  const reads = rows.map((r) => r.canonical.read_time).filter((v): v is number => v !== undefined);
  if (reads.length > 0) out.read_time = reads.reduce((a, b) => a + b, 0) / reads.length;

  return out;
}

export function buildAggregateFields(
  snapshots: AnalyticsSnapshot[],
  opts: {
    contentId?: string | null;
    contentVersionId?: string | null;
    publicationTargetId?: string | null;
    platform: string;
    publishedAt?: Date | null;
  },
): Omit<
  Parameters<
    import("@ai-affiliate/database").P5Repository["createAnalyticsAggregate"]
  >[0],
  never
> {
  const normalized = snapshots.map((s) =>
    normalizeSnapshotMetrics((s.metrics as Record<string, unknown>) ?? {}),
  );
  const summed = sumCanonical(normalized);
  const platformMetrics: Record<string, number> = {};
  for (const row of normalized) {
    for (const [k, v] of Object.entries(row.platformSpecific)) {
      platformMetrics[k] = (platformMetrics[k] ?? 0) + v;
    }
  }

  const measured = snapshots.map((s) => s.measuredAt.getTime());
  const windowStart = measured.length ? new Date(Math.min(...measured)) : new Date();
  const windowEnd = measured.length ? new Date(Math.max(...measured)) : new Date();

  let publicationAgeHours = summed.publication_age ?? null;
  if (publicationAgeHours === null && opts.publishedAt) {
    publicationAgeHours = (Date.now() - opts.publishedAt.getTime()) / 3_600_000;
  }

  const engagement =
    summed.engagement ??
    (summed.likes ?? 0) + (summed.repost ?? 0) + (summed.comments ?? 0) + (summed.bookmark ?? 0);

  return {
    contentId: opts.contentId ?? null,
    contentVersionId: opts.contentVersionId ?? null,
    publicationTargetId: opts.publicationTargetId ?? null,
    platform: opts.platform,
    windowStart,
    windowEnd,
    impressions: summed.impressions ?? null,
    views: summed.views ?? null,
    clicks: summed.clicks ?? null,
    ctr: summed.ctr ?? null,
    engagement,
    likes: summed.likes ?? null,
    reposts: summed.repost ?? null,
    comments: summed.comments ?? null,
    bookmarks: summed.bookmark ?? null,
    articleOpens: summed.article_open ?? null,
    readTimeSeconds: summed.read_time ?? null,
    externalClicks: summed.external_click ?? null,
    publicationAgeHours,
    sampleSnapshotCount: snapshots.length,
    normalizedMetrics: Object.fromEntries(
      Object.entries(summed).filter(([, v]) => v !== undefined),
    ) as Record<string, number>,
    platformMetrics: Object.keys(platformMetrics).length > 0 ? platformMetrics : null,
    sourceSnapshotIds: snapshots.map((s) => s.id),
    metadata: { aggregator: "p5-v1" },
  };
}

export type { AnalyticsAggregate };
