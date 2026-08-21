import { loadConfig } from "@ai-affiliate/config";
import {
  ContentRepository,
  NotificationRepository,
  XOptimizationRepository,
  XPublicationRepository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import type { XOptimizationRecommendationStatus } from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { ContentEngine, MockContentGenerationProvider } from "../content/index.js";
import { NotificationService } from "../notifications/index.js";
import {
  XContentFeatureExtractor,
  XContentOptimizer,
  XOptimizationEngine,
  XOptimizationImpactEvaluator,
  XOptimizationRecommendationService,
} from "./optimization/index.js";

export interface OptimizationCliFlags {
  recommendationId?: string;
  contentId?: string;
  publicationId?: string;
  variantId?: string;
  runId?: string;
  provider?: string;
  status?: string;
  dimension?: string;
  reviewer?: string;
  comment?: string;
  priority?: string;
  windowHours?: number;
  lookbackDays?: number;
  limit?: number;
  mode?: string;
}

export function parseOptimizationFlags(argv: string[]): OptimizationCliFlags {
  const flags: OptimizationCliFlags = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq);
    const value = body.slice(eq + 1);
    switch (key) {
      case "recommendation-id":
        flags.recommendationId = value;
        break;
      case "content-id":
        flags.contentId = value;
        break;
      case "publication-id":
        flags.publicationId = value;
        break;
      case "variant-id":
        flags.variantId = value;
        break;
      case "run-id":
        flags.runId = value;
        break;
      case "provider":
        flags.provider = value;
        break;
      case "status":
        flags.status = value;
        break;
      case "dimension":
        flags.dimension = value;
        break;
      case "reviewer":
        flags.reviewer = value;
        break;
      case "comment":
        flags.comment = value;
        break;
      case "priority":
        flags.priority = value;
        break;
      case "window-hours":
        flags.windowHours = Number.parseInt(value, 10);
        break;
      case "lookback-days":
        flags.lookbackDays = Number.parseInt(value, 10);
        break;
      case "limit":
        flags.limit = Number.parseInt(value, 10);
        break;
      case "mode":
        flags.mode = value;
        break;
      default:
        break;
    }
  }
  return flags;
}

function parseStatusFlag(value?: string): XOptimizationRecommendationStatus | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase().replace(/-/g, "_");
  const allowed: XOptimizationRecommendationStatus[] = [
    "PROPOSED",
    "REVIEW_REQUIRED",
    "APPROVED",
    "REJECTED",
    "EXPIRED",
    "APPLIED",
    "CANCELLED",
  ];
  return allowed.includes(normalized as XOptimizationRecommendationStatus)
    ? (normalized as XOptimizationRecommendationStatus)
    : undefined;
}

function printRecommendation(row: {
  id: string;
  dimension: string;
  currentValue: string;
  recommendedValue: string;
  confidenceLevel: string;
  status: string;
  reviewer: string | null;
  rationale: string;
  expectedImpact: unknown;
}): void {
  console.log(`id: ${row.id}`);
  console.log(`dimension: ${row.dimension}`);
  console.log(`currentVariant: ${row.currentValue}`);
  console.log(`recommendedVariant: ${row.recommendedValue}`);
  console.log(`confidence: ${row.confidenceLevel}`);
  console.log(`status: ${row.status}`);
  console.log(`reviewer: ${row.reviewer ?? "-"}`);
  console.log(`rationale: ${row.rationale}`);
  if (row.expectedImpact && typeof row.expectedImpact === "object") {
    const impact = row.expectedImpact as { scoreDifference?: number };
    if (impact.scoreDifference != null) {
      console.log(`scoreDifference: ${impact.scoreDifference}`);
    }
  }
  console.log("---");
}

export async function runXOptimizationRun(argv: string[]): Promise<void> {
  const flags = parseOptimizationFlags(argv);
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const publications = new XPublicationRepository(database.prisma);
    const optimization = new XOptimizationRepository(database.prisma);
    const contents = new ContentRepository(database.prisma);
    const notifications = new NotificationService({
      logger,
      config,
      notifications: new NotificationRepository(database.prisma),
    });
    const engine = new XOptimizationEngine({
      logger,
      config,
      publications,
      optimization,
      loadPublicationContext: async (publication) => {
        const content = await contents.findGeneratedContentById(publication.generatedContentId);
        const candidate = await database.prisma.contentCandidate.findUnique({
          where: { id: publication.contentCandidateId },
        });
        return {
          title: content?.title,
          candidateType: candidate?.candidateType,
          inputSnapshot:
            content?.inputSnapshot && typeof content.inputSnapshot === "object"
              ? (content.inputSnapshot as Record<string, unknown>)
              : null,
        };
      },
      notifications: {
        emitXEvent: (eventType, payload) =>
          notifications.emitXEvent(eventType, payload).then(() => undefined),
      },
    });
    const mode =
      flags.mode?.toUpperCase() === "OBSERVE_ONLY" ||
      flags.mode?.toUpperCase() === "RECOMMEND" ||
      flags.mode?.toUpperCase() === "ASSISTED" ||
      flags.mode?.toUpperCase() === "AUTO"
        ? (flags.mode.toUpperCase() as typeof config.xOptimizationMode)
        : config.xOptimizationMode;
    const result = await engine.run({
      windowHours: flags.windowHours,
      lookbackDays: flags.lookbackDays,
      mode,
    });
    console.log(`runId: ${result.runId}`);
    console.log(`status: ${result.status}`);
    console.log(`analyzed: ${result.analyzedPublicationCount}`);
    console.log(`findings: ${result.findingCount}`);
    console.log(`recommendations: ${result.generatedRecommendationCount}`);
    console.log(`errors: ${result.errorCount}`);
  } finally {
    await database.disconnect();
  }
}

export async function runXOptimizationList(): Promise<void> {
  const database = createDatabaseClient();
  await database.connect();
  try {
    const optimization = new XOptimizationRepository(database.prisma);
    const runs = await optimization.listRuns(20);
    for (const run of runs) {
      console.log(
        `${run.id} status=${run.status} analyzed=${run.analyzedPublicationCount} recs=${run.generatedRecommendationCount}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

export async function runXOptimizationShow(argv: string[]): Promise<void> {
  const flags = parseOptimizationFlags(argv);
  if (!flags.runId) {
    console.error("Usage: x:optimization:show -- --run-id=<ID>");
    process.exitCode = 1;
    return;
  }
  const database = createDatabaseClient();
  await database.connect();
  try {
    const optimization = new XOptimizationRepository(database.prisma);
    const run = await optimization.findRunById(flags.runId);
    if (!run) {
      console.error("run not found");
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({
      id: run.id,
      status: run.status,
      evaluationWindowHours: run.evaluationWindowHours,
      analyzedPublicationCount: run.analyzedPublicationCount,
      generatedRecommendationCount: run.generatedRecommendationCount,
      errorCount: run.errorCount,
      parameters: run.parameters,
    }, null, 2));
  } finally {
    await database.disconnect();
  }
}

export async function runXOptimizationFindings(argv: string[]): Promise<void> {
  const flags = parseOptimizationFlags(argv);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const optimization = new XOptimizationRepository(database.prisma);
    const findings = await optimization.listFindings({
      optimizationRunId: flags.runId,
      limit: flags.limit ?? 50,
    });
    for (const f of findings) {
      console.log(
        `${f.id} dim=${f.dimension} ${f.currentVariant}->${f.comparedVariant} n=${f.currentSampleCount}/${f.comparedSampleCount} Δ=${f.scoreDifference} conf=${f.confidenceLevel} type=${f.findingType}`,
      );
      if (f.supportingMetrics) {
        console.log(`  supportingMetrics: ${JSON.stringify(f.supportingMetrics)}`);
      }
      if (f.dataLimitations) {
        console.log(`  limitations: ${JSON.stringify(f.dataLimitations)}`);
      }
    }
  } finally {
    await database.disconnect();
  }
}

export async function runXOptimizationRecommendations(argv: string[]): Promise<void> {
  const flags = parseOptimizationFlags(argv);
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const service = new XOptimizationRecommendationService({
      logger,
      config,
      optimization: new XOptimizationRepository(database.prisma),
    });
    const rows = await service.list({
      status: parseStatusFlag(flags.status),
      dimension: flags.dimension,
      limit: flags.limit,
    });
    for (const row of rows) {
      printRecommendation(row);
    }
  } finally {
    await database.disconnect();
  }
}

export async function runXOptimizationApprove(argv: string[]): Promise<void> {
  const flags = parseOptimizationFlags(argv);
  if (!flags.recommendationId) {
    console.error("Usage: x:optimization:approve -- --recommendation-id=<ID> [--reviewer=admin]");
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
    const service = new XOptimizationRecommendationService({
      logger,
      config,
      optimization: new XOptimizationRepository(database.prisma),
      notifications: {
        emitXEvent: (eventType, payload) =>
          notifications.emitXEvent(eventType, payload).then(() => undefined),
      },
    });
    const row = await service.approve(flags.recommendationId, flags.reviewer, flags.comment);
    printRecommendation(row);
  } finally {
    await database.disconnect();
  }
}

export async function runXOptimizationReject(argv: string[]): Promise<void> {
  const flags = parseOptimizationFlags(argv);
  if (!flags.recommendationId) {
    console.error("Usage: x:optimization:reject -- --recommendation-id=<ID> [--reviewer=admin]");
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
    const service = new XOptimizationRecommendationService({
      logger,
      config,
      optimization: new XOptimizationRepository(database.prisma),
      notifications: {
        emitXEvent: (eventType, payload) =>
          notifications.emitXEvent(eventType, payload).then(() => undefined),
      },
    });
    const row = await service.reject(flags.recommendationId, flags.reviewer, flags.comment);
    printRecommendation(row);
  } finally {
    await database.disconnect();
  }
}

export async function runXOptimizationExpire(argv: string[]): Promise<void> {
  const flags = parseOptimizationFlags(argv);
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const service = new XOptimizationRecommendationService({
      logger,
      config,
      optimization: new XOptimizationRepository(database.prisma),
    });
    if (flags.recommendationId) {
      const row = await service.expire(flags.recommendationId);
      printRecommendation(row);
    } else {
      const count = await service.expireDue();
      console.log(`expired: ${count}`);
    }
  } finally {
    await database.disconnect();
  }
}

export async function runXOptimizationApply(argv: string[]): Promise<void> {
  const flags = parseOptimizationFlags(argv);
  if (!flags.recommendationId || !flags.contentId) {
    console.error(
      "Usage: x:optimization:apply -- --recommendation-id=<ID> --content-id=<ID> [--provider=mock]",
    );
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const contents = new ContentRepository(database.prisma);
    const publications = new XPublicationRepository(database.prisma);
    const optimization = new XOptimizationRepository(database.prisma);
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
    const optimizer = new XContentOptimizer({
      logger,
      config,
      contents,
      publications,
      optimization,
      contentEngine,
      notifications: {
        emitXEvent: (eventType, payload) =>
          notifications.emitXEvent(eventType, payload).then(() => undefined),
      },
    });
    const result = await optimizer.apply({
      recommendationId: flags.recommendationId,
      contentId: flags.contentId,
    });
    console.log(`applicationId: ${result.applicationId}`);
    console.log(`generatedContentId: ${result.generatedContentId}`);
    console.log(`experimentId: ${result.experimentId}`);
    console.log(`dimension: ${result.dimension}`);
    console.log(`status: ${result.status}`);
    console.log(`parentContentId: ${result.parentContentId}`);
    console.log(`version: ${result.version}`);
    console.log(`diff: ${JSON.stringify(result.diff)}`);
    if (result.validationFailed) {
      console.log(`validationFailed: true`);
      console.log(`issues: ${JSON.stringify(result.issues)}`);
    }
  } finally {
    await database.disconnect();
  }
}

export async function runXOptimizationImpact(argv: string[]): Promise<void> {
  const flags = parseOptimizationFlags(argv);
  if (!flags.recommendationId) {
    console.error("Usage: x:optimization:impact -- --recommendation-id=<ID>");
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const evaluator = new XOptimizationImpactEvaluator({
      logger,
      config,
      publications: new XPublicationRepository(database.prisma),
      optimization: new XOptimizationRepository(database.prisma),
    });
    const result = await evaluator.evaluate(flags.recommendationId);
    console.log(`label: ${result.label}`);
    console.log(`controlSampleCount: ${result.controlSampleCount}`);
    console.log(`variantSampleCount: ${result.variantSampleCount}`);
    console.log(`scoreDifference: ${result.scoreDifference}`);
    console.log(`confidence: ${result.confidence}`);
    console.log(`permanentAdoptionCandidate: ${result.permanentAdoptionCandidate}`);
    console.log(`limitations: ${result.dataLimitations.join(", ") || "-"}`);
    console.log(`metricDeltas: ${JSON.stringify(result.metricDeltas)}`);
  } finally {
    await database.disconnect();
  }
}

export async function runXVariantExtract(argv: string[]): Promise<void> {
  const flags = parseOptimizationFlags(argv);
  if (!flags.publicationId) {
    console.error("Usage: x:variant:extract -- --publication-id=<ID>");
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  try {
    const publications = new XPublicationRepository(database.prisma);
    const optimization = new XOptimizationRepository(database.prisma);
    const contents = new ContentRepository(database.prisma);
    const pub = await publications.findById(flags.publicationId);
    if (!pub) {
      console.error("publication not found");
      process.exitCode = 1;
      return;
    }
    const content = await contents.findGeneratedContentById(pub.generatedContentId);
    const extractor = new XContentFeatureExtractor(config);
    const features = extractor.extract({
      publication: pub,
      title: content?.title,
      inputSnapshot:
        content?.inputSnapshot && typeof content.inputSnapshot === "object"
          ? (content.inputSnapshot as Record<string, unknown>)
          : null,
    });
    const variant = await optimization.upsertContentVariant({
      publicationId: pub.id,
      generatedContentId: pub.generatedContentId,
      contentAngle: features.contentAngle,
      postFormat: features.strategyType,
      postingTimeBucket: features.postingTimeBucket,
      weekday: features.weekday,
      hashtagSet: features.hashtagSet,
      urlPlacement: features.urlPlacement,
      disclosurePlacement: features.disclosurePlacement,
      ctaStyle: features.ctaStyle,
      informationDensity: features.informationDensity,
      titleWeightedLength: features.titleWeightedLength,
      bodyWeightedLength: features.totalWeightedLength,
      featureSnapshot: extractor.featureSnapshot(features),
    });
    console.log(`variantId: ${variant.id}`);
    console.log(JSON.stringify(extractor.featureSnapshot(features), null, 2));
  } finally {
    await database.disconnect();
  }
}

export async function runXVariantList(argv: string[]): Promise<void> {
  const flags = parseOptimizationFlags(argv);
  const database = createDatabaseClient();
  await database.connect();
  try {
    const optimization = new XOptimizationRepository(database.prisma);
    const rows = await optimization.listVariants({
      publicationId: flags.publicationId,
      generatedContentId: flags.contentId,
      limit: flags.limit ?? 50,
    });
    for (const row of rows) {
      console.log(
        `${row.id} pub=${row.publicationId ?? "-"} angle=${row.contentAngle} format=${row.postFormat} time=${row.postingTimeBucket} tags=${row.hashtagSet}`,
      );
    }
  } finally {
    await database.disconnect();
  }
}

export async function runXVariantShow(argv: string[]): Promise<void> {
  const flags = parseOptimizationFlags(argv);
  if (!flags.variantId) {
    console.error("Usage: x:variant:show -- --variant-id=<ID>");
    process.exitCode = 1;
    return;
  }
  const database = createDatabaseClient();
  await database.connect();
  try {
    const optimization = new XOptimizationRepository(database.prisma);
    const row = await optimization.findVariantById(flags.variantId);
    if (!row) {
      console.error("variant not found");
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({
      id: row.id,
      publicationId: row.publicationId,
      generatedContentId: row.generatedContentId,
      contentAngle: row.contentAngle,
      postFormat: row.postFormat,
      postingTimeBucket: row.postingTimeBucket,
      hashtagSet: row.hashtagSet,
      featureSnapshot: row.featureSnapshot,
    }, null, 2));
  } finally {
    await database.disconnect();
  }
}
