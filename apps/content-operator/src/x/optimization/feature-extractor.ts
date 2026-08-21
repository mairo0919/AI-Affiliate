import { createHash } from "node:crypto";
import type { AppConfig } from "@ai-affiliate/config";
import type { PublicationWithPosts, XPostMetricSnapshot } from "@ai-affiliate/database";
import { XCharacterCounter } from "../character-counter.js";

export const VARIANT_VERSION = "x-variant-v1";
export const OPTIMIZATION_METRICS_VERSION = "x-optimization-metrics-v1";

export type InformationDensity = "LOW" | "MEDIUM" | "HIGH";
export type ContentAngle =
  | "RANKING"
  | "TRENDING"
  | "NEW_RELEASE"
  | "HIGH_RATING"
  | "DISCOUNT"
  | "ACTRESS"
  | "GENRE"
  | "MAKER"
  | "SERIES"
  | "DATA_FACT"
  | "SIMPLE_INTRODUCTION"
  | "CURIOSITY"
  | "CONTROL";

export interface XContentFeatures {
  contentAngle: ContentAngle;
  strategyType: string;
  postCount: number;
  rootWeightedLength: number;
  totalWeightedLength: number;
  titleWeightedLength: number;
  hashtagCount: number;
  hashtagSet: string;
  urlPostSequence: number | null;
  urlPlacement: "ROOT" | "REPLY" | "NONE" | "MULTIPLE";
  disclosurePostSequence: number | null;
  disclosurePlacement: "ROOT" | "REPLY" | "NONE" | "MULTIPLE";
  ctaStyle: "SOFT" | "DIRECT" | "NONE";
  hasRelatedPostLink: boolean;
  hasReply: boolean;
  informationDensity: InformationDensity;
  numericFactCount: number;
  entityCount: number;
  emojiCount: number;
  lineBreakCount: number;
  postingHour: number | null;
  weekday: string | null;
  postingTimeBucket: string | null;
  candidateType: string | null;
  productScoreBand: string | null;
  priceBand: string | null;
  reviewCountBand: string | null;
  accountFollowerBand: string | null;
  experimentGroup: string | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function tokyoParts(date: Date): { hour: number; weekday: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "numeric",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  return { hour, weekday };
}

export function postingTimeBucket(hour: number): string {
  if (hour < 6) return "00:00-05:59";
  if (hour < 9) return "06:00-08:59";
  if (hour < 12) return "09:00-11:59";
  if (hour < 15) return "12:00-14:59";
  if (hour < 18) return "15:00-17:59";
  if (hour < 21) return "18:00-20:59";
  return "21:00-23:59";
}

export function bandScore(score: number | null | undefined): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score < 40) return "0-39";
  if (score < 70) return "40-69";
  if (score < 85) return "70-84";
  return "85-100";
}

export function bandCount(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n < 10) return "0-9";
  if (n < 50) return "10-49";
  if (n < 200) return "50-199";
  return "200+";
}

function extractHashtags(text: string, disclosure: string): string[] {
  const matches = text.match(/#[\w\u3040-\u30ff\u3400-\u9fff]+/g) ?? [];
  return matches.filter((tag) => tag !== disclosure);
}

function classifyHashtagSet(tags: string[], disclosure: string): string {
  const normalized = tags.map((t) => t.toLowerCase());
  const hasPr = disclosure.startsWith("#");
  if (normalized.length === 0) return hasPr ? "PR_ONLY_IN_DISCLOSURE" : "NONE";
  if (normalized.some((t) => t.includes("fanza"))) return "PR_PLUS_FANZA";
  if (normalized.some((t) => t.includes("genre") || /ジャンル/.test(t))) return "PR_PLUS_GENRE";
  // actress-like: non-fanza content tags
  if (normalized.length >= 1) return "PR_PLUS_ENTITY";
  return "OTHER";
}

function inferAngle(input: {
  strategyType: string;
  candidateType?: string | null;
  body: string;
  snapshot?: Record<string, unknown> | null;
}): ContentAngle {
  const candidate = (input.candidateType ?? "").toUpperCase();
  if (candidate === "RANKING") return "RANKING";
  if (candidate === "TRENDING") return "TRENDING";
  if (candidate === "NEW_RELEASE") return "NEW_RELEASE";
  if (candidate === "HIGH_RATING") return "HIGH_RATING";
  if (candidate === "DISCOUNT") return "DISCOUNT";
  if (input.strategyType === "CONTROL") return "CONTROL";
  const body = input.body;
  if (/女優|出演/.test(body)) return "ACTRESS";
  if (/ジャンル/.test(body)) return "GENRE";
  if (/メーカー/.test(body)) return "MAKER";
  if (/シリーズ/.test(body)) return "SERIES";
  if (/\d/.test(body)) return "DATA_FACT";
  if (/気になる|チェック/.test(body)) return "CURIOSITY";
  return "SIMPLE_INTRODUCTION";
}

export function classifyDensity(
  features: {
    totalWeightedLength: number;
    numericFactCount: number;
    entityCount: number;
    hashtagCount: number;
    urlCount: number;
  },
  thresholds: AppConfig["xDensity"],
): InformationDensity {
  const exceedsMedium =
    features.totalWeightedLength > thresholds.mediumMaxWeightedLength ||
    features.numericFactCount > thresholds.mediumMaxFactCount ||
    features.entityCount > thresholds.mediumMaxEntityCount ||
    features.urlCount > thresholds.mediumMaxUrlCount ||
    features.hashtagCount > thresholds.mediumMaxHashtagCount;
  if (exceedsMedium) return "HIGH";

  const exceedsLow =
    features.totalWeightedLength > thresholds.lowMaxWeightedLength ||
    features.numericFactCount > thresholds.lowMaxFactCount ||
    features.entityCount > thresholds.lowMaxEntityCount ||
    features.urlCount > thresholds.lowMaxUrlCount ||
    features.hashtagCount > thresholds.lowMaxHashtagCount;
  if (exceedsLow) return "MEDIUM";
  return "LOW";
}

function ctaStyleOf(text: string): "SOFT" | "DIRECT" | "NONE" {
  if (/今すぐ|クリック|購入/.test(text)) return "DIRECT";
  if (/詳細|チェック|どうぞ|こちら/.test(text)) return "SOFT";
  return "NONE";
}

export class XContentFeatureExtractor {
  private readonly counter: XCharacterCounter;

  constructor(private readonly config: AppConfig) {
    this.counter = new XCharacterCounter(config.xUrlWeightedLength);
  }

  extract(options: {
    publication: PublicationWithPosts;
    title?: string | null;
    candidateType?: string | null;
    productScore?: number | null;
    price?: number | null;
    reviewCount?: number | null;
    inputSnapshot?: Record<string, unknown> | null;
    followerCount?: number | null;
  }): XContentFeatures {
    const { publication } = options;
    const disclosure = this.config.xAffiliateDisclosure;
    const posts = [...publication.posts].sort((a, b) => a.sequence - b.sequence);
    const root = posts.find((p) => p.sequence === 1);
    const bodies = posts.map((p) => p.body);
    const combined = bodies.join("\n");
    const rootLen = this.counter.count(root?.body ?? "").weightedLength;
    const totalLen = bodies.reduce((s, b) => s + this.counter.count(b).weightedLength, 0);
    const titleLen = this.counter.count(options.title ?? "").weightedLength;

    const tags = extractHashtags(combined, disclosure);
    const urlSequences = posts
      .filter((p) => /https?:\/\//.test(p.body))
      .map((p) => p.sequence);
    const disclosureSequences = posts
      .filter((p) => p.body.includes(disclosure))
      .map((p) => p.sequence);

    const urlPlacement =
      urlSequences.length === 0
        ? "NONE"
        : urlSequences.length > 1
          ? "MULTIPLE"
          : urlSequences[0] === 1
            ? "ROOT"
            : "REPLY";
    const disclosurePlacement =
      disclosureSequences.length === 0
        ? "NONE"
        : disclosureSequences.length > 1
          ? "MULTIPLE"
          : disclosureSequences[0] === 1
            ? "ROOT"
            : "REPLY";

    const publishedAt = publication.publishedAt ?? publication.scheduledAt;
    const tokyo = publishedAt ? tokyoParts(publishedAt) : null;

    const numericFactCount = (combined.match(/\d+(?:\.\d+)?/g) ?? []).length;
    const entityCount = [
      options.inputSnapshot?.tags &&
      typeof options.inputSnapshot.tags === "object"
        ? Object.values(options.inputSnapshot.tags as Record<string, unknown>).flat()
            .length
        : 0,
    ][0];
    const emojiCount = (combined.match(/[\u{1F300}-\u{1FAFF}]/gu) ?? []).length;
    const lineBreakCount = (combined.match(/\n/g) ?? []).length;
    const urlCount = (combined.match(/https?:\/\//g) ?? []).length;

    const density = classifyDensity(
      {
        totalWeightedLength: totalLen,
        numericFactCount,
        entityCount: typeof entityCount === "number" ? entityCount : 0,
        hashtagCount: tags.length,
        urlCount,
      },
      this.config.xDensity,
    );

    const angle = inferAngle({
      strategyType: publication.strategyType,
      candidateType: options.candidateType,
      body: combined,
      snapshot: options.inputSnapshot,
    });

    return {
      contentAngle: angle,
      strategyType: publication.strategyType,
      postCount: posts.length,
      rootWeightedLength: rootLen,
      totalWeightedLength: totalLen,
      titleWeightedLength: titleLen,
      hashtagCount: tags.length,
      hashtagSet: classifyHashtagSet(tags, disclosure),
      urlPostSequence: urlSequences[0] ?? null,
      urlPlacement,
      disclosurePostSequence: disclosureSequences[0] ?? null,
      disclosurePlacement,
      ctaStyle: ctaStyleOf(combined),
      hasRelatedPostLink: posts.some((p) => p.relatedPublicationId != null),
      hasReply: posts.some((p) => p.role === "REPLY"),
      informationDensity: density,
      numericFactCount,
      entityCount: typeof entityCount === "number" ? entityCount : 0,
      emojiCount,
      lineBreakCount,
      postingHour: tokyo?.hour ?? null,
      weekday: tokyo?.weekday ?? null,
      postingTimeBucket: tokyo ? postingTimeBucket(tokyo.hour) : null,
      candidateType: options.candidateType ?? null,
      productScoreBand: bandScore(options.productScore),
      priceBand: bandCount(options.price),
      reviewCountBand: bandCount(options.reviewCount),
      accountFollowerBand: bandCount(options.followerCount),
      experimentGroup: publication.experimentGroup,
    };
  }

  featureSnapshot(features: XContentFeatures): Record<string, unknown> {
    return {
      ...features,
      version: VARIANT_VERSION,
      densityVersion: this.config.xDensity.version,
      densityThresholds: { ...this.config.xDensity },
    };
  }
}

export function stableSegmentKey(parts: Record<string, string | null | undefined>): string {
  const entries = Object.entries(parts)
    .filter(([, v]) => v != null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  const raw = JSON.stringify(Object.fromEntries(entries));
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function computeOptimizationScore(
  metrics: {
    impressionCount: number | null;
    engagementRate: number | null;
    urlClickRate: number | null;
    profileClickRate: number | null;
    bookmarkRate: number | null;
    repostRate: number | null;
  },
  weights: AppConfig["xOptimizationScoreWeights"],
): { score: number | null; usedWeights: Record<string, number>; missing: string[] } {
  const components: Array<{ key: string; weight: number; value: number | null }> = [
    {
      key: "urlClickRate",
      weight: weights.urlClickRate,
      value: metrics.urlClickRate,
    },
    {
      key: "engagementRate",
      weight: weights.engagementRate,
      value: metrics.engagementRate,
    },
    {
      key: "impressionCount",
      weight: weights.impressionCount,
      value:
        metrics.impressionCount == null ? null : Math.min(1, metrics.impressionCount / 1000),
    },
    {
      key: "profileClickRate",
      weight: weights.profileClickRate,
      value: metrics.profileClickRate,
    },
    {
      key: "bookmarkRate",
      weight: weights.bookmarkRate,
      value: metrics.bookmarkRate,
    },
    {
      key: "repostRate",
      weight: weights.repostRate,
      value: metrics.repostRate,
    },
  ];
  const available = components.filter((c) => c.value != null && c.weight > 0);
  const missing = components.filter((c) => c.value == null).map((c) => c.key);
  const total = available.reduce((s, c) => s + c.weight, 0);
  if (available.length === 0 || total <= 0) {
    return { score: null, usedWeights: {}, missing };
  }
  const usedWeights: Record<string, number> = {};
  let score = 0;
  for (const c of available) {
    const w = c.weight / total;
    usedWeights[c.key] = w;
    score += c.value! * w;
  }
  return { score: score * 100, usedWeights, missing };
}

export function ratesFromSnapshot(snap: XPostMetricSnapshot): {
  impressionCount: number | null;
  engagementRate: number | null;
  urlClickRate: number | null;
  profileClickRate: number | null;
  bookmarkRate: number | null;
  repostRate: number | null;
  likeRate: number | null;
} {
  const impressions = snap.impressionCount;
  const engagementParts = [
    snap.likeCount,
    snap.replyCount,
    snap.repostCount,
    snap.quoteCount,
    snap.bookmarkCount,
  ];
  const engagement =
    engagementParts.every((v) => v == null)
      ? null
      : engagementParts.reduce<number>((s, v) => s + (v ?? 0), 0);
  const rate = (n: number | null) =>
    n == null || impressions == null || impressions <= 0 ? null : n / impressions;
  return {
    impressionCount: impressions,
    engagementRate: rate(engagement),
    urlClickRate: rate(snap.urlClickCount),
    profileClickRate: rate(snap.profileClickCount),
    bookmarkRate: rate(snap.bookmarkCount),
    repostRate: rate(snap.repostCount),
    likeRate: rate(snap.likeCount),
  };
}

export { WEEKDAYS };
