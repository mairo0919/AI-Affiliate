import type { LifecycleRepository } from "@ai-affiliate/database";

export class BudgetBlockedError extends Error {
  readonly code = "BUDGET_BLOCKED";
  constructor(message: string) {
    super(message);
    this.name = "BudgetBlockedError";
  }
}

export class BudgetGuard {
  constructor(private readonly repo: LifecycleRepository) {}

  async assertCanSpend(
    estimatedAmount: number,
    currency = "JPY",
    options?: { contentId?: string; jobId?: string; spentOnScope?: number },
  ): Promise<void> {
    const budgets = await this.repo.listBudgetSettings(currency);
    if (budgets.length === 0) return;

    const spentToday = await this.repo.sumCostsSince(startOfDay(new Date()), currency);
    const spentMonth = await this.repo.sumCostsSince(startOfMonth(new Date()), currency);

    for (const budget of budgets) {
      if (!budget.enabled) continue;
      let spent: number | null = null;
      if (budget.scopeType === "DAILY") spent = spentToday;
      else if (budget.scopeType === "MONTHLY") spent = spentMonth;
      else if (budget.scopeType === "PER_CONTENT" || budget.scopeType === "PER_JOB") {
        // Callers may pass accumulated spend for the scope; otherwise skip soft scopes
        if (options?.spentOnScope === undefined) continue;
        spent = options.spentOnScope;
      } else {
        continue;
      }
      const projected = spent + estimatedAmount;
      const stopAt = budget.hardLimit * budget.stopThreshold;
      if (projected >= stopAt) {
        throw new BudgetBlockedError(
          `Budget stop threshold reached for ${budget.scopeType}: projected=${projected} stopAt=${stopAt} ${currency}`,
        );
      }
    }
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
