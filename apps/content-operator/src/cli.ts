import { loadConfig } from "@ai-affiliate/config";
import {
  AnalysisRepository,
  ContentRepository,
  ContentStateError,
  JobRepository,
  NotificationRepository,
  ResearchRepository,
  ScheduleRepository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import {
  ConfigurationError,
  FanzaResearchProvider,
  MockResearchProvider,
  TikTokResearchProvider,
  XResearchProvider,
  isConfigurationIncomplete,
  toSafeErrorMessage,
} from "./providers/index.js";
import type { FanzaCollectOptions } from "./providers/index.js";
import { ResearchService } from "./research-service.js";
import { DmmError } from "./providers/fanza/dmm-api-error.js";
import { CollectionJobRunner, FanzaPageCollectionProvider } from "./jobs/index.js";
import {
  CronValidationError,
  RetryRunner,
  ScheduleRunner,
  SchedulerPipeline,
  assertValidCronExpression,
  computeNextRunAt,
} from "./schedules/index.js";
import { NotificationService } from "./notifications/index.js";
import { AnalysisEngine } from "./analysis/index.js";
import {
  ContentEngine,
  parseContentStatusFlag,
  parseContentTypeFlag,
} from "./content/index.js";
import type { ContentTargetChannel, ScheduleParameters, ContentCandidateType } from "@ai-affiliate/database";
import {
  runXExperimentComplete,
  runXExperimentCreate,
  runXExperimentList,
  runXExperimentPause,
  runXExperimentShow,
  runXExperimentStart,
  runXMetricsCollect,
  runXMetricsList,
  runXPublicationCancel,
  runXPublicationCreate,
  runXPublicationList,
  runXPublicationPublish,
  runXPublicationRetry,
  runXPublicationSchedule,
  runXPublicationShow,
  runXPublisherRun,
  runXStrategyEvaluate,
  runXStrategyReport,
} from "./x/cli-handlers.js";
import {
  runXOptimizationApply,
  runXOptimizationApprove,
  runXOptimizationExpire,
  runXOptimizationFindings,
  runXOptimizationImpact,
  runXOptimizationList,
  runXOptimizationRecommendations,
  runXOptimizationReject,
  runXOptimizationRun,
  runXOptimizationShow,
  runXVariantExtract,
  runXVariantList,
  runXVariantShow,
} from "./x/optimization-cli-handlers.js";
import {
  runXAssistedCancel,
  runXAssistedPrepare,
  runXAssistedReview,
  runXAssistedSchedule,
  runXAssistedShow,
  runXOpsAudit,
  runXOpsBlocked,
  runXOpsCooldowns,
  runXOpsHealth,
  runXOpsLimits,
  runXOpsQueue,
  runXOpsStatus,
  runXRuntimePause,
  runXRuntimeResume,
  runXRuntimeStatus,
} from "./x/ops-cli-handlers.js";
import {
  runXAuthComplete,
  runXAuthRefresh,
  runXAuthRevoke,
  runXAuthStart,
  runXAuthStatus,
  runXAuthTest,
  runXBudgetPause,
  runXBudgetResume,
  runXBudgetSet,
  runXBudgetStatus,
  runXLiveDiagnose,
  runXLiveMetrics,
  runXLivePublish,
  runXLiveStatus,
  runXUsageReport,
  runXUsageStatus,
  runXUsageSync,
} from "./x/live-cli-handlers.js";
import {
  runLifecycleApprovePublication,
  runLifecycleCreateContent,
  runLifecycleCreatePublicationTarget,
  runLifecycleCreateStrategy,
  runLifecycleCreateTopic,
  runLifecycleEvaluatePolicy,
  runLifecycleInspect,
  runLifecycleMockPublish,
  runLifecycleRegisterClaim,
  runLifecycleReview,
  runLifecycleRunVertical,
  runLifecycleSeedProducts,
} from "./lifecycle/cli-handlers.js";
import {
  runOpsAnalyticsIngest,
  runOpsApprove,
  runOpsBloggerDraft,
  runOpsCreateTargets,
  runOpsGenerateContent,
  runOpsLinkReplaceApply,
  runOpsLinkReplaceApprove,
  runOpsLinkReplacePropose,
  runOpsListUnmonetized,
  runOpsP3P4Vertical,
  runOpsQueueRun,
  runOpsRegisterProduct,
  runOpsRegisterResearch,
  runOpsSetMonetization,
  runOpsXExport,
} from "./ops/cli-handlers.js";
import {
  runLocalFanzaResearchCollectCli,
  runStockGenerateCli,
  runWpFutureScheduleCli,
  runStockStatusCli,
  runStockPipelineCli,
  runConfirmFanzaImageTermsCli,
} from "./stock/cli-handlers.js";
import { runInitialPublishBoostCli } from "./stock/cli-initial-publish-boost.js";
import { runWpRefreshMetadataCli } from "./wordpress/cli-refresh-metadata.js";
import { runWpRefreshAdultTagsCli } from "./wordpress/cli-refresh-adult-tags.js";
import { runWpUpgradeImageResolutionCli } from "./wordpress/cli-upgrade-image-resolution.js";
import { runWpRefreshCategoriesCli } from "./wordpress/cli-refresh-categories.js";
import { runWpDeployOtonaselectThemeCli } from "./wordpress/cli-deploy-otonaselect-theme.js";
import { runWpDeployOtonaselectAgeGateCli } from "./wordpress/cli-deploy-otonaselect-age-gate.js";
import { runWpReflectMediaCli } from "./wordpress/cli-reflect-media.js";
import { runFanzaRefreshOfficialTaxonomyCli } from "./ops/cli-refresh-official-taxonomy.js";
import {
  runP45ApproveContent,
  runP45CreateBloggerDraft,
  runP45DeleteBloggerDraft,
  runP45GenerateBlogger,
  runP45GenerateX,
  runP45GetBloggerStatus,
  runP45LlmSmoke,
  runP45PrepareBloggerDraft,
  runP45ReviewContent,
  runP45ReviseContent,
  runP45SeedPrompts,
  runP45UpdateBloggerDraft,
  runP45Vertical,
} from "./generation/cli-handlers.js";
import {
  runBloggerAuthUrl,
  runBloggerExchangeCode,
  runBloggerListBlogs,
  runBloggerValidateAuth,
} from "./generation/blogger-auth-cli.js";
import {
  runAggregateAnalytics,
  runApproveExperiment,
  runCompleteExperiment,
  runEvaluateContent,
  runExperimentCli,
  runGenerateLearning,
  runP5VerticalCli,
  runStrategyFeedbackCli,
} from "./learning/cli-handlers.js";
import {
  runAffiliateResultsImport,
  runAnalyticsImportCsv,
  runAnalyticsImportJson,
  runAnalyticsListUnmatched,
  runAnalyticsMatch,
  runAnalyticsRejectMatch,
  runLearningActivate,
  runLearningApprove,
  runLearningConflicts,
  runLearningDeactivate,
  runLearningList,
  runLearningSuspend,
  runOpsJobStatus,
  runOpsResumeJob,
  runOpsRunCycle,
  runP6Vertical,
  runStrategyGenerateWithFeedback,
} from "./ops-p6/cli-handlers.js";
import {
  runBloggerCreateTestDraft,
  runLlmTest,
  runOpsDailyStatus,
  runP8Vertical,
  runP9Vertical,
  runProductionCheck,
  runProductionDiagnose,
  runProductionResearchUrl,
} from "./ops/p8-cli.js";

interface CliFlags {
  service?: string;
  floor?: string;
  keyword?: string;
  sort?: string;
  hits?: number;
  offset?: number;
  startOffset?: number;
  maxPages?: number;
  maxItems?: number;
  fromDate?: string;
  toDate?: string;
  jobId?: string;
  scheduleId?: string;
  notificationId?: string;
  analysisRunId?: string;
  externalId?: string;
  source?: string;
  name?: string;
  provider?: string;
  cron?: string;
  timezone?: string;
  scheduleType?: string;
  status?: string;
  type?: string;
  candidateType?: string;
  candidateLimit?: number;
  minimumScore?: number;
  limit?: number;
  includeRequiresConfirmation: boolean;
  dryRun: boolean;
  force: boolean;
  continueOnItemError?: boolean;
  candidateId?: string;
  contentId?: string;
  contentType?: string;
  targetChannel?: string;
  model?: string;
  promptVersion?: string;
  reviewer?: string;
  comment?: string;
  instruction?: string;
}

function parseNumberFlag(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  return undefined;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, includeRequiresConfirmation: false, force: false };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      flags.dryRun = true;
      continue;
    }
    if (arg === "--force") {
      flags.force = true;
      continue;
    }
    if (arg === "--include-requires-confirmation") {
      flags.includeRequiresConfirmation = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const eqIndex = withoutPrefix.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = withoutPrefix.slice(0, eqIndex);
    const value = withoutPrefix.slice(eqIndex + 1);

    switch (key) {
      case "service":
        flags.service = value;
        break;
      case "floor":
        flags.floor = value;
        break;
      case "keyword":
        flags.keyword = value;
        break;
      case "sort":
        flags.sort = value;
        break;
      case "hits":
        flags.hits = parseNumberFlag(value);
        break;
      case "offset":
        flags.offset = parseNumberFlag(value);
        break;
      case "start-offset":
        flags.startOffset = parseNumberFlag(value);
        break;
      case "max-pages":
        flags.maxPages = parseNumberFlag(value);
        break;
      case "max-items":
        flags.maxItems = parseNumberFlag(value);
        break;
      case "from-date":
        flags.fromDate = value;
        break;
      case "to-date":
        flags.toDate = value;
        break;
      case "job-id":
        flags.jobId = value;
        break;
      case "schedule-id":
        flags.scheduleId = value;
        break;
      case "notification-id":
        flags.notificationId = value;
        break;
      case "analysis-run-id":
        flags.analysisRunId = value;
        break;
      case "external-id":
        flags.externalId = value;
        break;
      case "source":
        flags.source = value;
        break;
      case "name":
        flags.name = value;
        break;
      case "provider":
        flags.provider = value;
        break;
      case "cron":
        flags.cron = value;
        break;
      case "timezone":
        flags.timezone = value;
        break;
      case "schedule-type":
        flags.scheduleType = value;
        break;
      case "status":
        flags.status = value;
        break;
      case "type":
        flags.type = value;
        break;
      case "candidate-type":
        flags.candidateType = value;
        break;
      case "candidate-limit":
        flags.candidateLimit = parseNumberFlag(value);
        break;
      case "minimum-score":
        flags.minimumScore = parseNumberFlag(value);
        break;
      case "limit":
        flags.limit = parseNumberFlag(value);
        break;
      case "continue-on-item-error":
        flags.continueOnItemError = parseBooleanFlag(value) ?? true;
        break;
      case "candidate-id":
        flags.candidateId = value;
        break;
      case "content-id":
        flags.contentId = value;
        break;
      case "content-type":
        flags.contentType = value;
        break;
      case "target-channel":
        flags.targetChannel = value;
        break;
      case "model":
        flags.model = value;
        break;
      case "prompt-version":
        flags.promptVersion = value;
        break;
      case "reviewer":
        flags.reviewer = value;
        break;
      case "comment":
        flags.comment = value;
        break;
      case "instruction":
        flags.instruction = value;
        break;
      default:
        break;
    }
  }

  return flags;
}

function printSummary(summary: {
  fetchedCount: number;
  mappedCount: number;
  savedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  elapsedMs: number;
}): void {
  console.log(`取得件数: ${summary.fetchedCount}`);
  console.log(`変換件数: ${summary.mappedCount}`);
  console.log(`保存件数: ${summary.savedCount}`);
  console.log(`更新件数: ${summary.updatedCount}`);
  console.log(`スキップ件数: ${summary.skippedCount}`);
  console.log(`エラー件数: ${summary.errorCount}`);
  console.log(`実行時間: ${summary.elapsedMs}ms`);
}

function printJobResult(result: {
  jobId: string;
  status: string;
  pagesProcessed: number;
  fetchedCount: number;
  mappedCount: number;
  savedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  currentOffset: number | null;
  nextOffset: number | null;
  elapsedMs: number;
}): void {
  console.log(`jobId: ${result.jobId}`);
  console.log(`status: ${result.status}`);
  console.log(`処理ページ数: ${result.pagesProcessed}`);
  console.log(`fetchedCount: ${result.fetchedCount}`);
  console.log(`mappedCount: ${result.mappedCount}`);
  console.log(`savedCount: ${result.savedCount}`);
  console.log(`updatedCount: ${result.updatedCount}`);
  console.log(`skippedCount: ${result.skippedCount}`);
  console.log(`errorCount: ${result.errorCount}`);
  console.log(`currentOffset: ${result.currentOffset ?? "null"}`);
  console.log(`nextOffset: ${result.nextOffset ?? "null"}`);
  console.log(`実行時間: ${result.elapsedMs}ms`);
}

function printScheduleOutcome(result: {
  scheduleId: string;
  scheduleName: string;
  jobId: string | null;
  triggerType: string;
  status: string;
  scheduledFor: Date | null;
  nextRunAt: Date | null;
  fetchedCount: number;
  savedCount: number;
  updatedCount: number;
  errorCount: number;
  executionTime: number;
  errorMessage?: string;
}): void {
  console.log(`scheduleId: ${result.scheduleId}`);
  console.log(`scheduleName: ${result.scheduleName}`);
  console.log(`jobId: ${result.jobId ?? "null"}`);
  console.log(`triggerType: ${result.triggerType}`);
  console.log(`status: ${result.status}`);
  console.log(`scheduledFor: ${result.scheduledFor?.toISOString() ?? "null"}`);
  console.log(`nextRunAt: ${result.nextRunAt?.toISOString() ?? "null"}`);
  console.log(`fetchedCount: ${result.fetchedCount}`);
  console.log(`savedCount: ${result.savedCount}`);
  console.log(`updatedCount: ${result.updatedCount}`);
  console.log(`errorCount: ${result.errorCount}`);
  console.log(`executionTime: ${result.executionTime}ms`);
  if (result.errorMessage) {
    console.log(`errorMessage: ${result.errorMessage}`);
  }
}

function buildParametersFromFlags(flags: CliFlags): ScheduleParameters {
  return {
    ...(flags.service ? { service: flags.service } : {}),
    ...(flags.floor ? { floor: flags.floor } : {}),
    ...(flags.keyword ? { keyword: flags.keyword } : {}),
    ...(flags.sort ? { sort: flags.sort } : {}),
    ...(flags.hits !== undefined ? { hits: flags.hits } : {}),
    ...(flags.startOffset !== undefined ? { startOffset: flags.startOffset } : {}),
    ...(flags.maxPages !== undefined ? { maxPages: flags.maxPages } : {}),
    ...(flags.maxItems !== undefined ? { maxItems: flags.maxItems } : {}),
    ...(flags.fromDate ? { fromDate: flags.fromDate } : {}),
    ...(flags.toDate ? { toDate: flags.toDate } : {}),
    ...(flags.dryRun ? { dryRun: true } : {}),
    ...(flags.continueOnItemError !== undefined
      ? { continueOnItemError: flags.continueOnItemError }
      : {}),
  };
}

async function runMock(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();

  await database.connect();
  try {
    const service = new ResearchService({ logger, database });
    const summary = await service.collectAndSave(new MockResearchProvider());
    logger.info(
      `Mock collect finished: items=${summary.itemCount}, created=${summary.createdCount}, updated=${summary.updatedCount}`,
    );
  } finally {
    await database.disconnect();
  }
}

async function runHealth(): Promise<void> {
  const config = loadConfig({ requireDatabaseUrl: true });
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();

  await database.connect();
  try {
    const dbOk = await database.healthCheck();
    logger.info(`Database health: ${dbOk ? "ok" : "ng"}`);

    const providers = [
      new MockResearchProvider(),
      new FanzaResearchProvider({ config, logger }),
      new TikTokResearchProvider(),
      new XResearchProvider(),
    ];

    for (const provider of providers) {
      try {
        const ok = await provider.healthCheck();
        logger.info(`Provider ${provider.providerName} health: ${ok ? "ok" : "ng"}`);
      } catch (error) {
        if (isConfigurationIncomplete(error)) {
          logger.warn(`Provider ${provider.providerName} health: configuration incomplete`);
        } else {
          logger.warn(`Provider ${provider.providerName} health: ng (${toSafeErrorMessage(error)})`);
        }
      }
    }
  } finally {
    await database.disconnect();
  }
}

async function runFanza(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const startedAt = Date.now();
  const config = loadConfig({ requireDatabaseUrl: !flags.dryRun });
  const logger = createLogger(config.logLevel);
  const provider = new FanzaResearchProvider({ config, logger });

  const options: FanzaCollectOptions = {
    service: flags.service,
    floor: flags.floor,
    keyword: flags.keyword,
    sort: flags.sort,
    hits: flags.hits,
    offset: flags.offset,
    fromDate: flags.fromDate,
    toDate: flags.toDate,
  };

  const result = await provider.collect(options);
  const stats = provider.getLastStats();

  if (flags.dryRun) {
    printSummary({
      fetchedCount: stats.fetchedCount,
      mappedCount: stats.mappedCount,
      savedCount: 0,
      updatedCount: 0,
      skippedCount: stats.skippedCount,
      errorCount: stats.errorCount,
      elapsedMs: Date.now() - startedAt,
    });
    return;
  }

  const database = createDatabaseClient();
  await database.connect();
  try {
    const service = new ResearchService({ logger, database });
    const summary = await service.save(result);
    printSummary({
      fetchedCount: stats.fetchedCount,
      mappedCount: stats.mappedCount,
      savedCount: summary.createdCount,
      updatedCount: summary.updatedCount,
      skippedCount: stats.skippedCount,
      errorCount: stats.errorCount,
      elapsedMs: Date.now() - startedAt,
    });
  } finally {
    await database.disconnect();
  }
}

async function runFanzaHealth(): Promise<void> {
  const config = loadConfig({ requireDatabaseUrl: false });
  const logger = createLogger(config.logLevel);
  const provider = new FanzaResearchProvider({ config, logger });

  try {
    await provider.healthCheck();
    console.log("FANZA health: ok");
  } catch (error) {
    if (isConfigurationIncomplete(error) || error instanceof ConfigurationError) {
      console.error("FANZA health: configuration incomplete");
    } else if (error instanceof DmmError) {
      console.error(`FANZA health: ng (${error.code})`);
    } else {
      console.error(`FANZA health: ng (${toSafeErrorMessage(error)})`);
    }
    process.exitCode = 1;
  }
}

async function runFanzaFloors(): Promise<void> {
  const config = loadConfig({ requireDatabaseUrl: false });
  const logger = createLogger(config.logLevel);
  const provider = new FanzaResearchProvider({ config, logger });
  const response = await provider.getClient().getFloorList();
  const sites = response.result?.site ?? [];

  let floorCount = 0;
  for (const site of sites) {
    for (const service of site.service ?? []) {
      floorCount += service.floor?.length ?? 0;
    }
  }

  console.log(`sites: ${sites.length}`);
  console.log(`floors: ${floorCount}`);
  for (const site of sites) {
    if (site.code !== "FANZA") {
      continue;
    }
    for (const service of site.service ?? []) {
      for (const floor of service.floor ?? []) {
        console.log(`${service.code}/${floor.code}: ${floor.name ?? ""}`);
      }
    }
  }
}

async function runFanzaCollect(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();

  try {
    const provider = new FanzaResearchProvider({ config, logger });
    const pageProvider = new FanzaPageCollectionProvider(provider, {
      service: flags.service,
      floor: flags.floor,
      keyword: flags.keyword,
      sort: flags.sort,
      fromDate: flags.fromDate,
      toDate: flags.toDate,
    });
    const runner = new CollectionJobRunner({
      logger,
      database,
      jobs: new JobRepository(database.prisma),
      requestIntervalMs: config.fanzaRequestIntervalMs,
    });

    const result = await runner.run(pageProvider, {
      service: flags.service ?? config.fanzaDefaultService,
      floor: flags.floor ?? config.fanzaDefaultFloor,
      keyword: flags.keyword,
      sort: flags.sort,
      hits: flags.hits ?? config.fanzaDefaultHits,
      startOffset: flags.startOffset ?? 1,
      maxPages: flags.maxPages ?? 1,
      maxItems: flags.maxItems,
      fromDate: flags.fromDate,
      toDate: flags.toDate,
      dryRun: flags.dryRun,
      continueOnItemError: flags.continueOnItemError ?? true,
    });
    printJobResult(result);
    if (result.status === "FAILED") {
      process.exitCode = 1;
    }
  } finally {
    await database.disconnect();
  }
}

async function runJobStatus(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.jobId) {
    console.error("Usage: research:job:status -- --job-id=<JOB_ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const jobs = new JobRepository(database.prisma);
    const job = await jobs.findJobById(flags.jobId);
    if (!job) {
      console.error("job not found");
      process.exitCode = 1;
      return;
    }
    console.log(`jobId: ${job.id}`);
    console.log(`providerName: ${job.providerName}`);
    console.log(`jobType: ${job.jobType}`);
    console.log(`status: ${job.status}`);
    console.log(`pagesProcessed: ${job.pagesProcessed}`);
    console.log(`fetchedCount: ${job.fetchedCount}`);
    console.log(`mappedCount: ${job.mappedCount}`);
    console.log(`savedCount: ${job.savedCount}`);
    console.log(`updatedCount: ${job.updatedCount}`);
    console.log(`skippedCount: ${job.skippedCount}`);
    console.log(`errorCount: ${job.errorCount}`);
    console.log(`currentOffset: ${job.currentOffset ?? "null"}`);
    console.log(`nextOffset: ${job.nextOffset ?? "null"}`);
    console.log(`cancelRequested: ${job.cancelRequested}`);
    if (job.errorMessage) {
      console.log(`errorMessage: ${job.errorMessage}`);
    }
  } finally {
    await database.disconnect();
  }
}

async function runJobList(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const jobs = new JobRepository(database.prisma);
    const list = await jobs.listRecentJobs(flags.limit ?? 20);
    for (const job of list) {
      console.log(
        `${job.id}\t${job.status}\t${job.providerName}\tpages=${job.pagesProcessed}\tfetched=${job.fetchedCount}\terrors=${job.errorCount}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

async function runJobResume(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.jobId) {
    console.error("Usage: research:job:resume -- --job-id=<JOB_ID>");
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();

  try {
    const jobs = new JobRepository(database.prisma);
    const source = await jobs.findJobById(flags.jobId);
    if (!source) {
      console.error("job not found");
      process.exitCode = 1;
      return;
    }

    const provider = new FanzaResearchProvider({ config, logger });
    const params = source.parameters as Record<string, unknown>;
    const pageProvider = new FanzaPageCollectionProvider(provider, {
      service: typeof params.service === "string" ? params.service : undefined,
      floor: typeof params.floor === "string" ? params.floor : undefined,
      keyword: typeof params.keyword === "string" ? params.keyword : undefined,
      sort: typeof params.sort === "string" ? params.sort : undefined,
      fromDate: typeof params.fromDate === "string" ? params.fromDate : undefined,
      toDate: typeof params.toDate === "string" ? params.toDate : undefined,
    });

    const runner = new CollectionJobRunner({
      logger,
      database,
      jobs,
      requestIntervalMs: config.fanzaRequestIntervalMs,
    });
    const result = await runner.resume(pageProvider, flags.jobId);
    printJobResult(result);
  } finally {
    await database.disconnect();
  }
}

async function runJobCancel(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.jobId) {
    console.error("Usage: research:job:cancel -- --job-id=<JOB_ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const jobs = new JobRepository(database.prisma);
    const job = await jobs.cancelJob(flags.jobId);
    console.log(`jobId: ${job.id}`);
    console.log(`status: ${job.status}`);
    console.log(`cancelRequested: ${job.cancelRequested}`);
  } finally {
    await database.disconnect();
  }
}

async function runScheduleCreate(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.name) {
    console.error("Usage: research:schedule:create -- --name=... --provider=mock|fanza [--cron=...]");
    process.exitCode = 1;
    return;
  }
  const provider = (flags.provider ?? "mock").toLowerCase();
  if (provider !== "mock" && provider !== "fanza") {
    console.error("provider must be mock or fanza");
    process.exitCode = 1;
    return;
  }

  const timezone = flags.timezone ?? "Asia/Tokyo";
  const scheduleType =
    flags.scheduleType === "MANUAL_ONLY" || (!flags.cron && flags.scheduleType !== "CRON")
      ? "MANUAL_ONLY"
      : "CRON";

  let cronExpression: string | null = null;
  let nextRunAt: Date | null = null;
  if (scheduleType === "CRON") {
    if (!flags.cron) {
      console.error("CRON schedules require --cron=");
      process.exitCode = 1;
      return;
    }
    cronExpression = assertValidCronExpression(flags.cron);
    nextRunAt = computeNextRunAt({
      cronExpression,
      timezone,
      after: new Date(),
    });
  }

  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const schedules = new ScheduleRepository(database.prisma);
    const schedule = await schedules.createSchedule({
      name: flags.name,
      providerName: provider,
      scheduleType,
      cronExpression,
      timezone,
      parameters: buildParametersFromFlags(flags),
      nextRunAt,
    });
    console.log(`scheduleId: ${schedule.id}`);
    console.log(`name: ${schedule.name}`);
    console.log(`providerName: ${schedule.providerName}`);
    console.log(`scheduleType: ${schedule.scheduleType}`);
    console.log(`cronExpression: ${schedule.cronExpression ?? "null"}`);
    console.log(`timezone: ${schedule.timezone}`);
    console.log(`isActive: ${schedule.isActive}`);
    console.log(`nextRunAt: ${schedule.nextRunAt?.toISOString() ?? "null"}`);
  } finally {
    await database.disconnect();
  }
}

async function runScheduleList(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const schedules = new ScheduleRepository(database.prisma);
    const list = await schedules.listSchedules({
      includeInactive: true,
      limit: flags.limit ?? 50,
    });
    for (const schedule of list) {
      console.log(
        `${schedule.id}\t${schedule.isActive ? "active" : "paused"}\t${schedule.providerName}\t${schedule.scheduleType}\t${schedule.name}\tnext=${schedule.nextRunAt?.toISOString() ?? "null"}\tfail=${schedule.consecutiveFailureCount}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

async function runScheduleShow(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.scheduleId) {
    console.error("Usage: research:schedule:show -- --schedule-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const schedules = new ScheduleRepository(database.prisma);
    const schedule = await schedules.findScheduleById(flags.scheduleId);
    if (!schedule) {
      console.error("schedule not found");
      process.exitCode = 1;
      return;
    }
    console.log(`scheduleId: ${schedule.id}`);
    console.log(`name: ${schedule.name}`);
    console.log(`providerName: ${schedule.providerName}`);
    console.log(`scheduleType: ${schedule.scheduleType}`);
    console.log(`cronExpression: ${schedule.cronExpression ?? "null"}`);
    console.log(`timezone: ${schedule.timezone}`);
    console.log(`isActive: ${schedule.isActive}`);
    console.log(`lastRunAt: ${schedule.lastRunAt?.toISOString() ?? "null"}`);
    console.log(`nextRunAt: ${schedule.nextRunAt?.toISOString() ?? "null"}`);
    console.log(`lastJobId: ${schedule.lastJobId ?? "null"}`);
    console.log(`consecutiveFailureCount: ${schedule.consecutiveFailureCount}`);
    console.log(`parameters: ${JSON.stringify(schedule.parameters)}`);
    const runs = await schedules.listRunsForSchedule(schedule.id, 5);
    for (const run of runs) {
      console.log(
        `run\t${run.id}\t${run.status}\t${run.triggerType}\tjob=${run.jobId ?? "null"}\tscheduledFor=${run.scheduledFor?.toISOString() ?? "null"}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

async function runScheduleUpdate(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.scheduleId) {
    console.error("Usage: research:schedule:update -- --schedule-id=<ID> [--name=...] [--cron=...]");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const schedules = new ScheduleRepository(database.prisma);
    const existing = await schedules.findScheduleById(flags.scheduleId);
    if (!existing) {
      console.error("schedule not found");
      process.exitCode = 1;
      return;
    }

    const timezone = flags.timezone ?? existing.timezone;
    const cronExpression =
      flags.cron !== undefined ? assertValidCronExpression(flags.cron) : existing.cronExpression;
    const scheduleType =
      flags.scheduleType === "MANUAL_ONLY"
        ? "MANUAL_ONLY"
        : flags.scheduleType === "CRON"
          ? "CRON"
          : existing.scheduleType;

    let nextRunAt = existing.nextRunAt;
    if (scheduleType === "MANUAL_ONLY") {
      nextRunAt = null;
    } else if (cronExpression && (flags.cron !== undefined || flags.timezone !== undefined)) {
      nextRunAt = computeNextRunAt({
        cronExpression,
        timezone,
        after: new Date(),
      });
    }

    const parameterPatch = buildParametersFromFlags(flags);
    const mergedParameters = {
      ...(existing.parameters as ScheduleParameters),
      ...parameterPatch,
    };

    const updated = await schedules.updateSchedule(flags.scheduleId, {
      name: flags.name,
      providerName: flags.provider?.toLowerCase(),
      scheduleType,
      cronExpression: scheduleType === "MANUAL_ONLY" ? null : cronExpression,
      timezone,
      parameters: mergedParameters,
      nextRunAt,
    });
    console.log(`scheduleId: ${updated.id}`);
    console.log(`name: ${updated.name}`);
    console.log(`nextRunAt: ${updated.nextRunAt?.toISOString() ?? "null"}`);
    console.log(`isActive: ${updated.isActive}`);
  } finally {
    await database.disconnect();
  }
}

async function runSchedulePause(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.scheduleId) {
    console.error("Usage: research:schedule:pause -- --schedule-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const schedules = new ScheduleRepository(database.prisma);
    const schedule = await schedules.pauseSchedule(flags.scheduleId);
    console.log(`scheduleId: ${schedule.id}`);
    console.log(`isActive: ${schedule.isActive}`);
  } finally {
    await database.disconnect();
  }
}

async function runScheduleResume(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.scheduleId) {
    console.error("Usage: research:schedule:resume -- --schedule-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const schedules = new ScheduleRepository(database.prisma);
    const existing = await schedules.findScheduleById(flags.scheduleId);
    if (!existing) {
      console.error("schedule not found");
      process.exitCode = 1;
      return;
    }
    let nextRunAt = existing.nextRunAt;
    if (existing.scheduleType === "CRON" && existing.cronExpression) {
      nextRunAt = computeNextRunAt({
        cronExpression: existing.cronExpression,
        timezone: existing.timezone,
        after: new Date(),
      });
    }
    const schedule = await schedules.resumeSchedule(flags.scheduleId, nextRunAt);
    console.log(`scheduleId: ${schedule.id}`);
    console.log(`isActive: ${schedule.isActive}`);
    console.log(`nextRunAt: ${schedule.nextRunAt?.toISOString() ?? "null"}`);
    console.log(`consecutiveFailureCount: ${schedule.consecutiveFailureCount}`);
  } finally {
    await database.disconnect();
  }
}

async function runScheduleDelete(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.scheduleId) {
    console.error("Usage: research:schedule:delete -- --schedule-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const schedules = new ScheduleRepository(database.prisma);
    const schedule = await schedules.deleteSchedule(flags.scheduleId);
    console.log(`scheduleId: ${schedule.id}`);
    console.log(`deletedAt: ${schedule.deletedAt?.toISOString() ?? "null"}`);
    console.log(`isActive: ${schedule.isActive}`);
  } finally {
    await database.disconnect();
  }
}

async function runScheduleRun(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.scheduleId) {
    console.error("Usage: research:schedule:run -- --schedule-id=<ID>");
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const notifications = new NotificationService({
      logger,
      config,
      notifications: new NotificationRepository(database.prisma),
    });
    const runner = new ScheduleRunner({
      logger,
      database,
      schedules: new ScheduleRepository(database.prisma),
      jobs: new JobRepository(database.prisma),
      config,
      notifications,
    });
    const outcome = await runner.runManual(flags.scheduleId);
    printScheduleOutcome(outcome);
    await notifications.dispatchPendingNotifications(20);
    if (outcome.status === "FAILED") {
      process.exitCode = 1;
    }
  } finally {
    await database.disconnect();
  }
}

async function runSchedulerRun(): Promise<void> {
  const config = loadConfig({ requireDatabaseUrl: false });
  if (!config.databaseUrl) {
    console.log("DATABASE_URL is not set; scheduler exiting safely without running jobs");
    return;
  }

  const runtimeConfig = loadConfig({ requireDatabaseUrl: true });
  const logger = createLogger(runtimeConfig.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const pipeline = new SchedulerPipeline({
      logger,
      database,
      config: runtimeConfig,
    });
    const result = await pipeline.run();
    console.log(`schedules processed: ${result.schedules.length}`);
    for (const outcome of result.schedules) {
      printScheduleOutcome(outcome);
      console.log("---");
    }
    console.log(`retries processed: ${result.retries.length}`);
    for (const retry of result.retries) {
      console.log(`retryRunId: ${retry.retryRunId ?? "null"}`);
      console.log(`rootRunId: ${retry.rootRunId}`);
      console.log(`retryAttempt: ${retry.retryAttempt}`);
      console.log(`status: ${retry.status}`);
      console.log(`nextRetryAt: ${retry.nextRetryAt?.toISOString() ?? "null"}`);
      console.log("---");
    }
    if ("skipped" in result.analysis && result.analysis.skipped) {
      console.log(`analysis: SKIPPED (${result.analysis.skipReason})`);
    } else {
      const analysis = result.analysis as {
        analysisRunId: string | null;
        status: string;
        analyzedItemCount: number;
        selectedItemCount: number;
      };
      console.log(`analysisRunId: ${analysis.analysisRunId ?? "null"}`);
      console.log(`analysisStatus: ${analysis.status}`);
      console.log(`analyzedItemCount: ${analysis.analyzedItemCount}`);
      console.log(`selectedItemCount: ${analysis.selectedItemCount}`);
    }
    if ("skipped" in result.content && result.content.skipped) {
      console.log(`content: SKIPPED (${result.content.skipReason})`);
    } else {
      const content = result.content as {
        generationRunId: string | null;
        status: string;
        generatedCount: number;
        errorCount: number;
      };
      console.log(`contentGenerationRunId: ${content.generationRunId ?? "null"}`);
      console.log(`contentStatus: ${content.status}`);
      console.log(`contentGeneratedCount: ${content.generatedCount}`);
      console.log(`contentErrorCount: ${content.errorCount}`);
    }
    if ("skipReason" in result.xPublish) {
      console.log(`xPublish: SKIPPED (${result.xPublish.skipReason})`);
    } else {
      console.log(`xPublishProcessed: ${result.xPublish.published}`);
    }
    if ("skipReason" in result.xMetrics) {
      console.log(`xMetrics: SKIPPED (${result.xMetrics.skipReason})`);
    } else {
      console.log(
        `xMetricsCollected: ${result.xMetrics.collected} failed=${result.xMetrics.failed}`,
      );
    }
    if ("skipReason" in result.xStrategy) {
      console.log(`xStrategy: SKIPPED (${result.xStrategy.skipReason})`);
    } else {
      console.log(
        `xStrategyRecommended: ${result.xStrategy.recommendedStrategy ?? "null"} (${result.xStrategy.confidenceLevel})`,
      );
    }
    console.log(
      `notifications processed=${result.notifications.processed} sent=${result.notifications.sent} failed=${result.notifications.failed} skipped=${result.notifications.skipped}`,
    );
  } finally {
    await database.disconnect();
  }
}

async function runRetryRun(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const notifications = new NotificationService({
      logger,
      config,
      notifications: new NotificationRepository(database.prisma),
    });
    const runner = new RetryRunner({
      logger,
      database,
      schedules: new ScheduleRepository(database.prisma),
      jobs: new JobRepository(database.prisma),
      config,
      notifications,
    });
    const outcomes = await runner.runDueRetries();
    if (outcomes.length === 0) {
      console.log("no due retries");
      return;
    }
    for (const outcome of outcomes) {
      console.log(`retryRunId: ${outcome.retryRunId ?? "null"}`);
      console.log(`rootRunId: ${outcome.rootRunId}`);
      console.log(`sourceRunId: ${outcome.sourceRunId}`);
      console.log(`retryAttempt: ${outcome.retryAttempt}`);
      console.log(`status: ${outcome.status}`);
      console.log(`nextRetryAt: ${outcome.nextRetryAt?.toISOString() ?? "null"}`);
      console.log("---");
    }
  } finally {
    await database.disconnect();
  }
}

async function runRetryList(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const schedules = new ScheduleRepository(database.prisma);
    const list = await schedules.listPendingRetries(flags.limit ?? 50);
    for (const run of list) {
      console.log(
        `${run.id}\troot=${run.rootRunId ?? run.id}\tattempt=${run.retryAttempt}\tnextRetryAt=${run.nextRetryAt?.toISOString() ?? "null"}\tstatus=${run.status}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

async function runNotificationList(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const notifications = new NotificationRepository(database.prisma);
    const status = flags.status?.toUpperCase();
    const list = await notifications.listNotifications({
      status:
        status === "PENDING" ||
        status === "SENDING" ||
        status === "SENT" ||
        status === "FAILED" ||
        status === "SKIPPED"
          ? status
          : undefined,
      limit: flags.limit ?? 50,
    });
    for (const item of list) {
      console.log(
        `${item.id}\t${item.eventType}\t${item.channelType}\t${item.status}\tattempts=${item.attemptCount}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

async function runNotificationShow(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.notificationId) {
    console.error("Usage: research:notification:show -- --notification-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const notifications = new NotificationRepository(database.prisma);
    const item = await notifications.findById(flags.notificationId);
    if (!item) {
      console.error("notification not found");
      process.exitCode = 1;
      return;
    }
    console.log(`notificationId: ${item.id}`);
    console.log(`eventType: ${item.eventType}`);
    console.log(`channelType: ${item.channelType}`);
    console.log(`status: ${item.status}`);
    console.log(`attemptCount: ${item.attemptCount}`);
    console.log(`scheduleId: ${item.scheduleId ?? "null"}`);
    console.log(`scheduleRunId: ${item.scheduleRunId ?? "null"}`);
    console.log(`researchJobId: ${item.researchJobId ?? "null"}`);
    console.log(`title: ${item.title}`);
    console.log(`message: ${item.message}`);
    if (item.errorMessage) {
      console.log(`errorMessage: ${item.errorMessage}`);
    }
  } finally {
    await database.disconnect();
  }
}

async function runNotificationDispatch(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const service = new NotificationService({
      logger,
      config,
      notifications: new NotificationRepository(database.prisma),
    });
    const result = await service.dispatchPendingNotifications();
    console.log(
      `processed=${result.processed} sent=${result.sent} failed=${result.failed} skipped=${result.skipped}`,
    );
  } finally {
    await database.disconnect();
  }
}

async function runNotificationRetry(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.notificationId) {
    console.error("Usage: research:notification:retry -- --notification-id=<ID>");
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const service = new NotificationService({
      logger,
      config,
      notifications: new NotificationRepository(database.prisma),
    });
    const item = await service.retryFailedNotification(flags.notificationId);
    if (!item) {
      console.error("notification not found");
      process.exitCode = 1;
      return;
    }
    console.log(`notificationId: ${item.id}`);
    console.log(`eventType: ${item.eventType}`);
    console.log(`channelType: ${item.channelType}`);
    console.log(`status: ${item.status}`);
    console.log(`attemptCount: ${item.attemptCount}`);
  } finally {
    await database.disconnect();
  }
}

function parseCandidateTypes(value: string | undefined): ContentCandidateType[] | undefined {
  if (!value) {
    return undefined;
  }
  const allowed = new Set([
    "RANKING",
    "TRENDING",
    "HIGH_RATING",
    "NEW_RELEASE",
    "DISCOUNT",
    "EDITORIAL",
  ]);
  const types = value
    .split(",")
    .map((part) => part.trim().toUpperCase().replace(/-/g, "_"))
    .filter((part) => allowed.has(part)) as ContentCandidateType[];
  return types.length > 0 ? types : undefined;
}

async function runAnalysisRun(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const engine = new AnalysisEngine({
      logger,
      research: new ResearchRepository(database.prisma),
      analysis: new AnalysisRepository(database.prisma),
      config,
    });
    const result = await engine.run({
      source: flags.source ?? "mock",
      limit: flags.limit ?? 1000,
      fromDate: flags.fromDate ? new Date(flags.fromDate) : undefined,
      toDate: flags.toDate ? new Date(flags.toDate) : undefined,
      candidateTypes: parseCandidateTypes(flags.candidateType),
      candidateLimit: flags.candidateLimit ?? 10,
      minimumScore: flags.minimumScore ?? 0,
      includeRequiresConfirmation: flags.includeRequiresConfirmation,
      dryRun: flags.dryRun,
    });
    console.log(`analysisRunId: ${result.analysisRunId ?? "null"}`);
    console.log(`status: ${result.status}`);
    console.log(`analyzedItemCount: ${result.analyzedItemCount}`);
    console.log(`eligibleCount: ${result.eligibleCount}`);
    console.log(`requiresConfirmationCount: ${result.requiresConfirmationCount}`);
    console.log(`notEligibleCount: ${result.notEligibleCount}`);
    console.log(`selectedItemCount: ${result.selectedItemCount}`);
    console.log(`candidateCounts: ${JSON.stringify(result.candidateCounts)}`);
    console.log(`averageScore: ${result.averageScore}`);
    console.log(`errorCount: ${result.errorCount}`);
    console.log(`executionTime: ${result.executionTime}ms`);
  } finally {
    await database.disconnect();
  }
}

async function runAnalysisList(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const analysis = new AnalysisRepository(database.prisma);
    const runs = await analysis.listAnalysisRuns(flags.limit ?? 20);
    for (const run of runs) {
      console.log(
        `${run.id}\t${run.status}\t${run.analysisType}\tanalyzed=${run.analyzedItemCount}\tselected=${run.selectedItemCount}\terrors=${run.errorCount}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

async function runAnalysisShow(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.analysisRunId) {
    console.error("Usage: analysis:show -- --analysis-run-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const analysis = new AnalysisRepository(database.prisma);
    const run = await analysis.findAnalysisRunById(flags.analysisRunId);
    if (!run) {
      console.error("analysis run not found");
      process.exitCode = 1;
      return;
    }
    console.log(`analysisRunId: ${run.id}`);
    console.log(`status: ${run.status}`);
    console.log(`analysisType: ${run.analysisType}`);
    console.log(`analyzedItemCount: ${run.analyzedItemCount}`);
    console.log(`selectedItemCount: ${run.selectedItemCount}`);
    console.log(`errorCount: ${run.errorCount}`);
    console.log(`scoringVersion: ${run.scoringVersion}`);
    console.log(`eligibilityVersion: ${run.eligibilityVersion}`);
    console.log(`selectionVersion: ${run.selectionVersion}`);
    const top = await analysis.listProductAnalyses(run.id, { limit: 10 });
    for (const row of top) {
      console.log(
        `item\t${row.researchItemId}\tscore=${row.totalScore}\t${row.eligibilityStatus}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

async function runAnalysisCandidates(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const analysis = new AnalysisRepository(database.prisma);
    const type = flags.type?.toUpperCase().replace(/-/g, "_");
    const candidateType =
      type === "RANKING" ||
      type === "TRENDING" ||
      type === "HIGH_RATING" ||
      type === "NEW_RELEASE" ||
      type === "DISCOUNT" ||
      type === "EDITORIAL"
        ? type
        : undefined;
    const list = await analysis.listContentCandidates({
      analysisRunId: flags.analysisRunId,
      candidateType,
      limit: flags.limit ?? 20,
    });
    for (const row of list) {
      console.log(
        `${row.id}\t${row.candidateType}\trank=${row.rank}\tscore=${row.selectionScore}\titem=${row.researchItemId}\tstatus=${row.status}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

async function runAnalysisItem(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.externalId) {
    console.error("Usage: analysis:item -- --external-id=<CONTENT_ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const research = new ResearchRepository(database.prisma);
    const analysis = new AnalysisRepository(database.prisma);
    const item = await research.findItemByExternalId(flags.externalId);
    if (!item) {
      console.error("item not found");
      process.exitCode = 1;
      return;
    }
    console.log(`itemId: ${item.id}`);
    console.log(`externalId: ${item.externalId}`);
    console.log(`title: ${item.title}`);
    console.log(`url: ${item.url ?? "null"}`);
    console.log(`publishedAt: ${item.publishedAt?.toISOString() ?? "null"}`);
    console.log(`metricCount: ${item.metrics.length}`);
    console.log(`tagCount: ${item.tags.length}`);
    console.log(`imageCount: ${item.images.length}`);
    const latest = await analysis.findLatestAnalysisForItem(item.id);
    if (latest) {
      console.log(`latestAnalysisId: ${latest.id}`);
      console.log(`totalScore: ${latest.totalScore}`);
      console.log(`eligibilityStatus: ${latest.eligibilityStatus}`);
      console.log(`trendScore: ${latest.trendScore ?? "null"}`);
      console.log(`reviewScore: ${latest.reviewScore ?? "null"}`);
    } else {
      console.log("latestAnalysisId: null");
    }
  } finally {
    await database.disconnect();
  }
}

function parseTargetChannelFlag(value?: string): ContentTargetChannel | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase().replace(/-/g, "_");
  if (
    normalized === "BLOG" ||
    normalized === "X" ||
    normalized === "SHORT_VIDEO" ||
    normalized === "GENERIC"
  ) {
    return normalized;
  }
  return undefined;
}

function printGeneratedContent(row: {
  id: string;
  contentCandidateId: string;
  contentType: string;
  status: string;
  title: string;
  body: string;
  hashtags: unknown;
  affiliateUrl: string;
  version: number;
  validationIssues?: Array<{
    issueType: string;
    severity: string;
    message: string;
    detectedValue: string | null;
  }>;
}): void {
  console.log(`contentId: ${row.id}`);
  console.log(`candidateId: ${row.contentCandidateId}`);
  console.log(`contentType: ${row.contentType}`);
  console.log(`status: ${row.status}`);
  console.log(`version: ${row.version}`);
  console.log(`title: ${row.title}`);
  console.log(`body:\n${row.body}`);
  console.log(`hashtags: ${JSON.stringify(row.hashtags)}`);
  console.log(`affiliateUrl: ${row.affiliateUrl}`);
  if (row.validationIssues) {
    for (const issue of row.validationIssues) {
      console.log(
        `issue\t${issue.severity}\t${issue.issueType}\t${issue.message}\t${issue.detectedValue ?? ""}`,
      );
    }
  }
}

async function runContentGenerate(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const contentType = parseContentTypeFlag(flags.contentType);
  if (!contentType) {
    console.error(
      "Usage: content:generate -- --content-type=x-post|blog-article|short-video-script|product-introduction [--candidate-id=|--analysis-run-id=|--candidate-type=] [--limit=] [--dry-run]",
    );
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const engine = new ContentEngine({
      logger,
      config,
      contents: new ContentRepository(database.prisma),
      notifications: {
        emitContentEvent: async (eventType, payload) => {
          const service = new NotificationService({
            logger,
            config,
            notifications: new NotificationRepository(database.prisma),
          });
          await service.emitContentEvent(eventType, payload);
        },
      },
    });
    const result = await engine.generate({
      candidateId: flags.candidateId,
      analysisRunId: flags.analysisRunId,
      candidateType: flags.candidateType,
      contentType,
      targetChannel: parseTargetChannelFlag(flags.targetChannel),
      limit: flags.limit ?? 10,
      provider: flags.provider,
      model: flags.model,
      promptVersion: flags.promptVersion,
      dryRun: flags.dryRun,
      force: flags.force,
      includeRequiresConfirmation: flags.includeRequiresConfirmation,
      minScore: flags.minimumScore,
    });
    console.log(`generationRunId: ${result.generationRunId ?? "null"}`);
    console.log(`status: ${result.status}`);
    console.log(`dryRun: ${result.dryRun}`);
    console.log(`candidateCount: ${result.candidateCount}`);
    console.log(`generatedCount: ${result.generatedCount}`);
    console.log(`skippedCount: ${result.skippedCount}`);
    console.log(`errorCount: ${result.errorCount}`);
    for (const item of result.items) {
      console.log(
        `${item.candidateId}\t${item.contentId ?? "null"}\t${item.status}\tv=${item.version ?? "-"}\t${item.title ?? item.skipReason ?? item.error ?? ""}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

async function runContentList(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const contents = new ContentRepository(database.prisma);
    const list = await contents.listGeneratedContents({
      status: parseContentStatusFlag(flags.status),
      contentType: parseContentTypeFlag(flags.contentType),
      limit: flags.limit ?? 20,
    });
    for (const row of list) {
      console.log(
        `${row.id}\t${row.contentType}\t${row.status}\tv${row.version}\t${row.title}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

async function runContentShow(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.contentId) {
    console.error("Usage: content:show -- --content-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const contents = new ContentRepository(database.prisma);
    const row = await contents.findGeneratedContentById(flags.contentId);
    if (!row) {
      console.error("content not found");
      process.exitCode = 1;
      return;
    }
    printGeneratedContent(row);
  } finally {
    await database.disconnect();
  }
}

async function runContentReview(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const contents = new ContentRepository(database.prisma);
    const list = await contents.listContentsForReview(flags.limit ?? 20);
    for (const row of list) {
      console.log(
        `${row.id}\t${row.contentType}\t${row.status}\tv${row.version}\t${row.title}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

async function runContentApprove(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.contentId) {
    console.error("Usage: content:approve -- --content-id=<ID> [--reviewer=] [--comment=]");
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const contents = new ContentRepository(database.prisma);
    const reviewer = flags.reviewer ?? config.contentDefaultReviewer;
    const row = await contents.approveContent(flags.contentId, reviewer, flags.comment);
    console.log(`approved contentId=${row.id} status=${row.status} reviewer=${reviewer}`);
  } catch (error) {
    if (error instanceof ContentStateError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await database.disconnect();
  }
}

async function runContentReject(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.contentId) {
    console.error("Usage: content:reject -- --content-id=<ID> [--reviewer=] [--comment=]");
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const contents = new ContentRepository(database.prisma);
    const reviewer = flags.reviewer ?? config.contentDefaultReviewer;
    const row = await contents.rejectContent(flags.contentId, reviewer, flags.comment);
    console.log(`rejected contentId=${row.id} status=${row.status} reviewer=${reviewer}`);
  } catch (error) {
    if (error instanceof ContentStateError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await database.disconnect();
  }
}

async function runContentRequestChanges(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.contentId) {
    console.error(
      "Usage: content:request-changes -- --content-id=<ID> [--reviewer=] [--comment=]",
    );
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const contents = new ContentRepository(database.prisma);
    const reviewer = flags.reviewer ?? config.contentDefaultReviewer;
    const row = await contents.requestChanges(flags.contentId, reviewer, flags.comment);
    console.log(`request-changes contentId=${row.id} status=${row.status} reviewer=${reviewer}`);
  } catch (error) {
    if (error instanceof ContentStateError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await database.disconnect();
  }
}

async function runContentRegenerate(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.contentId) {
    console.error(
      'Usage: content:regenerate -- --content-id=<ID> [--instruction="..."] [--dry-run]',
    );
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const engine = new ContentEngine({
      logger,
      config,
      contents: new ContentRepository(database.prisma),
    });
    const result = await engine.regenerate({
      contentId: flags.contentId,
      instruction: flags.instruction,
      dryRun: flags.dryRun,
    });
    console.log(`generationRunId: ${result.generationRunId ?? "null"}`);
    console.log(`status: ${result.status}`);
    for (const item of result.items) {
      console.log(
        `${item.candidateId}\t${item.contentId ?? "null"}\t${item.status}\tv=${item.version ?? "-"}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

async function runContentReady(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.contentId) {
    console.error("Usage: content:ready -- --content-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const contents = new ContentRepository(database.prisma);
    const row = await contents.markReadyToPublish(flags.contentId);
    console.log(`ready contentId=${row.id} status=${row.status}`);
  } catch (error) {
    if (error instanceof ContentStateError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await database.disconnect();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const rest = process.argv.slice(3).filter((arg) => arg !== "--");

  switch (command) {
    case "mock":
      await runMock();
      break;
    case "health":
      await runHealth();
      break;
    case "fanza":
      await runFanza(rest);
      break;
    case "fanza-health":
      await runFanzaHealth();
      break;
    case "fanza-floors":
      await runFanzaFloors();
      break;
    case "fanza-collect":
      await runFanzaCollect(rest);
      break;
    case "job-status":
      await runJobStatus(rest);
      break;
    case "job-list":
      await runJobList(rest);
      break;
    case "job-resume":
      await runJobResume(rest);
      break;
    case "job-cancel":
      await runJobCancel(rest);
      break;
    case "schedule-create":
      await runScheduleCreate(rest);
      break;
    case "schedule-list":
      await runScheduleList(rest);
      break;
    case "schedule-show":
      await runScheduleShow(rest);
      break;
    case "schedule-update":
      await runScheduleUpdate(rest);
      break;
    case "schedule-pause":
      await runSchedulePause(rest);
      break;
    case "schedule-resume":
      await runScheduleResume(rest);
      break;
    case "schedule-delete":
      await runScheduleDelete(rest);
      break;
    case "schedule-run":
      await runScheduleRun(rest);
      break;
    case "scheduler-run":
      await runSchedulerRun();
      break;
    case "retry-run":
      await runRetryRun();
      break;
    case "retry-list":
      await runRetryList(rest);
      break;
    case "notification-list":
      await runNotificationList(rest);
      break;
    case "notification-show":
      await runNotificationShow(rest);
      break;
    case "notification-dispatch":
      await runNotificationDispatch();
      break;
    case "notification-retry":
      await runNotificationRetry(rest);
      break;
    case "analysis-run":
      await runAnalysisRun(rest);
      break;
    case "analysis-list":
      await runAnalysisList(rest);
      break;
    case "analysis-show":
      await runAnalysisShow(rest);
      break;
    case "analysis-candidates":
      await runAnalysisCandidates(rest);
      break;
    case "analysis-item":
      await runAnalysisItem(rest);
      break;
    case "content-generate":
      await runContentGenerate(rest);
      break;
    case "content-list":
      await runContentList(rest);
      break;
    case "content-show":
      await runContentShow(rest);
      break;
    case "content-review":
      await runContentReview(rest);
      break;
    case "content-approve":
      await runContentApprove(rest);
      break;
    case "content-reject":
      await runContentReject(rest);
      break;
    case "content-request-changes":
      await runContentRequestChanges(rest);
      break;
    case "content-regenerate":
      await runContentRegenerate(rest);
      break;
    case "content-ready":
      await runContentReady(rest);
      break;
    case "x-publication-create":
      await runXPublicationCreate(rest);
      break;
    case "x-publication-list":
      await runXPublicationList(rest);
      break;
    case "x-publication-show":
      await runXPublicationShow(rest);
      break;
    case "x-publication-schedule":
      await runXPublicationSchedule(rest);
      break;
    case "x-publication-publish":
      await runXPublicationPublish(rest);
      break;
    case "x-publication-cancel":
      await runXPublicationCancel(rest);
      break;
    case "x-publication-retry":
      await runXPublicationRetry(rest);
      break;
    case "x-publisher-run":
      await runXPublisherRun(rest);
      break;
    case "x-metrics-collect":
      await runXMetricsCollect(rest);
      break;
    case "x-metrics-list":
      await runXMetricsList(rest);
      break;
    case "x-strategy-evaluate":
      await runXStrategyEvaluate(rest);
      break;
    case "x-strategy-report":
      await runXStrategyReport(rest);
      break;
    case "x-experiment-create":
      await runXExperimentCreate(rest);
      break;
    case "x-experiment-list":
      await runXExperimentList(rest);
      break;
    case "x-experiment-show":
      await runXExperimentShow(rest);
      break;
    case "x-experiment-start":
      await runXExperimentStart(rest);
      break;
    case "x-experiment-pause":
      await runXExperimentPause(rest);
      break;
    case "x-experiment-complete":
      await runXExperimentComplete(rest);
      break;
    case "x-optimization-run":
      await runXOptimizationRun(rest);
      break;
    case "x-optimization-list":
      await runXOptimizationList();
      break;
    case "x-optimization-show":
      await runXOptimizationShow(rest);
      break;
    case "x-optimization-findings":
      await runXOptimizationFindings(rest);
      break;
    case "x-optimization-recommendations":
      await runXOptimizationRecommendations(rest);
      break;
    case "x-optimization-approve":
      await runXOptimizationApprove(rest);
      break;
    case "x-optimization-reject":
      await runXOptimizationReject(rest);
      break;
    case "x-optimization-expire":
      await runXOptimizationExpire(rest);
      break;
    case "x-optimization-apply":
      await runXOptimizationApply(rest);
      break;
    case "x-optimization-impact":
      await runXOptimizationImpact(rest);
      break;
    case "x-variant-extract":
      await runXVariantExtract(rest);
      break;
    case "x-variant-list":
      await runXVariantList(rest);
      break;
    case "x-variant-show":
      await runXVariantShow(rest);
      break;
    case "x-assisted-prepare":
      await runXAssistedPrepare(rest);
      break;
    case "x-assisted-review":
      await runXAssistedReview(rest);
      break;
    case "x-assisted-schedule":
      await runXAssistedSchedule(rest);
      break;
    case "x-assisted-show":
      await runXAssistedShow(rest);
      break;
    case "x-assisted-cancel":
      await runXAssistedCancel(rest);
      break;
    case "x-runtime-status":
      await runXRuntimeStatus();
      break;
    case "x-runtime-pause":
      await runXRuntimePause(rest);
      break;
    case "x-runtime-resume":
      await runXRuntimeResume(rest);
      break;
    case "x-ops-status":
      await runXOpsStatus();
      break;
    case "x-ops-health":
      await runXOpsHealth();
      break;
    case "x-ops-queue":
      await runXOpsQueue();
      break;
    case "x-ops-blocked":
      await runXOpsBlocked();
      break;
    case "x-ops-audit":
      await runXOpsAudit(rest);
      break;
    case "x-ops-limits":
      await runXOpsLimits();
      break;
    case "x-ops-cooldowns":
      await runXOpsCooldowns();
      break;
    case "x-auth-start":
      await runXAuthStart();
      break;
    case "x-auth-complete":
      await runXAuthComplete(rest);
      break;
    case "x-auth-status":
      await runXAuthStatus();
      break;
    case "x-auth-refresh":
      await runXAuthRefresh();
      break;
    case "x-auth-revoke":
      await runXAuthRevoke();
      break;
    case "x-auth-test":
      await runXAuthTest();
      break;
    case "x-live-status":
      await runXLiveStatus();
      break;
    case "x-live-diagnose":
      await runXLiveDiagnose();
      break;
    case "x-live-publish":
      await runXLivePublish(rest);
      break;
    case "x-live-metrics":
      await runXLiveMetrics(rest);
      break;
    case "x-usage-status":
      await runXUsageStatus();
      break;
    case "x-usage-sync":
      await runXUsageSync();
      break;
    case "x-usage-report":
      await runXUsageReport();
      break;
    case "x-budget-status":
      await runXBudgetStatus();
      break;
    case "x-budget-set":
      await runXBudgetSet(rest);
      break;
    case "x-budget-pause":
      await runXBudgetPause(rest);
      break;
    case "x-budget-resume":
      await runXBudgetResume(rest);
      break;
    case "lifecycle-seed-products":
      await runLifecycleSeedProducts();
      break;
    case "lifecycle-create-topic":
      await runLifecycleCreateTopic(rest);
      break;
    case "lifecycle-create-strategy":
      await runLifecycleCreateStrategy(rest);
      break;
    case "lifecycle-register-claim":
      await runLifecycleRegisterClaim(rest);
      break;
    case "lifecycle-create-content":
      await runLifecycleCreateContent(rest);
      break;
    case "lifecycle-evaluate-policy":
      await runLifecycleEvaluatePolicy(rest);
      break;
    case "lifecycle-review":
      await runLifecycleReview(rest);
      break;
    case "lifecycle-create-publication-target":
      await runLifecycleCreatePublicationTarget(rest);
      break;
    case "lifecycle-approve-publication":
      await runLifecycleApprovePublication(rest);
      break;
    case "lifecycle-mock-publish":
      await runLifecycleMockPublish(rest);
      break;
    case "lifecycle-inspect":
      await runLifecycleInspect(rest);
      break;
    case "lifecycle-run-vertical":
      await runLifecycleRunVertical();
      break;
    case "ops-register-product":
      await runOpsRegisterProduct(rest);
      break;
    case "ops-register-research":
      await runOpsRegisterResearch(rest);
      break;
    case "ops-generate-content":
      await runOpsGenerateContent(rest);
      break;
    case "ops-create-targets":
      await runOpsCreateTargets(rest);
      break;
    case "ops-approve":
      await runOpsApprove(rest);
      break;
    case "ops-blogger-draft":
      await runOpsBloggerDraft(rest);
      break;
    case "ops-x-export":
      await runOpsXExport(rest);
      break;
    case "ops-queue-run":
      await runOpsQueueRun(rest);
      break;
    case "ops-analytics-ingest":
      await runOpsAnalyticsIngest(rest);
      break;
    case "ops-list-unmonetized":
      await runOpsListUnmonetized(rest);
      break;
    case "ops-set-monetization":
      await runOpsSetMonetization(rest);
      break;
    case "ops-link-replace-propose":
      await runOpsLinkReplacePropose(rest);
      break;
    case "ops-link-replace-approve":
      await runOpsLinkReplaceApprove(rest);
      break;
    case "ops-link-replace-apply":
      await runOpsLinkReplaceApply(rest);
      break;
    case "ops-p3p4-vertical":
      await runOpsP3P4Vertical();
      break;
    case "p45-seed-prompts":
      await runP45SeedPrompts();
      break;
    case "p45-generate-blogger":
    case "generate-blogger-content":
      await runP45GenerateBlogger(rest);
      break;
    case "p45-review-content":
    case "review-content":
      await runP45ReviewContent(rest);
      break;
    case "p45-revise-content":
    case "revise-content":
      await runP45ReviseContent(rest);
      break;
    case "p45-approve-content":
    case "approve-content":
      await runP45ApproveContent(rest);
      break;
    case "p45-prepare-blogger-draft":
    case "prepare-blogger-draft":
      await runP45PrepareBloggerDraft(rest);
      break;
    case "p45-create-blogger-draft":
    case "create-blogger-draft":
      await runP45CreateBloggerDraft(rest);
      break;
    case "p45-update-blogger-draft":
    case "update-blogger-draft":
      await runP45UpdateBloggerDraft(rest);
      break;
    case "p45-delete-blogger-draft":
    case "delete-blogger-draft":
      await runP45DeleteBloggerDraft(rest);
      break;
    case "p45-get-blogger-status":
    case "get-blogger-status":
      await runP45GetBloggerStatus(rest);
      break;
    case "p45-generate-x":
      await runP45GenerateX(rest);
      break;
    case "p45-vertical":
      await runP45Vertical();
      break;
    case "p45-llm-smoke":
      await runP45LlmSmoke();
      break;
    case "blogger-auth-url":
      await runBloggerAuthUrl();
      break;
    case "blogger-exchange-code":
      await runBloggerExchangeCode(rest);
      break;
    case "blogger-validate-auth":
      await runBloggerValidateAuth();
      break;
    case "blogger-list-blogs":
      await runBloggerListBlogs();
      break;
    case "aggregate-analytics":
      await runAggregateAnalytics(rest);
      break;
    case "evaluate-content":
      await runEvaluateContent(rest);
      break;
    case "run-experiment":
      await runExperimentCli(rest);
      break;
    case "approve-experiment":
      await runApproveExperiment(rest);
      break;
    case "complete-experiment":
      await runCompleteExperiment(rest);
      break;
    case "generate-learning":
      await runGenerateLearning(rest);
      break;
    case "strategy-feedback":
      await runStrategyFeedbackCli(rest);
      break;
    case "p5-vertical":
      await runP5VerticalCli();
      break;
    case "analytics-import-csv":
      await runAnalyticsImportCsv(rest);
      break;
    case "analytics-import-json":
      await runAnalyticsImportJson(rest);
      break;
    case "analytics-list-unmatched":
      await runAnalyticsListUnmatched();
      break;
    case "analytics-match":
      await runAnalyticsMatch(rest);
      break;
    case "analytics-reject-match":
      await runAnalyticsRejectMatch(rest);
      break;
    case "affiliate-results-import":
      await runAffiliateResultsImport(rest);
      break;
    case "learning-list":
      await runLearningList(rest);
      break;
    case "learning-approve":
      await runLearningApprove(rest);
      break;
    case "learning-activate":
      await runLearningActivate(rest);
      break;
    case "learning-suspend":
      await runLearningSuspend(rest);
      break;
    case "learning-deactivate":
      await runLearningDeactivate(rest);
      break;
    case "learning-conflicts":
      await runLearningConflicts();
      break;
    case "strategy-generate-with-feedback":
      await runStrategyGenerateWithFeedback(rest);
      break;
    case "ops-run-cycle":
      await runOpsRunCycle(rest);
      break;
    case "ops-resume-job":
      await runOpsResumeJob(rest);
      break;
    case "ops-job-status":
      await runOpsJobStatus(rest);
      break;
    case "p6-vertical":
      await runP6Vertical();
      break;
    case "p8-vertical":
      await runP8Vertical();
      break;
    case "p9-vertical":
      await runP9Vertical();
      break;
    case "production-research-url":
      await runProductionResearchUrl(rest);
      break;
    case "production-check":
      await runProductionCheck();
      break;
    case "production-diagnose":
      await runProductionDiagnose();
      break;
    case "llm-test":
      await runLlmTest(rest);
      break;
    case "blogger-create-test-draft":
      await runBloggerCreateTestDraft(rest);
      break;
    case "ops-daily-status":
      await runOpsDailyStatus();
      break;
    case "local-fanza-research-collect":
      await runLocalFanzaResearchCollectCli(rest);
      break;
    case "stock-generate":
      await runStockGenerateCli(rest);
      break;
    case "wp-future-schedule":
      await runWpFutureScheduleCli(rest);
      break;
    case "stock-status":
      await runStockStatusCli();
      break;
    case "stock-pipeline":
      await runStockPipelineCli(rest);
      break;
    case "initial-publish-boost":
      await runInitialPublishBoostCli(rest);
      break;
    case "confirm-fanza-image-terms":
      await runConfirmFanzaImageTermsCli(rest);
      break;
    case "wp-refresh-metadata":
      await runWpRefreshMetadataCli(rest);
      break;
    case "wp-refresh-adult-tags":
      await runWpRefreshAdultTagsCli(rest);
      break;
    case "wp-upgrade-image-resolution":
      await runWpUpgradeImageResolutionCli(rest);
      break;
    case "wp-refresh-categories":
      await runWpRefreshCategoriesCli(rest);
      break;
    case "wp-deploy-otonaselect-theme":
      await runWpDeployOtonaselectThemeCli(rest);
      break;
    case "wp-deploy-otonaselect-age-gate":
      await runWpDeployOtonaselectAgeGateCli(rest);
      break;
    case "wp-reflect-media":
      await runWpReflectMediaCli(rest);
      break;
    case "fanza-refresh-official-taxonomy":
      await runFanzaRefreshOfficialTaxonomyCli(rest);
      break;
    default:
      console.error(
        "Usage: node dist/cli.js <...|wp-reflect-media|wp-deploy-otonaselect-theme|wp-deploy-otonaselect-age-gate|wp-refresh-categories|...>",
      );
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  if (isConfigurationIncomplete(error)) {
    console.error("configuration incomplete");
  } else if (error instanceof CronValidationError) {
    console.error(error.message);
  } else {
    console.error(toSafeErrorMessage(error));
  }
  process.exitCode = 1;
});
