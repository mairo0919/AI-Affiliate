import type { LifecycleRepository, PublicationTarget } from "@ai-affiliate/database";

export interface PublicationQueueConfig {
  targetPerDay: number;
  maximumPerDay: number;
  minimumIntervalMinutes: number;
  pauseWhenNoQualifiedContent: boolean;
}

export interface QueueRunResult {
  considered: number;
  processed: PublicationTarget[];
  skipped: Array<{ targetId: string; reason: string }>;
  paused: boolean;
  publishedToday: number;
}

/**
 * Cross-platform soft publication queue (Blogger + X).
 * Does not hard-force daily volume; quality / approval gates remain upstream.
 */
export class PublicationQueueRunner {
  constructor(
    private readonly repo: LifecycleRepository,
    private readonly config: PublicationQueueConfig,
    private readonly publishFn: (targetId: string) => Promise<PublicationTarget>,
  ) {}

  async run(options?: { now?: Date; limit?: number }): Promise<QueueRunResult> {
    const now = options?.now ?? new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const publishedToday = await this.repo.countPublicationsSince(dayStart);
    const skipped: QueueRunResult["skipped"] = [];
    const processed: PublicationTarget[] = [];

    if (publishedToday >= this.config.maximumPerDay) {
      return {
        considered: 0,
        processed,
        skipped: [{ targetId: "*", reason: "maximum-per-day-reached" }],
        paused: true,
        publishedToday,
      };
    }

    const due = await this.repo.listDuePublicationTargets({
      now,
      limit: options?.limit ?? this.config.maximumPerDay,
    });

    if (due.length === 0 && this.config.pauseWhenNoQualifiedContent) {
      return {
        considered: 0,
        processed,
        skipped: [{ targetId: "*", reason: "no-qualified-content" }],
        paused: true,
        publishedToday,
      };
    }

    let remaining = this.config.maximumPerDay - publishedToday;
    let lastPublishedAt = await this.repo.findLatestPublishedAt();

    for (const target of due) {
      if (remaining <= 0) {
        skipped.push({ targetId: target.id, reason: "maximum-per-day-reached" });
        continue;
      }

      if (lastPublishedAt) {
        const elapsedMs = now.getTime() - lastPublishedAt.getTime();
        const minMs = this.config.minimumIntervalMinutes * 60_000;
        if (elapsedMs < minMs) {
          skipped.push({ targetId: target.id, reason: "minimum-interval-not-elapsed" });
          continue;
        }
      }

      if (target.status !== "APPROVED" && target.status !== "SCHEDULED") {
        skipped.push({ targetId: target.id, reason: `status-${target.status}` });
        continue;
      }

      const published = await this.publishFn(target.id);
      processed.push(published);
      remaining -= 1;
      lastPublishedAt = published.publishedAt ?? now;
    }

    return {
      considered: due.length,
      processed,
      skipped,
      paused: processed.length === 0 && this.config.pauseWhenNoQualifiedContent,
      publishedToday: publishedToday + processed.length,
    };
  }
}
