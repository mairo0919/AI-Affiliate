import type { LlmRunStore } from "./llm-execution-gate.js";

let boundStore: LlmRunStore | null = null;
let boundTicks: Partial<Record<"X" | "WORDPRESS", { tickId: string; newGenerationBudget: number }>> = {};

export function bindLlmExecutionStore(store: LlmRunStore | null): void {
  boundStore = store;
}

export function getLlmExecutionStore(): LlmRunStore | null {
  return boundStore;
}

export function bindLlmTick(
  tick: { tickId: string; newGenerationBudget: number; channel?: "X" | "WORDPRESS" } | null,
): void {
  if (!tick) {
    boundTicks = {};
    return;
  }
  const channel = tick.channel ?? "X";
  boundTicks = { ...boundTicks, [channel]: { tickId: tick.tickId, newGenerationBudget: tick.newGenerationBudget } };
}

export function currentLlmTick(channel?: string | null): { tickId: string; newGenerationBudget: number } | null {
  if (channel === "WORDPRESS" || channel === "WP") return boundTicks.WORDPRESS ?? null;
  if (channel === "X") return boundTicks.X ?? null;
  return boundTicks.X ?? boundTicks.WORDPRESS ?? null;
}
