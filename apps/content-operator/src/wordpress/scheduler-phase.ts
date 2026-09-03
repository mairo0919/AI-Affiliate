/**
 * Scheduler / batch helper for APPROVED ContentVersions → WordPress.
 * Daily multi-channel live path uses publishContentVersionToWordPress directly
 * (see daily-ops/live-orchestrator). Prefer that shared path over a second publisher.
 */
import type { AppConfig } from "@ai-affiliate/config";
import type { LifecycleRepository } from "@ai-affiliate/database";
import {
  createDefaultWordPressPublisher,
  runWordPressPublicationBatch,
  type WordPressBatchResult,
  type WordPressPublishPathDeps,
} from "./wordpress-publish-path.js";

export interface WordPressSchedulerPhaseInput {
  contentVersionIds: string[];
  limit?: number;
  mode?: "publish" | "draft";
  dryRun?: boolean;
}

export function buildWordPressPublishDeps(input: {
  config: AppConfig;
  lifecycle: LifecycleRepository;
  prisma: WordPressPublishPathDeps["prisma"];
}): WordPressPublishPathDeps {
  return {
    config: input.config,
    lifecycle: input.lifecycle,
    prisma: input.prisma,
    publisher: createDefaultWordPressPublisher(input.config),
  };
}

export async function runWordPressSchedulerPhase(
  deps: WordPressPublishPathDeps,
  input: WordPressSchedulerPhaseInput,
): Promise<WordPressBatchResult> {
  return runWordPressPublicationBatch(deps, {
    contentVersionIds: input.contentVersionIds,
    limit: input.limit,
    mode: input.mode,
    dryRun: input.dryRun,
    route: "WORDPRESS_SCHEDULER_PHASE",
  });
}
