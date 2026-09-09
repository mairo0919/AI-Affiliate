import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, ScheduleParameters } from "@ai-affiliate/database";
import {
  DEFAULT_SCHEDULE_GRACE_MS,
  DEFAULT_SCHEDULER_BATCH_SIZE,
  JobRepository,
  LockError,
  ScheduleRepository,
} from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import type { ResearchSchedule, ResearchScheduleRun, ResearchScheduleTriggerType } from "@ai-affiliate/database";
import {
  CollectionJobRunner,
  type CollectionJobParams,
  type CollectionJobRunResult,
  type PageCollectionProvider,
} from "../jobs/collection-job-runner.js";
import { FanzaPageCollectionProvider } from "../jobs/fanza-page-provider.js";
import {
  FanzaResearchProvider,
  isConfigurationIncomplete,
  toSafeErrorMessage,
} from "../providers/index.js";
import { MockDynamicPaginatedProvider } from "../providers/mock/dynamic-paginated.js";
import type { NotificationService } from "../notifications/notification-service.js";
import { researchProviderAvailability } from "../adapters/affiliate/provider-status.js";
import { computeNextRunAt, isWithinGraceWindow } from "./cron.js";
import { applyRetryAndNotify, notifySuccess } from "./run-effects.js";
import { resolveJobFailureError } from "./job-failure-error.js";

export interface ScheduleRunnerDeps {
  logger: Logger;
  database: DatabaseClient;
  schedules: ScheduleRepository;
  jobs: JobRepository;
  config: AppConfig;
  failureLimit?: number;
  graceMs?: number;
  batchSize?: number;
  now?: () => Date;
  random?: () => number;
  notifications?: NotificationService | null;
  /** Test hook to override provider creation */
  createProvider?: (schedule: ResearchSchedule) => PageCollectionProvider;
}

export interface ScheduleRunOutcome {
  scheduleId: string;
  scheduleName: string;
  runId: string | null;
  jobId: string | null;
  triggerType: ResearchScheduleTriggerType;
  status: string;
  scheduledFor: Date | null;
  nextRunAt: Date | null;
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

function countsFromResult(result: CollectionJobRunResult | null): Pick<
  ScheduleRunOutcome,
  "fetchedCount" | "savedCount" | "updatedCount" | "errorCount"
> {
  return {
    fetchedCount: result?.fetchedCount ?? 0,
    savedCount: result?.savedCount ?? 0,
    updatedCount: result?.updatedCount ?? 0,
    errorCount: result?.errorCount ?? 0,
  };
}

export class ScheduleRunner {
  private readonly logger: Logger;
  private readonly database: DatabaseClient;
  private readonly schedules: ScheduleRepository;
  private readonly jobs: JobRepository;
  private readonly config: AppConfig;
  private readonly failureLimit: number;
  private readonly graceMs: number;
  private readonly batchSize: number;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly notifications: NotificationService | null;
  private readonly createProviderOverride?: (schedule: ResearchSchedule) => PageCollectionProvider;

  constructor(deps: ScheduleRunnerDeps) {
    this.logger = deps.logger;
    this.database = deps.database;
    this.schedules = deps.schedules;
    this.jobs = deps.jobs;
    this.config = deps.config;
    this.failureLimit = deps.failureLimit ?? deps.config.researchScheduleFailureLimit;
    this.graceMs = deps.graceMs ?? deps.config.researchScheduleGraceMs ?? DEFAULT_SCHEDULE_GRACE_MS;
    this.batchSize = deps.batchSize ?? DEFAULT_SCHEDULER_BATCH_SIZE;
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? Math.random;
    this.notifications = deps.notifications ?? null;
    this.createProviderOverride = deps.createProvider;
  }

  async runDueSchedules(): Promise<ScheduleRunOutcome[]> {
    const now = this.now();
    const due = await this.schedules.findDueSchedules(now, this.batchSize);
    const outcomes: ScheduleRunOutcome[] = [];
    for (const schedule of due) {
      try {
        outcomes.push(await this.executeSchedule(schedule, "SCHEDULED", schedule.nextRunAt));
      } catch (error) {
        this.logger.warn(
          `schedule execution error scheduleId=${schedule.id} (${toSafeErrorMessage(error)})`,
        );
      }
    }
    return outcomes;
  }

  async runManual(scheduleId: string): Promise<ScheduleRunOutcome> {
    const schedule = await this.schedules.findScheduleById(scheduleId);
    if (!schedule) {
      throw new Error(`Schedule not found: ${scheduleId}`);
    }
    return this.executeSchedule(schedule, "MANUAL", this.now());
  }

  private async executeSchedule(
    schedule: ResearchSchedule,
    triggerType: ResearchScheduleTriggerType,
    scheduledFor: Date | null,
  ): Promise<ScheduleRunOutcome> {
    const startedWall = Date.now();
    let ownerToken: string | null = null;

    try {
      ownerToken = await this.schedules.acquireScheduleLock(schedule.id);
    } catch (error) {
      if (error instanceof LockError) {
        return this.recordSkipOutcome({
          schedule,
          triggerType,
          scheduledFor,
          reason: "schedule lock held by another process",
          countFailure: false,
          startedWall,
          createRun: false,
        });
      }
      throw error;
    }

    try {
      const fresh = await this.schedules.findScheduleById(schedule.id);
      if (!fresh || fresh.deletedAt) {
        return this.finishSkip({
          schedule,
          triggerType,
          scheduledFor,
          reason: "schedule not found or deleted",
          countFailure: false,
          startedWall,
          advanceNext: false,
        });
      }

      if (!fresh.isActive && triggerType === "SCHEDULED") {
        return this.finishSkip({
          schedule: fresh,
          triggerType,
          scheduledFor,
          reason: "schedule inactive",
          countFailure: false,
          startedWall,
          advanceNext: false,
        });
      }

      if (triggerType === "SCHEDULED" && scheduledFor) {
        if (!isWithinGraceWindow(scheduledFor, this.now(), this.graceMs)) {
          const nextRunAt = this.safeNextRunAt(fresh, this.now());
          const run = await this.safeRecordRun({
            scheduleId: fresh.id,
            triggerType,
            scheduledFor,
            status: "SKIPPED",
            startedAt: this.now(),
            errorMessage: "missed schedule window (beyond grace)",
          });
          if (run) {
            await this.schedules.completeScheduleRun({
              runId: run.id,
              status: "SKIPPED",
              errorMessage: "missed schedule window (beyond grace)",
            });
          }
          await this.schedules.markScheduleAfterRun({
            scheduleId: fresh.id,
            lastRunAt: this.now(),
            nextRunAt,
            resetFailures: false,
            incrementFailures: false,
          });
          return {
            scheduleId: fresh.id,
            scheduleName: fresh.name,
            runId: run?.id ?? null,
            jobId: null,
            triggerType,
            status: "SKIPPED",
            scheduledFor,
            nextRunAt,
            ...countsFromResult(null),
            executionTime: Date.now() - startedWall,
            errorMessage: "missed schedule window (beyond grace)",
          };
        }

        const existing = await this.schedules.findRunByScheduleAndScheduledFor(
          fresh.id,
          scheduledFor,
        );
        if (existing) {
          const nextRunAt =
            fresh.nextRunAt && fresh.nextRunAt.getTime() <= scheduledFor.getTime()
              ? this.safeNextRunAt(fresh, this.now())
              : fresh.nextRunAt;
          if (nextRunAt && nextRunAt.getTime() !== (fresh.nextRunAt?.getTime() ?? -1)) {
            await this.schedules.updateNextRunAt(fresh.id, nextRunAt);
          }
          return {
            scheduleId: fresh.id,
            scheduleName: fresh.name,
            runId: existing.id,
            jobId: existing.jobId,
            triggerType,
            status: "SKIPPED",
            scheduledFor,
            nextRunAt,
            ...countsFromResult(null),
            executionTime: Date.now() - startedWall,
            errorMessage: "same scheduledFor already executed",
          };
        }
      }

      const active = await this.schedules.findActiveRunForSchedule(fresh.id);
      if (active) {
        return this.finishSkip({
          schedule: fresh,
          triggerType,
          scheduledFor,
          reason: "schedule already has an active run",
          countFailure: false,
          startedWall,
          advanceNext: triggerType === "SCHEDULED",
        });
      }

      const providerCheck = this.checkProviderReady(fresh);
      if (providerCheck) {
        return this.finishSkip({
          schedule: fresh,
          triggerType,
          scheduledFor,
          reason: providerCheck,
          countFailure: false,
          startedWall,
          advanceNext: triggerType === "SCHEDULED",
        });
      }

      let run;
      try {
        run = await this.schedules.recordScheduleRun({
          scheduleId: fresh.id,
          triggerType,
          scheduledFor,
          status: "RUNNING",
          startedAt: this.now(),
          retryAttempt: 0,
          maxRetryAttempts: this.config.researchRetryMaxAttempts,
        });
      } catch (error) {
        const message = toSafeErrorMessage(error);
        if (/Unique constraint|unique/i.test(message)) {
          return {
            scheduleId: fresh.id,
            scheduleName: fresh.name,
            runId: null,
            jobId: null,
            triggerType,
            status: "SKIPPED",
            scheduledFor,
            nextRunAt: fresh.nextRunAt,
            ...countsFromResult(null),
            executionTime: Date.now() - startedWall,
            errorMessage: "same scheduledFor already executed",
          };
        }
        throw error;
      }

      let jobResult: CollectionJobRunResult | null = null;
      try {
        const provider = this.createProvider(fresh);
        const params = toJobParams(asParameters(fresh.parameters), this.config);
        const runner = new CollectionJobRunner({
          logger: this.logger,
          database: this.database,
          jobs: this.jobs,
          requestIntervalMs:
            fresh.providerName === "fanza" ? this.config.fanzaRequestIntervalMs : 0,
        });
        jobResult = await runner.run(provider, params);
      } catch (error) {
        if (isConfigurationIncomplete(error)) {
          await this.schedules.completeScheduleRun({
            runId: run.id,
            status: "SKIPPED",
            errorMessage: "configuration incomplete (credentials or API approval pending)",
          });
          const nextRunAt =
            triggerType === "SCHEDULED" ? this.safeNextRunAt(fresh, this.now()) : fresh.nextRunAt;
          await this.schedules.markScheduleAfterRun({
            scheduleId: fresh.id,
            lastRunAt: this.now(),
            nextRunAt,
          });
          return {
            scheduleId: fresh.id,
            scheduleName: fresh.name,
            runId: run.id,
            jobId: null,
            triggerType,
            status: "SKIPPED",
            scheduledFor,
            nextRunAt,
            ...countsFromResult(null),
            executionTime: Date.now() - startedWall,
            errorMessage: "configuration incomplete (credentials or API approval pending)",
          };
        }

        const safeMessage = toSafeErrorMessage(error);
        await this.schedules.failScheduleRun(run.id, safeMessage);
        const previousFailureCount = fresh.consecutiveFailureCount;
        const updated = await this.applyFailure(fresh, triggerType, null);
        const runForRetry = await this.ensureRootRunId(run.id);
        await applyRetryAndNotify({
          schedules: this.schedules,
          notifications: this.notifications,
          config: this.config,
          schedule: updated,
          run: runForRetry,
          error,
          errorMessage: safeMessage,
          previousFailureCount,
          autoPaused: !updated.isActive && fresh.isActive,
          now: this.now(),
          random: this.random,
        });
        return {
          scheduleId: fresh.id,
          scheduleName: fresh.name,
          runId: run.id,
          jobId: null,
          triggerType,
          status: "FAILED",
          scheduledFor,
          nextRunAt: updated.nextRunAt,
          ...countsFromResult(null),
          executionTime: Date.now() - startedWall,
          errorMessage: safeMessage,
        };
      }

      const runStatus =
        jobResult.status === "COMPLETED"
          ? "COMPLETED"
          : jobResult.status === "PARTIALLY_COMPLETED"
            ? "PARTIALLY_COMPLETED"
            : jobResult.status === "CANCELLED"
              ? "FAILED"
              : "FAILED";

      await this.schedules.completeScheduleRun({
        runId: run.id,
        status: runStatus,
        jobId: jobResult.jobId,
        errorMessage: runStatus === "FAILED" ? `job status ${jobResult.status}` : null,
      });

      if (runStatus === "COMPLETED" || runStatus === "PARTIALLY_COMPLETED") {
        const previousFailureCount = fresh.consecutiveFailureCount;
        const nextRunAt =
          triggerType === "SCHEDULED" || fresh.scheduleType === "CRON"
            ? this.safeNextRunAt(fresh, this.now())
            : fresh.nextRunAt;
        await this.schedules.markScheduleAfterRun({
          scheduleId: fresh.id,
          lastRunAt: this.now(),
          lastJobId: jobResult.jobId,
          nextRunAt,
          resetFailures: true,
        });
        const completedRun = (await this.schedules.findRunById(run.id)) ?? run;
        await notifySuccess({
          notifications: this.notifications,
          schedule: fresh,
          run: completedRun,
          job: jobResult,
          previousFailureCount,
          partiallyCompleted: runStatus === "PARTIALLY_COMPLETED",
        });
        const refreshed = await this.schedules.findScheduleById(fresh.id);
        return {
          scheduleId: fresh.id,
          scheduleName: fresh.name,
          runId: run.id,
          jobId: jobResult.jobId,
          triggerType,
          status: runStatus,
          scheduledFor,
          nextRunAt: refreshed?.nextRunAt ?? nextRunAt,
          ...countsFromResult(jobResult),
          executionTime: Date.now() - startedWall,
        };
      }

      const previousFailureCount = fresh.consecutiveFailureCount;
      const updated = await this.applyFailure(fresh, triggerType, jobResult.jobId);
      const runForRetry = await this.ensureRootRunId(run.id);
      const jobError = await resolveJobFailureError(this.jobs, jobResult.jobId, jobResult.status);
      await applyRetryAndNotify({
        schedules: this.schedules,
        notifications: this.notifications,
        config: this.config,
        schedule: updated,
        run: runForRetry,
        job: jobResult,
        error: jobError,
        errorMessage: jobError.message,
        previousFailureCount,
        autoPaused: !updated.isActive && fresh.isActive,
        now: this.now(),
        random: this.random,
      });
      return {
        scheduleId: fresh.id,
        scheduleName: fresh.name,
        runId: run.id,
        jobId: jobResult.jobId,
        triggerType,
        status: "FAILED",
        scheduledFor,
        nextRunAt: updated.nextRunAt,
        ...countsFromResult(jobResult),
        executionTime: Date.now() - startedWall,
        errorMessage: jobError.message,
      };
    } finally {
      if (ownerToken) {
        await this.schedules.releaseScheduleLock(schedule.id, ownerToken);
      }
    }
  }

  private async ensureRootRunId(runId: string): Promise<ResearchScheduleRun> {
    const run = await this.schedules.findRunById(runId);
    if (!run) {
      throw new Error(`Schedule run not found: ${runId}`);
    }
    if (run.rootRunId) {
      return run;
    }
    return this.schedules.setRootRunId(runId, runId);
  }

  private checkProviderReady(schedule: ResearchSchedule): string | null {
    const availability = researchProviderAvailability(schedule.providerName, this.config);
    if (availability.available) return null;
    return availability.skipReason;
  }

  private createProvider(schedule: ResearchSchedule): PageCollectionProvider {
    if (this.createProviderOverride) {
      return this.createProviderOverride(schedule);
    }
    if (schedule.providerName === "mock") {
      return new MockDynamicPaginatedProvider({
        titlePrefix: `sched-${schedule.id.slice(0, 8)}`,
      });
    }
    if (schedule.providerName === "fanza") {
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
    // Future ASP adapters register here. Unknown providers are skipped via checkProviderReady;
    // this throw is a last-resort isolation boundary (caught per-schedule).
    throw new Error(
      `NOT_IMPLEMENTED: unsupported research provider adapter: ${schedule.providerName}`,
    );
  }

  private safeNextRunAt(schedule: ResearchSchedule, after: Date): Date | null {
    if (schedule.scheduleType !== "CRON" || !schedule.cronExpression) {
      return null;
    }
    return computeNextRunAt({
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      after,
    });
  }

  private async applyFailure(
    schedule: ResearchSchedule,
    triggerType: ResearchScheduleTriggerType,
    jobId: string | null,
  ): Promise<ResearchSchedule> {
    const nextRunAt =
      triggerType === "SCHEDULED" || schedule.scheduleType === "CRON"
        ? this.safeNextRunAt(schedule, this.now())
        : schedule.nextRunAt;
    const incremented = await this.schedules.markScheduleAfterRun({
      scheduleId: schedule.id,
      lastRunAt: this.now(),
      lastJobId: jobId,
      nextRunAt,
      incrementFailures: true,
    });
    if (incremented.consecutiveFailureCount >= this.failureLimit) {
      return this.schedules.markScheduleAfterRun({
        scheduleId: schedule.id,
        lastRunAt: incremented.lastRunAt ?? this.now(),
        lastJobId: jobId,
        nextRunAt: incremented.nextRunAt,
        deactivate: true,
      });
    }
    return incremented;
  }

  private async finishSkip(input: {
    schedule: ResearchSchedule;
    triggerType: ResearchScheduleTriggerType;
    scheduledFor: Date | null;
    reason: string;
    countFailure: boolean;
    startedWall: number;
    advanceNext: boolean;
  }): Promise<ScheduleRunOutcome> {
    const run = await this.safeRecordRun({
      scheduleId: input.schedule.id,
      triggerType: input.triggerType,
      scheduledFor: input.scheduledFor,
      status: "SKIPPED",
      startedAt: this.now(),
      errorMessage: input.reason,
    });
    if (run) {
      await this.schedules.completeScheduleRun({
        runId: run.id,
        status: "SKIPPED",
        errorMessage: input.reason,
      });
    }

    let nextRunAt = input.schedule.nextRunAt;
    if (input.advanceNext && input.triggerType === "SCHEDULED") {
      nextRunAt = this.safeNextRunAt(input.schedule, this.now());
      await this.schedules.markScheduleAfterRun({
        scheduleId: input.schedule.id,
        lastRunAt: this.now(),
        nextRunAt,
        incrementFailures: input.countFailure,
      });
    }

    return {
      scheduleId: input.schedule.id,
      scheduleName: input.schedule.name,
      runId: run?.id ?? null,
      jobId: null,
      triggerType: input.triggerType,
      status: "SKIPPED",
      scheduledFor: input.scheduledFor,
      nextRunAt,
      ...countsFromResult(null),
      executionTime: Date.now() - input.startedWall,
      errorMessage: input.reason,
    };
  }

  private async recordSkipOutcome(input: {
    schedule: ResearchSchedule;
    triggerType: ResearchScheduleTriggerType;
    scheduledFor: Date | null;
    reason: string;
    countFailure: boolean;
    startedWall: number;
    createRun: boolean;
  }): Promise<ScheduleRunOutcome> {
    let runId: string | null = null;
    if (input.createRun) {
      const run = await this.safeRecordRun({
        scheduleId: input.schedule.id,
        triggerType: input.triggerType,
        scheduledFor: input.scheduledFor,
        status: "SKIPPED",
        startedAt: this.now(),
        errorMessage: input.reason,
      });
      runId = run?.id ?? null;
      if (run) {
        await this.schedules.completeScheduleRun({
          runId: run.id,
          status: "SKIPPED",
          errorMessage: input.reason,
        });
      }
    }
    return {
      scheduleId: input.schedule.id,
      scheduleName: input.schedule.name,
      runId,
      jobId: null,
      triggerType: input.triggerType,
      status: "SKIPPED",
      scheduledFor: input.scheduledFor,
      nextRunAt: input.schedule.nextRunAt,
      ...countsFromResult(null),
      executionTime: Date.now() - input.startedWall,
      errorMessage: input.reason,
    };
  }

  private async safeRecordRun(input: {
    scheduleId: string;
    triggerType: ResearchScheduleTriggerType;
    scheduledFor: Date | null;
    status: "SKIPPED" | "PENDING" | "RUNNING";
    startedAt: Date;
    errorMessage?: string;
  }) {
    try {
      return await this.schedules.recordScheduleRun(input);
    } catch (error) {
      const message = toSafeErrorMessage(error);
      if (/Unique constraint|unique/i.test(message)) {
        return null;
      }
      throw error;
    }
  }
}
