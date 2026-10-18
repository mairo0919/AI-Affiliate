import { describe, expect, it } from "vitest";
import { aggregateFactoryControl, presentMetric } from "./factory-control.js";
import {
  executeLlmRun,
  MemoryLlmRunStore,
  recoverStaleRequests,
  settleLlmDisposition,
  type GateTransportResult,
  type LlmSafetyLimits,
} from "./llm-execution-gate.js";

const limits: LlmSafetyLimits = {
  globalMonthlyUsd: 1000,
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

function okResult(): GateTransportResult {
  return {
    output: { body: "posted" },
    model: "gpt-4.1-2025-04-14",
    provider: "openai-compatible",
    currency: "USD",
    usage: { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 40, reasoningTokens: null },
  };
}

function base(store: MemoryLlmRunStore, transport: ExecuteArgs["transport"], extra?: Partial<ExecuteArgs>) {
  return executeLlmRun({
    store,
    transport,
    model: "gpt-4.1",
    taskType: "GENERATION_X_SOCIAL",
    promptIdentifier: "x.social.generate",
    promptVersion: "v3",
    limits,
    now,
    safety: {
      channel: "X",
      operation: "GENERATION_X_SOCIAL",
      trigger: "probe",
      cid: "cid-1",
      artifactFingerprint: "fp-1",
      tickId: "tick-1",
      newGenerationBudget: 4,
    },
    ...extra,
  });
}

type ExecuteArgs = Parameters<typeof executeLlmRun>[0];

describe("llm execution gate", () => {
  it("persists PLANNED then REQUESTED before the transport", async () => {
    const store = new MemoryLlmRunStore();
    const seen: string[] = [];
    await base(store, async () => {
      const row = store.runs[0];
      seen.push(row?.executionStatus ?? "missing");
      expect(row?.requestedAt).toBeTruthy();
      return okResult();
    });
    expect(seen).toEqual(["REQUESTED"]);
    expect(store.runs[0]?.executionStatus).toBe("SUCCEEDED");
    expect(store.runs[0]?.inputTokens).toBe(1000);
    expect(store.runs[0]?.cachedTokens).toBe(100);
    expect(store.runs[0]?.modelActual).toBe("gpt-4.1-2025-04-14");
    expect(store.runs[0]?.modelRequested).toBe("gpt-4.1");
    expect(store.runs[0]?.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("keeps unknown usage null instead of zero", async () => {
    const store = new MemoryLlmRunStore();
    await base(store, async () => ({ ...okResult(), usage: null }));
    expect(store.runs[0]?.usageKnown).toBe(false);
    expect(store.runs[0]?.inputTokens).toBeNull();
    expect(store.runs[0]?.outputTokens).toBeNull();
    expect(store.runs[0]?.estimatedCostUsd).toBeNull();
  });

  it("records failure and does not retry quota exhaustion", async () => {
    const store = new MemoryLlmRunStore();
    let calls = 0;
    await expect(
      base(store, async () => {
        calls += 1;
        const error = new Error("quota") as Error & { failureClass: string; retryable: boolean };
        error.failureClass = "INSUFFICIENT_QUOTA";
        error.retryable = false;
        throw error;
      }),
    ).rejects.toThrow(/quota/);
    expect(calls).toBe(1);
    expect(store.runs[0]?.executionStatus).toBe("FAILED");
    expect(store.runs[0]?.errorCode).toBe("INSUFFICIENT_QUOTA");
    expect(store.circuits.find((row) => row.scopeType === "MODEL")?.state).toBe("OPEN");
    const again = await base(store, async () => {
      calls += 1;
      return okResult();
    });
    expect(again.blocked).toBe(true);
    expect(again.blockReason).toContain("CIRCUIT_OPEN");
    expect(calls).toBe(1);
  });

  it("bounds temporary retries and still records the run", async () => {
    const store = new MemoryLlmRunStore();
    let calls = 0;
    await base(
      store,
      async () => {
        calls += 1;
        if (calls === 1) {
          const error = new Error("slow") as Error & { failureClass: string; retryable: boolean };
          error.failureClass = "RATE_LIMIT";
          error.retryable = true;
          throw error;
        }
        return okResult();
      },
      { limits: { ...limits, httpRetryLimit: 2 } },
    );
    expect(calls).toBe(2);
    expect(store.runs.filter((run) => run.executionStatus === "SUCCEEDED")).toHaveLength(1);
    expect(store.runs[0]?.httpAttempt).toBe(2);
    expect(store.runs[0]?.attemptKind).toBe("creative");
  });

  it("blocks a second send while the same fingerprint is in flight", async () => {
    const store = new MemoryLlmRunStore();
    let calls = 0;
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = base(store, async () => {
      calls += 1;
      await hold;
      return okResult();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await base(store, async () => {
      calls += 1;
      return okResult();
    });
    expect(second.blocked).toBe(true);
    expect(second.blockReason).toBe("BLOCKED_DUPLICATE");
    release();
    const done = await first;
    expect(done.blocked).toBe(false);
    expect(calls).toBe(1);
  });

  it("blocks a new send after a crash leaves a stale request", async () => {
    const store = new MemoryLlmRunStore();
    let calls = 0;
    let finish: (result: GateTransportResult) => void = () => undefined;
    const hung = base(store, () => new Promise((resolve) => {
      finish = resolve;
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.runs[0]?.executionStatus).toBe("REQUESTED");
    const stale = await recoverStaleRequests(store, new Date(now.getTime() + 120_000), limits.staleRequestMs);
    expect(stale).toHaveLength(1);
    expect(store.runs[0]?.executionStatus).toBe("STALE_REQUEST");
    const second = await base(store, async () => {
      calls += 1;
      return okResult();
    });
    expect(second.blockReason).toBe("BLOCKED_STALE");
    expect(calls).toBe(0);
    finish(okResult());
    const late = await hung;
    expect(late.blockReason).toBe("STALE_REQUEST");
    expect(store.runs[0]?.executionStatus).toBe("STALE_REQUEST");
  });

  it("blocks duplicate fingerprint after ADOPTED and rejected fingerprint without a reason", async () => {
    const store = new MemoryLlmRunStore();
    const first = await base(store, async () => okResult());
    await settleLlmDisposition(store, first.runId, "ADOPTED");
    const duplicate = await base(store, async () => okResult());
    expect(duplicate.blockReason).toBe("BLOCKED_DUPLICATE");

    const store2 = new MemoryLlmRunStore();
    const rejected = await base(store2, async () => okResult(), {
      safety: { channel: "X", artifactFingerprint: "fp-r", tickId: "t", newGenerationBudget: 4 },
    });
    await settleLlmDisposition(store2, rejected.runId, "DISCARDED_REVIEW");
    const again = await base(store2, async () => okResult(), {
      safety: { channel: "X", artifactFingerprint: "fp-r", tickId: "t2", newGenerationBudget: 4 },
    });
    expect(again.blockReason).toBe("BLOCKED_REJECTED_FINGERPRINT");
  });

  it("enforces per-artifact and per-tick ceilings", async () => {
    const store = new MemoryLlmRunStore();
    await base(store, async () => okResult(), { limits: { ...limits, logicalCallLimit: 1 } });
    const limited = await base(store, async () => okResult(), {
      limits: { ...limits, logicalCallLimit: 1 },
      safety: { channel: "X", artifactFingerprint: "fp-1", tickId: "tick-2", newGenerationBudget: 4 },
    });
    expect(limited.blockReason).toBe("BLOCKED_CALL_LIMIT");

    const ticks = new MemoryLlmRunStore();
    await base(ticks, async () => okResult(), {
      safety: { channel: "X", artifactFingerprint: "a", tickId: "same", newGenerationBudget: 1 },
    });
    const tickBlocked = await base(ticks, async () => okResult(), {
      safety: { channel: "X", artifactFingerprint: "b", tickId: "same", newGenerationBudget: 1 },
    });
    expect(tickBlocked.blockReason).toBe("BLOCKED_TICK_LIMIT");
  });

  it("stops sending once reserved plus spent reach the daily budget", async () => {
    const store = new MemoryLlmRunStore();
    let calls = 0;
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tight = { ...limits, globalDailyUsd: 0.05, gpt41DailyUsd: 100, xWriterDailyUsd: 100 };
    const first = base(
      store,
      async () => {
        calls += 1;
        await hold;
        return okResult();
      },
      { limits: tight, safety: { channel: "X", artifactFingerprint: "budget-a", tickId: "tb", newGenerationBudget: 4 } },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await base(
      store,
      async () => {
        calls += 1;
        return okResult();
      },
      { limits: tight, safety: { channel: "X", artifactFingerprint: "budget-b", tickId: "tb", newGenerationBudget: 4 } },
    );
    expect(second.blockReason).toBe("BLOCKED_BUDGET");
    expect(calls).toBe(1);
    release();
    await first;
  });

  it("clamps an 80-candidate tick and blocks after the daily estimate is spent", async () => {
    const ticks = new MemoryLlmRunStore();
    const cap = { ...limits, absoluteTickCap: 2 };
    await base(ticks, async () => okResult(), {
      limits: cap,
      safety: { channel: "X", artifactFingerprint: "cap-a", tickId: "probe", newGenerationBudget: 80 },
    });
    await base(ticks, async () => okResult(), {
      limits: cap,
      safety: { channel: "X", artifactFingerprint: "cap-b", tickId: "probe", newGenerationBudget: 80 },
    });
    const third = await base(ticks, async () => okResult(), {
      limits: cap,
      safety: { channel: "X", artifactFingerprint: "cap-c", tickId: "probe", newGenerationBudget: 80 },
    });
    expect(third.blockReason).toBe("BLOCKED_TICK_LIMIT");

    const costs = new MemoryLlmRunStore();
    const tight = { ...limits, globalDailyUsd: 0.01, gpt41DailyUsd: 100, xWriterDailyUsd: 100 };
    const expensive = {
      ...okResult(),
      usage: { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000, reasoningTokens: null },
    };
    await base(costs, async () => expensive, {
      limits: tight,
      safety: { channel: "X", artifactFingerprint: "cost-a", tickId: "cost", newGenerationBudget: 4 },
    });
    const over = await base(costs, async () => okResult(), {
      limits: tight,
      safety: { channel: "X", artifactFingerprint: "cost-b", tickId: "cost-2", newGenerationBudget: 4 },
    });
    expect(over.blockReason).toBe("BLOCKED_BUDGET");
  });

  it("blocks once the calendar month's spend is used, even on a fresh day, and resets next month", async () => {
    const store = new MemoryLlmRunStore();
    const monthly = { ...limits, globalMonthlyUsd: 2.03 };
    const expensive = {
      ...okResult(),
      usage: { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000, reasoningTokens: null },
    };
    await base(store, async () => expensive, {
      limits: monthly,
      now: new Date("2026-10-02T00:00:00.000Z"),
      safety: { channel: "X", artifactFingerprint: "month-a", tickId: "m1", newGenerationBudget: 4 },
    });
    const sameMonth = await base(store, async () => okResult(), {
      limits: monthly,
      now: new Date("2026-10-20T00:00:00.000Z"),
      safety: { channel: "X", artifactFingerprint: "month-b", tickId: "m2", newGenerationBudget: 4 },
    });
    expect(sameMonth.blockReason).toBe("BLOCKED_MONTHLY_BUDGET");
    const nextMonth = await base(store, async () => okResult(), {
      limits: monthly,
      now: new Date("2026-11-01T00:00:00.000Z"),
      safety: { channel: "X", artifactFingerprint: "month-c", tickId: "m3", newGenerationBudget: 4 },
    });
    expect(nextMonth.blocked).toBe(false);
  });

  it("aggregates adopted and discarded runs and does not zero unknown metrics", async () => {
    const store = new MemoryLlmRunStore();
    const adopted = await base(store, async () => okResult());
    await settleLlmDisposition(store, adopted.runId, "ADOPTED");
    const discarded = await base(store, async () => okResult(), {
      safety: { channel: "X", artifactFingerprint: "other", tickId: "tick-9", newGenerationBudget: 4 },
    });
    await settleLlmDisposition(store, discarded.runId, "DISCARDED_REVIEW");
    const overview = aggregateFactoryControl({
      runs: store.runs,
      circuits: [],
      now,
      range: "today",
      outputs: { wpGenerated: 1, wpPublished: 0, xGenerated: 2, xPublished: 0, xScheduled: 0, xBlocked: 0 },
    });
    expect(overview.adopted).toBe(1);
    expect(overview.discarded).toBe(1);
    expect(overview.estimatedCostUsd).not.toBeNull();
    expect(overview.learningConnectedToBrain).toBe(false);
    expect(overview.railwayBilling).toBe("EXTERNAL_BILLING_NOT_CONNECTED");
    expect(presentMetric(null, false)).toEqual({ status: "NOT_COLLECTED", value: null });
    expect(presentMetric(0, true)).toEqual({ status: "AVAILABLE", value: 0 });
  });
});
