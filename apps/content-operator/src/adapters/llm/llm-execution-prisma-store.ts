import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseClient } from "@ai-affiliate/database";
import type { CircuitRecord, LlmRunRecord, LlmRunStore } from "./llm-execution-gate.js";
import { LLM_LEDGER_VERSION } from "./llm-execution-gate.js";

type Prisma = DatabaseClient["prisma"];
type Tx = Omit<Prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
const txContext = new AsyncLocalStorage<Tx>();

function fromRow(row: {
  id: string;
  provider: string;
  model: string;
  taskType: string;
  promptIdentifier: string | null;
  promptVersion: string | null;
  executionStatus: string | null;
  status: LlmRunRecord["status"];
  createdAt: Date;
  requestedAt: Date | null;
  finishedAt: Date | null;
  channel: string | null;
  operation: string | null;
  trigger: string | null;
  canonicalCid: string | null;
  contentVersionId: string | null;
  xPublicationId: string | null;
  publicationTargetId: string | null;
  publishedExternalId: string | null;
  artifactFingerprint: string | null;
  modelRequested: string | null;
  modelActual: string | null;
  logicalAttempt: number | null;
  httpAttempt: number | null;
  attemptKind: string | null;
  tickId: string | null;
  disposition: string | null;
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
}): LlmRunRecord {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    taskType: row.taskType,
    promptIdentifier: row.promptIdentifier,
    promptVersion: row.promptVersion,
    executionStatus: (row.executionStatus ?? "PLANNED") as LlmRunRecord["executionStatus"],
    status: row.status,
    createdAt: row.createdAt,
    requestedAt: row.requestedAt,
    finishedAt: row.finishedAt,
    channel: row.channel ?? "UNKNOWN",
    operation: row.operation ?? row.taskType,
    trigger: row.trigger,
    canonicalCid: row.canonicalCid,
    contentVersionId: row.contentVersionId,
    xPublicationId: row.xPublicationId,
    publicationTargetId: row.publicationTargetId,
    publishedExternalId: row.publishedExternalId,
    artifactFingerprint: row.artifactFingerprint,
    modelRequested: row.modelRequested ?? row.model,
    modelActual: row.modelActual,
    logicalAttempt: row.logicalAttempt ?? 1,
    httpAttempt: row.httpAttempt ?? 1,
    attemptKind: row.attemptKind === "http" ? "http" : "creative",
    tickId: row.tickId,
    disposition: row.disposition as LlmRunRecord["disposition"],
    errorType: row.errorType,
    errorCode: row.errorCode,
    errorDetail: row.errorDetail,
    httpStatus: row.httpStatus,
    retryable: row.retryable,
    failureStage: row.failureStage,
    blockReason: row.blockReason,
    inputTokens: row.inputTokens,
    cachedTokens: row.cachedTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    usageKnown: row.usageKnown,
    estimatedCostUsd: row.estimatedCostUsd,
    reservedCostUsd: row.reservedCostUsd,
    retryOfId: row.retryOfId,
  };
}

export function createPrismaLlmRunStore(prisma: Prisma): LlmRunStore {
  const db = () => txContext.getStore() ?? prisma;
  return {
    async create(row) {
      await db().modelRun.create({
        data: {
          id: row.id,
          provider: row.provider,
          model: row.model,
          taskType: row.taskType,
          promptIdentifier: row.promptIdentifier,
          promptVersion: row.promptVersion,
          status: row.status,
          executionStatus: row.executionStatus,
          requestedAt: row.requestedAt,
          finishedAt: row.finishedAt,
          channel: row.channel,
          operation: row.operation,
          trigger: row.trigger,
          canonicalCid: row.canonicalCid,
          contentVersionId: row.contentVersionId,
          xPublicationId: row.xPublicationId,
          publicationTargetId: row.publicationTargetId,
          publishedExternalId: row.publishedExternalId,
          artifactFingerprint: row.artifactFingerprint,
          modelRequested: row.modelRequested,
          modelActual: row.modelActual,
          logicalAttempt: row.logicalAttempt,
          httpAttempt: row.httpAttempt,
          attemptKind: row.attemptKind,
          tickId: row.tickId,
          disposition: row.disposition,
          errorType: row.errorType,
          errorCode: row.errorCode,
          errorDetail: row.errorDetail,
          httpStatus: row.httpStatus,
          retryable: row.retryable,
          failureStage: row.failureStage,
          blockReason: row.blockReason,
          inputTokens: row.inputTokens,
          cachedTokens: row.cachedTokens,
          outputTokens: row.outputTokens,
          reasoningTokens: row.reasoningTokens,
          usageKnown: row.usageKnown,
          estimatedCostUsd: row.estimatedCostUsd,
          reservedCostUsd: row.reservedCostUsd,
          retryOfId: row.retryOfId,
          ledgerVersion: LLM_LEDGER_VERSION,
          metadata: { ledger: LLM_LEDGER_VERSION },
        },
      });
    },
    async update(id, patch) {
      const row = await db().modelRun.update({
        where: { id },
        data: {
          ...(patch.executionStatus ? { executionStatus: patch.executionStatus, status: patch.status } : {}),
          ...(patch.requestedAt !== undefined ? { requestedAt: patch.requestedAt } : {}),
          ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
          ...(patch.modelActual !== undefined ? { modelActual: patch.modelActual } : {}),
          ...(patch.httpAttempt !== undefined ? { httpAttempt: patch.httpAttempt } : {}),
          ...(patch.attemptKind !== undefined ? { attemptKind: patch.attemptKind } : {}),
          ...(patch.disposition !== undefined ? { disposition: patch.disposition } : {}),
          ...(patch.errorType !== undefined ? { errorType: patch.errorType } : {}),
          ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
          ...(patch.errorDetail !== undefined ? { errorDetail: patch.errorDetail } : {}),
          ...(patch.httpStatus !== undefined ? { httpStatus: patch.httpStatus } : {}),
          ...(patch.retryable !== undefined ? { retryable: patch.retryable } : {}),
          ...(patch.failureStage !== undefined ? { failureStage: patch.failureStage } : {}),
          ...(patch.blockReason !== undefined ? { blockReason: patch.blockReason } : {}),
          ...(patch.inputTokens !== undefined ? { inputTokens: patch.inputTokens } : {}),
          ...(patch.cachedTokens !== undefined ? { cachedTokens: patch.cachedTokens } : {}),
          ...(patch.outputTokens !== undefined ? { outputTokens: patch.outputTokens } : {}),
          ...(patch.reasoningTokens !== undefined ? { reasoningTokens: patch.reasoningTokens } : {}),
          ...(patch.usageKnown !== undefined ? { usageKnown: patch.usageKnown } : {}),
          ...(patch.estimatedCostUsd !== undefined ? { estimatedCostUsd: patch.estimatedCostUsd } : {}),
          ...(patch.reservedCostUsd !== undefined ? { reservedCostUsd: patch.reservedCostUsd } : {}),
          ...(patch.xPublicationId !== undefined ? { xPublicationId: patch.xPublicationId } : {}),
          ...(patch.contentVersionId !== undefined ? { contentVersionId: patch.contentVersionId } : {}),
          ...(patch.publicationTargetId !== undefined ? { publicationTargetId: patch.publicationTargetId } : {}),
          ...(patch.publishedExternalId !== undefined ? { publishedExternalId: patch.publishedExternalId } : {}),
          ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        },
      });
      return fromRow(row);
    },
    async findById(id) {
      const row = await db().modelRun.findUnique({ where: { id } });
      return row ? fromRow(row) : null;
    },
    async list(query?: { fingerprint?: string | null }) {
      const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const fingerprint = query?.fingerprint ?? null;
      const rows = await db().modelRun.findMany({
        where: fingerprint
          ? {
              ledgerVersion: LLM_LEDGER_VERSION,
              OR: [{ createdAt: { gte: since } }, { artifactFingerprint: fingerprint }],
            }
          : { ledgerVersion: LLM_LEDGER_VERSION, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      return rows.map(fromRow);
    },
    async withLock(key, fn) {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`llm:${key}`}, 0))`;
        return txContext.run(tx, fn);
      });
    },
    async getCircuit(scopeType, scopeKey) {
      const row = await db().llmCircuitState.findUnique({
        where: { scopeType_scopeKey: { scopeType, scopeKey } },
      });
      if (!row) return null;
      return {
        scopeType: row.scopeType as CircuitRecord["scopeType"],
        scopeKey: row.scopeKey,
        state: row.state as CircuitRecord["state"],
        consecutiveFailures: row.consecutiveFailures,
        openedAt: row.openedAt,
        reason: row.reason,
      };
    },
    async saveCircuit(row) {
      await db().llmCircuitState.upsert({
        where: { scopeType_scopeKey: { scopeType: row.scopeType, scopeKey: row.scopeKey } },
        create: {
          scopeType: row.scopeType,
          scopeKey: row.scopeKey,
          state: row.state,
          consecutiveFailures: row.consecutiveFailures,
          openedAt: row.openedAt,
          reason: row.reason,
        },
        update: {
          state: row.state,
          consecutiveFailures: row.consecutiveFailures,
          openedAt: row.openedAt,
          reason: row.reason,
        },
      });
    },
    async listCircuits() {
      const rows = await db().llmCircuitState.findMany();
      return rows.map((row) => ({
        scopeType: row.scopeType as CircuitRecord["scopeType"],
        scopeKey: row.scopeKey,
        state: row.state as CircuitRecord["state"],
        consecutiveFailures: row.consecutiveFailures,
        openedAt: row.openedAt,
        reason: row.reason,
      }));
    },
  };
}
