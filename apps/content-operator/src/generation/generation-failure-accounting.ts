/**
 * Keep the provider's own error class when a model call fails.
 * Schema validation is only for a response that was parsed and then rejected.
 */

import { LLMProviderError, type LLMProviderUsage } from "../adapters/types.js";

export const SCHEMA_VALIDATION_ERROR_TYPE = "structured_output_schema_validation_failed";

export type GenerationFailureAccount = {
  errorType: string;
  errorDetail: string;
  providerPreserved: boolean;
  usage: LLMProviderUsage | null;
};

export function retainedFailureTokens(input: {
  providerUsage: { inputTokens: number; outputTokens: number; estimatedCost: number } | null;
  response?: { inputTokens?: number | null; outputTokens?: number | null; estimatedCost?: number | null } | null;
}): { inputTokens: number | null; outputTokens: number | null; estimatedCost: number | null } {
  return {
    inputTokens: input.providerUsage?.inputTokens ?? input.response?.inputTokens ?? null,
    outputTokens: input.providerUsage?.outputTokens ?? input.response?.outputTokens ?? null,
    estimatedCost: input.providerUsage?.estimatedCost ?? input.response?.estimatedCost ?? null,
  };
}

export function accountGenerationFailure(error: unknown): GenerationFailureAccount {
  if (error instanceof LLMProviderError) {
    return {
      errorType: error.errorClass,
      errorDetail: error.message.slice(0, 480),
      providerPreserved: true,
      usage: error.usage,
    };
  }
  const message = error instanceof Error ? error.message : "generation failed";
  return {
    errorType: SCHEMA_VALIDATION_ERROR_TYPE,
    errorDetail: message.slice(0, 480),
    providerPreserved: false,
    usage: null,
  };
}
