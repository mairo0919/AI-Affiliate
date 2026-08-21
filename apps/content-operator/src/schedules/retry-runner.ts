import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, ScheduleParameters } from "@ai-affiliate/database";
import {
  JobRepository,
  LockError,
  ScheduleRepository,
} from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import type { ResearchSchedule, ResearchScheduleRun } from "@ai-affiliate/database";
import {
  CollectionJobRunner,
  type CollectionJobParams,
  type CollectionJobRunResult,
  type PageCollectionProvider,
} from "../jobs/collection-job-runner.js";
import { classifyErrorType } from "../jobs/errors.js";
import { FanzaPageCollectionProvider } from "../jobs/fanza-page-provider.js";
import type { NotificationService } from "../notifications/notification-service.js";
import {
  FanzaResearchProvider,
  isConfigurationIncomplete,
  toSafeErrorMessage,
} from "../providers/index.js";
import { requireDmmCredentials } from "@ai-affiliate/config";
import { MockDynamicPaginatedProvider } from "../providers/mock/dynamic-paginated.js";
import { applyRetryAndNotify, notifySuccess } from "./run-effects.js";
import { resolveJobFailureError } from "./job-failure-error.js";

export interface RetryRunnerDeps {
  logger: Logger;
  database: DatabaseClient;
  schedules: ScheduleRepository;
  jobs: JobRepository;
  config: AppConfig;
  notifications?: NotificationService | null;
  batchSize?: number;
  now?: () => Date;
  random?: () => number;
  createProvider?: (schedule: ResearchSchedule) => PageCollectionProvider;
  failureLimit?: number;
}

export interface RetryRunOutcome {
  sourceRunId: string;
  rootRunId: string;
  retryRunId: string | null;
  scheduleId: string;
  scheduleName: string;
  jobId: string | null;
  retryAttempt: number;
  status: string;
  nextRetryAt: Date | null;
  fetchedCount: number;
  savedCount: number;
  updatedCount: number;
  errorCount: number;
  executionTime: number;
  errorMessage?: string;
}

function asParameters(value: unknown): ScheduleParameters {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as ScheduleParameters;
  }
  return {};
}

function toJobParams(parameters: ScheduleParameters, config: AppConfig): CollectionJobParams {
  return {
    service: typeof parameters.service === "string" ? parameters.service : config.fanzaDefaultService,
    floor: typeof parameters.floor === "string" ? parameters.floor : config.fanzaDefaultFloor,
    keyword: typeof parameters.keyword === "string" ? parameters.keyword : undefined,
    sort: typeof parameters.sort === "string" ? parameters.sort : undefined,
    hits:
      typeof parameters.hits === "number" && Number.isFinite(parameters.hits)
        ? parameters.hits
        : config.fanzaDefaultHits,
    startOffset:
      typeof parameters.startOffset === "number" && Number.isFinite(parameters.startOffset)
        ? parameters.startOffset
        : 1,
    maxPages:
      typeof parameters.maxPages === "number" && Number.isFinite(parameters.maxPages)
        ? parameters.maxPages
        : 1,
    maxItems:
      typeof parameters.maxItems === "number" && Number.isFinite(parameters.maxItems)
        ? parameters.maxItems
        : undefined,
    fromDate: typeof parameters.fromDate === "string" ? parameters.fromDate : undefined,
    toDate: typeof parameters.toDate === "string" ? parameters.toDate : undefined,
    dryRun: parameters.dryRun === true,
    continueOnItemError: parameters.continueOnItemError !== false,
  };
}

export class RetryRunner {
  private readonly logger: Logger;
  private readonly database: DatabaseClient;
  private readonly schedules: ScheduleRepository;
  private readonly jobs: JobRepository;
  private readonly config: AppConfig;
  private readonly notifications: NotificationService | null;
  private readonly batchSize: number;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly createProviderOverride?: (schedule: ResearchSchedule) => PageCollectionProvider;
  private readonly failureLimit: number;

  constructor(deps: RetryRunnerDeps) {
    this.logger = deps.logger;
    this.database = deps.database;
    this.schedules = deps.schedules;
    this.jobs = deps.jobs;
    this.config = deps.config;
    this.notifications = deps.notifications ?? null;
    this.batchSize = deps.batchSize ?? 20;
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? Math.random;
    this.createProviderOverride = deps.createProvider;
    this.failureLimit = deps.failureLimit ?? deps.config.researchScheduleFailureLimit;
  }

  async runDueRetries(): Promise<RetryRunOutcome[]> {
    if (!this.config.researchRetryEnabled) {
      return [];
    }
    const due = await this.schedules.findDueRetries(this.now(), this.batchSize);
    const outcomes: RetryRunOutcome[] = [];
    for (const source of due) {
      try {
        outcomes.push(await this.executeRetry(source));
      } catch (error) {
        this.logger.warn(
          `retry execution error sourceRunId=${source.id} (${toSafeErrorMessage(error)})`,
        );
        outcomes.push({
          sourceRunId: source.id,
          rootRunId: source.rootRunId ?? source.id,
          retryRunId: null,
          scheduleId: source.scheduleId,
          scheduleName: "",
          jobId: null,
          retryAttempt: source.retryAttempt + 1,
          status: "FAILED",
          nextRetryAt: source.nextRetryAt,
          fetchedCount: 0,
          savedCount: 0,
          updatedCount: 0,
          errorCount: 1,
          executionTime: 0,
          errorMessage: toSafeErrorMessage(error),
        });
      }
    }
    return outcomes;
  }

  private async executeRetry(source: ResearchScheduleRun): Promise<RetryRunOutcome> {
    const startedWall = Date.now();
    const schedule = await this.schedules.findScheduleById(source.scheduleId);
    if (!schedule || !schedule.isActive || schedule.deletedAt) {
      await this.schedules.clearNextRetryAt(source.id);
      return {
        sourceRunId: source.id,
        rootRunId: source.rootRunId ?? source.id,
        retryRunId: null,
        scheduleId: source.scheduleId,
        scheduleName: schedule?.name ?? "",
        jobId: null,
        retryAttempt: source.retryAttempt + 1,
        status: "SKIPPED",
        nextRetryAt: null,
        fetchedCount: 0,
        savedCount: 0,
        updatedCount: 0,
        errorCount: 0,
        executionTime: Date.now() - startedWall,
        errorMessage: "schedule inactive or deleted",
      };
    }

    const rootRunId = source.rootRunId ?? source.id;
    const activeRetry = await this.schedules.findActiveRetryForRoot(rootRunId);
    if (activeRetry) {
      return {
        sourceRunId: source.id,
        rootRunId,
        retryRunId: activeRetry.id,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        jobId: activeRetry.jobId,
        retryAttempt: activeRetry.retryAttempt,
        status: "SKIPPED",
        nextRetryAt: source.nextRetryAt,
        fetchedCount: 0,
        savedCount: 0,
        updatedCount: 0,
        errorCount: 0,
        executionTime: Date.now() - startedWall,
        errorMessage: "active retry already running",
      };
    }

    let ownerToken: string | null = null;
    try {
      ownerToken = await this.schedules.acquireScheduleLock(schedule.id);
    } catch (error) {
      if (error instanceof LockError) {
        return {
          sourceRunId: source.id,
          rootRunId,
          retryRunId: null,
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          jobId: null,
          retryAttempt: source.retryAttempt + 1,
          status: "SKIPPED",
          nextRetryAt: source.nextRetryAt,
          fetchedCount: 0,
          savedCount: 0,
          updatedCount: 0,
          errorCount: 0,
          executionTime: Date.now() - startedWall,
          errorMessage: "schedule lock held",
        };
      }
      throw error;
    }

    try {
      // Re-check and claim the retry slot
      const freshSource = await this.schedules.findRunById(source.id);
      if (!freshSource?.nextRetryAt || freshSource.nextRetryAt.getTime() > this.now().getTime()) {
        return {
          sourceRunId: source.id,
          rootRunId,
          retryRunId: null,
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          jobId: null,
          retryAttempt: source.retryAttempt + 1,
          status: "SKIPPED",
          nextRetryAt: freshSource?.nextRetryAt ?? null,
          fetchedCount: 0,
          savedCount: 0,
          updatedCount: 0,
          errorCount: 0,
          executionTime: Date.now() - startedWall,
          errorMessage: "retry no longer due",
        };
      }

      await this.schedules.clearNextRetryAt(source.id);

      const retryAttempt = source.retryAttempt + 1;
      const scheduledFor = freshSource.nextRetryAt;
      const retryRun = await this.schedules.recordScheduleRun({
        scheduleId: schedule.id,
        triggerType: "RETRY",
        scheduledFor,
        status: "RUNNING",
        startedAt: this.now(),
        retryOfRunId: source.id,
        rootRunId,
        retryAttempt,
        maxRetryAttempts: source.maxRetryAttempts ?? this.config.researchRetryMaxAttempts,
      });

      const previousFailureCount = schedule.consecutiveFailureCount;
      let jobResult: CollectionJobRunResult | null = null;
      try {
        const provider = this.createProvider(schedule);
        const runner = new CollectionJobRunner({
          logger: this.logger,
          database: this.database,
          jobs: this.jobs,
          requestIntervalMs: schedule.providerName === "fanza" ? this.config.fanzaRequestIntervalMs : 0,
        });
        jobResult = await runner.run(provider, toJobParams(asParameters(schedule.parameters), this.config));
      } catch (error) {
        if (isConfigurationIncomplete(error)) {
          await this.schedules.completeScheduleRun({
            runId: retryRun.id,
            status: "SKIPPED",
            errorMessage: "configuration incomplete",
            errorType: "Configuration",
          });
          return {
            sourceRunId: source.id,
            rootRunId,
            retryRunId: retryRun.id,
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            jobId: null,
            retryAttempt,
            status: "SKIPPED",
            nextRetryAt: null,
            fetchedCount: 0,
            savedCount: 0,
            updatedCount: 0,
            errorCount: 0,
            executionTime: Date.now() - startedWall,
            errorMessage: "configuration incomplete",
          };
        }

        const safeMessage = toSafeErrorMessage(error);
        const errorType = classifyErrorType(error);
        await this.schedules.failScheduleRun(retryRun.id, safeMessage);
        const failedRun = await this.schedules.findRunById(retryRun.id);
        const updatedSchedule = await this.bumpFailure(schedule, null);
        const decision = await applyRetryAndNotify({
          schedules: this.schedules,
          notifications: this.notifications,
          config: this.config,
          schedule: updatedSchedule,
          run: failedRun ?? retryRun,
          error,
          errorMessage: safeMessage,
          previousFailureCount,
          autoPaused: !updatedSchedule.isActive && schedule.isActive,
          now: this.now(),
          random: this.random,
        });
        // Store errorType on run
        await this.schedules.completeScheduleRun({
          runId: retryRun.id,
          status: "FAILED",
          errorMessage: safeMessage,
          errorType,
          nextRetryAt: decision.nextRetryAt,
        });

        return {
          sourceRunId: source.id,
          rootRunId,
          retryRunId: retryRun.id,
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          jobId: null,
          retryAttempt,
          status: "FAILED",
          nextRetryAt: decision.nextRetryAt,
          fetchedCount: 0,
          savedCount: 0,
          updatedCount: 0,
          errorCount: 1,
          executionTime: Date.now() - startedWall,
          errorMessage: safeMessage,
        };
      }

      const runStatus =
        jobResult.status === "COMPLETED"
          ? "COMPLETED"
          : jobResult.status === "PARTIALLY_COMPLETED"
            ? "PARTIALLY_COMPLETED"
            : "FAILED";

      await this.schedules.completeScheduleRun({
        runId: retryRun.id,
        status: runStatus,
        jobId: jobResult.jobId,
        errorMessage: runStatus === "FAILED" ? `job status ${jobResult.status}` : null,
        errorType: runStatus === "FAILED" ? "Job" : null,
      });

      const completedRun = (await this.schedules.findRunById(retryRun.id)) ?? retryRun;

      if (runStatus === "COMPLETED" || runStatus === "PARTIALLY_COMPLETED") {
        await this.schedules.markScheduleAfterRun({
          scheduleId: schedule.id,
          lastRunAt: this.now(),
          lastJobId: jobResult.jobId,
          resetFailures: true,
        });
        await notifySuccess({
          notifications: this.notifications,
          schedule,
          run: completedRun,
          job: jobResult,
          previousFailureCount,
          partiallyCompleted: runStatus === "PARTIALLY_COMPLETED",
        });
        return {
          sourceRunId: source.id,
          rootRunId,
          retryRunId: retryRun.id,
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          jobId: jobResult.jobId,
          retryAttempt,
          status: runStatus,
          nextRetryAt: null,
          fetchedCount: jobResult.fetchedCount,
          savedCount: jobResult.savedCount,
          updatedCount: jobResult.updatedCount,
          errorCount: jobResult.errorCount,
          executionTime: Date.now() - startedWall,
        };
      }

      const jobError = await resolveJobFailureError(this.jobs, jobResult.jobId, jobResult.status);

      const updatedSchedule = await this.bumpFailure(schedule, jobResult.jobId);
      const decision = await applyRetryAndNotify({
        schedules: this.schedules,
        notifications: this.notifications,
        config: this.config,
        schedule: updatedSchedule,
        run: completedRun,
        job: jobResult,
        error: jobError,
        errorMessage: jobError.message,
        previousFailureCount,
        autoPaused: !updatedSchedule.isActive && schedule.isActive,
        now: this.now(),
        random: this.random,
      });

      return {
        sourceRunId: source.id,
        rootRunId,
        retryRunId: retryRun.id,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        jobId: jobResult.jobId,
        retryAttempt,
        status: "FAILED",
        nextRetryAt: decision.nextRetryAt,
        fetchedCount: jobResult.fetchedCount,
        savedCount: jobResult.savedCount,
        updatedCount: jobResult.updatedCount,
        errorCount: jobResult.errorCount,
        executionTime: Date.now() - startedWall,
        errorMessage: jobError.message,
      };
    } finally {
      if (ownerToken) {
        await this.schedules.releaseScheduleLock(schedule.id, ownerToken);
      }
    }
  }

  private async bumpFailure(
    schedule: ResearchSchedule,
    jobId: string | null,
  ): Promise<ResearchSchedule> {
    const incremented = await this.schedules.markScheduleAfterRun({
      scheduleId: schedule.id,
      lastRunAt: this.now(),
      lastJobId: jobId,
      incrementFailures: true,
    });
    if (incremented.consecutiveFailureCount >= this.failureLimit) {
      return this.schedules.markScheduleAfterRun({
        scheduleId: schedule.id,
        lastRunAt: incremented.lastRunAt ?? this.now(),
        lastJobId: jobId,
        deactivate: true,
      });
    }
    return incremented;
  }

  private createProvider(schedule: ResearchSchedule): PageCollectionProvider {
    if (this.createProviderOverride) {
      return this.createProviderOverride(schedule);
    }
    if (schedule.providerName === "mock") {
      return new MockDynamicPaginatedProvider({
        titlePrefix: `retry-${schedule.id.slice(0, 8)}`,
      });
    }
    if (schedule.providerName === "fanza") {
      requireDmmCredentials(this.config);
      const provider = new FanzaResearchProvider({
        config: this.config,
        logger: this.logger,
      });
      const parameters = asParameters(schedule.parameters);
      return new FanzaPageCollectionProvider(provider, {
        service: typeof parameters.service === "string" ? parameters.service : undefined,
        floor: typeof parameters.floor === "string" ? parameters.floor : undefined,
        keyword: typeof parameters.keyword === "string" ? parameters.keyword : undefined,
        sort: typeof parameters.sort === "string" ? parameters.sort : undefined,
        fromDate: typeof parameters.fromDate === "string" ? parameters.fromDate : undefined,
        toDate: typeof parameters.toDate === "string" ? parameters.toDate : undefined,
      });
    }
    throw new Error(`unsupported provider: ${schedule.providerName}`);
  }
}
