import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRawDataAfterStockFailure,
  buildRawDataAfterStockSuccess,
  isStockAttemptEligibleNow,
  readStockAttemptLedger,
  STOCK_ATTEMPT_RAW_KEY,
} from "./stock-attempt-ledger.js";
import { computeFutureReserveBudget, loadStockRuntimeConfig } from "./stock-config.js";

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walkTsFiles(p, out);
      continue;
    }
    if (!name.endsWith(".ts")) continue;
    if (name.endsWith(".test.ts") || name.endsWith(".spec.ts")) continue;
    out.push(p);
  }
  return out;
}

describe("ResearchItem retention policy", () => {
  it("production source never calls researchItem.delete / deleteMany", () => {
    const root = join(__dirname, "..");
    const files = walkTsFiles(root);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/researchItem\s*\.\s*delete(Many)?\s*\(/.test(text)) {
        offenders.push(file);
      }
      if (/DELETE\s+FROM\s+"?ResearchItem"?/i.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps ResearchItem ledger after generation success (no delete semantics)", () => {
    const { rawData, ledger } = buildRawDataAfterStockSuccess({
      rawData: { externalPayload: { keep: true } },
      now: new Date("2026-09-12T00:00:00.000Z"),
    });
    expect(rawData.externalPayload).toEqual({ keep: true });
    expect(ledger.status).toBe("COMPLETED");
    expect(rawData[STOCK_ATTEMPT_RAW_KEY]).toMatchObject({ status: "COMPLETED" });
  });

  it("keeps ResearchItem ledger after generation failure and allows retry", () => {
    const first = buildRawDataAfterStockFailure({
      rawData: { cid: "ssis00123" },
      reason: "LLM timeout",
      now: new Date("2026-09-12T00:00:00.000Z"),
      maxAttempts: 5,
      backoffMs: 60_000,
    });
    expect(first.rawData.cid).toBe("ssis00123");
    expect(first.ledger.attemptCount).toBe(1);
    expect(first.ledger.status).toBe("RETRY_DEFERRED");
    expect(first.ledger.lastFailureCode).toBe("PROVIDER_TEMPORARY");
    expect(isStockAttemptEligibleNow(first.ledger, new Date("2026-09-12T00:00:30.000Z"))).toBe(
      false,
    );
    expect(isStockAttemptEligibleNow(first.ledger, new Date("2026-09-12T00:02:00.000Z"))).toBe(
      true,
    );
  });

  it("keeps ResearchItem after review failure", () => {
    const { ledger, rawData } = buildRawDataAfterStockFailure({
      rawData: {},
      reason: "AUTO_REVIEW_FAILED: quality gate",
      now: new Date("2026-09-12T00:00:00.000Z"),
    });
    expect(rawData[STOCK_ATTEMPT_RAW_KEY]).toBeTruthy();
    expect(ledger.lastFailureCode).toBe("REVIEW_OR_WRITER");
    expect(ledger.status).not.toBe("COMPLETED");
  });

  it("does not delete on duplicate / policy block — marks MANUAL_REVIEW_REQUIRED after max", () => {
    let raw: unknown = { keep: 1 };
    for (let i = 0; i < 5; i++) {
      const next = buildRawDataAfterStockFailure({
        rawData: raw,
        reason: "AFFILIATE_URL_INVALID",
        now: new Date(`2026-09-12T0${i}:00:00.000Z`),
        maxAttempts: 5,
      });
      raw = next.rawData;
      expect((raw as { keep: number }).keep).toBe(1);
    }
    const ledger = readStockAttemptLedger(raw);
    expect(ledger.attemptCount).toBe(5);
    expect(ledger.status).toBe("MANUAL_REVIEW_REQUIRED");
    expect(isStockAttemptEligibleNow(ledger)).toBe(false);
  });

  it("never deletes ResearchItem after retry ceiling — uses NEEDS_ENRICHMENT / RETRY_DEFERRED", () => {
    let raw: unknown = { asset: true };
    for (let i = 0; i < 5; i++) {
      raw = buildRawDataAfterStockFailure({
        rawData: raw,
        reason: "EVIDENCE missing for claims",
        now: new Date(`2026-09-12T0${i}:00:00.000Z`),
        maxAttempts: 5,
        backoffMs: 1,
      }).rawData;
    }
    const ledger = readStockAttemptLedger(raw);
    expect((raw as { asset: boolean }).asset).toBe(true);
    expect(ledger.status).toBe("NEEDS_ENRICHMENT");
    expect(ledger.attemptCount).toBe(5);
  });
});

describe("future inventory hard band", () => {
  it("defaults target=45 min=30 and tick max=3", () => {
    const cfg = loadStockRuntimeConfig({});
    expect(cfg.futureTargetPosts).toBe(45);
    expect(cfg.futureMinPosts).toBe(30);
    expect(cfg.scheduleMaxPerTick).toBe(3);
    expect(cfg.generationBatch).toBe(3);
    expect(cfg.maxGenerationsPerDay).toBe(48);
  });

  it("stops reserving at/above target", () => {
    expect(
      computeFutureReserveBudget({
        currentFutureCount: 45,
        futureMinPosts: 30,
        futureTargetPosts: 45,
        scheduleMaxPerTick: 3,
      }),
    ).toMatchObject({ allow: false, budget: 0, reason: "FUTURE_AT_OR_ABOVE_TARGET" });
  });

  it("replenishes toward target in batches of scheduleMaxPerTick when below min", () => {
    expect(
      computeFutureReserveBudget({
        currentFutureCount: 16,
        futureMinPosts: 30,
        futureTargetPosts: 45,
        scheduleMaxPerTick: 3,
      }),
    ).toMatchObject({ allow: true, budget: 3 });
  });

  it("climbs from mid-band toward target without bursting", () => {
    expect(
      computeFutureReserveBudget({
        currentFutureCount: 40,
        futureMinPosts: 30,
        futureTargetPosts: 45,
        scheduleMaxPerTick: 3,
      }),
    ).toMatchObject({ allow: true, budget: 3 });
    expect(
      computeFutureReserveBudget({
        currentFutureCount: 44,
        futureMinPosts: 30,
        futureTargetPosts: 45,
        scheduleMaxPerTick: 3,
      }),
    ).toMatchObject({ allow: true, budget: 1 });
  });
});
