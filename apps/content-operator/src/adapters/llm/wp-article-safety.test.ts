import { describe, expect, it } from "vitest";
import { classifyFactoryAnomaly, costPerAdopted, physicalSizeHealth } from "./factory-control.js";
import { bindLlmExecutionStore } from "./llm-execution-binding.js";
import {
  executeLlmRun,
  MemoryLlmRunStore,
  settleLlmDisposition,
  type GateTransportResult,
  type LlmSafetyLimits,
} from "./llm-execution-gate.js";
import { linkSafetyRuns, linkXPublicationByCid, settleWpRuns, wpArticleFingerprint, wpLlmSafety } from "./wp-article-safety.js";

const limits: LlmSafetyLimits = {
  globalDailyUsd: 100,
  gpt41DailyUsd: 100,
  xWriterDailyUsd: 100,
  logicalCallLimit: 5,
  httpRetryLimit: 2,
  absoluteTickCap: 12,
  wpArticleTickCap: 5,
  staleRequestMs: 60_000,
  rateLimitOpenAfter: 5,
  timeoutOpenAfter: 5,
  serverErrorOpenAfter: 5,
  halfOpenAfterMs: 60_000,
};

const now = new Date("2026-10-09T00:00:00.000Z");

function ok(): GateTransportResult {
  return {
    output: { ok: true },
    model: "gpt-4.1-mini",
    provider: "openai-compatible",
    currency: "USD",
    usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 4, reasoningTokens: null },
  };
}

function call(store: MemoryLlmRunStore, safety: ReturnType<typeof wpLlmSafety> & { tickId?: string; newGenerationBudget?: number }, transport: () => Promise<GateTransportResult>, taskType = "GENERATION_BLOGGER") {
  return executeLlmRun({
    store,
    transport: async () => transport(),
    model: "gpt-4.1-mini",
    taskType,
    promptIdentifier: safety.operation,
    promptVersion: "v1",
    limits,
    now,
    safety,
  });
}

describe("wp article safety", () => {
  it("builds one fingerprint for writer and rewrite without the body", () => {
    const writer = wpArticleFingerprint({ cid: "CID-1", contentIdentity: "CID-1", promptVersion: "blogger-v1" });
    const rewrite = wpLlmSafety({
      cid: "cid-1",
      operation: "WP_REWRITE",
      promptVersion: "blogger-v1",
      contentIdentity: "CID-1",
      logicalAttempt: 2,
    }).artifactFingerprint;
    const review = wpLlmSafety({
      cid: "cid-1",
      operation: "WP_REVIEW",
      promptVersion: "blogger-v1",
      contentIdentity: "CID-1",
    }).artifactFingerprint;
    expect(rewrite).toBe(writer);
    expect(review).toBe(writer);
    expect(wpLlmSafety({ cid: "cid-1", operation: "WP_WRITER", promptVersion: "other", contentIdentity: "CID-1" }).artifactFingerprint).not.toBe(writer);
  });

  it("sends one of two simultaneous article generations and blocks the other", async () => {
    const store = new MemoryLlmRunStore();
    let sends = 0;
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const safety = wpLlmSafety({
      cid: "cid-dup",
      operation: "WP_WRITER",
      promptVersion: "blogger-v1",
      contentIdentity: "cid-dup",
    });
    const first = call(store, safety, async () => {
      sends += 1;
      await hold;
      return ok();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await call(store, safety, async () => {
      sends += 1;
      return ok();
    });
    expect(second.blocked).toBe(true);
    expect(second.blockReason).toBe("BLOCKED_DUPLICATE");
    expect(store.runs.find((run) => run.id === second.runId)?.disposition).toBe("DISCARDED_DUPLICATE");
    release();
    expect((await first).blocked).toBe(false);
    expect(sends).toBe(1);
  });

  it("stops an 80-article tick at the wordpress ceiling", async () => {
    const store = new MemoryLlmRunStore();
    let sends = 0;
    const results = [];
    for (let index = 0; index < 80; index += 1) {
      const safety = {
        ...wpLlmSafety({
          cid: `cid-${index}`,
          operation: "WP_WRITER" as const,
          promptVersion: "blogger-v1",
          contentIdentity: `cid-${index}`,
        }),
        tickId: "wp-tick-80",
        newGenerationBudget: 80,
      };
      results.push(
        await call(store, safety, async () => {
          sends += 1;
          return ok();
        }),
      );
    }
    expect(sends).toBe(5);
    expect(results.filter((row) => !row.blocked)).toHaveLength(5);
    expect(results.filter((row) => row.blockReason === "BLOCKED_TICK_LIMIT")).toHaveLength(75);
    expect(results.filter((row) => row.blocked).every((row) => store.runs.find((run) => run.id === row.runId)?.disposition === "DISCARDED_POLICY")).toBe(true);
  });

  it("stops the writer review rewrite loop at the creative ceiling", async () => {
    const store = new MemoryLlmRunStore();
    bindLlmExecutionStore(store);
    const tight = { ...limits, logicalCallLimit: 3 };
    let creativeSends = 0;
    let reviewSends = 0;
    const writerIds: string[] = [];
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const safety = wpLlmSafety({
        cid: "cid-loop",
        operation: attempt === 1 ? "WP_WRITER" : "WP_REWRITE",
        promptVersion: "blogger-v1",
        contentIdentity: "cid-loop",
        logicalAttempt: attempt,
        regenerateReason: attempt > 1 ? "plan-execution-retry" : null,
      });
      const writer = await executeLlmRun({
        store,
        transport: async () => {
          creativeSends += 1;
          return ok();
        },
        model: "gpt-4.1-mini",
        taskType: "GENERATION_BLOGGER",
        promptVersion: "blogger-v1",
        limits: tight,
        now,
        safety,
      });
      if (writer.blocked) {
        expect(writer.blockReason).toBe("BLOCKED_CALL_LIMIT");
        expect(store.runs.find((run) => run.id === writer.runId)?.disposition).toBe("DISCARDED_POLICY");
        break;
      }
      writerIds.push(writer.runId);
      const reviews = attempt === 1 ? 6 : 1;
      for (let review = 0; review < reviews; review += 1) {
        const result = await executeLlmRun({
          store,
          transport: async () => {
            reviewSends += 1;
            return ok();
          },
          model: "gpt-4.1-mini",
          taskType: "REVIEW",
          promptVersion: "review-v1",
          limits: tight,
          now,
          safety: wpLlmSafety({
            cid: "cid-loop",
            operation: "WP_REVIEW",
            promptVersion: "review-v1",
            contentIdentity: "cid-loop",
            logicalAttempt: review + 1,
          }),
        });
        expect(result.blocked).toBe(false);
      }
      await settleWpRuns(
        [{ id: writer.runId, operation: attempt === 1 ? "WP_WRITER" : "WP_REWRITE", logicalAttempt: attempt }],
        () => "DISCARDED_REVIEW",
        { contentVersionId: "version-loop" },
      );
    }
    expect(creativeSends).toBe(3);
    expect(reviewSends).toBe(8);
    const extra = await executeLlmRun({
      store,
      transport: async () => {
        creativeSends += 1;
        return ok();
      },
      model: "gpt-4.1-mini",
      taskType: "GENERATION_BLOGGER",
      limits: tight,
      now,
      safety: wpLlmSafety({
        cid: "cid-loop",
        operation: "WP_REWRITE",
        promptVersion: "blogger-v1",
        contentIdentity: "cid-loop",
        logicalAttempt: 7,
        regenerateReason: "plan-execution-retry",
      }),
    });
    expect(extra.blocked).toBe(true);
    expect(extra.blockReason).toBe("BLOCKED_CALL_LIMIT");
    expect(creativeSends).toBe(3);
    expect(writerIds.map((id) => store.runs.find((run) => run.id === id)?.disposition)).toEqual([
      "DISCARDED_REVIEW",
      "DISCARDED_REVIEW",
      "DISCARDED_REVIEW",
    ]);
    bindLlmExecutionStore(null);
  });

  it("traces an adopted article to a publication target and a rejected article to review", async () => {
    const store = new MemoryLlmRunStore();
    bindLlmExecutionStore(store);
    const brain = await call(
      store,
      wpLlmSafety({ cid: "cid-adopt", operation: "WP_BRAIN", promptVersion: "brain-v1", contentIdentity: "cid-adopt" }),
      async () => ok(),
    );
    const writer = await call(
      store,
      wpLlmSafety({ cid: "cid-adopt", operation: "WP_WRITER", promptVersion: "blogger-v1", contentIdentity: "cid-adopt" }),
      async () => ok(),
    );
    const review = await call(
      store,
      wpLlmSafety({ cid: "cid-adopt", operation: "WP_REVIEW", promptVersion: "review-v1", contentIdentity: "cid-adopt" }),
      async () => ok(),
      "REVIEW",
    );
    await settleWpRuns(
      [
        { id: brain.runId, operation: "WP_BRAIN", logicalAttempt: 1 },
        { id: writer.runId, operation: "WP_WRITER", logicalAttempt: 1 },
        { id: review.runId, operation: "WP_REVIEW", logicalAttempt: 1 },
      ],
      () => "ADOPTED",
      { contentVersionId: "version-adopt" },
    );
    await linkSafetyRuns(
      [
        { id: brain.runId, operation: "WP_BRAIN", logicalAttempt: 1 },
        { id: writer.runId, operation: "WP_WRITER", logicalAttempt: 1 },
        { id: review.runId, operation: "WP_REVIEW", logicalAttempt: 1 },
      ],
      { contentVersionId: "version-adopt", publicationTargetId: "target-1", publishedExternalId: "wp-post-77" },
    );
    const adopted = store.runs.find((run) => run.id === writer.runId);
    expect(adopted?.canonicalCid).toBe("cid-adopt");
    expect(adopted?.contentVersionId).toBe("version-adopt");
    expect(adopted?.disposition).toBe("ADOPTED");
    expect(adopted?.publicationTargetId).toBe("target-1");
    expect(adopted?.publishedExternalId).toBe("wp-post-77");

    const rejectedStore = new MemoryLlmRunStore();
    bindLlmExecutionStore(rejectedStore);
    const rejected = await call(
      rejectedStore,
      wpLlmSafety({ cid: "cid-reject", operation: "WP_WRITER", promptVersion: "blogger-v1", contentIdentity: "cid-reject" }),
      async () => ok(),
    );
    await settleWpRuns(
      [{ id: rejected.runId, operation: "WP_WRITER", logicalAttempt: 1 }],
      () => "DISCARDED_REVIEW",
      { contentVersionId: "version-reject" },
    );
    expect(rejectedStore.runs[0]?.disposition).toBe("DISCARDED_REVIEW");
    expect(rejectedStore.runs[0]?.contentVersionId).toBe("version-reject");
    expect(rejectedStore.runs[0]?.publicationTargetId).toBeNull();
    bindLlmExecutionStore(null);
  });

  it("links an adopted x run to the publication row and its post id", async () => {
    const store = new MemoryLlmRunStore();
    const safety = {
      channel: "X",
      operation: "GENERATION_X_SOCIAL",
      cid: "cid-x",
      artifactFingerprint: "x-fp",
      attemptKind: "creative" as const,
      logicalAttempt: 1,
      trigger: "scheduler",
      tickId: "x-tick",
      newGenerationBudget: 1,
    };
    const run = await executeLlmRun({
      store,
      transport: async () => ok(),
      model: "gpt-4.1",
      taskType: "GENERATION_X_SOCIAL",
      limits,
      now,
      safety,
    });
    await settleLlmDisposition(store, run.runId, "ADOPTED", { contentVersionId: "x-version" });
    const publication = { id: "xpub-1", rootPostId: "2099196359601770000" };
    await linkXPublicationByCid("cid-x", publication.id, store);
    const row = store.runs.find((item) => item.id === run.runId);
    expect(row?.canonicalCid).toBe("cid-x");
    expect(row?.disposition).toBe("ADOPTED");
    expect(row?.xPublicationId).toBe(publication.id);
    expect(publication.rootPostId).toBe("2099196359601770000");
  });

  it("marks a replaced writer discarded and the replacement adopted", async () => {
    const store = new MemoryLlmRunStore();
    bindLlmExecutionStore(store);
    const first = await call(
      store,
      wpLlmSafety({ cid: "cid-rw", operation: "WP_WRITER", promptVersion: "blogger-v1", contentIdentity: "cid-rw", logicalAttempt: 1 }),
      async () => ok(),
    );
    await settleWpRuns([{ id: first.runId, operation: "WP_WRITER", logicalAttempt: 1 }], () => "DISCARDED_REWRITE");
    const second = await call(
      store,
      wpLlmSafety({
        cid: "cid-rw",
        operation: "WP_REWRITE",
        promptVersion: "blogger-v1",
        contentIdentity: "cid-rw",
        logicalAttempt: 2,
        regenerateReason: "plan-execution-retry",
      }),
      async () => ok(),
    );
    await settleWpRuns(
      [{ id: second.runId, operation: "WP_REWRITE", logicalAttempt: 2 }],
      () => "ADOPTED",
      { contentVersionId: "version-rw" },
    );
    expect(store.runs.find((run) => run.id === first.runId)?.disposition).toBe("DISCARDED_REWRITE");
    expect(store.runs.find((run) => run.id === second.runId)?.disposition).toBe("ADOPTED");
    bindLlmExecutionStore(null);
  });

  it("keeps cost per adopted unavailable when nothing was adopted", () => {
    expect(costPerAdopted(1.25, 0)).toBeNull();
    expect(costPerAdopted(null, 3)).toBeNull();
    expect(costPerAdopted(1.5, 3)).toBe(0.5);
    expect(classifyFactoryAnomaly({
      circuitsOpen: 1,
      stale: 0,
      quotaFailures: 0,
      duplicateBlocks: 0,
      budgetUsedRatio: 0.1,
      discarded: 0,
      adopted: 1,
      retriedCalls: 0,
      calls: 1,
      unknownUsage: 0,
    }).status).toBe("CRITICAL");
    expect(classifyFactoryAnomaly({
      circuitsOpen: 0,
      stale: 0,
      quotaFailures: 0,
      duplicateBlocks: 0,
      budgetUsedRatio: 0.8,
      discarded: 0,
      adopted: 1,
      retriedCalls: 0,
      calls: 1,
      unknownUsage: 0,
    }).status).toBe("WARNING");
    expect(classifyFactoryAnomaly({
      circuitsOpen: 0,
      stale: 0,
      quotaFailures: 0,
      duplicateBlocks: 0,
      budgetUsedRatio: 0.1,
      discarded: 0,
      adopted: 1,
      retriedCalls: 0,
      calls: 1,
      unknownUsage: 0,
    }).status).toBe("NORMAL");
    expect(physicalSizeHealth({ totalBytes: 4_100_000_000, liveRows: 4458, deadRows: 0 })).toBe("PHYSICAL_SIZE_HIGH_AFTER_RETENTION");
  });
});
