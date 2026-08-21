import type { AppConfig } from "@ai-affiliate/config";
import type {
  NotificationRepository,
  ResearchNotification,
  ResearchNotificationChannelType,
  ResearchNotificationEventType,
  ResearchSchedule,
  ResearchScheduleRun,
} from "@ai-affiliate/database";
import { buildNotificationDeduplicationKey } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { toSafeErrorMessage } from "../providers/fanza/dmm-api-error.js";
import { ConsoleNotificationProvider } from "./console-provider.js";
import { WebhookNotificationProvider } from "./webhook-provider.js";
import type {
  PreparedResearchNotification,
  ResearchNotificationProvider,
} from "./types.js";

export const DEFAULT_NOTIFICATION_DISPATCH_LIMIT = 50;

export interface NotificationContext {
  schedule?: ResearchSchedule | null;
  run?: ResearchScheduleRun | null;
  job?: {
    id?: string | null;
    fetchedCount?: number;
    savedCount?: number;
    updatedCount?: number;
    errorCount?: number;
    status?: string;
  } | null;
  errorType?: string | null;
  errorMessage?: string | null;
  retryScheduled?: boolean;
  nextRetryAt?: Date | null;
  retryAttempt?: number | null;
  content?: {
    contentId?: string | null;
    candidateId?: string | null;
    contentType?: string | null;
    status?: string | null;
  } | null;
  x?: {
    publicationId?: string | null;
    postId?: string | null;
    status?: string | null;
  } | null;
}

export interface NotificationServiceDeps {
  logger: Logger;
  config: AppConfig;
  notifications: NotificationRepository;
  providers?: ResearchNotificationProvider[];
  now?: () => Date;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  random?: () => number;
}

function resolveChannelType(config: AppConfig): ResearchNotificationChannelType {
  return config.researchNotificationChannel === "webhook" ? "WEBHOOK" : "CONSOLE";
}

export class NotificationService {
  private readonly logger: Logger;
  private readonly config: AppConfig;
  private readonly notifications: NotificationRepository;
  private readonly providers: ResearchNotificationProvider[];
  private readonly now: () => Date;

  constructor(deps: NotificationServiceDeps) {
    this.logger = deps.logger;
    this.config = deps.config;
    this.notifications = deps.notifications;
    this.now = deps.now ?? (() => new Date());
    this.providers =
      deps.providers ??
      [
        new ConsoleNotificationProvider(deps.logger),
        new WebhookNotificationProvider({
          webhookUrl: deps.config.researchNotificationWebhookUrl,
          timeoutMs: deps.config.researchNotificationTimeoutMs,
          maxAttempts: deps.config.researchNotificationMaxAttempts,
          fetchImpl: deps.fetchImpl,
          sleepImpl: deps.sleepImpl,
          random: deps.random,
          now: deps.now,
        }),
      ];
  }

  async emitEvent(
    eventType: ResearchNotificationEventType,
    context: NotificationContext,
  ): Promise<ResearchNotification | null> {
    if (!this.config.researchNotificationEnabled) {
      return null;
    }

    if (!this.shouldEmitContentEvent(eventType)) {
      return null;
    }

    const channelType = resolveChannelType(this.config);
    const retryAttempt = context.retryAttempt ?? context.run?.retryAttempt ?? 0;
    const deduplicationKey = buildNotificationDeduplicationKey({
      eventType,
      scheduleId: context.schedule?.id ?? null,
      scheduleRunId: context.run?.id ?? null,
      researchJobId: context.job?.id ?? context.run?.jobId ?? context.content?.contentId ?? context.x?.publicationId ?? null,
      retryAttempt,
    });

    const payload = this.buildPayload(eventType, context);
    const title = this.buildTitle(eventType, context);
    const message = this.buildMessage(eventType, context);

    const { notification, created } = await this.notifications.createNotificationIfAbsent({
      eventType,
      providerName: context.schedule?.providerName ?? null,
      scheduleId: context.schedule?.id ?? null,
      scheduleRunId: context.run?.id ?? null,
      researchJobId: context.job?.id ?? context.run?.jobId ?? null,
      channelType,
      deduplicationKey,
      title,
      message,
      payload,
    });

    if (!created) {
      this.logger.info(`notification deduped eventType=${eventType} id=${notification.id}`);
    }
    return notification;
  }

  async emitContentEvent(
    eventType:
      | "CONTENT_GENERATION_FAILED"
      | "CONTENT_VALIDATION_FAILED"
      | "CONTENT_REVIEW_REQUIRED"
      | "CONTENT_APPROVED"
      | "CONTENT_REJECTED",
    payload: Record<string, unknown>,
  ): Promise<ResearchNotification | null> {
    return this.emitEvent(eventType, {
      content: {
        contentId: typeof payload.contentId === "string" ? payload.contentId : null,
        candidateId: typeof payload.candidateId === "string" ? payload.candidateId : null,
        contentType: typeof payload.contentType === "string" ? payload.contentType : null,
        status: typeof payload.status === "string" ? payload.status : null,
      },
      errorType: typeof payload.error === "string" ? "ContentGeneration" : null,
      errorMessage: typeof payload.error === "string" ? payload.error : null,
    });
  }

  async emitXEvent(
    eventType:
      | "X_PUBLICATION_FAILED"
      | "X_PUBLICATION_PARTIALLY_PUBLISHED"
      | "X_PUBLICATION_PUBLISHED"
      | "X_REPLY_FAILED"
      | "X_METRICS_COLLECTION_FAILED"
      | "X_STRATEGY_EVALUATION_COMPLETED"
      | "X_OPTIMIZATION_RECOMMENDATION_CREATED"
      | "X_OPTIMIZATION_RECOMMENDATION_APPROVED"
      | "X_OPTIMIZATION_RECOMMENDATION_REJECTED"
      | "X_OPTIMIZATION_EXPERIMENT_STARTED"
      | "X_OPTIMIZATION_IMPROVED"
      | "X_OPTIMIZATION_DECLINED"
      | "X_OPTIMIZATION_VALIDATION_FAILED"
      | "X_PUBLICATION_BLOCKED"
      | "X_PRODUCT_COOLDOWN_BLOCKED"
      | "X_PUBLICATION_LIMIT_REACHED"
      | "X_KILL_SWITCH_ENABLED"
      | "X_RELEASE_MODE_CHANGED"
      | "X_ASSISTED_REVIEW_REQUIRED"
      | "X_RESERVATION_EXPIRED"
      | "X_DUPLICATE_CONTENT_BLOCKED"
      | "X_AUTHORIZATION_COMPLETED"
      | "X_AUTHORIZATION_FAILED"
      | "X_TOKEN_REFRESH_FAILED"
      | "X_CREDENTIAL_REAUTH_REQUIRED"
      | "X_ACCOUNT_MISMATCH"
      | "X_API_RATE_LIMITED"
      | "X_API_SOFT_BUDGET_REACHED"
      | "X_API_HARD_BUDGET_REACHED"
      | "X_API_USAGE_SYNC_FAILED"
      | "X_POST_PUBLISHED_UNVERIFIED"
      | "X_LIVE_POST_PUBLISHED",
    payload: Record<string, unknown>,
  ): Promise<ResearchNotification | null> {
    return this.emitEvent(eventType, {
      x: {
        publicationId:
          typeof payload.publicationId === "string" ? payload.publicationId : null,
        postId: typeof payload.postId === "string" ? payload.postId : null,
        status: typeof payload.status === "string" ? payload.status : null,
      },
      content: {
        contentId: typeof payload.contentId === "string" ? payload.contentId : null,
        candidateId: null,
        contentType: typeof payload.dimension === "string" ? payload.dimension : null,
        status: typeof payload.recommendationId === "string" ? payload.recommendationId : null,
      },
      errorType: typeof payload.error === "string" ? "XOptimization" : null,
      errorMessage: typeof payload.error === "string" ? payload.error : null,
    });
  }

  private shouldEmitContentEvent(eventType: ResearchNotificationEventType): boolean {
    if (eventType === "CONTENT_GENERATION_FAILED" || eventType === "CONTENT_VALIDATION_FAILED") {
      return true;
    }
    if (eventType === "CONTENT_REVIEW_REQUIRED") {
      return this.config.contentNotifyReviewRequired;
    }
    if (eventType === "CONTENT_APPROVED") {
      return this.config.contentNotifyApproved;
    }
    if (eventType === "CONTENT_REJECTED") {
      return this.config.contentNotifyRejected;
    }
    if (
      eventType === "X_PUBLICATION_FAILED" ||
      eventType === "X_PUBLICATION_PARTIALLY_PUBLISHED" ||
      eventType === "X_REPLY_FAILED"
    ) {
      return true;
    }
    if (eventType === "X_PUBLICATION_PUBLISHED") {
      return this.config.xNotifyPublicationPublished;
    }
    if (eventType === "X_STRATEGY_EVALUATION_COMPLETED") {
      return this.config.xNotifyStrategyEvaluationCompleted;
    }
    if (eventType === "X_METRICS_COLLECTION_FAILED") {
      return true;
    }
    if (eventType === "X_OPTIMIZATION_RECOMMENDATION_CREATED") {
      return this.config.xNotifyOptimizationRecommendationCreated;
    }
    if (eventType === "X_OPTIMIZATION_DECLINED") {
      return this.config.xNotifyOptimizationDeclined;
    }
    if (eventType === "X_OPTIMIZATION_VALIDATION_FAILED") {
      return this.config.xNotifyOptimizationValidationFailed;
    }
    if (
      eventType === "X_OPTIMIZATION_RECOMMENDATION_APPROVED" ||
      eventType === "X_OPTIMIZATION_RECOMMENDATION_REJECTED" ||
      eventType === "X_OPTIMIZATION_EXPERIMENT_STARTED" ||
      eventType === "X_OPTIMIZATION_IMPROVED" ||
      eventType === "X_RELEASE_MODE_CHANGED" ||
      eventType === "X_ASSISTED_REVIEW_REQUIRED" ||
      eventType === "X_RESERVATION_EXPIRED"
    ) {
      return false;
    }
    if (eventType === "X_PUBLICATION_BLOCKED") {
      return this.config.xNotifyPublicationBlocked;
    }
    if (eventType === "X_PRODUCT_COOLDOWN_BLOCKED") {
      return this.config.xNotifyProductCooldownBlocked;
    }
    if (eventType === "X_PUBLICATION_LIMIT_REACHED") {
      return this.config.xNotifyPublicationLimitReached;
    }
    if (eventType === "X_KILL_SWITCH_ENABLED") {
      return this.config.xNotifyKillSwitchEnabled;
    }
    if (eventType === "X_DUPLICATE_CONTENT_BLOCKED") {
      return this.config.xNotifyDuplicateContentBlocked;
    }
    if (eventType === "X_TOKEN_REFRESH_FAILED") {
      return this.config.xNotifyTokenRefreshFailed;
    }
    if (eventType === "X_CREDENTIAL_REAUTH_REQUIRED") {
      return this.config.xNotifyCredentialReauthRequired;
    }
    if (eventType === "X_ACCOUNT_MISMATCH") {
      return this.config.xNotifyAccountMismatch;
    }
    if (eventType === "X_API_HARD_BUDGET_REACHED") {
      return this.config.xNotifyHardBudgetReached;
    }
    if (eventType === "X_POST_PUBLISHED_UNVERIFIED") {
      return this.config.xNotifyPostPublishedUnverified;
    }
    if (eventType === "X_LIVE_POST_PUBLISHED") {
      return this.config.xNotifyLivePostPublished;
    }
    if (
      eventType === "X_AUTHORIZATION_COMPLETED" ||
      eventType === "X_AUTHORIZATION_FAILED" ||
      eventType === "X_API_RATE_LIMITED" ||
      eventType === "X_API_SOFT_BUDGET_REACHED" ||
      eventType === "X_API_USAGE_SYNC_FAILED"
    ) {
      return false;
    }
    return true;
  }

  async dispatchPendingNotifications(
    limit: number = DEFAULT_NOTIFICATION_DISPATCH_LIMIT,
  ): Promise<{ processed: number; sent: number; failed: number; skipped: number }> {
    const pending = await this.notifications.listPendingNotifications(this.now(), limit);
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of pending) {
      try {
        const result = await this.dispatchOne(item.id);
        if (result === "SENT") sent += 1;
        else if (result === "SKIPPED") skipped += 1;
        else if (result === "FAILED") failed += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `notification dispatch error id=${item.id} (${toSafeErrorMessage(error)})`,
        );
      }
    }

    return { processed: pending.length, sent, failed, skipped };
  }

  async retryFailedNotification(notificationId: string): Promise<ResearchNotification | null> {
    const existing = await this.notifications.findById(notificationId);
    if (!existing) {
      return null;
    }
    // Re-queue without creating a new row — increment attempts via dispatch
    await this.notifications.markFailed(existing.id, existing.errorMessage ?? "manual retry requested");
    // Reset to PENDING by claiming path: markSending accepts FAILED
    const claimed = await this.notifications.markSending(existing.id, this.now());
    if (!claimed) {
      return existing;
    }
    await this.sendClaimed(claimed);
    return this.notifications.findById(notificationId);
  }

  async dispatchOne(
    notificationId: string,
  ): Promise<"SENT" | "FAILED" | "SKIPPED" | "BUSY"> {
    const claimed = await this.notifications.markSending(notificationId, this.now());
    if (!claimed) {
      return "BUSY";
    }
    return this.sendClaimed(claimed);
  }

  private async sendClaimed(
    notification: ResearchNotification,
  ): Promise<"SENT" | "FAILED" | "SKIPPED"> {
    const provider = this.providers.find((entry) => entry.channelType === notification.channelType);
    const attemptNumber = notification.attemptCount + 1;
    const startedAt = this.now();

    if (!provider) {
      await this.notifications.recordAttempt({
        notificationId: notification.id,
        attemptNumber,
        status: "FAILED",
        errorType: "Configuration",
        errorMessage: `no provider for channel ${notification.channelType}`,
        startedAt,
        completedAt: this.now(),
      });
      await this.notifications.markFailed(
        notification.id,
        `no provider for channel ${notification.channelType}`,
        this.now(),
      );
      return "FAILED";
    }

    if (
      notification.channelType === "WEBHOOK" &&
      (!this.config.researchNotificationWebhookUrl ||
        this.config.researchNotificationWebhookUrl.trim() === "")
    ) {
      await this.notifications.recordAttempt({
        notificationId: notification.id,
        attemptNumber,
        status: "SKIPPED",
        errorType: "Configuration",
        errorMessage: "webhook URL not configured",
        startedAt,
        completedAt: this.now(),
      });
      await this.notifications.markSkipped(notification.id, "webhook URL not configured");
      return "SKIPPED";
    }

    const prepared: PreparedResearchNotification = {
      id: notification.id,
      eventType: notification.eventType,
      channelType: notification.channelType,
      title: notification.title,
      message: notification.message,
      payload:
        notification.payload && typeof notification.payload === "object"
          ? (notification.payload as Record<string, unknown>)
          : {},
    };

    try {
      const result = await provider.send(prepared);
      if (result.ok) {
        await this.notifications.recordAttempt({
          notificationId: notification.id,
          attemptNumber,
          status: "SENT",
          httpStatus: result.httpStatus ?? null,
          startedAt,
          completedAt: this.now(),
        });
        await this.notifications.markSent(notification.id, this.now());
        return "SENT";
      }
      if (result.skipped) {
        await this.notifications.recordAttempt({
          notificationId: notification.id,
          attemptNumber,
          status: "SKIPPED",
          errorType: result.errorType ?? null,
          errorMessage: result.errorMessage ?? null,
          startedAt,
          completedAt: this.now(),
        });
        await this.notifications.markSkipped(
          notification.id,
          result.errorMessage ?? "notification skipped",
        );
        return "SKIPPED";
      }

      const safeMessage = result.errorMessage ?? "notification send failed";
      await this.notifications.recordAttempt({
        notificationId: notification.id,
        attemptNumber,
        status: "FAILED",
        httpStatus: result.httpStatus ?? null,
        errorType: result.errorType ?? null,
        errorMessage: safeMessage,
        startedAt,
        completedAt: this.now(),
      });
      await this.notifications.markFailed(notification.id, safeMessage, this.now());
      return "FAILED";
    } catch (error) {
      const safeMessage = toSafeErrorMessage(error);
      await this.notifications.recordAttempt({
        notificationId: notification.id,
        attemptNumber,
        status: "FAILED",
        errorType: "Unknown",
        errorMessage: safeMessage,
        startedAt,
        completedAt: this.now(),
      });
      await this.notifications.markFailed(notification.id, safeMessage, this.now());
      return "FAILED";
    }
  }

  private buildPayload(
    eventType: ResearchNotificationEventType,
    context: NotificationContext,
  ): Record<string, unknown> {
    return {
      eventType,
      occurredAt: this.now().toISOString(),
      schedule: context.schedule
        ? {
            id: context.schedule.id,
            name: context.schedule.name,
            providerName: context.schedule.providerName,
          }
        : null,
      run: context.run
        ? {
            id: context.run.id,
            status: context.run.status,
            triggerType: context.run.triggerType,
            retryAttempt: context.run.retryAttempt,
          }
        : null,
      job: {
        id: context.job?.id ?? context.run?.jobId ?? null,
        fetchedCount: context.job?.fetchedCount ?? 0,
        savedCount: context.job?.savedCount ?? 0,
        updatedCount: context.job?.updatedCount ?? 0,
        errorCount: context.job?.errorCount ?? 0,
      },
      error: context.errorType || context.errorMessage
        ? {
            type: context.errorType ?? "Unknown",
            message: context.errorMessage ? toSafeErrorMessage(new Error(context.errorMessage)) : null,
          }
        : null,
      retry: {
        scheduled: context.retryScheduled === true,
        nextRetryAt: context.nextRetryAt?.toISOString() ?? null,
      },
      content: context.content
        ? {
            contentId: context.content.contentId ?? null,
            candidateId: context.content.candidateId ?? null,
            contentType: context.content.contentType ?? null,
            status: context.content.status ?? null,
          }
        : null,
      x: context.x
        ? {
            publicationId: context.x.publicationId ?? null,
            postId: context.x.postId ?? null,
            status: context.x.status ?? null,
          }
        : null,
    };
  }

  private buildTitle(
    eventType: ResearchNotificationEventType,
    context: NotificationContext,
  ): string {
    const name = context.schedule?.name ?? "schedule";
    return `${eventType}: ${name}`;
  }

  private buildMessage(
    eventType: ResearchNotificationEventType,
    context: NotificationContext,
  ): string {
    const parts = [
      eventType,
      context.schedule ? `schedule=${context.schedule.id}` : null,
      context.run ? `run=${context.run.id}` : null,
      context.errorType ? `errorType=${context.errorType}` : null,
    ].filter(Boolean);
    return parts.join(" ");
  }
}
