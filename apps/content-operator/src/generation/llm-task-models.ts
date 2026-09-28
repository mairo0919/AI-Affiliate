import type { AppConfig } from "@ai-affiliate/config";

/**
 * Per-task LLM model authority for ContentGenerationService / X Social.
 *
 * - generation: editorial decision (+ legacy GENERATION_X)
 * - writer: Article Writer, Article Rewrite, X Social Writer/Rewrite
 * - review: Article Review prompts
 * - revision: retained for non-writer REVISION callers; Article Rewrite uses writer
 */
export type LlmTaskModels = {
  generation: string;
  writer: string;
  review: string;
  revision: string;
};

export function llmTaskModelsFromConfig(
  config: Pick<
    AppConfig,
    "llmModelGeneration" | "llmModelWriter" | "llmModelReview" | "llmModelRevision"
  >,
): LlmTaskModels {
  return {
    generation: config.llmModelGeneration,
    writer: config.llmModelWriter,
    review: config.llmModelReview,
    revision: config.llmModelRevision,
  };
}
