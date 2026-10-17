/**
 * Single production LLM execution gate.
 * A row is persisted as PLANNED then REQUESTED before the HTTP transport runs.
 * OpenAI is not called from this module. The transport is injected.
 */
import { randomUUID } from "node:crypto";
import { estimateUsd, reservationUsd, type TokenUsage } from "./llm-pricing.js";
import { loadLlmSafetyLimits, type LlmSafetyLimits } from "./llm-safety-limits.js";

export const LLM_LEDGER_VERSION = "execution-gate-v1";

export type ExecutionStatus =
  | "PLANNED"
  | "REQUESTED"
  | "SUCCEEDED"
  | "FAILED"
  | "BLOCKED"
  | "STALE_REQUEST";

export type LlmDisposition =
  | "ADOPTED"
  | "DISCARDED_REVIEW"
  | "DISCARDED_DUPLICATE"
  | "DISCARDED_REWRITE"
  | "DISCARDED_SUPERSEDED"
  | "DISCARDED_NO_SLOT"
  | "DISCARDED_POLICY"
  | "DISCARDED_OTHER"
  | "UNKNOWN";

export type FailureClass =
  | "RATE_LIMIT"
  | "INSUFFICIENT_QUOTA"
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_REQUEST"
  | "SCHEMA_VALIDATION"
  | "CONTENT_POLICY"
  | "SERVER_ERROR"
  | "UNKNOWN";

export type CircuitStateName = "CLOSED" | "OPEN" | "HALF_OPEN";

export type LlmSafetyContext = {
  channel?: string | null;
  operation?: string | null;
  trigger?: string | null;
  cid?: string | null;
  contentVersionId?: string | null;
  xPublicationId?: string | null;
  artifactFingerprint?: string | null;
  logicalAttempt?: number | null;
  /** creative calls count toward ceilings. http retries do not. */
  attemptKind?: "creative" | "http" | "review" | null;
  tickId?: string | null;
  /** Desired new creative generations this tick. Clamped to the absolute cap. */
  newGenerationBudget?: number | null;
  regenerateReason?: string | null;
  reconcileStale?: boolean | null;
};

export type LlmRunRecord = {
  id: string;
  provider: string;
  model: string;
  taskType: string;
  promptIdentifier: string | null;
  promptVersion: string | null;
  executionStatus: ExecutionStatus;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  createdAt: Date;
  requestedAt: Date | null;
  finishedAt: Date | null;
  channel: string;
  operation: string;
  trigger: string | null;
  canonicalCid: string | null;
  contentVersionId: string | null;
  xPublicationId: string | null;
  publicationTargetId: string | null;
  publishedExternalId: string | null;
  artifactFingerprint: string | null;
  modelRequested: string;
  modelActual: string | null;
  logicalAttempt: number;
  httpAttempt: number;
  attemptKind: "creative" | "http" | "review";
  tickId: string | null;
  disposition: LlmDisposition | null;
  errorType: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  httpStatus: number | null;
  retryable: boolean | null;
  failureStage: string | null;
  blockReason: string | null;
  inputTokens: number | null;
  cachedTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  usageKnown: boolean | null;
  estimatedCostUsd: number | null;
  reservedCostUsd: number | null;
  retryOfId: string | null;
};

export type CircuitRecord = {
  scopeType: "GLOBAL" | "MODEL" | "CHANNEL" | "OPERATION";
  scopeKey: string;
  state: CircuitStateName;
  consecutiveFailures: number;
  openedAt: Date | null;
  reason: string | null;
};

export interface LlmRunStore {
  create(row: LlmRunRecord): Promise<void>;
  update(id: string, patch: Partial<LlmRunRecord>): Promise<LlmRunRecord>;
  findById(id: string): Promise<LlmRunRecord | null>;
  list(query?: { fingerprint?: string | null }): Promise<LlmRunRecord[]>;
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  getCircuit(scopeType: CircuitRecord["scopeType"], scopeKey: string): Promise<CircuitRecord | null>;
  saveCircuit(row: CircuitRecord): Promise<void>;
  listCircuits(): Promise<CircuitRecord[]>;
}

export class MemoryLlmRunStore implements LlmRunStore {
  readonly runs: LlmRunRecord[] = [];
  readonly circuits: CircuitRecord[] = [];
  private chains = new Map<string, Promise<unknown>>();

  async create(row: LlmRunRecord): Promise<void> {
    this.runs.push({ ...row });
  }

  async update(id: string, patch: Partial<LlmRunRecord>): Promise<LlmRunRecord> {
    const row = this.runs.find((item) => item.id === id);
    if (!row) throw new Error(`missing run ${id}`);
    Object.assign(row, patch);
    return { ...row };
  }

  async findById(id: string): Promise<LlmRunRecord | null> {
    const row = this.runs.find((item) => item.id === id);
    return row ? { ...row } : null;
  }

  async list(): Promise<LlmRunRecord[]> {
    return this.runs.map((row) => ({ ...row }));
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.chains.set(
      key,
      previous.then(() => current),
    );
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async getCircuit(scopeType: CircuitRecord["scopeType"], scopeKey: string): Promise<CircuitRecord | null> {
    return this.circuits.find((row) => row.scopeType === scopeType && row.scopeKey === scopeKey) ?? null;
  }

  async saveCircuit(row: CircuitRecord): Promise<void> {
    const index = this.circuits.findIndex(
      (item) => item.scopeType === row.scopeType && item.scopeKey === row.scopeKey,
    );
    if (index >= 0) this.circuits[index] = { ...row };
    else this.circuits.push({ ...row });
  }

  async listCircuits(): Promise<CircuitRecord[]> {
    return this.circuits.map((row) => ({ ...row }));
  }
}

export type GateTransportResult = {
  output: Record<string, unknown>;
  model: string;
  provider: string;
  usage: TokenUsage | null;
  currency: string;
};

export type GateTransportError = Error & {
  failureClass?: FailureClass;
  httpStatus?: number | null;
  retryable?: boolean;
  usage?: TokenUsage | null;
  model?: string | null;
};

export type ExecuteLlmRunInput = {
  store: LlmRunStore;
  transport: (attempt: { httpAttempt: number; runId: string }) => Promise<GateTransportResult>;
  model: string;
  taskType: string;
  provider?: string;
  promptIdentifier?: string | null;
  promptVersion?: string | null;
  safety?: LlmSafetyContext | null;
  limits?: LlmSafetyLimits;
  now?: Date;
};

export class LlmExecutionBlocked extends Error {
  readonly blockReason: string;
  readonly runId: string;

  constructor(blockReason: string, runId: string) {
    super(blockReason);
    this.name = "LlmExecutionBlocked";
    this.blockReason = blockReason;
    this.runId = runId;
  }
}

const LEGACY_STATUS: Record<ExecutionStatus, LlmRunRecord["status"]> = {
  PLANNED: "PENDING",
  REQUESTED: "RUNNING",
  SUCCEEDED: "COMPLETED",
  FAILED: "FAILED",
  BLOCKED: "CANCELLED",
  STALE_REQUEST: "CANCELLED",
};

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isGpt41(model: string): boolean {
  return model.startsWith("gpt-4.1") && !model.startsWith("gpt-4.1-mini");
}

function isXWriter(operation: string, channel: string): boolean {
  return channel === "X" || operation === "GENERATION_X_SOCIAL" || operation.startsWith("x.");
}

export function sanitizeProviderError(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key["']?\s*[:=]\s*\S+/gi, "api_key=[redacted]")
    .slice(0, 240);
}

function classifyThrown(error: unknown): {
  failureClass: FailureClass;
  httpStatus: number | null;
  retryable: boolean;
  usage: TokenUsage | null;
  model: string | null;
  detail: string;
} {
  const err = error as GateTransportError;
  const failureClass = err.failureClass ?? "UNKNOWN";
  const retryable =
    failureClass === "INSUFFICIENT_QUOTA" ? false : err.retryable === true && failureClass !== "INVALID_REQUEST";
  return {
    failureClass,
    httpStatus: err.httpStatus ?? null,
    retryable,
    usage: err.usage ?? null,
    model: err.model ?? null,
    detail: sanitizeProviderError(err instanceof Error ? err.message : "llm_failed"),
  };
}

async function circuitAllows(
  store: LlmRunStore,
  scopeType: CircuitRecord["scopeType"],
  scopeKey: string,
  now: Date,
  limits: LlmSafetyLimits,
): Promise<{ ok: true; halfOpen: boolean } | { ok: false; reason: string }> {
  const row = await store.getCircuit(scopeType, scopeKey);
  if (!row || row.state === "CLOSED") return { ok: true, halfOpen: false };
  if (row.state === "OPEN") {
    const opened = row.openedAt?.getTime() ?? now.getTime();
    if (now.getTime() - opened >= limits.halfOpenAfterMs) {
      await store.saveCircuit({ ...row, state: "HALF_OPEN" });
      return { ok: true, halfOpen: true };
    }
    return { ok: false, reason: `CIRCUIT_OPEN:${scopeType}:${scopeKey}` };
  }
  return { ok: true, halfOpen: true };
}

async function noteFailure(
  store: LlmRunStore,
  scopeType: CircuitRecord["scopeType"],
  scopeKey: string,
  failure: FailureClass,
  now: Date,
  limits: LlmSafetyLimits,
): Promise<void> {
  const current = (await store.getCircuit(scopeType, scopeKey)) ?? {
    scopeType,
    scopeKey,
    state: "CLOSED" as const,
    consecutiveFailures: 0,
    openedAt: null,
    reason: null,
  };
  const immediate = failure === "INSUFFICIENT_QUOTA";
  const threshold =
    failure === "RATE_LIMIT"
      ? limits.rateLimitOpenAfter
      : failure === "TIMEOUT" || failure === "NETWORK"
        ? limits.timeoutOpenAfter
        : failure === "SERVER_ERROR"
          ? limits.serverErrorOpenAfter
          : Number.POSITIVE_INFINITY;
  const consecutive = current.consecutiveFailures + 1;
  const open = immediate || consecutive >= threshold;
  await store.saveCircuit({
    scopeType,
    scopeKey,
    state: open ? "OPEN" : current.state === "HALF_OPEN" ? "OPEN" : "CLOSED",
    consecutiveFailures: consecutive,
    openedAt: open ? now : current.openedAt,
    reason: open ? failure : current.reason,
  });
}

async function noteSuccess(
  store: LlmRunStore,
  scopeType: CircuitRecord["scopeType"],
  scopeKey: string,
): Promise<void> {
  const current = await store.getCircuit(scopeType, scopeKey);
  if (!current) return;
  await store.saveCircuit({
    ...current,
    state: "CLOSED",
    consecutiveFailures: 0,
    openedAt: null,
    reason: null,
  });
}

function spentAndReserved(runs: LlmRunRecord[], now: Date, predicate: (run: LlmRunRecord) => boolean): number {
  const day = dayKey(now);
  let total = 0;
  for (const run of runs) {
    if (dayKey(run.createdAt) !== day || !predicate(run)) continue;
    if (run.executionStatus === "SUCCEEDED") total += run.estimatedCostUsd ?? run.reservedCostUsd ?? 0;
    else if (run.executionStatus === "REQUESTED" || run.executionStatus === "PLANNED") {
      total += run.reservedCostUsd ?? 0;
    }
  }
  return total;
}

export async function executeLlmRun(input: ExecuteLlmRunInput): Promise<{
  runId: string;
  output: Record<string, unknown>;
  model: string;
  provider: string;
  usage: TokenUsage | null;
  estimatedCostUsd: number | null;
  blocked: boolean;
  blockReason: string | null;
}> {
  const limits = input.limits ?? loadLlmSafetyLimits();
  const now = input.now ?? new Date();
  const safety = input.safety ?? {};
  const channel = safety.channel?.trim() || "UNKNOWN";
  const operation = safety.operation?.trim() || input.taskType;
  const attemptKind = safety.attemptKind === "http" ? "http" : safety.attemptKind === "review" ? "review" : "creative";
  const fingerprint = safety.artifactFingerprint?.trim() || null;
  const tickId = safety.tickId?.trim() || null;
  const lockKey = fingerprint ?? `untagged:${operation}:${safety.cid ?? "none"}`;
  const reserved = reservationUsd(input.model);
  const httpLimit = Math.max(1, Math.floor(limits.httpRetryLimit));

  const admitted = await input.store.withLock(lockKey, async () => {
    const runs = await input.store.list({ fingerprint: safety.artifactFingerprint ?? null });
    const block = await blockingReason({
      store: input.store,
      runs,
      now,
      limits,
      model: input.model,
      channel,
      operation,
      fingerprint,
      tickId,
      attemptKind,
      safety,
    });
    if (block) {
      const row = await persistBlocked(input, {
        now,
        channel,
        operation,
        attemptKind,
        fingerprint,
        tickId,
        reason: block,
        logicalAttempt: safety.logicalAttempt ?? 1,
      });
      return { blocked: true as const, row };
    }
    const priorCreative = fingerprint
      ? runs.filter(
          (run) =>
            run.artifactFingerprint === fingerprint &&
            run.attemptKind === "creative" &&
            (run.executionStatus === "SUCCEEDED" || run.executionStatus === "FAILED"),
        ).length
      : 0;
    const logicalAttempt = safety.logicalAttempt ?? priorCreative + 1;
    const run = blankRun(input, {
      now,
      channel,
      operation,
      attemptKind,
      fingerprint,
      tickId,
      logicalAttempt,
      httpAttempt: 1,
      reserved,
      retryOfId: null,
      executionStatus: "PLANNED",
    });
    await input.store.create(run);
    const requested = await input.store.update(run.id, {
      executionStatus: "REQUESTED",
      status: "RUNNING",
      requestedAt: now,
    });
    return { blocked: false as const, row: requested };
  });

  if (admitted.blocked) {
    return {
      runId: admitted.row.id,
      output: {},
      model: input.model,
      provider: input.provider ?? "openai-compatible",
      usage: null,
      estimatedCostUsd: null,
      blocked: true,
      blockReason: admitted.row.blockReason,
    };
  }

  const run = admitted.row;
  let httpAttempt = 0;
  while (httpAttempt < httpLimit) {
    httpAttempt += 1;
    if (httpAttempt > 1) {
      await input.store.update(run.id, { httpAttempt });
    }
    try {
      const result = await input.transport({ httpAttempt, runId: run.id });
      const current = await input.store.findById(run.id);
      if (!current || current.executionStatus !== "REQUESTED") {
        return {
          runId: run.id,
          output: result.output,
          model: result.model,
          provider: result.provider,
          usage: result.usage,
          estimatedCostUsd: null,
          blocked: false,
          blockReason: "STALE_REQUEST",
        };
      }
      const usage = result.usage;
      const known = usage?.inputTokens != null && usage.outputTokens != null;
      const estimated = known ? estimateUsd(result.model || input.model, usage) : null;
      await input.store.update(run.id, {
        executionStatus: "SUCCEEDED",
        status: "COMPLETED",
        finishedAt: input.now ?? new Date(),
        disposition: "UNKNOWN",
        modelActual: result.model,
        inputTokens: known ? usage.inputTokens : null,
        cachedTokens: known ? usage.cachedInputTokens : null,
        outputTokens: known ? usage.outputTokens : null,
        reasoningTokens: known ? usage.reasoningTokens : null,
        usageKnown: known,
        estimatedCostUsd: estimated,
        reservedCostUsd: estimated ?? reserved,
        provider: result.provider,
        httpAttempt,
      });
      await noteSuccess(input.store, "MODEL", input.model);
      await noteSuccess(input.store, "OPERATION", operation);
      return {
        runId: run.id,
        output: result.output,
        model: result.model,
        provider: result.provider,
        usage,
        estimatedCostUsd: estimated,
        blocked: false,
        blockReason: null,
      };
    } catch (error) {
      const failure = classifyThrown(error);
      const current = await input.store.findById(run.id);
      const again = failure.retryable && failure.failureClass !== "INSUFFICIENT_QUOTA" && httpAttempt < httpLimit;
      if (current?.executionStatus === "REQUESTED" && !again) {
        await input.store.update(run.id, {
          executionStatus: "FAILED",
          status: "FAILED",
          finishedAt: input.now ?? new Date(),
          errorType: failure.failureClass,
          errorCode: failure.failureClass,
          errorDetail: failure.detail,
          httpStatus: failure.httpStatus,
          retryable: failure.retryable,
          failureStage: "transport",
          modelActual: failure.model,
          httpAttempt,
          usageKnown: failure.usage?.inputTokens != null && failure.usage.outputTokens != null,
          inputTokens: failure.usage?.inputTokens ?? null,
          outputTokens: failure.usage?.outputTokens ?? null,
          cachedTokens: failure.usage?.cachedInputTokens ?? null,
          reasoningTokens: failure.usage?.reasoningTokens ?? null,
          estimatedCostUsd:
            failure.usage && failure.usage.inputTokens != null && failure.usage.outputTokens != null
              ? estimateUsd(failure.model || input.model, failure.usage)
              : null,
        });
      }
      await noteFailure(input.store, "MODEL", failure.model || input.model, failure.failureClass, now, limits);
      await noteFailure(input.store, "OPERATION", operation, failure.failureClass, now, limits);
      if (!again) {
        throw Object.assign(error instanceof Error ? error : new Error(failure.detail), {
          executionRunId: run.id,
          failureClass: failure.failureClass,
        });
      }
    }
  }
  throw new LlmExecutionBlocked("BLOCKED_CALL_LIMIT", run.id);
}

function ceilingFamily(operation: string): string {
  if (operation === "WP_WRITER" || operation === "WP_REWRITE") return "wp-article";
  if (operation === "WP_BRAIN") return "wp-brain";
  if (operation === "WP_REVIEW") return "wp-review";
  return operation;
}

function tickBucket(run: {
  channel: string;
  operation: string;
  attemptKind: string;
  logicalAttempt: number;
}): "wp-article" | "other" | null {
  if (run.attemptKind !== "creative") return null;
  if (run.channel === "WORDPRESS" || run.channel === "WP") {
    return run.operation === "WP_WRITER" && run.logicalAttempt <= 1 ? "wp-article" : null;
  }
  return "other";
}

async function blockingReason(input: {
  store: LlmRunStore;
  runs: LlmRunRecord[];
  now: Date;
  limits: LlmSafetyLimits;
  model: string;
  channel: string;
  operation: string;
  fingerprint: string | null;
  tickId: string | null;
  attemptKind: "creative" | "http" | "review";
  safety: LlmSafetyContext;
}): Promise<string | null> {
  for (const scope of [
    ["GLOBAL", "*"],
    ["MODEL", input.model],
    ["OPERATION", input.operation],
    ["CHANNEL", input.channel],
  ] as const) {
    const allowed = await circuitAllows(input.store, scope[0], scope[1], input.now, input.limits);
    if (!allowed.ok) return allowed.reason;
  }
  if (input.fingerprint) {
    const stale = input.runs.find(
      (run) => run.artifactFingerprint === input.fingerprint && run.executionStatus === "STALE_REQUEST",
    );
    if (stale && !input.safety.reconcileStale) return "BLOCKED_STALE";
    const inflight = input.runs.find(
      (run) => run.artifactFingerprint === input.fingerprint && run.executionStatus === "REQUESTED",
    );
    if (inflight) {
      return input.attemptKind === "creative" ? "BLOCKED_DUPLICATE" : "BLOCKED_IN_FLIGHT";
    }
    const family = ceilingFamily(input.operation);
    const adopted = input.runs.find(
      (run) =>
        run.artifactFingerprint === input.fingerprint &&
        ceilingFamily(run.operation) === family &&
        run.executionStatus === "SUCCEEDED" &&
        run.disposition === "ADOPTED",
    );
    if (adopted) return "BLOCKED_DUPLICATE";
    const rejected = input.runs.find(
      (run) =>
        run.artifactFingerprint === input.fingerprint &&
        ceilingFamily(run.operation) === family &&
        (run.disposition === "DISCARDED_REVIEW" || run.disposition === "DISCARDED_DUPLICATE"),
    );
    if (rejected && !input.safety.regenerateReason) return "BLOCKED_REJECTED_FINGERPRINT";
    if (input.attemptKind === "creative") {
      const creative = input.runs.filter(
        (run) =>
          run.artifactFingerprint === input.fingerprint &&
          run.attemptKind === "creative" &&
          ceilingFamily(run.operation) === family &&
          (run.executionStatus === "SUCCEEDED" || run.executionStatus === "FAILED"),
      ).length;
      if (creative >= input.limits.logicalCallLimit) return "BLOCKED_CALL_LIMIT";
    }
  }
  const tickKind = tickBucket({
    channel: input.channel,
    operation: input.operation,
    attemptKind: input.attemptKind,
    logicalAttempt: input.safety.logicalAttempt ?? 1,
  });
  if (tickKind && input.tickId) {
    const used = input.runs.filter(
      (run) =>
        run.tickId === input.tickId &&
        tickBucket(run) === tickKind &&
        (run.executionStatus === "REQUESTED" ||
          run.executionStatus === "SUCCEEDED" ||
          run.executionStatus === "FAILED"),
    ).length;
    const cap = tickKind === "wp-article" ? (input.limits.wpArticleTickCap ?? 5) : input.limits.absoluteTickCap;
    const requested = input.safety.newGenerationBudget ?? cap;
    const budget = Math.min(cap, Math.max(0, requested));
    if (used >= budget) return "BLOCKED_TICK_LIMIT";
  }
  const reserve = reservationUsd(input.model);
  const all = spentAndReserved(input.runs, input.now, () => true);
  if (all + reserve > input.limits.globalDailyUsd) return "BLOCKED_BUDGET";
  if (isGpt41(input.model)) {
    const gpt = spentAndReserved(input.runs, input.now, (run) => isGpt41(run.modelRequested));
    if (gpt + reserve > input.limits.gpt41DailyUsd) return "BLOCKED_BUDGET";
  }
  if (isXWriter(input.operation, input.channel)) {
    const x = spentAndReserved(
      input.runs,
      input.now,
      (run) => isXWriter(run.operation, run.channel) && isGpt41(run.modelRequested),
    );
    if (x + reserve > input.limits.xWriterDailyUsd) return "BLOCKED_BUDGET";
  }
  return null;
}

function blankRun(
  input: ExecuteLlmRunInput,
  extra: {
    now: Date;
    channel: string;
    operation: string;
    attemptKind: "creative" | "http" | "review";
    fingerprint: string | null;
    tickId: string | null;
    logicalAttempt: number;
    httpAttempt: number;
    reserved: number;
    retryOfId: string | null;
    executionStatus: ExecutionStatus;
  },
): LlmRunRecord {
  return {
    id: randomUUID(),
    provider: input.provider ?? "openai-compatible",
    model: input.model,
    taskType: input.taskType,
    promptIdentifier: input.promptIdentifier ?? null,
    promptVersion: input.promptVersion ?? null,
    executionStatus: extra.executionStatus,
    status: LEGACY_STATUS[extra.executionStatus],
    createdAt: extra.now,
    requestedAt: null,
    finishedAt: null,
    channel: extra.channel,
    operation: extra.operation,
    trigger: input.safety?.trigger ?? null,
    canonicalCid: input.safety?.cid ?? null,
    contentVersionId: input.safety?.contentVersionId ?? null,
    xPublicationId: input.safety?.xPublicationId ?? null,
    publicationTargetId: null,
    publishedExternalId: null,
    artifactFingerprint: extra.fingerprint,
    modelRequested: input.model,
    modelActual: null,
    logicalAttempt: extra.logicalAttempt,
    httpAttempt: extra.httpAttempt,
    attemptKind: extra.attemptKind,
    tickId: extra.tickId,
    disposition: null,
    errorType: null,
    errorCode: null,
    errorDetail: null,
    httpStatus: null,
    retryable: null,
    failureStage: null,
    blockReason: null,
    inputTokens: null,
    cachedTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    usageKnown: null,
    estimatedCostUsd: null,
    reservedCostUsd: extra.reserved,
    retryOfId: extra.retryOfId,
  };
}

async function persistBlocked(
  input: ExecuteLlmRunInput,
  extra: {
    now: Date;
    channel: string;
    operation: string;
    attemptKind: "creative" | "http" | "review";
    fingerprint: string | null;
    tickId: string | null;
    reason: string;
    logicalAttempt: number;
  },
): Promise<LlmRunRecord> {
  const row = blankRun(input, {
    ...extra,
    httpAttempt: 1,
    reserved: 0,
    retryOfId: null,
    executionStatus: "BLOCKED",
  });
  row.finishedAt = extra.now;
  row.blockReason = extra.reason;
  row.disposition = extra.reason === "BLOCKED_DUPLICATE" ? "DISCARDED_DUPLICATE" : "DISCARDED_POLICY";
  row.failureStage = "guard";
  row.reservedCostUsd = 0;
  await input.store.create(row);
  return row;
}

export async function recoverStaleRequests(
  store: LlmRunStore,
  now: Date,
  staleMs: number,
): Promise<string[]> {
  const runs = await store.list();
  const ids: string[] = [];
  for (const run of runs) {
    if (run.executionStatus !== "REQUESTED") continue;
    const requested = run.requestedAt ?? run.createdAt;
    if (now.getTime() - requested.getTime() < staleMs) continue;
    await store.update(run.id, {
      executionStatus: "STALE_REQUEST",
      status: "CANCELLED",
      finishedAt: now,
      blockReason: "STALE_REQUEST",
      failureStage: "crash",
      disposition: "UNKNOWN",
    });
    ids.push(run.id);
  }
  return ids;
}

export async function settleLlmDisposition(
  store: LlmRunStore,
  runId: string,
  disposition: LlmDisposition,
  links?: {
    xPublicationId?: string | null;
    contentVersionId?: string | null;
    publicationTargetId?: string | null;
    publishedExternalId?: string | null;
  },
): Promise<void> {
  const row = await store.findById(runId);
  if (!row) return;
  await store.update(runId, {
    disposition,
    xPublicationId: links?.xPublicationId ?? row.xPublicationId,
    contentVersionId: links?.contentVersionId ?? row.contentVersionId,
    publicationTargetId: links?.publicationTargetId ?? row.publicationTargetId,
    publishedExternalId: links?.publishedExternalId ?? row.publishedExternalId,
  });
}

export function dispositionForSocialSkip(reason: string | null | undefined): LlmDisposition {
  if (!reason) return "ADOPTED";
  if (reason.includes("REVIEW") || reason === "SOCIAL_REVIEW_FAILED") return "DISCARDED_REVIEW";
  if (reason.includes("DUPLICATE")) return "DISCARDED_DUPLICATE";
  if (reason.includes("SLOT") || reason === "NO_OPEN_SLOT") return "DISCARDED_NO_SLOT";
  if (reason.includes("POLICY") || reason.includes("DESTINATION") || reason.includes("ADULT")) {
    return "DISCARDED_POLICY";
  }
  if (reason.includes("REWRITE")) return "DISCARDED_REWRITE";
  return "DISCARDED_OTHER";
}
