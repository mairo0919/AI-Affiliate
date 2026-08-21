import type { LifecycleRepository } from "@ai-affiliate/database";
import type { LLMProvider } from "../adapters/types.js";
import { LLMProviderError } from "../adapters/types.js";
import type { ArticleWritingFeatures } from "./types.js";
import {
  getWritingFeaturesLlmJsonSchema,
  validateWritingFeaturesLlmOverlay,
  type WritingFeatureLlmExtractor,
} from "./writing-extraction.js";

const PROMPT_ID = "article-pattern.writing-features";
const PROMPT_VERSION = "v1";

export type WritingFeatureLlmExtractorResult = Partial<ArticleWritingFeatures> & {
  _modelRunId?: string;
  _fallbackReason?: string;
  _schemaValid?: boolean;
};

/**
 * Real/Mock LLM WritingFeature extractor with ModelRun + CostRecord.
 * temperature=0 for this task only. Schema-invalid overlays are rejected.
 * Never persists article body; ModelRun metadata stores lengths/ids only.
 */
export function createWritingFeatureLlmExtractor(deps: {
  llm: LLMProvider;
  repo: LifecycleRepository;
  model: string;
}): WritingFeatureLlmExtractor {
  return async (input) => {
    const plainLen = input.plainText.length;
    const modelRun = await deps.repo.createModelRun({
      provider: deps.llm.providerKey,
      model: deps.model,
      taskType: "WRITING_FEATURE_EXTRACTION",
      promptIdentifier: PROMPT_ID,
      promptVersion: PROMPT_VERSION,
      status: "RUNNING",
      inputRef: null,
      metadata: {
        purpose: "writing_feature_extraction",
        titlePresent: Boolean(input.title),
        plainTextLength: plainLen,
        storesBody: false,
        temperature: 0,
      },
    });

    try {
      const llm = await deps.llm.executeTask({
        taskType: "WRITING_FEATURE_EXTRACTION",
        promptIdentifier: PROMPT_ID,
        promptVersion: PROMPT_VERSION,
        model: deps.model,
        outputSchema: getWritingFeaturesLlmJsonSchema(),
        systemInstruction: [
          "Extract abstract writing craft features as JSON only.",
          "Never quote, rewrite, summarize for storage, or invent sentence templates.",
          "Do not include URLs or long prose in any field.",
          "tone must be a single string, never an array.",
        ].join(" "),
        userPrompt: [
          "Return Writing Features JSON matching the schema.",
          `Title: ${input.title ?? "(none)"}`,
          "Ephemeral text (do not echo):",
          input.plainText.slice(0, 8_000),
        ].join("\n"),
        input: {
          title: input.title ?? null,
          plainTextLength: plainLen,
        },
      });

      await deps.repo.createCostRecord({
        provider: llm.provider,
        serviceOrModel: llm.model,
        operationType: "WRITING_FEATURE_EXTRACTION",
        relatedType: "ArticleStructureObservation",
        relatedId: null,
        modelRunId: modelRun.id,
        estimatedAmount: llm.estimatedCost,
        actualAmount: llm.actualCost ?? llm.estimatedCost,
        currency: llm.currency,
      });

      const validated = validateWritingFeaturesLlmOverlay(llm.output);
      if (!validated.ok) {
        await deps.repo.completeModelRun(modelRun.id, {
          status: "COMPLETED",
          inputTokens: llm.inputTokens,
          outputTokens: llm.outputTokens,
          estimatedCost: llm.estimatedCost,
          actualCost: llm.actualCost ?? llm.estimatedCost,
          currency: llm.currency,
          metadata: {
            purpose: "writing_feature_extraction",
            storesBody: false,
            schemaValid: false,
            fallbackReason: validated.reason,
            temperature: 0,
          },
        });
        const err = new Error(`writing_features_schema_invalid:${validated.reason}`);
        (err as Error & { fallbackReason?: string }).fallbackReason = validated.reason;
        throw err;
      }

      const features = validated.features;
      const serialized = JSON.stringify(features);
      if (serialized.length > 4_000 || /https?:\/\//i.test(serialized)) {
        throw new Error("writing_features_not_abstract");
      }

      await deps.repo.completeModelRun(modelRun.id, {
        status: "COMPLETED",
        inputTokens: llm.inputTokens,
        outputTokens: llm.outputTokens,
        estimatedCost: llm.estimatedCost,
        actualCost: llm.actualCost ?? llm.estimatedCost,
        currency: llm.currency,
        metadata: {
          purpose: "writing_feature_extraction",
          featureKeys: Object.keys(features),
          storesBody: false,
          schemaValid: true,
          temperature: 0,
        },
      });

      return {
        ...features,
        _modelRunId: modelRun.id,
        _schemaValid: true,
      } as WritingFeatureLlmExtractorResult;
    } catch (error) {
      const fallbackReason =
        error instanceof Error && error.message.startsWith("writing_features_schema_invalid:")
          ? error.message.replace("writing_features_schema_invalid:", "")
          : error instanceof Error
            ? error.message.slice(0, 120)
            : "llm_failed";
      const alreadyCompleted = error instanceof Error && error.message.startsWith("writing_features_schema_invalid:");
      if (!alreadyCompleted) {
        await deps.repo.completeModelRun(modelRun.id, {
          status: "FAILED",
          errorType: error instanceof LLMProviderError ? error.errorClass : "unknown",
          errorDetail: error instanceof Error ? error.message.slice(0, 200) : "LLM failed",
          metadata: {
            purpose: "writing_feature_extraction",
            storesBody: false,
            schemaValid: false,
            fallbackReason,
            temperature: 0,
          },
        });
      }
      throw error;
    }
  };
}
