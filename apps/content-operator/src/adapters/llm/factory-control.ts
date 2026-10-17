import type { CircuitRecord, LlmRunRecord } from "./llm-execution-gate.js";

export type FactoryRange = "today" | "7d" | "30d";

export type FactoryOverview = {
  range: FactoryRange;
  estimatedCostUsd: number | null;
  calls: number;
  gpt41CostUsd: number | null;
  gpt41MiniCostUsd: number | null;
  adopted: number;
  discarded: number;
  failed: number;
  blocked: number;
  requested: number;
  stale: number;
  wpGenerated: number;
  wpPublished: number;
  xGenerated: number;
  xPublished: number;
  xScheduled: number;
  xBlocked: number;
  circuits: CircuitRecord[];
  critical: string[];
  railwayBilling: "EXTERNAL_BILLING_NOT_CONNECTED";
  learningConnectedToBrain: false;
};

export type MetricValue = { status: "AVAILABLE" | "NOT_COLLECTED" | "NOT_AVAILABLE"; value: number | null };

function inRange(date: Date, now: Date, range: FactoryRange): boolean {
  if (range === "today") return date.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  const days = range === "7d" ? 7 : 30;
  return now.getTime() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function sumKnown(runs: LlmRunRecord[], pick: (run: LlmRunRecord) => number | null): number | null {
  let total = 0;
  let any = false;
  for (const run of runs) {
    const value = pick(run);
    if (value == null) continue;
    any = true;
    total += value;
  }
  return any ? total : null;
}

export function aggregateFactoryControl(input: {
  runs: LlmRunRecord[];
  circuits: CircuitRecord[];
  now: Date;
  range: FactoryRange;
  outputs: {
    wpGenerated: number;
    wpPublished: number;
    xGenerated: number;
    xPublished: number;
    xScheduled: number;
    xBlocked: number;
  };
}): FactoryOverview {
  const runs = input.runs.filter(
    (run) => run.executionStatus && inRange(run.createdAt, input.now, input.range),
  );
  const cost = (modelPrefix: string | null) =>
    sumKnown(runs.filter((run) => (modelPrefix ? run.modelRequested.startsWith(modelPrefix) : true)), (run) =>
      run.executionStatus === "SUCCEEDED" ? run.estimatedCostUsd : null,
    );
  const critical = [
    ...input.circuits.filter((row) => row.state === "OPEN").map((row) => `${row.scopeType}:${row.scopeKey}:${row.reason ?? "OPEN"}`),
    ...runs.filter((run) => run.executionStatus === "STALE_REQUEST").map((run) => `STALE:${run.id}`),
  ];
  return {
    range: input.range,
    estimatedCostUsd: cost(null),
    calls: runs.length,
    gpt41CostUsd: cost("gpt-4.1") == null
      ? null
      : sumKnown(
          runs.filter((run) => run.modelRequested.startsWith("gpt-4.1") && !run.modelRequested.startsWith("gpt-4.1-mini")),
          (run) => (run.executionStatus === "SUCCEEDED" ? run.estimatedCostUsd : null),
        ),
    gpt41MiniCostUsd: cost("gpt-4.1-mini"),
    adopted: runs.filter((run) => run.disposition === "ADOPTED").length,
    discarded: runs.filter((run) => run.disposition?.startsWith("DISCARDED")).length,
    failed: runs.filter((run) => run.executionStatus === "FAILED").length,
    blocked: runs.filter((run) => run.executionStatus === "BLOCKED").length,
    requested: runs.filter((run) => run.executionStatus === "REQUESTED").length,
    stale: runs.filter((run) => run.executionStatus === "STALE_REQUEST").length,
    ...input.outputs,
    circuits: input.circuits,
    critical,
    railwayBilling: "EXTERNAL_BILLING_NOT_CONNECTED",
    learningConnectedToBrain: false,
  };
}

export const ANOMALY_THRESHOLDS = {
  budgetWarningRatio: 0.8,
  discardRateWarning: 0.5,
  discardSampleMin: 4,
  retryRateWarning: 0.4,
  retrySampleMin: 4,
  unknownUsageWarning: 3,
  duplicateBlockWarning: 5,
} as const;

export function costPerAdopted(cost: number | null, adopted: number): number | null {
  if (cost == null || adopted <= 0) return null;
  return cost / adopted;
}

export function classifyFactoryAnomaly(input: {
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

export function physicalSizeHealth(input: { totalBytes: number; liveRows: number; deadRows: number }): "OK" | "PHYSICAL_SIZE_HIGH_AFTER_RETENTION" {
  if (input.totalBytes >= 1_000_000_000 && input.liveRows < 50_000 && input.deadRows === 0) {
    return "PHYSICAL_SIZE_HIGH_AFTER_RETENTION";
  }
  return "OK";
}

export function presentMetric(value: number | null, collected: boolean): MetricValue {
  if (!collected) return { status: "NOT_COLLECTED", value: null };
  if (value == null) return { status: "NOT_AVAILABLE", value: null };
  return { status: "AVAILABLE", value };
}
