import type { AppConfig } from "@ai-affiliate/config";
import type { XPublicationRepository } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import type { XPublishingProvider } from "./providers/index.js";
import { METRICS_VERSION } from "./types.js";

const PRIVATE_METRICS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface XMetricsCollectorDeps {
  logger: Logger;
  config: AppConfig;
  publications: XPublicationRepository;
  provider: XPublishingProvider;
  now?: () => Date;
  notifications?: {
    emitXEvent?: (
      eventType: "X_METRICS_COLLECTION_FAILED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
  /** Optional preflight for live metrics (credential / budget / rate limit). */
  beforeCollect?: () => Promise<{ ok: boolean; reason?: string }>;
}

export interface MetricsCollectResult {
  examined: number;
  collected: number;
  skipped: number;
  failed: number;
}

function engagementCount(m: {
  likeCount: number | null;
  replyCount: number | null;
  repostCount: number | null;
  quoteCount: number | null;
  bookmarkCount: number | null;
}): number | null {
  const parts = [m.likeCount, m.replyCount, m.repostCount, m.quoteCount, m.bookmarkCount];
  if (parts.every((p) => p == null)) return null;
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}

export function computeEngagementRate(
  engagement: number | null,
  impressions: number | null,
): number | null {
  if (engagement == null || impressions == null || impressions <= 0) return null;
  return engagement / impressions;
}

export function computeRate(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return numerator / denominator;
}

export class XMetricsCollector {
  private readonly now: () => Date;

  constructor(private readonly deps: XMetricsCollectorDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async collect(options?: { limit?: number }): Promise<MetricsCollectResult> {
    if (this.deps.beforeCollect) {
      const gate = await this.deps.beforeCollect();
      if (!gate.ok) {
        this.deps.logger.info(`metrics collect skipped: ${gate.reason ?? "preflight"}`);
        return { examined: 0, collected: 0, skipped: 0, failed: 0 };
      }
    }

    const windows = this.deps.config.xMetricsCollectionWindowsMinutes;
    const limit = options?.limit ?? this.deps.config.xMetricsCollectionBatchSize;
    const maxAgeMinutes = Math.max(...windows);
    const since = new Date(this.now().getTime() - maxAgeMinutes * 60 * 1000);

    const publications = await this.deps.publications.listPublishedWithPosts({
      since,
      limit,
    });

    let examined = 0;
    let collected = 0;
    let skipped = 0;
    let failed = 0;

    for (const publication of publications) {
      for (const post of publication.posts) {
        if (!post.xPostId || post.status !== "PUBLISHED" || !post.publishedAt) {
          continue;
        }
        examined += 1;
        const ageMs = this.now().getTime() - post.publishedAt.getTime();
        const ageMinutes = ageMs / (60 * 1000);
        const olderThan30Days = ageMs > PRIVATE_METRICS_MAX_AGE_MS;

        for (const window of windows) {
          if (ageMinutes < window) {
            continue;
          }
          const exists = await this.deps.publications.hasMetricForWindow(
            post.xPostId,
            window,
          );
          if (exists) {
            skipped += 1;
            continue;
          }

          try {
            const [metrics] = await this.deps.provider.getPostMetrics([post.xPostId]);
            if (!metrics) {
              skipped += 1;
              continue;
            }
            const measuredAt = new Date(
              post.publishedAt.getTime() + window * 60 * 1000,
            );
            const availability = {
              ...metrics.availability,
              ...(metrics.rawMetricAvailability ?? {}),
              olderThan30Days,
            };
            await this.deps.publications.saveMetricSnapshot({
              publicationId: publication.id,
              publicationPostId: post.id,
              xPostId: post.xPostId,
              measuredAt,
              impressionCount: metrics.impressionCount,
              likeCount: metrics.likeCount,
              replyCount: metrics.replyCount,
              repostCount: metrics.repostCount,
              quoteCount: metrics.quoteCount,
              bookmarkCount: metrics.bookmarkCount,
              urlClickCount: metrics.urlClickCount,
              profileClickCount: metrics.profileClickCount,
              detailExpandCount: metrics.detailExpandCount,
              mediaViewCount: metrics.mediaViewCount,
              followerCountAtMeasurement: metrics.followerCountAtMeasurement,
              rawMetricAvailability: availability,
              source: this.deps.provider.providerName,
              collectionWindowMinutes: window,
              metricsVersion: METRICS_VERSION,
            });
            collected += 1;
            void engagementCount;
            void computeEngagementRate;
            void computeRate;
          } catch (error) {
            failed += 1;
            this.deps.logger.warn(
              `metrics collection failed post=${post.xPostId}: ${String(error)}`,
            );
            await this.deps.notifications?.emitXEvent?.("X_METRICS_COLLECTION_FAILED", {
              publicationId: publication.id,
              xPostId: post.xPostId,
            });
          }
        }
      }
    }

    return { examined, collected, skipped, failed };
  }
}
