import type { LLMProvider } from "../../adapters/types.js";

/** A writer that returns a fixed post, for tests of how a post is assembled rather than written. */
export function replayWriter(body: string): LLMProvider {
  return {
    providerKey: "replay",
    async executeTask() {
      return {
        output: { body },
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        currency: "USD",
        provider: "replay",
        model: "replay",
      };
    },
  } as LLMProvider;
}
