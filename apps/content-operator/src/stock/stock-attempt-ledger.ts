/**
 * Stock generation attempt ledger — stored on ResearchItem.rawData without deleting the item.
 * ResearchItem is a retained source asset; failures only update this ledger.
 */

export const STOCK_ATTEMPT_RAW_KEY = "_factoryStockAttempts" as const;

export type StockAttemptStatus =
  | "ACTIVE"
  | "RETRY_DEFERRED"
  | "NEEDS_ENRICHMENT"
  | "MANUAL_REVIEW_REQUIRED"
  | "COMPLETED";

export type StockAttemptLedger = {
  attemptCount: number;
  lastAttemptAt: string | null;
  lastFailureCode: string | null;
  lastFailureDetail: string | null;
  nextRetryAt: string | null;
  status: StockAttemptStatus;
};

export const DEFAULT_STOCK_MAX_ATTEMPTS_BEFORE_DEFER = 5;
export const DEFAULT_STOCK_RETRY_BACKOFF_MS = 30 * 60_000;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function sanitizeDetail(raw: string, max = 160): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

export function readStockAttemptLedger(rawData: unknown): StockAttemptLedger {
  const root = asRecord(rawData);
  const ledger = asRecord(root[STOCK_ATTEMPT_RAW_KEY]);
  const attemptCount = Number(ledger.attemptCount);
  const statusRaw = typeof ledger.status === "string" ? ledger.status : "ACTIVE";
  const status = (
    [
      "ACTIVE",
      "RETRY_DEFERRED",
      "NEEDS_ENRICHMENT",
      "MANUAL_REVIEW_REQUIRED",
      "COMPLETED",
    ] as const
  ).includes(statusRaw as StockAttemptStatus)
    ? (statusRaw as StockAttemptStatus)
    : "ACTIVE";
  return {
    attemptCount: Number.isFinite(attemptCount) && attemptCount > 0 ? Math.floor(attemptCount) : 0,
    lastAttemptAt: typeof ledger.lastAttemptAt === "string" ? ledger.lastAttemptAt : null,
    lastFailureCode: typeof ledger.lastFailureCode === "string" ? ledger.lastFailureCode : null,
    lastFailureDetail:
      typeof ledger.lastFailureDetail === "string" ? ledger.lastFailureDetail : null,
    nextRetryAt: typeof ledger.nextRetryAt === "string" ? ledger.nextRetryAt : null,
    status,
  };
}

export function classifyStockFailureCode(reason: string): {
  code: string;
  statusAfterMax: StockAttemptStatus;
  retryable: boolean;
} {
  const r = reason.toUpperCase();
  if (/TIMEOUT|ECONNRESET|EAI_AGAIN|429|RATE.?LIMIT|TEMPORAR/.test(r)) {
    return { code: "PROVIDER_TEMPORARY", statusAfterMax: "RETRY_DEFERRED", retryable: true };
  }
  if (/EVIDENCE|CLAIM|SOURCE.?MISSING|ENRICH/.test(r)) {
    return { code: "NEEDS_ENRICHMENT", statusAfterMax: "NEEDS_ENRICHMENT", retryable: true };
  }
  if (/IMAGE|PUBLIC_ELIGIBILITY|RIGHTS/.test(r)) {
    return { code: "IMAGE_GATE", statusAfterMax: "NEEDS_ENRICHMENT", retryable: true };
  }
  if (/AUTO_REVIEW_FAILED|REVIEW|VALIDATOR|WRITER|QUALITY/.test(r)) {
    return { code: "REVIEW_OR_WRITER", statusAfterMax: "RETRY_DEFERRED", retryable: true };
  }
  if (/AFFILIATE_URL_INVALID|BLOG_BLOCKED|DUPLICATE/.test(r)) {
    return { code: "POLICY_BLOCK", statusAfterMax: "MANUAL_REVIEW_REQUIRED", retryable: false };
  }
  return { code: "GENERATION_FAILED", statusAfterMax: "RETRY_DEFERRED", retryable: true };
}

/** True when stock generation may try this ResearchItem now. Never implies deletion. */
export function isStockAttemptEligibleNow(
  ledger: StockAttemptLedger,
  now: Date = new Date(),
): boolean {
  if (ledger.status === "COMPLETED" || ledger.status === "MANUAL_REVIEW_REQUIRED") {
    return false;
  }
  if (ledger.status === "NEEDS_ENRICHMENT") {
    // Enrichment may unlock later; allow retry after nextRetryAt (or immediately if unset).
    if (ledger.nextRetryAt) {
      const t = Date.parse(ledger.nextRetryAt);
      if (Number.isFinite(t) && t > now.getTime()) return false;
    }
    return true;
  }
  if (ledger.nextRetryAt) {
    const t = Date.parse(ledger.nextRetryAt);
    if (Number.isFinite(t) && t > now.getTime()) return false;
  }
  return true;
}

export function buildRawDataAfterStockFailure(input: {
  rawData: unknown;
  reason: string;
  now?: Date;
  maxAttempts?: number;
  backoffMs?: number;
}): { rawData: Record<string, unknown>; ledger: StockAttemptLedger } {
  const now = input.now ?? new Date();
  const maxAttempts = input.maxAttempts ?? DEFAULT_STOCK_MAX_ATTEMPTS_BEFORE_DEFER;
  const backoffMs = input.backoffMs ?? DEFAULT_STOCK_RETRY_BACKOFF_MS;
  const prev = readStockAttemptLedger(input.rawData);
  const classified = classifyStockFailureCode(input.reason);
  const attemptCount = prev.attemptCount + 1;
  const hitMax = attemptCount >= maxAttempts;
  const status: StockAttemptStatus = hitMax
    ? classified.statusAfterMax
    : classified.retryable
      ? "RETRY_DEFERRED"
      : "MANUAL_REVIEW_REQUIRED";
  const nextRetryAt =
    status === "MANUAL_REVIEW_REQUIRED"
      ? null
      : new Date(now.getTime() + backoffMs * Math.min(attemptCount, 8)).toISOString();
  const ledger: StockAttemptLedger = {
    attemptCount,
    lastAttemptAt: now.toISOString(),
    lastFailureCode: classified.code,
    lastFailureDetail: sanitizeDetail(input.reason),
    nextRetryAt,
    status,
  };
  const root = asRecord(input.rawData);
  return {
    rawData: { ...root, [STOCK_ATTEMPT_RAW_KEY]: ledger },
    ledger,
  };
}

export function buildRawDataAfterStockSuccess(input: {
  rawData: unknown;
  now?: Date;
}): { rawData: Record<string, unknown>; ledger: StockAttemptLedger } {
  const now = input.now ?? new Date();
  const prev = readStockAttemptLedger(input.rawData);
  const ledger: StockAttemptLedger = {
    attemptCount: prev.attemptCount + 1,
    lastAttemptAt: now.toISOString(),
    lastFailureCode: null,
    lastFailureDetail: null,
    nextRetryAt: null,
    status: "COMPLETED",
  };
  const root = asRecord(input.rawData);
  return {
    rawData: { ...root, [STOCK_ATTEMPT_RAW_KEY]: ledger },
    ledger,
  };
}
