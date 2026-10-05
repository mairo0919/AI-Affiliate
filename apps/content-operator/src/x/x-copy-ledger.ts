/**
 * Ledger for X copy model calls. Prompts and secrets are not stored.
 * A ledger write failure must not force another generation.
 */

import type { DatabaseClient } from "@ai-affiliate/database";
import type { LLMProvider, LLMTaskRequest, LLMTaskResult } from "../adapters/types.js";
import { LLMProviderError } from "../adapters/types.js";
import type { XCopyArtifactStore } from "./x-copy-artifact.js";
import type { XCopyGenerationContext } from "./x-copy-reuse.js";

export type XCopyLedgerAttempt = {
  provider: string;
  model: string;
  promptIdentifier: string | null;
  promptVersion: string | null;
  success: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  actualCost: number | null;
  currency: string;
  errorType: string | null;
  errorDetail: string | null;
  trigger: "probe" | "execute";
  cid: string;
  fingerprint: string;
  logicalGenerationId: string;
  httpAttempt: number;
  retryOfId: string | null;
};

export type XCopyLedger = {
  recordAttempt(input: XCopyLedgerAttempt): Promise<string | null>;
};

export function createPrismaXCopyArtifactStore(
  prisma: DatabaseClient["prisma"],
  researchItemId: string,
): XCopyArtifactStore {
  return {
    async transact(fn) {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`x-copy:${researchItemId}`}, 0))`;
        const row = await tx.researchItem.findUnique({
          where: { id: researchItemId },
          select: { rawData: true },
        });
        const outcome = await fn(row?.rawData ?? null);
        if (outcome.rawData) {
          await tx.researchItem.update({
            where: { id: researchItemId },
            data: { rawData: JSON.parse(JSON.stringify(outcome.rawData)) as object },
          });
        }
        return outcome.value;
      });
    },
  };
}

export function createPrismaXCopyLedger(prisma: DatabaseClient["prisma"]): XCopyLedger {
  return {
    async recordAttempt(input) {
      const metadata = {
        phase: "x.copy",
        trigger: input.trigger,
        canonicalCid: input.cid,
        inputFingerprint: input.fingerprint,
        logicalGenerationId: input.logicalGenerationId,
        httpAttempt: input.httpAttempt,
      };
      const run = await prisma.modelRun.create({
        data: {
          provider: input.provider,
          model: input.model,
          taskType: "GENERATION_X_SOCIAL",
          promptIdentifier: input.promptIdentifier,
          promptVersion: input.promptVersion,
          status: input.success ? "COMPLETED" : "FAILED",
          completedAt: new Date(),
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          estimatedCost: input.estimatedCost,
          actualCost: input.actualCost,
          currency: input.currency || "JPY",
          errorType: input.errorType,
          errorDetail: input.errorDetail,
          retryOfId: input.retryOfId,
          metadata,
        },
      });
      const billed = input.inputTokens != null || input.outputTokens != null;
      if (input.success || billed) {
        await prisma.costRecord.create({
          data: {
            provider: input.provider,
            serviceOrModel: input.model,
            operationType: "x.copy",
            relatedType: "x.copy",
            relatedId: input.cid,
            modelRunId: run.id,
            estimatedAmount: input.estimatedCost,
            actualAmount: input.actualCost ?? input.estimatedCost,
            currency: input.currency || "JPY",
            metadata,
          },
        });
      }
      return run.id;
    },
  };
}

export function ledgeringXCopyProvider(
  inner: LLMProvider,
  ledger: XCopyLedger,
  ctx: XCopyGenerationContext & { cid: string },
): LLMProvider {
  let httpAttempt = 0;
  let firstModelRunId: string | null = null;
  return {
    providerKey: inner.providerKey,
    async executeTask(request: LLMTaskRequest): Promise<LLMTaskResult> {
      httpAttempt += 1;
      const attempt = httpAttempt;
      try {
        const result = await inner.executeTask(request);
        const id = await ledger
          .recordAttempt({
            provider: result.provider,
            model: result.model,
            promptIdentifier: request.promptIdentifier ?? null,
            promptVersion: request.promptVersion ?? null,
            success: true,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            estimatedCost: result.estimatedCost,
            actualCost: result.actualCost ?? result.estimatedCost,
            currency: result.currency,
            errorType: null,
            errorDetail: null,
            trigger: ctx.trigger,
            cid: ctx.cid,
            fingerprint: ctx.fingerprint,
            logicalGenerationId: ctx.logicalGenerationId,
            httpAttempt: attempt,
            retryOfId: firstModelRunId,
          })
          .catch(() => null);
        if (!firstModelRunId && id) firstModelRunId = id;
        return result;
      } catch (error) {
        const providerError = error instanceof LLMProviderError ? error : null;
        const usage = providerError?.usage ?? null;
        const id = await ledger
          .recordAttempt({
            provider: usage?.provider ?? inner.providerKey,
            model: usage?.model ?? request.model ?? "unknown",
            promptIdentifier: request.promptIdentifier ?? null,
            promptVersion: request.promptVersion ?? null,
            success: false,
            inputTokens: usage?.inputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
            estimatedCost: usage?.estimatedCost ?? null,
            actualCost: usage?.actualCost ?? usage?.estimatedCost ?? null,
            currency: usage?.currency ?? "JPY",
            errorType: providerError?.errorClass ?? "unknown",
            errorDetail: error instanceof Error ? error.message.slice(0, 480) : "x_copy_llm_failed",
            trigger: ctx.trigger,
            cid: ctx.cid,
            fingerprint: ctx.fingerprint,
            logicalGenerationId: ctx.logicalGenerationId,
            httpAttempt: attempt,
            retryOfId: firstModelRunId,
          })
          .catch(() => null);
        if (!firstModelRunId && id) firstModelRunId = id;
        throw error;
      }
    },
  };
}
