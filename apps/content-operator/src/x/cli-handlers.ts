import { loadConfig } from "@ai-affiliate/config";
import {
  ContentRepository,
  XPublicationRepository,
  XPublicationStateError,
  createDatabaseClient,
} from "@ai-affiliate/database";
import type { XPublicationStrategyType } from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { NotificationService } from "../notifications/index.js";
import { NotificationRepository } from "@ai-affiliate/database";
import { XMetricsCollector } from "./metrics-collector.js";
import { XPublicationService } from "./publication-service.js";
import { XStrategyEvaluator } from "./strategy-evaluator.js";
import { createXPublishingProvider } from "./providers/index.js";
import { parseStrategyTypeFlag, XPublicationValidationError } from "./index.js";

export interface XCliFlags {
  contentId?: string;
  publicationId?: string;
  experimentId?: string;
  strategy?: string;
  scheduledAt?: string;
  provider?: string;
  status?: string;
  limit?: number;
  windowHours?: number;
  minimumSamples?: number;
  name?: string;
  variants?: string;
  allocation?: string;
  dryRun?: boolean;
}

export function parseXFlags(argv: string[]): XCliFlags {
  const flags: XCliFlags = {};
  for (const arg of argv) {
    if (arg === "--dry-run") {
      flags.dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq);
    const value = body.slice(eq + 1);
    switch (key) {
      case "content-id":
        flags.contentId = value;
        break;
      case "publication-id":
        flags.publicationId = value;
        break;
      case "experiment-id":
        flags.experimentId = value;
        break;
      case "strategy":
        flags.strategy = value;
        break;
      case "scheduled-at":
        flags.scheduledAt = value;
        break;
      case "provider":
        flags.provider = value;
        break;
      case "status":
        flags.status = value;
        break;
      case "limit":
        flags.limit = Number.parseInt(value, 10);
        break;
      case "window-hours":
        flags.windowHours = Number.parseInt(value, 10);
        break;
      case "minimum-samples":
        flags.minimumSamples = Number.parseInt(value, 10);
        break;
      case "name":
        flags.name = value;
        break;
      case "variants":
        flags.variants = value;
        break;
      case "allocation":
        flags.allocation = value;
        break;
      default:
        break;
    }
  }
  return flags;
}

async function withService(
  flags: XCliFlags,
  run: (svc: XPublicationService, pubs: XPublicationRepository) => Promise<void>,
): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const publications = new XPublicationRepository(database.prisma);
    const contents = new ContentRepository(database.prisma);
    const notifications = new NotificationService({
      logger,
      config,
      notifications: new NotificationRepository(database.prisma),
    });
    const provider = createXPublishingProvider(flags.provider ?? config.xApiProvider, {
      enabled: config.xApiEnabled,
      accessToken: config.xApiAccessToken,
      accountId: config.xApiAccountId,
      baseUrl: config.xApiBaseUrl,
      timeoutMs: config.xApiTimeoutMs,
      username: "mockuser",
    });
    const svc = new XPublicationService({
      logger,
      config,
      contents,
      publications,
      provider,
      notifications: {
        emitXEvent: (eventType, payload) =>
          notifications.emitXEvent(eventType, payload).then(() => undefined),
      },
      loadItemTags: async (researchItemId) => {
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
      },
      loadCandidateType: async (id) => {
        const row = await database.prisma.contentCandidate.findUnique({ where: { id } });
        return row?.candidateType;
      },
    });
    await run(svc, publications);
  } finally {
    await database.disconnect();
  }
}

export async function runXPublicationCreate(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  if (!flags.contentId) {
    console.error(
      "Usage: x:publication:create -- --content-id=<ID> [--strategy=auto|single-post|...] [--scheduled-at=ISO]",
    );
    process.exitCode = 1;
    return;
  }
  try {
    await withService(flags, async (svc) => {
      const strategy = parseStrategyTypeFlag(flags.strategy ?? "auto");
      const pub = await svc.createFromContent({
        contentId: flags.contentId!,
        strategy: strategy ?? "AUTO",
        scheduledAt: flags.scheduledAt ? new Date(flags.scheduledAt) : null,
      });
      console.log(`publicationId: ${pub.id}`);
      console.log(`status: ${pub.status}`);
      console.log(`strategyType: ${pub.strategyType}`);
      console.log(`posts: ${pub.posts.length}`);
      for (const post of pub.posts) {
        console.log(
          `  seq=${post.sequence} role=${post.role} weighted=${post.weightedLength} status=${post.status}`,
        );
      }
    });
  } catch (error) {
    if (
      error instanceof XPublicationValidationError ||
      error instanceof XPublicationStateError ||
      error instanceof Error
    ) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

export async function runXPublicationList(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const pubs = new XPublicationRepository(database.prisma);
    const status = flags.status?.toUpperCase().replace(/-/g, "_") as
      | "DRAFT"
      | "SCHEDULED"
      | "PUBLISHED"
      | "FAILED"
      | "PARTIALLY_PUBLISHED"
      | undefined;
    const list = await pubs.list({ status, limit: flags.limit ?? 20 });
    for (const row of list) {
      console.log(
        `${row.id}\t${row.strategyType}\t${row.status}\tposts=${row.posts.length}\t${row.scheduledAt?.toISOString() ?? "-"}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

export async function runXPublicationShow(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  if (!flags.publicationId) {
    console.error("Usage: x:publication:show -- --publication-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const pubs = new XPublicationRepository(database.prisma);
    const row = await pubs.findById(flags.publicationId);
    if (!row) {
      console.error("publication not found");
      process.exitCode = 1;
      return;
    }
    console.log(`publicationId: ${row.id}`);
    console.log(`status: ${row.status}`);
    console.log(`strategyType: ${row.strategyType}`);
    console.log(`rootPostId: ${row.rootPostId ?? "null"}`);
    console.log(`rootPostUrl: ${row.rootPostUrl ?? "null"}`);
    console.log(`idempotencyKey: ${row.idempotencyKey}`);
    for (const post of row.posts) {
      console.log(`--- post seq=${post.sequence} ---`);
      console.log(`role: ${post.role}`);
      console.log(`status: ${post.status}`);
      console.log(`weightedLength: ${post.weightedLength}`);
      console.log(`xPostId: ${post.xPostId ?? "null"}`);
      console.log(`body:\n${post.body}`);
    }
  } finally {
    await database.disconnect();
  }
}

export async function runXPublicationSchedule(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  if (!flags.publicationId || !flags.scheduledAt) {
    console.error(
      "Usage: x:publication:schedule -- --publication-id=<ID> --scheduled-at=ISO",
    );
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const pubs = new XPublicationRepository(database.prisma);
    const row = await pubs.schedule(flags.publicationId, new Date(flags.scheduledAt));
    console.log(`scheduled publicationId=${row.id} at=${row.scheduledAt?.toISOString()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await database.disconnect();
  }
}

export async function runXPublicationPublish(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  if (!flags.publicationId) {
    console.error("Usage: x:publication:publish -- --publication-id=<ID> [--provider=mock]");
    process.exitCode = 1;
    return;
  }
  await withService(flags, async (svc, pubs) => {
    // Ensure scheduled for immediate if draft
    const current = await pubs.findById(flags.publicationId!);
    if (current?.status === "DRAFT") {
      await pubs.schedule(flags.publicationId!, new Date());
    }
    const row = await svc.publishOne(flags.publicationId!);
    console.log(`publicationId: ${row.id}`);
    console.log(`status: ${row.status}`);
    console.log(`rootPostId: ${row.rootPostId ?? "null"}`);
    for (const post of row.posts) {
      console.log(`seq=${post.sequence}\t${post.status}\t${post.xPostId ?? "-"}`);
    }
  });
}

export async function runXPublicationCancel(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  if (!flags.publicationId) {
    console.error("Usage: x:publication:cancel -- --publication-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const pubs = new XPublicationRepository(database.prisma);
    const row = await pubs.cancel(flags.publicationId);
    console.log(`cancelled publicationId=${row.id} status=${row.status}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await database.disconnect();
  }
}

export async function runXPublicationRetry(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  if (!flags.publicationId) {
    console.error("Usage: x:publication:retry -- --publication-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withService(flags, async (svc) => {
    const row = await svc.retry(flags.publicationId!);
    console.log(`retried publicationId=${row.id} status=${row.status}`);
  });
}

export async function runXPublisherRun(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  await withService(flags, async (svc) => {
    const results = await svc.runDue(flags.limit ?? 20);
    console.log(`processed: ${results.length}`);
    for (const row of results) {
      console.log(`${row.id}\t${row.status}`);
    }
  });
}

export async function runXMetricsCollect(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const publications = new XPublicationRepository(database.prisma);
    const provider = createXPublishingProvider(flags.provider ?? config.xApiProvider, {
      enabled: config.xApiEnabled,
      accessToken: config.xApiAccessToken,
      accountId: config.xApiAccountId,
      baseUrl: config.xApiBaseUrl,
      timeoutMs: config.xApiTimeoutMs,
    });
    const collector = new XMetricsCollector({
      logger,
      config,
      publications,
      provider,
    });
    const result = await collector.collect({ limit: flags.limit });
    console.log(`examined: ${result.examined}`);
    console.log(`collected: ${result.collected}`);
    console.log(`skipped: ${result.skipped}`);
    console.log(`failed: ${result.failed}`);
  } finally {
    await database.disconnect();
  }
}

export async function runXMetricsList(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const pubs = new XPublicationRepository(database.prisma);
    const list = await pubs.listMetricSnapshots({
      publicationId: flags.publicationId,
      limit: flags.limit ?? 20,
    });
    for (const row of list) {
      console.log(
        `${row.id}\tpub=${row.publicationId}\txPost=${row.xPostId}\tw=${row.collectionWindowMinutes ?? "-"}\timp=${row.impressionCount ?? "null"}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

export async function runXStrategyEvaluate(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const publications = new XPublicationRepository(database.prisma);
    const evaluator = new XStrategyEvaluator({ logger, config, publications });
    const report = await evaluator.evaluate({
      windowHours: flags.windowHours,
      minimumSamples: flags.minimumSamples,
    });
    console.log(`recommendedStrategy: ${report.recommendedStrategy ?? "null"}`);
    console.log(`confidenceLevel: ${report.confidenceLevel}`);
    console.log(`dataLimitations: ${report.dataLimitations.join("; ") || "-"}`);
    for (const row of report.rows) {
      console.log(
        `${row.strategyType}\tsamples=${row.sampleCount}\teligible=${row.eligibleSampleCount}\tscore=${row.score ?? "null"}\t${row.confidenceLevel}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

export async function runXStrategyReport(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const pubs = new XPublicationRepository(database.prisma);
    const list = await pubs.listLatestStrategyPerformances(flags.limit ?? 20);
    for (const row of list) {
      console.log(
        `${row.calculatedAt.toISOString()}\t${row.strategyType}\tscore=${row.score ?? "null"}\t${row.confidenceLevel}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

export async function runXExperimentCreate(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  if (!flags.name) {
    console.error(
      "Usage: x:experiment:create -- --name=<NAME> [--variants=single-post,control] [--allocation=round-robin]",
    );
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const pubs = new XPublicationRepository(database.prisma);
    const variants = (flags.variants ?? "single-post,control,root-with-reply")
      .split(",")
      .map((v) => v.trim().toUpperCase().replace(/-/g, "_"));
    const allocation = (flags.allocation ?? "round-robin")
      .trim()
      .toUpperCase()
      .replace(/-/g, "_") as "ROUND_ROBIN" | "RANDOM" | "WEIGHTED" | "MANUAL";
    const row = await pubs.createExperiment({
      name: flags.name,
      strategyVariants: variants,
      allocationMethod: allocation,
      minimumSampleSize: flags.minimumSamples,
      evaluationWindowHours: flags.windowHours,
    });
    console.log(`experimentId: ${row.id}`);
    console.log(`status: ${row.status}`);
  } finally {
    await database.disconnect();
  }
}

export async function runXExperimentList(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const pubs = new XPublicationRepository(database.prisma);
    const list = await pubs.listExperiments(flags.limit ?? 20);
    for (const row of list) {
      console.log(`${row.id}\t${row.name}\t${row.status}\t${row.allocationMethod}`);
    }
  } finally {
    await database.disconnect();
  }
}

export async function runXExperimentShow(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  if (!flags.experimentId) {
    console.error("Usage: x:experiment:show -- --experiment-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const pubs = new XPublicationRepository(database.prisma);
    const row = await pubs.findExperimentById(flags.experimentId);
    if (!row) {
      console.error("experiment not found");
      process.exitCode = 1;
      return;
    }
    console.log(`experimentId: ${row.id}`);
    console.log(`name: ${row.name}`);
    console.log(`status: ${row.status}`);
    console.log(`allocationMethod: ${row.allocationMethod}`);
    console.log(`strategyVariants: ${JSON.stringify(row.strategyVariants)}`);
  } finally {
    await database.disconnect();
  }
}

export async function runXExperimentStart(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  if (!flags.experimentId) {
    console.error("Usage: x:experiment:start -- --experiment-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const pubs = new XPublicationRepository(database.prisma);
    const row = await pubs.updateExperimentStatus(flags.experimentId, "RUNNING", {
      startedAt: new Date(),
    });
    console.log(`started experimentId=${row.id} status=${row.status}`);
  } finally {
    await database.disconnect();
  }
}

export async function runXExperimentPause(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  if (!flags.experimentId) {
    console.error("Usage: x:experiment:pause -- --experiment-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const pubs = new XPublicationRepository(database.prisma);
    const row = await pubs.updateExperimentStatus(flags.experimentId, "PAUSED");
    console.log(`paused experimentId=${row.id} status=${row.status}`);
  } finally {
    await database.disconnect();
  }
}

export async function runXExperimentComplete(argv: string[]): Promise<void> {
  const flags = parseXFlags(argv);
  if (!flags.experimentId) {
    console.error("Usage: x:experiment:complete -- --experiment-id=<ID>");
    process.exitCode = 1;
    return;
  }
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const pubs = new XPublicationRepository(database.prisma);
    const row = await pubs.updateExperimentStatus(flags.experimentId, "COMPLETED", {
      endedAt: new Date(),
    });
    console.log(`completed experimentId=${row.id} status=${row.status}`);
  } finally {
    await database.disconnect();
  }
}

// silence unused import warning for type-only usage in comments
void (null as unknown as XPublicationStrategyType);
