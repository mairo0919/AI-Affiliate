import type { CollectionResult, Logger } from "@ai-affiliate/shared";
import type { DatabaseClient, JobRepository } from "@ai-affiliate/database";
import {
  DEFAULT_LOCK_TTL_MS,
  LockError,
  ResearchRepository,
  buildLockKey,
} from "@ai-affiliate/database";
import { sanitizeForLog } from "../providers/fanza/dmm-api-error.js";
import {
  CancelledError,
  DatabaseError,
  classifyErrorType,
  isFatalConfigOrAuthError,
  isRetryableError,
} from "./errors.js";

export interface PageCollectionProvider {
  readonly providerName: string;
  collectPage(options: {
    offset: number;
    hits: number;
    [key: string]: unknown;
  }): Promise<CollectionResult>;
}

export interface CollectionJobParams {
  service?: string;
  floor?: string;
  keyword?: string;
  sort?: string;
  hits?: number;
  startOffset?: number;
  maxPages?: number;
  maxItems?: number;
  fromDate?: string;
  toDate?: string;
  dryRun?: boolean;
  continueOnItemError?: boolean;
  resumedFromJobId?: string;
  [key: string]: unknown;
}

export interface CollectionJobRunnerDeps {
  logger: Logger;
  database: DatabaseClient;
  jobs: JobRepository;
  sleepImpl?: (ms: number) => Promise<void>;
  requestIntervalMs?: number;
  lockTtlMs?: number;
  /** Live WP publish+future product keys — counted only, still upserted as enrichment. */
  wpProductKeys?: Set<string>;
  normalizeProductKey?: (raw: string | null | undefined) => string | null;
}

export interface CollectionJobRunResult {
  jobId: string;
  status: string;
  pagesProcessed: number;
  fetchedCount: number;
  mappedCount: number;
  savedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  /** Fetched items whose externalId already exists on WP publish/future. */
  wpDuplicateExcluded: number;
  currentOffset: number | null;
  nextOffset: number | null;
  elapsedMs: number;
  startOffset: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampHits(hits: number | undefined): number {
  const value = hits ?? 100;
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.min(100, Math.floor(value));
}

function clampMaxPages(maxPages: number | undefined): number {
  const value = maxPages ?? 1;
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.min(100, Math.floor(value));
}

export class CollectionJobRunner {
  private readonly logger: Logger;
  private readonly jobs: JobRepository;
  private readonly research: ResearchRepository;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly requestIntervalMs: number;
  private readonly lockTtlMs: number;
  private readonly wpProductKeys: Set<string>;
  private readonly normalizeProductKey:
    | ((raw: string | null | undefined) => string | null)
    | null;

  constructor(deps: CollectionJobRunnerDeps) {
    this.logger = deps.logger;
    this.jobs = deps.jobs;
    this.research = new ResearchRepository(deps.database.prisma);
    this.sleepImpl = deps.sleepImpl ?? defaultSleep;
    this.requestIntervalMs = deps.requestIntervalMs ?? 1000;
    this.lockTtlMs = deps.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
    this.wpProductKeys = deps.wpProductKeys ?? new Set();
    this.normalizeProductKey = deps.normalizeProductKey ?? null;
  }

  async run(
    provider: PageCollectionProvider,
    params: CollectionJobParams,
  ): Promise<CollectionJobRunResult> {
    const startedAt = Date.now();
    const hits = clampHits(params.hits);
    const maxPages = clampMaxPages(params.maxPages);
    const startOffset = Math.max(1, Math.floor(params.startOffset ?? 1));
    const continueOnItemError = params.continueOnItemError ?? true;
    const dryRun = params.dryRun ?? false;

    const lockKey = buildLockKey({
      providerName: provider.providerName,
      service: typeof params.service === "string" ? params.service : undefined,
      floor: typeof params.floor === "string" ? params.floor : undefined,
      keyword: typeof params.keyword === "string" ? params.keyword : undefined,
      sort: typeof params.sort === "string" ? params.sort : undefined,
      fromDate: typeof params.fromDate === "string" ? params.fromDate : undefined,
      toDate: typeof params.toDate === "string" ? params.toDate : undefined,
    });

    const job = await this.jobs.createJob({
      providerName: provider.providerName,
      jobType: maxPages === 1 && !params.maxItems ? "SINGLE_PAGE" : "PAGINATED_COLLECTION",
      parameters: {
        ...params,
        hits,
        maxPages,
        startOffset,
        dryRun,
        continueOnItemError,
      },
      currentOffset: startOffset,
      resumedFromJobId: params.resumedFromJobId,
    });

    try {
      await this.jobs.acquireLock(lockKey, job.id, this.lockTtlMs);
    } catch (error) {
      const message =
        error instanceof LockError ? error.message : "Failed to acquire job lock";
      await this.jobs.failJob(job.id, sanitizeForLog(message));
      throw error instanceof LockError ? error : new LockError(message);
    }

    let fetchedCount = 0;
    let mappedCount = 0;
    let savedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let wpDuplicateExcluded = 0;
    let pagesProcessed = 0;
    let currentOffset: number | null = startOffset;
    let nextOffset: number | null = startOffset;
    let hadItemErrors = false;
    let hadPageSuccess = false;
    const seenOffsets = new Set<number>();

    try {
      await this.jobs.startJob(job.id);

      while (pagesProcessed < maxPages) {
        if (await this.jobs.isCancelRequested(job.id)) {
          throw new CancelledError();
        }

        if (nextOffset === null) {
          break;
        }
        if (seenOffsets.has(nextOffset)) {
          this.logger.warn(
            `Stopping paginated job due to repeated nextOffset=${nextOffset} jobId=${job.id}`,
          );
          break;
        }
        seenOffsets.add(nextOffset);
        currentOffset = nextOffset;

        if (pagesProcessed > 0 && this.requestIntervalMs > 0) {
          await this.sleepImpl(this.requestIntervalMs);
        }

        if (await this.jobs.isCancelRequested(job.id)) {
          throw new CancelledError();
        }

        let pageResult: CollectionResult;
        try {
          pageResult = await provider.collectPage({
            ...params,
            offset: currentOffset,
            hits,
          });
        } catch (error) {
          const safeMessage = sanitizeForLog(
            error instanceof Error ? error.message : String(error),
          );
          await this.jobs.recordJobError({
            jobId: job.id,
            providerName: provider.providerName,
            stage: "collect",
            offset: currentOffset,
            errorType: classifyErrorType(error),
            message: safeMessage,
            retryable: isRetryableError(error),
          });
          errorCount += 1;

          if (hadPageSuccess && !isFatalConfigOrAuthError(error)) {
            await this.jobs.partiallyCompleteJob(job.id, safeMessage);
            return this.toResult(job.id, "PARTIALLY_COMPLETED", this.snapshotCounts({
              pagesProcessed,
              fetchedCount,
              mappedCount,
              savedCount,
              updatedCount,
              skippedCount,
              errorCount,
              wpDuplicateExcluded,
              currentOffset,
              nextOffset,
              elapsedMs: Date.now() - startedAt,
              startOffset,
            }));
          }
          await this.jobs.failJob(job.id, safeMessage);
          return this.toResult(job.id, "FAILED", this.snapshotCounts({
            pagesProcessed,
            fetchedCount,
            mappedCount,
            savedCount,
            updatedCount,
            skippedCount,
            errorCount,
            wpDuplicateExcluded,
            currentOffset,
            nextOffset,
            elapsedMs: Date.now() - startedAt,
            startOffset,
          }));
        }

        const pageFetched = pageResult.stats?.fetchedCount ?? pageResult.items.length;
        const pageMapped = pageResult.stats?.mappedCount ?? pageResult.items.length;
        const pageSkipped = pageResult.stats?.skippedCount ?? 0;
        const pageErrors = pageResult.stats?.errorCount ?? 0;

        fetchedCount += pageFetched;
        mappedCount += pageMapped;
        skippedCount += pageSkipped;
        errorCount += pageErrors;
        if (pageErrors > 0) {
          hadItemErrors = true;
          if (!continueOnItemError) {
            await this.jobs.recordJobError({
              jobId: job.id,
              providerName: provider.providerName,
              stage: "mapping",
              offset: currentOffset,
              errorType: "Mapping",
              message: "Item mapping errors occurred and continueOnItemError=false",
              retryable: false,
            });
          }
        }

        if (!dryRun) {
          try {
            if (this.wpProductKeys.size > 0 && this.normalizeProductKey) {
              for (const item of pageResult.items) {
                const key = this.normalizeProductKey(item.externalId);
                if (key && this.wpProductKeys.has(key)) {
                  wpDuplicateExcluded += 1;
                }
              }
            }
            const summary = await this.research.saveCollection(pageResult);
            savedCount += summary.createdCount;
            updatedCount += summary.updatedCount;
          } catch (error) {
            const safeMessage = sanitizeForLog(
              error instanceof Error ? error.message : String(error),
            );
            await this.jobs.recordJobError({
              jobId: job.id,
              providerName: provider.providerName,
              stage: "save",
              offset: currentOffset,
              errorType: "Database",
              message: safeMessage,
              retryable: false,
            });
            throw new DatabaseError(safeMessage, { cause: error });
          }
        } else if (this.wpProductKeys.size > 0 && this.normalizeProductKey) {
          for (const item of pageResult.items) {
            const key = this.normalizeProductKey(item.externalId);
            if (key && this.wpProductKeys.has(key)) {
              wpDuplicateExcluded += 1;
            }
          }
        }

        pagesProcessed += 1;
        hadPageSuccess = true;
        nextOffset = pageResult.nextOffset ?? null;

        await this.jobs.updateProgress(job.id, {
          currentOffset,
          nextOffset,
          fetchedCount,
          mappedCount,
          savedCount,
          updatedCount,
          skippedCount,
          errorCount,
          pagesProcessed,
          lastHeartbeatAt: new Date(),
        });
        await this.jobs.refreshLock(lockKey, job.id, this.lockTtlMs);

        if (pageFetched === 0) {
          break;
        }
        if (params.maxItems !== undefined && fetchedCount >= params.maxItems) {
          break;
        }
        if (nextOffset === null) {
          break;
        }
      }

      if (await this.jobs.isCancelRequested(job.id)) {
        throw new CancelledError();
      }

      const finalStatus = hadItemErrors ? "PARTIALLY_COMPLETED" : "COMPLETED";
      if (finalStatus === "COMPLETED") {
        await this.jobs.completeJob(job.id);
      } else {
        await this.jobs.partiallyCompleteJob(job.id);
      }

      return this.toResult(job.id, finalStatus, this.snapshotCounts({
        pagesProcessed,
        fetchedCount,
        mappedCount,
        savedCount,
        updatedCount,
        skippedCount,
        errorCount,
        wpDuplicateExcluded,
        currentOffset,
        nextOffset,
        elapsedMs: Date.now() - startedAt,
        startOffset,
      }));
    } catch (error) {
      if (error instanceof CancelledError) {
        await this.jobs.markCancelled(job.id);
        return this.toResult(job.id, "CANCELLED", this.snapshotCounts({
          pagesProcessed,
          fetchedCount,
          mappedCount,
          savedCount,
          updatedCount,
          skippedCount,
          errorCount,
          wpDuplicateExcluded,
          currentOffset,
          nextOffset,
          elapsedMs: Date.now() - startedAt,
          startOffset,
        }));
      }

      const safeMessage = sanitizeForLog(error instanceof Error ? error.message : String(error));
      await this.jobs.recordJobError({
        jobId: job.id,
        providerName: provider.providerName,
        stage: "job",
        offset: currentOffset ?? undefined,
        errorType: classifyErrorType(error),
        message: safeMessage,
        retryable: isRetryableError(error),
      });

      if (hadPageSuccess && !isFatalConfigOrAuthError(error)) {
        await this.jobs.partiallyCompleteJob(job.id, safeMessage);
        return this.toResult(job.id, "PARTIALLY_COMPLETED", this.snapshotCounts({
          pagesProcessed,
          fetchedCount,
          mappedCount,
          savedCount,
          updatedCount,
          skippedCount,
          errorCount: errorCount + 1,
          wpDuplicateExcluded,
          currentOffset,
          nextOffset,
          elapsedMs: Date.now() - startedAt,
          startOffset,
        }));
      }

      const latest = await this.jobs.findJobById(job.id);
      if (latest && latest.status === "RUNNING") {
        await this.jobs.failJob(job.id, safeMessage);
      }
      return this.toResult(job.id, "FAILED", this.snapshotCounts({
        pagesProcessed,
        fetchedCount,
        mappedCount,
        savedCount,
        updatedCount,
        skippedCount,
        errorCount: errorCount + 1,
        wpDuplicateExcluded,
        currentOffset,
        nextOffset,
        elapsedMs: Date.now() - startedAt,
        startOffset,
      }));
    } finally {
      await this.jobs.releaseLock(lockKey, job.id);
    }
  }

  async resume(
    provider: PageCollectionProvider,
    sourceJobId: string,
    overrides: Partial<CollectionJobParams> = {},
  ): Promise<CollectionJobRunResult> {
    const source = await this.jobs.findJobById(sourceJobId);
    if (!source) {
      throw new DatabaseError(`Job not found: ${sourceJobId}`);
    }
    if (source.status !== "FAILED" && source.status !== "PARTIALLY_COMPLETED") {
      throw new DatabaseError(`Job ${sourceJobId} cannot be resumed from status ${source.status}`);
    }

    const params = {
      ...(source.parameters as CollectionJobParams),
      ...overrides,
      startOffset: source.nextOffset ?? source.currentOffset ?? 1,
      resumedFromJobId: source.id,
    };

    return this.run(provider, params);
  }

  private snapshotCounts(
    counts: Omit<CollectionJobRunResult, "jobId" | "status">,
  ): Omit<CollectionJobRunResult, "jobId" | "status"> {
    return counts;
  }

  private toResult(
    jobId: string,
    status: string,
    counts: Omit<CollectionJobRunResult, "jobId" | "status">,
  ): CollectionJobRunResult {
    this.logger.info(
      `Job finished jobId=${jobId} status=${status} pages=${counts.pagesProcessed} fetched=${counts.fetchedCount} mapped=${counts.mappedCount} inserted=${counts.savedCount} updated=${counts.updatedCount} duplicates=${counts.updatedCount} wpDuplicateExcluded=${counts.wpDuplicateExcluded} offset=${counts.startOffset} nextOffset=${counts.nextOffset ?? "none"} errors=${counts.errorCount}`,
    );
    return { jobId, status, ...counts };
  }
}
