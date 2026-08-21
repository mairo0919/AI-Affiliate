import type { AppConfig } from "@ai-affiliate/config";
import type { XLiveRepository } from "@ai-affiliate/database";
import type { XApiBudgetPeriodType, XApiBudgetStatus } from "@ai-affiliate/database";
import type { XApiUsageService } from "./usage-service.js";

export interface BudgetCheckResult {
  allowed: boolean;
  paused: boolean;
  softReached: boolean;
  hardReached: boolean;
  reason?: string;
  dailyStatus?: XApiBudgetStatus;
  monthlyStatus?: XApiBudgetStatus;
  currentUsage: number;
  /** Prefer reported when present. */
  usageSource: "reported" | "estimated" | "unknown";
}

export interface XApiBudgetServiceDeps {
  config: AppConfig;
  live: XLiveRepository;
  usage: XApiUsageService;
  now?: () => Date;
  notifications?: {
    emitXEvent?: (
      eventType: "X_API_SOFT_BUDGET_REACHED" | "X_API_HARD_BUDGET_REACHED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
}

export class XApiBudgetService {
  private readonly now: () => Date;

  constructor(private readonly deps: XApiBudgetServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  periodBounds(periodType: XApiBudgetPeriodType, now = this.now()): {
    start: Date;
    end: Date;
  } {
    if (periodType === "DAILY") {
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      return { start, end: new Date(start.getTime() + 86400000) };
    }
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start, end };
  }

  async ensurePeriodBudgets(accountId?: string | null) {
    const cfg = this.deps.config;
    for (const periodType of ["DAILY", "MONTHLY"] as const) {
      const bounds = this.periodBounds(periodType);
      const existing = await this.deps.live.findBudget(accountId ?? null, periodType);
      const softLimit =
        periodType === "DAILY"
          ? cfg.xApiDailySoftBudgetUsd
          : cfg.xApiMonthlySoftBudgetUsd;
      const hardLimit =
        periodType === "DAILY"
          ? cfg.xApiDailyHardBudgetUsd
          : cfg.xApiMonthlyHardBudgetUsd;

      if (existing && existing.periodStartedAt.getTime() === bounds.start.getTime()) {
        // Keep PAUSED reason; still sync limit numbers from current config.
        if (
          existing.softLimit !== softLimit ||
          existing.hardLimit !== hardLimit
        ) {
          await this.deps.live.upsertBudget({
            ...existing,
            softLimit,
            hardLimit,
            currentEstimatedUsage: existing.currentEstimatedUsage,
          });
        }
        continue;
      }

      await this.deps.live.upsertBudget({
        accountId: accountId ?? null,
        periodType,
        softLimit,
        hardLimit,
        currentEstimatedUsage: 0,
        currentReportedUsage: null,
        currency: cfg.xApiCostCurrency,
        status: "ACTIVE",
        periodStartedAt: bounds.start,
        periodEndsAt: bounds.end,
      });
    }
  }

  async refreshUsage(accountId?: string | null): Promise<BudgetCheckResult> {
    await this.ensurePeriodBudgets(accountId);
    const usageStatus = await this.deps.usage.status(accountId);
    const dailyBounds = this.periodBounds("DAILY");
    const local = await this.deps.live.sumEstimatedCostSince(
      dailyBounds.start,
      accountId,
    );

    let usageSource: BudgetCheckResult["usageSource"] = "estimated";
    let currentUsage = local.estimatedCost;
    if (usageStatus.reportedCost != null) {
      currentUsage = usageStatus.reportedCost;
      usageSource = "reported";
    } else if (
      this.deps.config.xApiWriteCostPerRequest == null &&
      this.deps.config.xApiReadCostPerResource == null &&
      this.deps.config.xApiAnalyticsCostPerRequest == null
    ) {
      usageSource = "unknown";
    }

    const daily = await this.updatePeriod(
      accountId ?? null,
      "DAILY",
      currentUsage,
      usageStatus.reportedCost,
    );
    const monthly = await this.updatePeriod(
      accountId ?? null,
      "MONTHLY",
      currentUsage,
      usageStatus.reportedCost,
    );

    if (usageSource === "unknown") {
      const behavior = this.deps.config.xApiUnknownCostBehavior;
      if (behavior === "BLOCK") {
        return {
          allowed: false,
          paused: true,
          softReached: false,
          hardReached: false,
          reason: "API_BUDGET_UNKNOWN_COST",
          dailyStatus: daily.status,
          monthlyStatus: monthly.status,
          currentUsage,
          usageSource,
        };
      }
    }

    const hardReached =
      daily.status === "HARD_LIMIT_REACHED" ||
      monthly.status === "HARD_LIMIT_REACHED" ||
      daily.status === "PAUSED" ||
      monthly.status === "PAUSED";
    const softReached =
      daily.status === "SOFT_LIMIT_REACHED" ||
      monthly.status === "SOFT_LIMIT_REACHED";

    return {
      allowed: !hardReached,
      paused: hardReached,
      softReached,
      hardReached,
      reason: hardReached ? "API_BUDGET_PAUSED" : softReached ? "SOFT_LIMIT" : undefined,
      dailyStatus: daily.status,
      monthlyStatus: monthly.status,
      currentUsage,
      usageSource,
    };
  }

  async checkPaidRequest(
    accountId?: string | null,
    estimatedCost?: number | null,
  ): Promise<BudgetCheckResult> {
    const result = await this.refreshUsage(accountId);
    if (!result.allowed) return result;
    if (estimatedCost == null) {
      if (this.deps.config.xApiUnknownCostBehavior === "BLOCK") {
        return {
          ...result,
          allowed: false,
          paused: true,
          reason: "API_BUDGET_UNKNOWN_COST",
        };
      }
      if (this.deps.config.xApiUnknownCostBehavior === "WARN") {
        return { ...result, reason: "UNKNOWN_COST_WARN" };
      }
    }
    return result;
  }

  async pause(accountId: string | null, reason: string, updatedBy?: string) {
    await this.ensurePeriodBudgets(accountId);
    for (const periodType of ["DAILY", "MONTHLY"] as const) {
      const budget = await this.deps.live.findBudget(accountId, periodType);
      if (!budget) continue;
      await this.deps.live.upsertBudget({
        ...budget,
        status: "PAUSED",
        reason,
        updatedBy: updatedBy ?? null,
        currentEstimatedUsage: budget.currentEstimatedUsage,
      });
    }
  }

  async resume(accountId: string | null, updatedBy?: string) {
    await this.ensurePeriodBudgets(accountId);
    for (const periodType of ["DAILY", "MONTHLY"] as const) {
      const budget = await this.deps.live.findBudget(accountId, periodType);
      if (!budget) continue;
      const usage = budget.currentReportedUsage ?? budget.currentEstimatedUsage;
      let status: XApiBudgetStatus = "ACTIVE";
      if (usage >= budget.hardLimit) status = "HARD_LIMIT_REACHED";
      else if (usage >= budget.softLimit) status = "SOFT_LIMIT_REACHED";
      await this.deps.live.upsertBudget({
        ...budget,
        status,
        reason: null,
        updatedBy: updatedBy ?? null,
        currentEstimatedUsage: budget.currentEstimatedUsage,
      });
    }
  }

  async setLimits(input: {
    accountId?: string | null;
    periodType: XApiBudgetPeriodType;
    softLimit: number;
    hardLimit: number;
    updatedBy?: string;
  }) {
    const bounds = this.periodBounds(input.periodType);
    const existing = await this.deps.live.findBudget(
      input.accountId ?? null,
      input.periodType,
    );
    return this.deps.live.upsertBudget({
      accountId: input.accountId ?? null,
      periodType: input.periodType,
      softLimit: input.softLimit,
      hardLimit: input.hardLimit,
      currentEstimatedUsage: existing?.currentEstimatedUsage ?? 0,
      currentReportedUsage: existing?.currentReportedUsage ?? null,
      currency: this.deps.config.xApiCostCurrency,
      status: existing?.status ?? "ACTIVE",
      updatedBy: input.updatedBy ?? null,
      periodStartedAt: existing?.periodStartedAt ?? bounds.start,
      periodEndsAt: existing?.periodEndsAt ?? bounds.end,
    });
  }

  private async updatePeriod(
    accountId: string | null,
    periodType: XApiBudgetPeriodType,
    currentUsage: number,
    reported: number | null,
  ) {
    const bounds = this.periodBounds(periodType);
    const existing = await this.deps.live.findBudget(accountId, periodType);
    const soft =
      existing?.softLimit ??
      (periodType === "DAILY"
        ? this.deps.config.xApiDailySoftBudgetUsd
        : this.deps.config.xApiMonthlySoftBudgetUsd);
    const hard =
      existing?.hardLimit ??
      (periodType === "DAILY"
        ? this.deps.config.xApiDailyHardBudgetUsd
        : this.deps.config.xApiMonthlyHardBudgetUsd);

    let status: XApiBudgetStatus = existing?.status === "PAUSED" ? "PAUSED" : "ACTIVE";
    if (status !== "PAUSED") {
      if (currentUsage >= hard) status = "HARD_LIMIT_REACHED";
      else if (currentUsage >= soft) status = "SOFT_LIMIT_REACHED";
    }

    const prev = existing?.status;
    const updated = await this.deps.live.upsertBudget({
      accountId,
      periodType,
      softLimit: soft,
      hardLimit: hard,
      currentEstimatedUsage: currentUsage,
      currentReportedUsage: reported,
      currency: this.deps.config.xApiCostCurrency,
      status,
      reason: existing?.reason ?? null,
      updatedBy: existing?.updatedBy ?? null,
      periodStartedAt: existing?.periodStartedAt ?? bounds.start,
      periodEndsAt: existing?.periodEndsAt ?? bounds.end,
    });

    if (prev !== status) {
      if (status === "SOFT_LIMIT_REACHED") {
        await this.deps.notifications?.emitXEvent?.("X_API_SOFT_BUDGET_REACHED", {
          periodType,
          accountId,
        });
      }
      if (status === "HARD_LIMIT_REACHED") {
        await this.deps.notifications?.emitXEvent?.("X_API_HARD_BUDGET_REACHED", {
          periodType,
          accountId,
        });
      }
    }
    return updated;
  }
}
