/**
 * Daily hard budget — exploration unlimited-ish; LLM generations capped.
 */

export interface DailyBlogBudgetConfig {
  maxLlmProductsPerRun: number;
  maxLlmCallsPerRun: number;
  maxCandidatesToScan: number;
}

export interface DailyBlogBudgetState {
  llmProductsUsed: number;
  llmCallsUsed: number;
  candidatesScanned: number;
}

export function createBudgetState(): DailyBlogBudgetState {
  return { llmProductsUsed: 0, llmCallsUsed: 0, candidatesScanned: 0 };
}

export function canStartLlmGeneration(
  state: DailyBlogBudgetState,
  config: DailyBlogBudgetConfig,
): { ok: boolean; code: string | null } {
  if (state.llmProductsUsed >= config.maxLlmProductsPerRun) {
    return { ok: false, code: "LLM_PRODUCT_BUDGET_EXCEEDED" };
  }
  if (state.llmCallsUsed >= config.maxLlmCallsPerRun) {
    return { ok: false, code: "LLM_CALL_BUDGET_EXCEEDED" };
  }
  return { ok: true, code: null };
}

/** Pre-LLM DEFER skips may advance to next candidate without counting as LLM product. */
export function noteCandidateScan(state: DailyBlogBudgetState, config: DailyBlogBudgetConfig): boolean {
  state.candidatesScanned += 1;
  return state.candidatesScanned <= config.maxCandidatesToScan;
}
