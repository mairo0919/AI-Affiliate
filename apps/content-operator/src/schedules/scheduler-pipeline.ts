import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient } from "@ai-affiliate/database";
import {
  AnalysisRepository,
  ContentRepository,
  JobRepository,
  NotificationRepository,
  ResearchRepository,
  ScheduleRepository,
  XOptimizationRepository,
  XOpsRepository,
  XPublicationRepository,
} from "@ai-affiliate/database";
import type { GeneratedContentType } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { AnalysisEngine } from "../analysis/analysis-engine.js";
import type { AnalysisRunResult } from "../analysis/analysis-engine.js";
import { ContentEngine } from "../content/content-engine.js";
import type { ContentGenerateResult } from "../content/content-engine.js";
import { parseContentTypeFlag } from "../content/content-engine.js";
import { NotificationService } from "../notifications/notification-service.js";
import { XMetricsCollector } from "../x/metrics-collector.js";
import type { MetricsCollectResult } from "../x/metrics-collector.js";
import { XPublicationService } from "../x/publication-service.js";
import { XStrategyEvaluator } from "../x/strategy-evaluator.js";
import type { StrategyEvaluationReport } from "../x/strategy-evaluator.js";
import {
  XOptimizationEngine,
  XOptimizationImpactEvaluator,
} from "../x/optimization/index.js";
import type { OptimizationRunResult } from "../x/optimization/index.js";
import { createLiveStack } from "../x/live/index.js";
import { createXPublishingProvider } from "../x/providers/index.js";
import type { ScheduleRunOutcome } from "./schedule-runner.js";
import { ScheduleRunner } from "./schedule-runner.js";
import type { RetryRunOutcome } from "./retry-runner.js";
import { RetryRunner } from "./retry-runner.js";
import { loadDailyMultiChannelConfig } from "../daily-ops/config.js";
import { runDailyMultiChannelLive, type DailyLiveResult } from "../daily-ops/live-orchestrator.js";
import { LifecycleRepository } from "@ai-affiliate/database";
import { ensureResearchCollectionSchedules } from "../research/ensure-collection-schedules.js";
import { loadStockRuntimeConfig } from "../stock/stock-config.js";
import { runStockGenerationBatch, type StockGenerationResult } from "../stock/stock-generation-worker.js";
import { runPublishSlotScheduler, type PublishSlotScheduleResult } from "../stock/publish-slot-scheduler.js";
import { probeEnabledAdultProviders } from "../providers/adult-provider-registry.js";

export const DEFAULT_DUE_SCHEDULE_LIMIT = 20;
export const DEFAULT_DUE_RETRY_LIMIT = 20;
export const DEFAULT_NOTIFICATION_LIMIT = 50;

type Skipped = { skipped: true; skipReason: string };

export interface SchedulerPipelineResult {
  schedules: ScheduleRunOutcome[];
  retries: RetryRunOutcome[];
  analysis: AnalysisRunResult | Skipped;
  content: ContentGenerateResult | Skipped;
  dailyOps: DailyLiveResult | Skipped;
  stockGeneration: StockGenerationResult | Skipped;
  publishSlots: PublishSlotScheduleResult | Skipped;
  providerProbe: Array<{
    key: string;
    status: string;
    skipReason: string | null;
  }>;
  xPublish: { published: number } | Skipped;
  xMetrics: MetricsCollectResult | Skipped;
  xStrategy: StrategyEvaluationReport | Skipped;
  xOptimization: OptimizationRunResult | Skipped;
  xOptimizationImpact: { evaluated: number } | Skipped;
  notifications: {
    processed: number;
    sent: number;
    failed: number;
    skipped: number;
  };
}

export interface SchedulerPipelineDeps {
  logger: Logger;
  database: DatabaseClient;
  config: AppConfig;
  now?: () => Date;
  random?: () => number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  scheduleRunner?: ScheduleRunner;
  retryRunner?: RetryRunner;
  notificationService?: NotificationService;
  analysisEngine?: AnalysisEngine;
  contentEngine?: ContentEngine;
  xPublicationService?: XPublicationService;
  xMetricsCollector?: XMetricsCollector;
  xStrategyEvaluator?: XStrategyEvaluator;
  xOptimizationEngine?: XOptimizationEngine;
  xOptimizationImpactEvaluator?: XOptimizationImpactEvaluator;
}

async function loadItemTags(
  database: DatabaseClient,
  researchItemId: string,
): Promise<{ actress: string[]; genre: string[]; maker: string[]; series: string[] }> {
  const tags = await database.prisma.researchItemTag.findMany({
    where: { researchItemId },
    include: { researchTag: true },
  });
  const group = (type: string) =>
    tags
      .filter((t) => t.researchTag.type.toLowerCase() === type)
      .map((t) => t.researchTag.name);
  return {
    actress: group("actress"),
    genre: group("genre"),
    maker: group("maker"),
    series: group("series"),
  };
}

export class SchedulerPipeline {
  private readonly logger: Logger;
  private readonly config: AppConfig;
  private readonly database: DatabaseClient;
  private readonly now: () => Date;
  private readonly scheduleRunner: ScheduleRunner;
  private readonly retryRunner: RetryRunner;
  private readonly notifications: NotificationService;
  private readonly analysisEngine: AnalysisEngine;
  private readonly contentEngine: ContentEngine;
  private readonly xPublicationService: XPublicationService;
  private readonly xMetricsCollector: XMetricsCollector;
  private readonly xStrategyEvaluator: XStrategyEvaluator;
  private readonly xOptimizationEngine: XOptimizationEngine;
  private readonly xOptimizationImpactEvaluator: XOptimizationImpactEvaluator;
  private readonly analysisRepo: AnalysisRepository;
  private readonly contentRepo: ContentRepository;
  private readonly xRepo: XPublicationRepository;
  private readonly optimizationRepo: XOptimizationRepository;
  private readonly opsRepo: XOpsRepository;
  private readonly scheduleRepository: ScheduleRepository;

  constructor(deps: SchedulerPipelineDeps) {
    this.logger = deps.logger;
    this.config = deps.config;
    this.database = deps.database;
    this.now = deps.now ?? (() => new Date());
    const schedules = new ScheduleRepository(deps.database.prisma);
    this.scheduleRepository = schedules;
    const jobs = new JobRepository(deps.database.prisma);
    const notificationRepo = new NotificationRepository(deps.database.prisma);
    this.analysisRepo = new AnalysisRepository(deps.database.prisma);
    this.contentRepo = new ContentRepository(deps.database.prisma);
    this.xRepo = new XPublicationRepository(deps.database.prisma);
    this.optimizationRepo = new XOptimizationRepository(deps.database.prisma);
    this.opsRepo = new XOpsRepository(deps.database.prisma);

    this.notifications =
      deps.notificationService ??
      new NotificationService({
        logger: deps.logger,
        config: deps.config,
        notifications: notificationRepo,
        now: deps.now,
        fetchImpl: deps.fetchImpl,
        sleepImpl: deps.sleepImpl,
        random: deps.random,
      });

    this.scheduleRunner =
      deps.scheduleRunner ??
      new ScheduleRunner({
        logger: deps.logger,
        database: deps.database,
        schedules,
        jobs,
        config: deps.config,
        now: deps.now,
        random: deps.random,
        notifications: this.notifications,
      });

    this.retryRunner =
      deps.retryRunner ??
      new RetryRunner({
        logger: deps.logger,
        database: deps.database,
        schedules,
        jobs,
        config: deps.config,
        notifications: this.notifications,
        now: deps.now,
        random: deps.random,
        batchSize: DEFAULT_DUE_RETRY_LIMIT,
      });

    this.analysisEngine =
      deps.analysisEngine ??
      new AnalysisEngine({
        logger: deps.logger,
        research: new ResearchRepository(deps.database.prisma),
        analysis: this.analysisRepo,
        config: deps.config,
      });

    this.contentEngine =
      deps.contentEngine ??
      new ContentEngine({
        logger: deps.logger,
        config: deps.config,
        contents: this.contentRepo,
        notifications: {
          emitContentEvent: (eventType, payload) =>
            this.notifications.emitContentEvent(eventType, payload).then(() => undefined),
        },
      });

    const providerName = deps.config.xApiProvider.trim().toLowerCase();
    const liveStack =
      providerName === "x-api" || providerName === "api"
        ? createLiveStack({
            config: deps.config,
            prisma: deps.database.prisma,
            fetchImpl: deps.fetchImpl,
            now: deps.now,
            sleep: deps.sleepImpl,
            // Scheduler never enables ALLOWLIST live writes via this flag alone
            allowWrites:
              deps.config.xReleaseMode === "LIMITED" ||
              deps.config.xReleaseMode === "FULL",
            notifications: {
              emitXEvent: (eventType, payload) =>
                this.notifications
                  .emitXEvent(
                    eventType as Parameters<NotificationService["emitXEvent"]>[0],
                    payload,
                  )
                  .then(() => undefined),
            },
          })
        : null;

    const xProvider = createXPublishingProvider(deps.config.xApiProvider, {
      enabled: deps.config.xApiEnabled,
      accessToken: deps.config.xApiAccessToken,
      accountId: deps.config.xApiAccountId,
      baseUrl: deps.config.xApiBaseUrl,
      timeoutMs: deps.config.xApiTimeoutMs,
      liveProvider: liveStack?.provider,
    });

    const dailyCfg = loadDailyMultiChannelConfig();
    const allowDailyLiveX =
      dailyCfg.enabled &&
      !dailyCfg.dryRun &&
      (deps.config.xReleaseMode === "LIMITED" || deps.config.xReleaseMode === "FULL");

    this.xPublicationService =
      deps.xPublicationService ??
      new XPublicationService({
        logger: deps.logger,
        config: deps.config,
        contents: this.contentRepo,
        publications: this.xRepo,
        provider: xProvider,
        ops: this.opsRepo,
        optimization: this.optimizationRepo,
        now: deps.now,
        random: deps.random,
        allowSchedulerLivePublish: allowDailyLiveX,
        livePublishConfirmed: allowDailyLiveX,
        checkApiBudget: liveStack
          ? async (accountId) => liveStack.budget.checkPaidRequest(accountId)
          : undefined,
        notifications: {
          emitXEvent: (eventType, payload) =>
            this.notifications.emitXEvent(eventType, payload).then(() => undefined),
        },
        loadItemTags: (id) => loadItemTags(deps.database, id),
        loadCandidateType: async (id) => {
          const row = await deps.database.prisma.contentCandidate.findUnique({
            where: { id },
          });
          return row?.candidateType;
        },
        loadResearchExternalId: async (researchItemId) => {
          const row = await deps.database.prisma.researchItem.findUnique({
            where: { id: researchItemId },
            select: { externalId: true },
          });
          return row?.externalId;
        },
      });

    this.xMetricsCollector =
      deps.xMetricsCollector ??
      new XMetricsCollector({
        logger: deps.logger,
        config: deps.config,
        publications: this.xRepo,
        provider: xProvider,
        now: deps.now,
        notifications: {
          emitXEvent: (eventType, payload) =>
            this.notifications.emitXEvent(eventType, payload).then(() => undefined),
        },
        beforeCollect: liveStack
          ? async () => {
              const cred = await liveStack.live.findActiveCredential();
              if (!cred || cred.status === "INVALID" || cred.status === "REVOKED") {
                return { ok: false, reason: "CREDENTIAL_UNAVAILABLE" };
              }
              const budget = await liveStack.budget.checkPaidRequest(
                cred.accountId,
                liveStack.usage.estimateCost("analytics"),
              );
              if (!budget.allowed) {
                return { ok: false, reason: budget.reason ?? "API_BUDGET_PAUSED" };
              }
              return { ok: true };
            }
          : undefined,
      });

    // usage sync at most once per configured interval (default daily)
    if (liveStack && deps.config.xApiUsageSyncEnabled) {
      void liveStack.usage.syncOfficialUsage(deps.config.xApiAccountId).catch(() => undefined);
    }

    this.xStrategyEvaluator =
      deps.xStrategyEvaluator ??
      new XStrategyEvaluator({
        logger: deps.logger,
        config: deps.config,
        publications: this.xRepo,
        now: deps.now,
        notifications: {
          emitXEvent: (eventType, payload) =>
            this.notifications.emitXEvent(eventType, payload).then(() => undefined),
        },
      });

    this.xOptimizationEngine =
      deps.xOptimizationEngine ??
      new XOptimizationEngine({
        logger: deps.logger,
        config: deps.config,
        publications: this.xRepo,
        optimization: this.optimizationRepo,
        now: deps.now,
        loadPublicationContext: async (publication) => {
          const content = await this.contentRepo.findGeneratedContentById(
            publication.generatedContentId,
          );
          const candidate = await deps.database.prisma.contentCandidate.findUnique({
            where: { id: publication.contentCandidateId },
          });
          const analysis = await deps.database.prisma.productAnalysis.findFirst({
            where: { researchItemId: publication.researchItemId },
            orderBy: { createdAt: "desc" },
          });
          return {
            title: content?.title,
            candidateType: candidate?.candidateType,
            productScore: analysis?.totalScore ?? null,
            price: null,
            reviewCount: null,
            inputSnapshot:
              content?.inputSnapshot && typeof content.inputSnapshot === "object"
                ? (content.inputSnapshot as Record<string, unknown>)
                : null,
          };
        },
        notifications: {
          emitXEvent: (eventType, payload) =>
            this.notifications.emitXEvent(eventType, payload).then(() => undefined),
        },
      });

    this.xOptimizationImpactEvaluator =
      deps.xOptimizationImpactEvaluator ??
      new XOptimizationImpactEvaluator({
        logger: deps.logger,
        config: deps.config,
        publications: this.xRepo,
        optimization: this.optimizationRepo,
        now: deps.now,
        notifications: {
          emitXEvent: (eventType, payload) =>
            this.notifications.emitXEvent(eventType, payload).then(() => undefined),
        },
      });
  }

  async run(): Promise<SchedulerPipelineResult> {
    let schedules: ScheduleRunOutcome[] = [];
    let retries: RetryRunOutcome[] = [];
    let analysis: SchedulerPipelineResult["analysis"] = {
      skipped: true,
      skipReason: "ANALYSIS_AUTO_RUN_DISABLED",
    };
    let content: SchedulerPipelineResult["content"] = {
      skipped: true,
      skipReason: "CONTENT_AUTO_GENERATION_DISABLED",
    };
    let dailyOps: SchedulerPipelineResult["dailyOps"] = {
      skipped: true,
      skipReason: "DAILY_OPS_DISABLED_OR_NOT_RUN",
    };
    let stockGeneration: SchedulerPipelineResult["stockGeneration"] = {
      skipped: true,
      skipReason: "STOCK_GENERATION_NOT_RUN",
    };
    let publishSlots: SchedulerPipelineResult["publishSlots"] = {
      skipped: true,
      skipReason: "PUBLISH_SLOTS_NOT_RUN",
    };
    let providerProbe: SchedulerPipelineResult["providerProbe"] = [];
    let xPublish: SchedulerPipelineResult["xPublish"] = {
      skipped: true,
      skipReason: "X_AUTO_PUBLICATION_DISABLED",
    };
    let xMetrics: SchedulerPipelineResult["xMetrics"] = {
      skipped: true,
      skipReason: "X_METRICS_COLLECTION_DISABLED",
    };
    let xStrategy: SchedulerPipelineResult["xStrategy"] = {
      skipped: true,
      skipReason: "X_STRATEGY_EVALUATION_DISABLED",
    };
    let xOptimization: SchedulerPipelineResult["xOptimization"] = {
      skipped: true,
      skipReason: "X_OPTIMIZATION_DISABLED",
    };
    let xOptimizationImpact: SchedulerPipelineResult["xOptimizationImpact"] = {
      skipped: true,
      skipReason: "X_OPTIMIZATION_IMPACT_EVALUATION_DISABLED",
    };
    let notifications = { processed: 0, sent: 0, failed: 0, skipped: 0 };

    try {
      // Multi-ASP: ensure system schedules for enabled providers before due runs.
      // Missing credentials only skip that provider at execution time.
      await ensureResearchCollectionSchedules({
        schedules: this.scheduleRepository,
        config: this.config,
        logger: this.logger,
        now: this.now,
      });
    } catch (error) {
      this.logger.warn(`research auto-schedule ensure failed: ${String(error)}`);
    }

    try {
      providerProbe = (await probeEnabledAdultProviders(this.config)).map((p) => ({
        key: p.key,
        status: String(p.status),
        skipReason: p.skipReason,
      }));
      this.logger.info(
        `provider probe: ${providerProbe.map((p) => `${p.key}=${p.status}`).join(", ")}`,
      );
    } catch (error) {
      this.logger.warn(`provider probe failed: ${String(error)}`);
    }

    try {
      schedules = await this.scheduleRunner.runDueSchedules();
    } catch (error) {
      this.logger.warn(`due schedule phase failed: ${String(error)}`);
    }

    try {
      retries = await this.retryRunner.runDueRetries();
    } catch (error) {
      this.logger.warn(`retry phase failed: ${String(error)}`);
    }

    try {
      analysis = await this.runAnalysisPhase();
    } catch (error) {
      this.logger.warn(`analysis phase failed: ${String(error)}`);
      analysis = { skipped: true, skipReason: `analysis error: ${String(error)}` };
    }

    try {
      content = await this.runContentPhase();
    } catch (error) {
      this.logger.warn(`content phase failed: ${String(error)}`);
      content = { skipped: true, skipReason: `content error: ${String(error)}` };
    }

    try {
      dailyOps = await this.runDailyOpsPhase();
    } catch (error) {
      this.logger.warn(`daily ops phase failed: ${String(error)}`);
      dailyOps = { skipped: true, skipReason: `daily ops error: ${String(error)}` };
    }

    try {
      stockGeneration = await this.runStockGenerationPhase();
    } catch (error) {
      this.logger.warn(`stock generation phase failed: ${String(error)}`);
      stockGeneration = { skipped: true, skipReason: `stock generation error: ${String(error)}` };
    }

    try {
      publishSlots = await this.runPublishSlotsPhase();
    } catch (error) {
      this.logger.warn(`publish slots phase failed: ${String(error)}`);
      publishSlots = { skipped: true, skipReason: `publish slots error: ${String(error)}` };
    }

    try {
      xPublish = await this.runXPublishPhase();
    } catch (error) {
      this.logger.warn(`x publish phase failed: ${String(error)}`);
      xPublish = { skipped: true, skipReason: `x publish error: ${String(error)}` };
    }

    try {
      xMetrics = await this.runXMetricsPhase();
    } catch (error) {
      this.logger.warn(`x metrics phase failed: ${String(error)}`);
      xMetrics = { skipped: true, skipReason: `x metrics error: ${String(error)}` };
    }

    try {
      xStrategy = await this.runXStrategyPhase();
    } catch (error) {
      this.logger.warn(`x strategy phase failed: ${String(error)}`);
      xStrategy = { skipped: true, skipReason: `x strategy error: ${String(error)}` };
    }

    try {
      xOptimization = await this.runXOptimizationPhase();
    } catch (error) {
      this.logger.warn(`x optimization phase failed: ${String(error)}`);
      xOptimization = {
        skipped: true,
        skipReason: `x optimization error: ${String(error)}`,
      };
    }

    try {
      xOptimizationImpact = await this.runXOptimizationImpactPhase();
    } catch (error) {
      this.logger.warn(`x optimization impact phase failed: ${String(error)}`);
      xOptimizationImpact = {
        skipped: true,
        skipReason: `x optimization impact error: ${String(error)}`,
      };
    }

    try {
      notifications = await this.notifications.dispatchPendingNotifications(
        DEFAULT_NOTIFICATION_LIMIT,
      );
    } catch (error) {
      this.logger.warn(`notification phase failed: ${String(error)}`);
    }

    return {
      schedules,
      retries,
      analysis,
      content,
      dailyOps,
      stockGeneration,
      publishSlots,
      providerProbe,
      xPublish,
      xMetrics,
      xStrategy,
      xOptimization,
      xOptimizationImpact,
      notifications,
    };
  }

  /** Continuous APPROVED stock fill (batch-limited). Independent of WP publish rate. */
  private async runStockGenerationPhase(): Promise<SchedulerPipelineResult["stockGeneration"]> {
    const runtime = loadStockRuntimeConfig();
    if (!runtime.stockGenerationEnabled) {
      return { skipped: true, skipReason: "STOCK_GENERATION_ENABLED_FALSE" };
    }
    // Do not force STOCK_CONTINUOUS here — only fill toward minStock (cost control).
    // Ops can set STOCK_CONTINUOUS=true in env for gradual growth above min.
    const lifecycle = new LifecycleRepository(this.database.prisma);
    return runStockGenerationBatch({
      database: this.database,
      lifecycle,
      config: this.config,
      now: this.now(),
    });
  }

  /** Fill next JST 12/21/23 future slots from PUBLIC-eligible APPROVED stock. */
  private async runPublishSlotsPhase(): Promise<SchedulerPipelineResult["publishSlots"]> {
    const runtime = loadStockRuntimeConfig();
    if (!runtime.stockPublishSchedulerEnabled) {
      return { skipped: true, skipReason: "STOCK_PUBLISH_SCHEDULER_ENABLED_FALSE" };
    }
    if (!this.config.wordpressAllowFutureSchedule && !this.config.wordpressAllowDirectPublish) {
      return { skipped: true, skipReason: "FUTURE_SCHEDULE_DISABLED" };
    }
    const lifecycle = new LifecycleRepository(this.database.prisma);
    return runPublishSlotScheduler({
      database: this.database,
      lifecycle,
      config: this.config,
      now: this.now(),
      days: 3,
    });
  }

  /** Daily Blog + X production (OPTION B Blog / ContentEngine X). */
  private async runDailyOpsPhase(): Promise<SchedulerPipelineResult["dailyOps"]> {
    const daily = loadDailyMultiChannelConfig();
    if (!daily.enabled) {
      return { skipped: true, skipReason: "DAILY_OPS_ENABLED_FALSE" };
    }
    const lifecycle = new LifecycleRepository(this.database.prisma);
    return runDailyMultiChannelLive({
      logger: this.logger,
      database: this.database,
      config: this.config,
      lifecycle,
      contentEngine: this.contentEngine,
      xPublicationService: this.xPublicationService,
      dailyConfig: daily,
      now: this.now,
    });
  }

  private async runAnalysisPhase(): Promise<SchedulerPipelineResult["analysis"]> {
    if (!this.config.analysisAutoRunEnabled) {
      return { skipped: true, skipReason: "ANALYSIS_AUTO_RUN_DISABLED" };
    }
    const latest = await this.analysisRepo.findLatestCompletedRun();
    if (latest?.completedAt) {
      const elapsedMs = this.now().getTime() - latest.completedAt.getTime();
      const minMs = this.config.analysisAutoRunMinIntervalMinutes * 60 * 1000;
      if (elapsedMs < minMs) {
        return { skipped: true, skipReason: "ANALYSIS_MIN_INTERVAL_NOT_ELAPSED" };
      }
    }
    return this.analysisEngine.run({
      source: this.config.analysisAutoRunSource,
      limit: this.config.analysisAutoRunLimit,
      now: this.now(),
    });
  }

  private async runContentPhase(): Promise<SchedulerPipelineResult["content"]> {
    if (!this.config.contentAutoGenerationEnabled) {
      return { skipped: true, skipReason: "CONTENT_AUTO_GENERATION_DISABLED" };
    }
    const latestRun = await this.contentRepo.findLatestCompletedGenerationRun();
    if (latestRun?.completedAt) {
      const elapsedMs = this.now().getTime() - latestRun.completedAt.getTime();
      const minMs = this.config.contentAutoGenerationMinIntervalMinutes * 60 * 1000;
      if (elapsedMs < minMs) {
        return { skipped: true, skipReason: "CONTENT_MIN_INTERVAL_NOT_ELAPSED" };
      }
    }

    const types = this.config.contentAutoGenerationTypes
      .map((entry) => parseContentTypeFlag(entry))
      .filter((entry): entry is GeneratedContentType => entry === "X_POST");
    const contentType = types[0] ?? "X_POST";

    return this.contentEngine.generate({
      contentType,
      limit: this.config.contentAutoGenerationLimit,
      minScore: this.config.contentAutoGenerationMinScore,
      includeRequiresConfirmation:
        this.config.contentAutoGenerationIncludeRequiresConfirmation,
      skipExistingSameType: true,
      force: false,
    });
  }

  private async runXPublishPhase(): Promise<SchedulerPipelineResult["xPublish"]> {
    if (!this.config.xAutoPublicationEnabled) {
      return { skipped: true, skipReason: "X_AUTO_PUBLICATION_DISABLED" };
    }
    if (!this.config.xApiEnabled && this.config.xApiProvider !== "mock") {
      return { skipped: true, skipReason: "X_API_DISABLED" };
    }
    if (this.config.xReleaseMode === "DISABLED") {
      return { skipped: true, skipReason: "X_RELEASE_MODE_DISABLED" };
    }
    if (this.config.xReleaseMode === "DRY_RUN") {
      return { skipped: true, skipReason: "X_RELEASE_MODE_DRY_RUN" };
    }
    // ALLOWLIST: scheduler must never perform live posts
    if (this.config.xReleaseMode === "ALLOWLIST") {
      return { skipped: true, skipReason: "X_RELEASE_MODE_ALLOWLIST_NO_SCHEDULER" };
    }
    const runtimePaused = await this.opsRepo.isControlActive(
      "PUBLISHING_PAUSED",
      this.now(),
    );
    const runtimeKill = await this.opsRepo.isControlActive(
      "GLOBAL_KILL_SWITCH",
      this.now(),
    );
    if (this.config.xGlobalKillSwitch || runtimeKill || runtimePaused) {
      return { skipped: true, skipReason: "X_KILL_SWITCH_OR_PAUSE" };
    }
    await this.opsRepo.expireDueReservations(this.now());
    const results = await this.xPublicationService.runDue(20);
    const published = results.filter(
      (r) => r.status === "PUBLISHED" || r.status === "PUBLISHED_UNVERIFIED",
    ).length;
    return { published };
  }

  private async runXMetricsPhase(): Promise<SchedulerPipelineResult["xMetrics"]> {
    if (!this.config.xMetricsCollectionEnabled) {
      return { skipped: true, skipReason: "X_METRICS_COLLECTION_DISABLED" };
    }
    const metricsPaused = await this.opsRepo.isControlActive("METRICS_PAUSED", this.now());
    if (metricsPaused) {
      return { skipped: true, skipReason: "X_METRICS_PAUSED" };
    }
    // metrics remain available during kill switch
    return this.xMetricsCollector.collect();
  }

  private async runXStrategyPhase(): Promise<SchedulerPipelineResult["xStrategy"]> {
    if (!this.config.xStrategyEvaluationEnabled) {
      return { skipped: true, skipReason: "X_STRATEGY_EVALUATION_DISABLED" };
    }
    return this.xStrategyEvaluator.evaluate();
  }

  private async runXOptimizationPhase(): Promise<SchedulerPipelineResult["xOptimization"]> {
    if (!this.config.xOptimizationEnabled) {
      return { skipped: true, skipReason: "X_OPTIMIZATION_DISABLED" };
    }
    const paused = await this.opsRepo.isControlActive("OPTIMIZATION_PAUSED", this.now());
    if (paused) {
      return { skipped: true, skipReason: "X_OPTIMIZATION_PAUSED" };
    }
    const latest = await this.optimizationRepo.findLatestCompletedRun();
    if (latest?.completedAt) {
      const elapsedMs = this.now().getTime() - latest.completedAt.getTime();
      const minMs = this.config.xOptimizationMinIntervalMinutes * 60 * 1000;
      if (elapsedMs < minMs) {
        return { skipped: true, skipReason: "X_OPTIMIZATION_MIN_INTERVAL_NOT_ELAPSED" };
      }
    }
    return this.xOptimizationEngine.run({
      mode: this.config.xOptimizationMode,
    });
  }

  private async runXOptimizationImpactPhase(): Promise<
    SchedulerPipelineResult["xOptimizationImpact"]
  > {
    if (!this.config.xOptimizationImpactEvaluationEnabled) {
      return { skipped: true, skipReason: "X_OPTIMIZATION_IMPACT_EVALUATION_DISABLED" };
    }
    const apps = await this.optimizationRepo.listApplications({ limit: 20 });
    const evaluating = apps.filter((a) => a.status === "EVALUATING");
    let evaluated = 0;
    const seen = new Set<string>();
    for (const app of evaluating) {
      if (seen.has(app.recommendationId)) continue;
      seen.add(app.recommendationId);
      await this.xOptimizationImpactEvaluator.evaluate(app.recommendationId);
      evaluated += 1;
    }
    return { evaluated };
  }
}
