import type { DatabaseClient } from "@ai-affiliate/database";

type Prisma = DatabaseClient["prisma"];
export type FactoryRange = "today" | "7d" | "30d";

export function parseFactoryRange(raw: string | undefined): FactoryRange {
  if (raw === "7d" || raw === "30d") return raw;
  return "today";
}

function rangeStart(now: Date, range: FactoryRange): Date {
  if (range === "today") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days = range === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function limits(env: NodeJS.ProcessEnv) {
  return {
    globalDailyUsd: positive(env.GLOBAL_DAILY_LLM_BUDGET_USD, 15),
    gpt41DailyUsd: positive(env.GPT41_DAILY_BUDGET_USD, 2),
    xWriterDailyUsd: positive(env.X_WRITER_DAILY_BUDGET_USD, 2),
    logicalCallLimit: positive(env.LLM_LOGICAL_CALL_LIMIT, 5),
    httpRetryLimit: positive(env.LLM_HTTP_RETRY_LIMIT, 2),
    absoluteTickCap: positive(env.LLM_ABSOLUTE_TICK_CAP, 12),
    wpArticleTickCap: positive(env.WP_ARTICLE_TICK_CAP, 5),
    source: "code-defaults-not-production-env-write",
  };
}

function money(runs: RunRow[], modelPrefix: string | null, excludeMini = false): number | null {
  let total = 0;
  let any = false;
  let unknown = false;
  for (const run of runs) {
    if (run.executionStatus !== "SUCCEEDED") continue;
    const model = run.modelRequested ?? run.model;
    if (modelPrefix && !model.startsWith(modelPrefix)) continue;
    if (excludeMini && model.startsWith("gpt-4.1-mini")) continue;
    if (run.estimatedCostUsd == null) {
      unknown = true;
      continue;
    }
    any = true;
    total += run.estimatedCostUsd;
  }
  if (unknown) return null;
  return any ? total : null;
}

type RunRow = {
  id: string;
  createdAt: Date;
  requestedAt: Date | null;
  finishedAt: Date | null;
  executionStatus: string | null;
  channel: string | null;
  operation: string | null;
  taskType: string;
  trigger: string | null;
  canonicalCid: string | null;
  contentVersionId: string | null;
  xPublicationId: string | null;
  artifactFingerprint: string | null;
  model: string;
  modelRequested: string | null;
  modelActual: string | null;
  promptIdentifier: string | null;
  promptVersion: string | null;
  logicalAttempt: number | null;
  httpAttempt: number | null;
  attemptKind: string | null;
  disposition: string | null;
  inputTokens: number | null;
  cachedTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  usageKnown: boolean | null;
  estimatedCostUsd: number | null;
  reservedCostUsd: number | null;
  errorCode: string | null;
  errorType: string | null;
  httpStatus: number | null;
  retryable: boolean | null;
  failureStage: string | null;
  blockReason: string | null;
  ledgerVersion: string | null;
};

const runSelect = {
  id: true,
  createdAt: true,
  requestedAt: true,
  finishedAt: true,
  executionStatus: true,
  channel: true,
  operation: true,
  taskType: true,
  trigger: true,
  canonicalCid: true,
  contentVersionId: true,
  xPublicationId: true,
  artifactFingerprint: true,
  model: true,
  modelRequested: true,
  modelActual: true,
  promptIdentifier: true,
  promptVersion: true,
  logicalAttempt: true,
  httpAttempt: true,
  attemptKind: true,
  disposition: true,
  inputTokens: true,
  cachedTokens: true,
  outputTokens: true,
  reasoningTokens: true,
  usageKnown: true,
  estimatedCostUsd: true,
  reservedCostUsd: true,
  errorCode: true,
  errorType: true,
  httpStatus: true,
  retryable: true,
  failureStage: true,
  blockReason: true,
  ledgerVersion: true,
} as const;

function presentRun(run: RunRow) {
  return {
    ...run,
    createdAt: run.createdAt.toISOString(),
    requestedAt: run.requestedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

async function gateRuns(prisma: Prisma, start: Date): Promise<RunRow[]> {
  return prisma.modelRun.findMany({
    where: { ledgerVersion: "execution-gate-v1", createdAt: { gte: start } },
    select: runSelect,
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
}

const ANOMALY_THRESHOLDS = {
  budgetWarningRatio: 0.8,
  discardRateWarning: 0.5,
  discardSampleMin: 4,
  retryRateWarning: 0.4,
  retrySampleMin: 4,
  unknownUsageWarning: 3,
  duplicateBlockWarning: 5,
} as const;

function costPer(cost: number | null, adopted: number): number | null {
  if (cost == null || adopted <= 0) return null;
  return cost / adopted;
}

function classifyAnomaly(input: {
  circuitsOpen: number;
  stale: number;
  quotaFailures: number;
  duplicateBlocks: number;
  budgetUsedRatio: number | null;
  discarded: number;
  adopted: number;
  retriedCalls: number;
  calls: number;
  unknownUsage: number;
}): { status: "NORMAL" | "WARNING" | "CRITICAL"; reasons: string[] } {
  const critical: string[] = [];
  const warning: string[] = [];
  if (input.circuitsOpen > 0) critical.push("circuit OPEN");
  if (input.stale > 0) critical.push("stale request");
  if (input.quotaFailures > 0) critical.push("quota exhaustion");
  if (input.budgetUsedRatio != null && input.budgetUsedRatio >= 1) critical.push("budget exhausted");
  if (input.duplicateBlocks >= ANOMALY_THRESHOLDS.duplicateBlockWarning) critical.push("duplicate execution attempts");
  const decided = input.adopted + input.discarded;
  if (decided >= ANOMALY_THRESHOLDS.discardSampleMin && input.discarded / decided >= ANOMALY_THRESHOLDS.discardRateWarning) {
    warning.push("discard rate");
  }
  if (input.calls >= ANOMALY_THRESHOLDS.retrySampleMin && input.retriedCalls / input.calls >= ANOMALY_THRESHOLDS.retryRateWarning) {
    warning.push("retry rate");
  }
  if (input.unknownUsage >= ANOMALY_THRESHOLDS.unknownUsageWarning) warning.push("usage unknown");
  if (input.budgetUsedRatio != null && input.budgetUsedRatio >= ANOMALY_THRESHOLDS.budgetWarningRatio && input.budgetUsedRatio < 1) {
    warning.push("budget >= 80%");
  }
  if (critical.length > 0) return { status: "CRITICAL", reasons: critical };
  if (warning.length > 0) return { status: "WARNING", reasons: warning };
  return { status: "NORMAL", reasons: [] };
}

function metric(value: number | null, collected: boolean) {
  if (!collected) return { status: "NOT_COLLECTED" as const, value: null };
  if (value == null) return { status: "NOT_AVAILABLE" as const, value: null };
  return { status: "AVAILABLE" as const, value };
}

export async function readFactoryOverview(prisma: Prisma, range: FactoryRange, now = new Date()) {
  const start = rangeStart(now, range);
  const [runs, circuits, wpGenerated, wpPublished, xGenerated, xPublished, xScheduled, xBlocked] =
    await Promise.all([
      gateRuns(prisma, start),
      prisma.llmCircuitState.findMany(),
      prisma.generatedContent.count({ where: { targetChannel: "BLOG", generatedAt: { gte: start } } }),
      prisma.publicationTarget.count({
        where: { platform: "WORDPRESS", status: "PUBLISHED", publishedAt: { gte: start } },
      }),
      prisma.generatedContent.count({ where: { targetChannel: "X", generatedAt: { gte: start } } }),
      prisma.xPublication.count({ where: { status: "PUBLISHED", publishedAt: { gte: start } } }),
      prisma.xPublication.count({ where: { status: "SCHEDULED", createdAt: { gte: start } } }),
      prisma.xPublication.count({ where: { status: "BLOCKED", createdAt: { gte: start } } }),
    ]);
  const critical = [
    ...circuits.filter((row) => row.state === "OPEN").map((row) => `${row.scopeType}:${row.scopeKey}:${row.reason ?? "OPEN"}`),
    ...runs.filter((run) => run.executionStatus === "STALE_REQUEST").slice(0, 10).map((run) => `STALE:${run.id}`),
  ];
  const wpRuns = runs.filter((run) => run.channel === "WORDPRESS" || run.channel === "WP");
  const xRuns = runs.filter((run) => run.channel === "X");
  const adopted = runs.filter((run) => run.disposition === "ADOPTED").length;
  const discarded = runs.filter((run) => run.disposition?.startsWith("DISCARDED")).length;
  const wpAdopted = wpRuns.filter((run) => run.operation === "WP_WRITER" || run.operation === "WP_REWRITE").filter((run) => run.disposition === "ADOPTED").length;
  const wpDiscarded = wpRuns.filter((run) => run.operation === "WP_WRITER" || run.operation === "WP_REWRITE").filter((run) => run.disposition?.startsWith("DISCARDED")).length;
  const xAdopted = xRuns.filter((run) => run.disposition === "ADOPTED").length;
  const xDiscarded = xRuns.filter((run) => run.disposition?.startsWith("DISCARDED")).length;
  const estimatedCostUsd = money(runs, null);
  const knownSpent = runs.reduce((sum, run) => sum + (run.executionStatus === "SUCCEEDED" && run.estimatedCostUsd != null ? run.estimatedCostUsd : 0), 0);
  const reserved = runs.reduce((sum, run) => sum + (run.executionStatus === "REQUESTED" ? run.reservedCostUsd ?? 0 : 0), 0);
  const anomaly = classifyAnomaly({
    circuitsOpen: circuits.filter((row) => row.state === "OPEN").length,
    stale: runs.filter((run) => run.executionStatus === "STALE_REQUEST").length,
    quotaFailures: runs.filter((run) => run.errorCode === "INSUFFICIENT_QUOTA").length,
    duplicateBlocks: runs.filter((run) => run.blockReason === "BLOCKED_DUPLICATE").length,
    budgetUsedRatio:
      runs.some((run) => run.executionStatus === "SUCCEEDED" && run.estimatedCostUsd == null)
        ? null
        : (knownSpent + reserved) / limits(process.env).globalDailyUsd,
    discarded,
    adopted,
    retriedCalls: runs.filter((run) => (run.httpAttempt ?? 1) > 1).length,
    calls: runs.length,
    unknownUsage: runs.filter((run) => run.executionStatus === "SUCCEEDED" && run.estimatedCostUsd == null).length,
  });
  const wpCost = money(wpRuns, null);
  const xCost = money(xRuns, null);
  return {
    range,
    estimatedCostUsd,
    calls: runs.length,
    gpt41CostUsd: money(runs, "gpt-4.1", true),
    gpt41MiniCostUsd: money(runs, "gpt-4.1-mini"),
    adopted,
    discarded,
    failed: runs.filter((run) => run.executionStatus === "FAILED").length,
    blocked: runs.filter((run) => run.executionStatus === "BLOCKED").length,
    stale: runs.filter((run) => run.executionStatus === "STALE_REQUEST").length,
    success: runs.filter((run) => run.executionStatus === "SUCCEEDED").length,
    wpGenerated,
    wpAdopted,
    wpDiscarded,
    wpPublished,
    xGenerated,
    xAdopted,
    xDiscarded,
    xPublished,
    xScheduled,
    xBlocked,
    wpEstimatedCostUsd: wpCost,
    xEstimatedCostUsd: xCost,
    costPerAdopted: costPer(estimatedCostUsd, adopted),
    costPerWpAdopted: costPer(wpCost, wpAdopted),
    costPerXAdopted: costPer(xCost, xAdopted),
    anomaly,
    circuits: circuits.map((row) => ({
      scopeType: row.scopeType,
      scopeKey: row.scopeKey,
      state: row.state,
      reason: row.reason,
      consecutiveFailures: row.consecutiveFailures,
    })),
    critical,
    railwayBilling: "EXTERNAL_BILLING_NOT_CONNECTED" as const,
    learningConnectedToBrain: false as const,
  };
}

export async function readFactoryUsage(prisma: Prisma, range: FactoryRange, now = new Date()) {
  const runs = await gateRuns(prisma, rangeStart(now, range));
  const sum = (pick: (run: RunRow) => number | null) => {
    let total = 0;
    let any = false;
    for (const run of runs) {
      const value = pick(run);
      if (value == null) continue;
      any = true;
      total += value;
    }
    return any ? total : null;
  };
  const breakdown = (key: (run: RunRow) => string) => {
    const map = new Map<string, { calls: number; estimatedCostUsd: number | null }>();
    for (const run of runs) {
      const name = key(run);
      const row = map.get(name) ?? { calls: 0, estimatedCostUsd: null };
      row.calls += 1;
      if (run.executionStatus === "SUCCEEDED" && run.estimatedCostUsd != null) {
        row.estimatedCostUsd = (row.estimatedCostUsd ?? 0) + run.estimatedCostUsd;
      }
      map.set(name, row);
    }
    return [...map.entries()].map(([name, row]) => ({ name, ...row }));
  };
  return {
    range,
    estimatedCostUsd: money(runs, null),
    calls: runs.length,
    inputTokens: sum((run) => run.inputTokens),
    cachedTokens: sum((run) => run.cachedTokens),
    outputTokens: sum((run) => run.outputTokens),
    adopted: runs.filter((run) => run.disposition === "ADOPTED").length,
    discarded: runs.filter((run) => run.disposition?.startsWith("DISCARDED")).length,
    failed: runs.filter((run) => run.executionStatus === "FAILED").length,
    blocked: runs.filter((run) => run.executionStatus === "BLOCKED").length,
    byModel: breakdown((run) => run.modelRequested ?? run.model),
    byChannel: breakdown((run) => run.channel ?? "UNKNOWN"),
    byOperation: breakdown((run) => run.operation ?? run.taskType),
    runs: runs.map(presentRun),
  };
}

export async function readFactoryRun(prisma: Prisma, id: string) {
  const run = await prisma.modelRun.findFirst({
    where: { id, ledgerVersion: "execution-gate-v1" },
    select: runSelect,
  });
  if (!run) return null;
  return presentRun(run);
}

export async function readFactorySafety(prisma: Prisma, env: NodeJS.ProcessEnv = process.env, now = new Date()) {
  const start = rangeStart(now, "today");
  const [runs, circuits, dbSize, activity] = await Promise.all([
    gateRuns(prisma, start),
    prisma.llmCircuitState.findMany(),
    prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`,
    prisma.$queryRaw<Array<{ state: string | null; n: number }>>`
      SELECT state, count(*)::int AS n
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY state
    `,
  ]);
  const budget = limits(env);
  const knownSpent = runs.reduce((sum, run) => {
    if (run.executionStatus === "SUCCEEDED" && run.estimatedCostUsd != null) return sum + run.estimatedCostUsd;
    return sum;
  }, 0);
  const unknownUsageRuns = runs.filter(
    (run) => run.executionStatus === "SUCCEEDED" && run.estimatedCostUsd == null,
  ).length;
  const reserved = runs.reduce((sum, run) => {
    if (run.executionStatus === "REQUESTED") return sum + (run.reservedCostUsd ?? 0);
    return sum;
  }, 0);
  return {
    circuits,
    budget,
    usedUsd: unknownUsageRuns > 0 ? null : knownSpent,
    knownSpentUsd: knownSpent,
    unknownUsageRuns,
    reservedUsd: reserved,
    remainingUsd: unknownUsageRuns > 0 ? null : budget.globalDailyUsd - knownSpent - reserved,
    ceilings: {
      logicalCallLimit: budget.logicalCallLimit,
      httpRetryLimit: budget.httpRetryLimit,
      absoluteTickCap: budget.absoluteTickCap,
      wpArticleTickCap: budget.wpArticleTickCap,
    },
    blocked: runs.filter((run) => run.executionStatus === "BLOCKED").slice(0, 50).map(presentRun),
    failures: runs.filter((run) => run.executionStatus === "FAILED").slice(0, 50).map(presentRun),
    stale: runs.filter((run) => run.executionStatus === "STALE_REQUEST").map(presentRun),
    database: {
      sizeBytes: dbSize[0] ? dbSize[0].bytes.toString() : null,
      activity: activity.map((row) => ({ state: row.state, count: row.n })),
    },
    railwayBilling: "EXTERNAL_BILLING_NOT_CONNECTED" as const,
    mutableSettings: false as const,
  };
}

export async function readFactoryPerformance(prisma: Prisma) {
  const [xSnapshots, analyticsSnapshots, xToken, impressionsKnown, engagementKnown, dbSize, analysis, connections] = await Promise.all([
    prisma.xPostMetricSnapshot.aggregate({
      _count: { _all: true },
      _sum: { impressionCount: true, likeCount: true },
      _max: { measuredAt: true },
    }),
    prisma.analyticsSnapshot.count(),
    prisma.xApiCredential.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { status: true, accessTokenExpiresAt: true, lastRefreshErrorCode: true },
    }),
    prisma.xPostMetricSnapshot.count({ where: { impressionCount: { not: null } } }),
    prisma.xPostMetricSnapshot.count({ where: { likeCount: { not: null } } }),
    prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`,
    prisma.$queryRaw<Array<{ total_bytes: bigint; live: bigint; dead: bigint }>>`
      SELECT pg_total_relation_size(c.oid) AS total_bytes, s.n_live_tup AS live, s.n_dead_tup AS dead
      FROM pg_class c
      JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE c.relname = 'ProductAnalysis'
    `,
    prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`,
  ]);
  const analysisRow = analysis[0];
  const totalBytes = analysisRow ? Number(analysisRow.total_bytes) : null;
  const liveRows = analysisRow ? Number(analysisRow.live) : null;
  const deadRows = analysisRow ? Number(analysisRow.dead) : null;
  const dbHealth =
    totalBytes != null && liveRows != null && deadRows != null && totalBytes >= 1_000_000_000 && liveRows < 50_000 && deadRows === 0
      ? "PHYSICAL_SIZE_HIGH_AFTER_RETENTION"
      : "OK";
  const snapshotCount = xSnapshots._count._all;
  const impressionsCollected = impressionsKnown > 0;
  const engagementCollected = engagementKnown > 0;
  return {
    learningConnectedToBrain: false as const,
    brainLearning: "OFF" as const,
    wp: {
      analyticsSnapshots,
      pageViews: metric(null, analyticsSnapshots > 0),
      visits: metric(null, false),
      ctaClicks: metric(null, analyticsSnapshots > 0),
      articleAttributionCoverage: metric(null, analyticsSnapshots > 0),
    },
    x: {
      snapshotCount,
      lastMeasuredAt: xSnapshots._max.measuredAt?.toISOString() ?? null,
      collectionStatus: snapshotCount > 0 ? "PARTIAL" : "NOT_COLLECTED",
      tokenStatus: xToken?.status ?? "NOT_AVAILABLE",
      tokenExpiresAt: xToken?.accessTokenExpiresAt?.toISOString() ?? null,
      lastRefreshErrorCode: xToken?.lastRefreshErrorCode ?? null,
      impressions: metric(impressionsCollected ? xSnapshots._sum.impressionCount : null, snapshotCount > 0),
      engagement: metric(engagementCollected ? xSnapshots._sum.likeCount : null, snapshotCount > 0),
    },
    database: {
      sizeBytes: dbSize[0] ? dbSize[0].bytes.toString() : null,
      productAnalysisTotalBytes: totalBytes == null ? null : String(totalBytes),
      liveRows,
      deadRows,
      connectionCount: connections[0]?.n ?? null,
      health: dbHealth,
      healthMeaning: dbHealth === "PHYSICAL_SIZE_HIGH_AFTER_RETENTION" ? "file remains large after retention deletes" : "no size warning",
      railwayBilling: "EXTERNAL_BILLING_NOT_CONNECTED" as const,
    },
  };
}
