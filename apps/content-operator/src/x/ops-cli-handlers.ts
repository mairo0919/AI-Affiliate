import { loadConfig } from "@ai-affiliate/config";
import {
  ContentRepository,
  NotificationRepository,
  XOpsRepository,
  XOptimizationRepository,
  XPublicationRepository,
  createDatabaseClient,
  hashProductKey,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { ContentEngine, MockContentGenerationProvider } from "../content/index.js";
import { NotificationService } from "../notifications/index.js";
import { XContentOptimizer } from "./optimization/content-optimizer.js";
import {
  XAssistedPublicationService,
  XRuntimeControlService,
} from "./ops/index.js";
import { XPublicationService } from "./publication-service.js";
import { createXPublishingProvider } from "./providers/index.js";
import { tokyoParts } from "./optimization/feature-extractor.js";

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    flags[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return flags;
}

async function withDb<T>(run: (db: ReturnType<typeof createDatabaseClient>) => Promise<T>): Promise<T> {
  const database = createDatabaseClient();
  await database.connect();
  try {
    return await run(database);
  } finally {
    await database.disconnect();
  }
}

export async function runXAssistedPrepare(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["recommendation-id"] || !flags["content-id"]) {
    console.error(
      "Usage: x:assisted:prepare -- --recommendation-id=<ID> --content-id=<ID> [--provider=mock]",
    );
    process.exitCode = 1;
    return;
  }
  await withDb(async (database) => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const contents = new ContentRepository(database.prisma);
    const publications = new XPublicationRepository(database.prisma);
    const optimization = new XOptimizationRepository(database.prisma);
    const ops = new XOpsRepository(database.prisma);
    const notifications = new NotificationService({
      logger,
      config,
      notifications: new NotificationRepository(database.prisma),
    });
    const contentEngine = new ContentEngine({
      logger,
      config,
      contents,
      provider: new MockContentGenerationProvider(),
    });
    const provider = createXPublishingProvider(flags.provider ?? "mock", {
      enabled: false,
      accessToken: config.xApiAccessToken,
      accountId: config.xApiAccountId,
      baseUrl: config.xApiBaseUrl,
      timeoutMs: config.xApiTimeoutMs,
      username: "mockuser",
    });
    const publicationService = new XPublicationService({
      logger,
      config,
      contents,
      publications,
      ops,
      optimization,
      provider,
    });
    const contentOptimizer = new XContentOptimizer({
      logger,
      config,
      contents,
      publications,
      optimization,
      contentEngine,
    });
    const assisted = new XAssistedPublicationService({
      logger,
      config,
      contents,
      publications,
      optimization,
      ops,
      contentEngine,
      publicationService,
      contentOptimizer,
      notifications: {
        emitXEvent: (e, p) => notifications.emitXEvent(e, p).then(() => undefined),
      },
    });
    const result = await assisted.prepare({
      recommendationId: flags["recommendation-id"]!,
      contentId: flags["content-id"]!,
      actorId: flags.reviewer ?? "cli",
    });
    console.log(JSON.stringify(result, null, 2));
  });
}

export async function runXAssistedReview(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["application-id"] || !flags.action) {
    console.error(
      "Usage: x:assisted:review -- --application-id=<ID> --action=approve|reject --reviewer=admin",
    );
    process.exitCode = 1;
    return;
  }
  await withDb(async (database) => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const contents = new ContentRepository(database.prisma);
    const publications = new XPublicationRepository(database.prisma);
    const optimization = new XOptimizationRepository(database.prisma);
    const ops = new XOpsRepository(database.prisma);
    const contentEngine = new ContentEngine({
      logger,
      config,
      contents,
      provider: new MockContentGenerationProvider(),
    });
    const publicationService = new XPublicationService({
      logger,
      config,
      contents,
      publications,
      ops,
      optimization,
      provider: createXPublishingProvider("mock", {
        enabled: false,
        accessToken: config.xApiAccessToken,
        accountId: config.xApiAccountId,
        baseUrl: config.xApiBaseUrl,
        timeoutMs: config.xApiTimeoutMs,
        username: "mockuser",
      }),
    });
    const assisted = new XAssistedPublicationService({
      logger,
      config,
      contents,
      publications,
      optimization,
      ops,
      contentEngine,
      publicationService,
      contentOptimizer: new XContentOptimizer({
        logger,
        config,
        contents,
        publications,
        optimization,
        contentEngine,
      }),
    });
    const result = await assisted.review({
      applicationId: flags["application-id"]!,
      action: flags.action === "reject" ? "reject" : "approve",
      reviewer: flags.reviewer ?? config.xOptimizationDefaultReviewer,
      comment: flags.comment,
    });
    console.log(JSON.stringify(result, null, 2));
  });
}

export async function runXAssistedSchedule(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["application-id"] || !flags["scheduled-at"]) {
    console.error(
      'Usage: x:assisted:schedule -- --application-id=<ID> --scheduled-at="2026-08-01T21:00:00+09:00"',
    );
    process.exitCode = 1;
    return;
  }
  await withDb(async (database) => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const contents = new ContentRepository(database.prisma);
    const publications = new XPublicationRepository(database.prisma);
    const optimization = new XOptimizationRepository(database.prisma);
    const ops = new XOpsRepository(database.prisma);
    const contentEngine = new ContentEngine({
      logger,
      config,
      contents,
      provider: new MockContentGenerationProvider(),
    });
    const publicationService = new XPublicationService({
      logger,
      config,
      contents,
      publications,
      ops,
      optimization,
      provider: createXPublishingProvider("mock", {
        enabled: false,
        accessToken: config.xApiAccessToken,
        accountId: config.xApiAccountId,
        baseUrl: config.xApiBaseUrl,
        timeoutMs: config.xApiTimeoutMs,
        username: "mockuser",
      }),
      loadResearchExternalId: async (id) => {
        const row = await database.prisma.researchItem.findUnique({
          where: { id },
          select: { externalId: true },
        });
        return row?.externalId;
      },
    });
    const assisted = new XAssistedPublicationService({
      logger,
      config,
      contents,
      publications,
      optimization,
      ops,
      contentEngine,
      publicationService,
      contentOptimizer: new XContentOptimizer({
        logger,
        config,
        contents,
        publications,
        optimization,
        contentEngine,
      }),
    });
    const pub = await assisted.schedule({
      applicationId: flags["application-id"]!,
      scheduledAt: new Date(flags["scheduled-at"]!),
      actorId: flags.reviewer ?? "cli",
      cooldownOverrideReason: flags["override-reason"],
    });
    console.log(`publicationId: ${pub.id}`);
    console.log(`status: ${pub.status}`);
    console.log(`scheduledAt: ${pub.scheduledAt?.toISOString() ?? "-"}`);
  });
}

export async function runXAssistedShow(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["application-id"]) {
    console.error("Usage: x:assisted:show -- --application-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withDb(async (database) => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const contents = new ContentRepository(database.prisma);
    const publications = new XPublicationRepository(database.prisma);
    const optimization = new XOptimizationRepository(database.prisma);
    const ops = new XOpsRepository(database.prisma);
    const contentEngine = new ContentEngine({
      logger,
      config,
      contents,
      provider: new MockContentGenerationProvider(),
    });
    const publicationService = new XPublicationService({
      logger,
      config,
      contents,
      publications,
      ops,
      optimization,
    });
    const assisted = new XAssistedPublicationService({
      logger,
      config,
      contents,
      publications,
      optimization,
      ops,
      contentEngine,
      publicationService,
      contentOptimizer: new XContentOptimizer({
        logger,
        config,
        contents,
        publications,
        optimization,
        contentEngine,
      }),
    });
    console.log(JSON.stringify(await assisted.show(flags["application-id"]!), null, 2));
  });
}

export async function runXAssistedCancel(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["application-id"]) {
    console.error("Usage: x:assisted:cancel -- --application-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withDb(async (database) => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const contents = new ContentRepository(database.prisma);
    const publications = new XPublicationRepository(database.prisma);
    const optimization = new XOptimizationRepository(database.prisma);
    const ops = new XOpsRepository(database.prisma);
    const contentEngine = new ContentEngine({
      logger,
      config,
      contents,
      provider: new MockContentGenerationProvider(),
    });
    const publicationService = new XPublicationService({
      logger,
      config,
      contents,
      publications,
      ops,
      optimization,
    });
    const assisted = new XAssistedPublicationService({
      logger,
      config,
      contents,
      publications,
      optimization,
      ops,
      contentEngine,
      publicationService,
      contentOptimizer: new XContentOptimizer({
        logger,
        config,
        contents,
        publications,
        optimization,
        contentEngine,
      }),
    });
    await assisted.cancel({
      applicationId: flags["application-id"]!,
      actorId: flags.reviewer ?? "cli",
      reason: flags.reason,
    });
    console.log("cancelled");
  });
}

export async function runXRuntimeStatus(): Promise<void> {
  await withDb(async (database) => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const service = new XRuntimeControlService({
      logger,
      config,
      ops: new XOpsRepository(database.prisma),
    });
    console.log(JSON.stringify(await service.status(), null, 2));
  });
}

export async function runXRuntimePause(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.by || !flags.reason) {
    console.error("Usage: x:runtime:pause -- --by=admin --reason=... [--key=GLOBAL_KILL_SWITCH]");
    process.exitCode = 1;
    return;
  }
  await withDb(async (database) => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const notifications = new NotificationService({
      logger,
      config,
      notifications: new NotificationRepository(database.prisma),
    });
    const service = new XRuntimeControlService({
      logger,
      config,
      ops: new XOpsRepository(database.prisma),
      notifications: {
        emitXEvent: (e, p) => notifications.emitXEvent(e, p).then(() => undefined),
      },
    });
    await service.pause({
      key: flags.key,
      changedBy: flags.by,
      reason: flags.reason,
    });
    console.log("paused");
  });
}

export async function runXRuntimeResume(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.by || !flags.reason) {
    console.error("Usage: x:runtime:resume -- --by=admin --reason=... [--key=GLOBAL_KILL_SWITCH]");
    process.exitCode = 1;
    return;
  }
  await withDb(async (database) => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const service = new XRuntimeControlService({
      logger,
      config,
      ops: new XOpsRepository(database.prisma),
    });
    await service.resume({
      key: flags.key,
      changedBy: flags.by,
      reason: flags.reason,
    });
    console.log("resumed");
  });
}

export async function runXOpsStatus(): Promise<void> {
  await withDb(async (database) => {
    const config = loadConfig();
    const ops = new XOpsRepository(database.prisma);
    const publications = new XPublicationRepository(database.prisma);
    const runtime = new XRuntimeControlService({
      logger: createLogger(config.logLevel),
      config,
      ops,
    });
    const st = await runtime.status();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const hourStart = new Date();
    hourStart.setMinutes(0, 0, 0);
    const daily = await ops.countPublishedPostsInRange({
      since: dayStart,
      until: new Date(),
    });
    const hourly = await ops.countPublishedPostsInRange({
      since: hourStart,
      until: new Date(),
    });
    const next = await ops.findNextScheduled();
    console.log(
      JSON.stringify(
        {
          releaseMode: st.releaseMode,
          killSwitch: st.effectivePublishingBlocked,
          publishingEnabled: config.xAutoPublicationEnabled && !st.effectivePublishingBlocked,
          metricsEnabled: config.xMetricsCollectionEnabled && !st.metricsPaused,
          optimizationEnabled: config.xOptimizationEnabled && !st.optimizationPaused,
          queued: await ops.countByStatus("SCHEDULED"),
          blocked: await ops.countByStatus("BLOCKED"),
          failed: await ops.countByStatus("FAILED"),
          activeReservations: await ops.countActiveReservations(),
          dailyPublishedCount: daily,
          hourlyPublishedCount: hourly,
          limits: {
            daily: config.xReleaseDailyPostLimit,
            hourly: config.xReleaseHourlyPostLimit,
            startHourJst: config.xReleaseAllowedStartHourJst,
            endHourJst: config.xReleaseAllowedEndHourJst,
          },
          currentHourJst: tokyoParts(new Date()).hour,
          nextScheduledPublication: next
            ? { id: next.id, scheduledAt: next.scheduledAt?.toISOString() ?? null }
            : null,
          sampleQueued: (await publications.list({ status: "SCHEDULED", limit: 5 })).map((p) => ({
            id: p.id,
            strategyType: p.strategyType,
            scheduledAt: p.scheduledAt?.toISOString() ?? null,
          })),
        },
        null,
        2,
      ),
    );
  });
}

export async function runXOpsHealth(): Promise<void> {
  await runXOpsStatus();
}

export async function runXOpsQueue(): Promise<void> {
  await withDb(async (database) => {
    const publications = new XPublicationRepository(database.prisma);
    const rows = await publications.list({ status: "SCHEDULED", limit: 50 });
    for (const row of rows) {
      console.log(
        `${row.id} strategy=${row.strategyType} scheduledAt=${row.scheduledAt?.toISOString() ?? "-"}`,
      );
    }
  });
}

export async function runXOpsBlocked(): Promise<void> {
  await withDb(async (database) => {
    const publications = new XPublicationRepository(database.prisma);
    const rows = await publications.list({ status: "BLOCKED", limit: 50 });
    for (const row of rows) {
      console.log(
        `${row.id} error=${row.lastErrorType ?? "-"} msg=${row.lastErrorMessage ?? "-"}`,
      );
    }
  });
}

export async function runXOpsAudit(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  await withDb(async (database) => {
    const ops = new XOpsRepository(database.prisma);
    const rows = await ops.listAudit({
      limit: Number.parseInt(flags.limit ?? "50", 10),
      action: flags.action,
    });
    for (const row of rows) {
      const dumped = JSON.stringify(row);
      if (/accessToken|client_secret|rawData/i.test(dumped)) {
        console.log(`${row.id} [redacted]`);
        continue;
      }
      console.log(
        `${row.createdAt.toISOString()} ${row.action} ${row.result} pub=${row.publicationId ?? "-"} hash=${row.productKeyHash ?? "-"} reason=${row.reason ?? "-"}`,
      );
    }
  });
}

export async function runXOpsLimits(): Promise<void> {
  const config = loadConfig();
  console.log(
    JSON.stringify(
      {
        daily: config.xReleaseDailyPostLimit,
        hourly: config.xReleaseHourlyPostLimit,
        startHourJst: config.xReleaseAllowedStartHourJst,
        endHourJst: config.xReleaseAllowedEndHourJst,
        cooldownHours: config.xProductCooldownHours,
        reservationTtlMinutes: config.xProductReservationTtlMinutes,
      },
      null,
      2,
    ),
  );
}

export async function runXOpsCooldowns(): Promise<void> {
  await withDb(async (database) => {
    const ops = new XOpsRepository(database.prisma);
    const rows = await ops.listProductStates(50);
    for (const row of rows) {
      console.log(
        `hash=${hashProductKey(row.productKey)} nextEligible=${row.nextEligibleAt?.toISOString() ?? "-"} activeRes=${row.activeReservationCount} lastPub=${row.lastPublicationId ?? "-"}`,
      );
    }
  });
}
