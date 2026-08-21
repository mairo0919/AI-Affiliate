import type { AppConfig } from "@ai-affiliate/config";
import type { XLiveRepository } from "@ai-affiliate/database";
import type { XApiHttpClient } from "./x-api-http-client.js";

export type UsageBillingClass = "write" | "read" | "analytics" | "free";

export interface XApiUsageServiceDeps {
  config: AppConfig;
  live: XLiveRepository;
  http?: XApiHttpClient;
  now?: () => Date;
  notifications?: {
    emitXEvent?: (
      eventType: "X_API_USAGE_SYNC_FAILED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
}

export class XApiUsageService {
  private readonly now: () => Date;
  private lastSyncAt: Date | null = null;

  constructor(private readonly deps: XApiUsageServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  estimateCost(billingClass: UsageBillingClass, units = 1): number | null {
    const cfg = this.deps.config;
    if (billingClass === "free") return 0;
    if (billingClass === "write") {
      return cfg.xApiWriteCostPerRequest == null
        ? null
        : cfg.xApiWriteCostPerRequest * units;
    }
    if (billingClass === "analytics") {
      return cfg.xApiAnalyticsCostPerRequest == null
        ? null
        : cfg.xApiAnalyticsCostPerRequest * units;
    }
    return cfg.xApiReadCostPerResource == null
      ? null
      : cfg.xApiReadCostPerResource * units;
  }

  async buildLocalEstimateSnapshot(accountId?: string | null) {
    const periodStart = startOfUtcDay(this.now());
    const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
    const sinceSum = await this.deps.live.sumEstimatedCostSince(periodStart, accountId);
    const writeCost = this.estimateCost("write") ?? 0;
    const readCost = this.estimateCost("read") ?? 0;
    // Counts approximated from logs: store estimated cost only; counts as 0 when unknown.
    return this.deps.live.createUsageSnapshot({
      accountId,
      periodStart,
      periodEnd,
      writeRequestCount: 0,
      readRequestCount: 0,
      resourceReadCount: 0,
      analyticsRequestCount: 0,
      estimatedCost: sinceSum.estimatedCost || writeCost * 0 + readCost * 0,
      reportedCost: null,
      currency: this.deps.config.xApiCostCurrency,
      source: "LOCAL_ESTIMATE",
      capturedAt: this.now(),
    });
  }

  async recordManualUsage(input: {
    accountId?: string | null;
    reportedCost: number;
    estimatedCost?: number | null;
    currency?: string;
    periodStart?: Date;
    periodEnd?: Date;
    source?: "MANUAL" | "DEVELOPER_CONSOLE";
  }) {
    const periodStart = input.periodStart ?? startOfUtcDay(this.now());
    const periodEnd =
      input.periodEnd ?? new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
    return this.deps.live.createUsageSnapshot({
      accountId: input.accountId,
      periodStart,
      periodEnd,
      writeRequestCount: 0,
      readRequestCount: 0,
      resourceReadCount: 0,
      analyticsRequestCount: 0,
      estimatedCost: input.estimatedCost ?? null,
      reportedCost: input.reportedCost,
      currency: input.currency ?? this.deps.config.xApiCostCurrency,
      source: input.source ?? "MANUAL",
      capturedAt: this.now(),
    });
  }

  async syncOfficialUsage(accountId?: string | null): Promise<{
    synced: boolean;
    skipped?: string;
    reportedCost?: number | null;
    estimatedCost?: number | null;
    delta?: number | null;
  }> {
    if (!this.deps.config.xApiUsageSyncEnabled) {
      return { synced: false, skipped: "USAGE_SYNC_DISABLED" };
    }
    const minInterval =
      this.deps.config.xApiUsageSyncMinIntervalMinutes * 60_000;
    if (
      this.lastSyncAt &&
      this.now().getTime() - this.lastSyncAt.getTime() < minInterval
    ) {
      return { synced: false, skipped: "MIN_INTERVAL" };
    }

    const local = await this.deps.live.sumEstimatedCostSince(
      startOfUtcDay(this.now()),
      accountId,
    );

    let reportedCost: number | null = null;
    if (this.deps.http) {
      try {
        // Usage API endpoint varies by plan; attempt and fall back to local.
        const response = await this.deps.http.request<{
          data?: { usage?: Array<{ amount?: number }> };
          amount?: number;
        }>({
          method: "GET",
          path: "/2/usage/tweets",
          endpointKey: "usage.get",
          requestType: "USAGE_SYNC",
          accountId,
          disableRetry: true,
          estimatedCost: this.estimateCost("read"),
          billingUnit: "read",
        });
        reportedCost =
          response.data?.amount ??
          response.data?.data?.usage?.[0]?.amount ??
          null;
      } catch {
        await this.deps.notifications?.emitXEvent?.("X_API_USAGE_SYNC_FAILED", {
          accountId,
        });
        const snap = await this.deps.live.createUsageSnapshot({
          accountId,
          periodStart: startOfUtcDay(this.now()),
          periodEnd: new Date(startOfUtcDay(this.now()).getTime() + 86400000),
          writeRequestCount: 0,
          readRequestCount: 0,
          resourceReadCount: 0,
          analyticsRequestCount: 0,
          estimatedCost: local.estimatedCost,
          reportedCost: null,
          currency: this.deps.config.xApiCostCurrency,
          source: "LOCAL_ESTIMATE",
          capturedAt: this.now(),
        });
        this.lastSyncAt = this.now();
        return {
          synced: true,
          reportedCost: null,
          estimatedCost: snap.estimatedCost,
          delta: null,
        };
      }
    }

    const snap = await this.deps.live.createUsageSnapshot({
      accountId,
      periodStart: startOfUtcDay(this.now()),
      periodEnd: new Date(startOfUtcDay(this.now()).getTime() + 86400000),
      writeRequestCount: 0,
      readRequestCount: 0,
      resourceReadCount: 0,
      analyticsRequestCount: 0,
      estimatedCost: local.estimatedCost,
      reportedCost,
      currency: this.deps.config.xApiCostCurrency,
      source: reportedCost != null ? "X_USAGE_API" : "LOCAL_ESTIMATE",
      capturedAt: this.now(),
    });
    this.lastSyncAt = this.now();
    const delta =
      reportedCost != null && snap.estimatedCost != null
        ? reportedCost - snap.estimatedCost
        : null;
    return {
      synced: true,
      reportedCost,
      estimatedCost: snap.estimatedCost,
      delta,
    };
  }

  async status(accountId?: string | null) {
    const latest = await this.deps.live.latestUsageSnapshot(accountId);
    const local = await this.deps.live.sumEstimatedCostSince(
      startOfUtcDay(this.now()),
      accountId,
    );
    const reported = latest?.reportedCost ?? null;
    const estimated = latest?.estimatedCost ?? local.estimatedCost;
    return {
      currency: this.deps.config.xApiCostCurrency,
      estimatedCost: estimated,
      reportedCost: reported,
      /** Prefer reported for display of billing; never treat estimate as invoice. */
      preferredCost: reported ?? null,
      preferredLabel: reported != null ? "reported" : "estimate_only",
      delta: reported != null && estimated != null ? reported - estimated : null,
      latestSource: latest?.source ?? null,
      capturedAt: latest?.capturedAt ?? null,
    };
  }
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
