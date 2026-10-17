import type { AppConfig } from "@ai-affiliate/config";
import type { LLMProvider } from "../types.js";
import { getLlmExecutionStore } from "./llm-execution-binding.js";
import { MockLLMProvider } from "./mock-llm-provider.js";
import { OpenAiCompatibleLLMProvider } from "./openai-compatible-provider.js";

function apiProvider(config: AppConfig, apiKey: string): LLMProvider {
  const executionStore = getLlmExecutionStore();
  if (!executionStore) {
    throw new Error("LLM execution ledger is not bound");
  }
  return new OpenAiCompatibleLLMProvider({
    apiKey,
    baseUrl: config.llmApiBaseUrl,
    defaultModel: config.llmModelGeneration,
    timeoutMs: config.llmTimeoutMs,
    maxAttempts: config.llmMaxAttempts,
    currency: config.llmCurrency,
    yenPer1kInput: config.llmEstimatedYenPer1kInputTokens,
    yenPer1kOutput: config.llmEstimatedYenPer1kOutputTokens,
    allowExternal: true,
    executionStore,
  });
}

export function createLLMProvider(config: AppConfig): LLMProvider {
  if (config.llmMode !== "api") {
    return new MockLLMProvider();
  }
  if (!config.llmAllowExternalRequests || !config.llmApiKey) {
    return new MockLLMProvider();
  }
  return apiProvider(config, config.llmApiKey);
}

export function requireApiLLMProvider(config: AppConfig): LLMProvider {
  if (config.llmMode !== "api") {
    throw new Error("LLM_MODE must be api for production generation");
  }
  if (!config.llmAllowExternalRequests) {
    throw new Error("LLM_ALLOW_EXTERNAL_REQUESTS must be true");
  }
  if (!config.llmApiKey) {
    throw new Error("LLM_API_KEY is required");
  }
  return apiProvider(config, config.llmApiKey);
}
