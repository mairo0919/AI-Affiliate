/**
 * Versioned list prices for estimated USD. Not an OpenAI invoice.
 * Do not fetch prices from the network. Do not use the flat yen estimate
 * as an execution-safety limit.
 */
export const LLM_PRICE_CARD = {
  id: "openai-public-2025-04-14",
  source:
    "OpenAI published API prices for gpt-4.1 ($2 / $0.50 cached / $8 per 1M) and gpt-4.1-mini ($0.40 / $0.10 cached / $1.60 per 1M). Estimate only.",
  effectiveFrom: "2025-04-14",
  updatedAt: "2026-10-09",
} as const;

export type ModelPrice = {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
};

const PRICES: Record<string, ModelPrice> = {
  "gpt-4.1": { inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 8 },
  "gpt-4.1-2025-04-14": { inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 8 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, cachedInputPerMillion: 0.1, outputPerMillion: 1.6 },
  "gpt-4.1-mini-2025-04-14": {
    inputPerMillion: 0.4,
    cachedInputPerMillion: 0.1,
    outputPerMillion: 1.6,
  },
};

export function priceForModel(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  if (PRICES[model]) return PRICES[model];
  if (model.startsWith("gpt-4.1-mini")) return PRICES["gpt-4.1-mini"];
  if (model.startsWith("gpt-4.1")) return PRICES["gpt-4.1"];
  return null;
}

export type TokenUsage = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
};

/** Returns null when tokens or a price card are missing. Never treats unknown as zero dollars. */
export function estimateUsd(model: string, usage: TokenUsage): number | null {
  const price = priceForModel(model);
  if (!price) return null;
  if (usage.inputTokens == null || usage.outputTokens == null) return null;
  const cached = usage.cachedInputTokens ?? 0;
  const uncached = Math.max(0, usage.inputTokens - cached);
  return (
    (uncached * price.inputPerMillion +
      cached * price.cachedInputPerMillion +
      usage.outputTokens * price.outputPerMillion) /
    1_000_000
  );
}

/** Held against the daily budget until actual usage replaces it. */
export function reservationUsd(model: string): number {
  if (model.startsWith("gpt-4.1-mini")) return 0.02;
  if (model.startsWith("gpt-4.1")) return 0.05;
  return 0.05;
}
