import type { LLMProvider, LLMProviderUsage, LLMTaskRequest, LLMTaskResult } from "../types.js";
import { LLMProviderError } from "../types.js";
import { currentLlmTick } from "./llm-execution-binding.js";
import { executeLlmRun, type FailureClass } from "./llm-execution-gate.js";
import type { LlmRunStore } from "./llm-execution-gate.js";
import { loadLlmSafetyLimits } from "./llm-safety-limits.js";

export interface OpenAiCompatibleConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  timeoutMs: number;
  maxAttempts: number;
  currency: string;
  yenPer1kInput: number;
  yenPer1kOutput: number;
  allowExternal: boolean;
  fetchImpl?: typeof fetch;
  /** When set, every executeTask persists a row before HTTP. */
  executionStore?: LlmRunStore | null;
}

/**
 * OpenAI-compatible Chat Completions provider.
 * Never logs or persists the API key.
 */
export class OpenAiCompatibleLLMProvider implements LLMProvider {
  readonly providerKey = "openai-compatible";

  constructor(private readonly config: OpenAiCompatibleConfig) {}

  async executeTask(request: LLMTaskRequest): Promise<LLMTaskResult> {
    if (!this.config.allowExternal) {
      throw new LLMProviderError(
        "LLM external requests are disabled (LLM_ALLOW_EXTERNAL_REQUESTS=false)",
        "non_retryable",
        false,
      );
    }
    if (!this.config.apiKey) {
      throw new LLMProviderError("LLM_API_KEY is not configured", "missing_credentials", false);
    }

    const model = request.model ?? this.config.defaultModel;
    if (this.config.executionStore) {
      return this.executeThroughGate(request, model);
    }
    const system =
      request.systemInstruction ??
      "You are a careful Japanese content operator. Return valid JSON only.";
    const user =
      request.userPrompt ??
      JSON.stringify({
        taskType: request.taskType,
        promptIdentifier: request.promptIdentifier,
        promptVersion: request.promptVersion,
        input: request.input,
        outputSchema: request.outputSchema ?? null,
      });

    let lastError: unknown;
    const attempts = Math.max(1, this.config.maxAttempts);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.callOnce({ model, system, user, request });
      } catch (error) {
        lastError = error;
        if (error instanceof LLMProviderError && !error.retryable) throw error;
        if (attempt >= attempts) break;
      }
    }
    if (lastError instanceof LLMProviderError) throw lastError;
    throw new LLMProviderError(
      lastError instanceof Error ? lastError.message : "LLM request failed",
      "retryable",
      true,
    );
  }

  private async callOnce(args: {
    model: string;
    system: string;
    user: string;
    request: LLMTaskRequest;
  }): Promise<LLMTaskResult> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      args.request.timeoutMs ?? this.config.timeoutMs,
    );

    try {
      const response = await fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: args.model,
          temperature:
            typeof args.request.temperature === "number" ? args.request.temperature : 0.4,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: args.system },
            { role: "user", content: args.user },
          ],
        }),
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new LLMProviderError("LLM authentication failed", "auth", false);
      }
      if (response.status === 429) {
        let quota = false;
        try {
          const body = (await response.clone().json()) as {
            error?: { code?: string; type?: string };
          };
          const code = `${body.error?.code ?? ""} ${body.error?.type ?? ""}`;
          quota = /insufficient_quota|credit_balance_exhausted/.test(code);
        } catch {
          quota = false;
        }
        throw new LLMProviderError(
          quota ? "LLM quota exhausted" : "LLM rate limited",
          quota ? "insufficient_quota" : "rate_limit",
          !quota,
        );
      }
      if (response.status >= 500) {
        throw new LLMProviderError(`LLM server error ${response.status}`, "retryable", true);
      }
      if (!response.ok) {
        throw new LLMProviderError(`LLM request failed (${response.status})`, "non_retryable", false);
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        model?: string;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      const finishReason = json.choices?.[0]?.finish_reason ?? null;
      const billedUsage = this.billedUsage(json.usage, args.model);
      if (finishReason === "content_filter") {
        return {
          output: { refused: true },
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
          estimatedCost: 0,
          actualCost: null,
          currency: this.config.currency,
          provider: this.providerKey,
          model: args.model,
          finishReason,
          errorClass: "policy_refusal",
          structuredOutputValid: false,
          metadata: { hasApiKey: true },
        };
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content) as Record<string, unknown>;
      } catch {
        throw new LLMProviderError(
          "LLM returned malformed JSON",
          "malformed_output",
          false,
          billedUsage,
        );
      }

      const usageKnown =
        typeof json.usage?.prompt_tokens === "number" &&
        typeof json.usage?.completion_tokens === "number";
      const inputTokens = usageKnown
        ? (json.usage?.prompt_tokens as number)
        : Math.ceil(args.user.length / 4);
      const outputTokens = usageKnown
        ? (json.usage?.completion_tokens as number)
        : Math.ceil(content.length / 4);
      const cachedTokens =
        typeof json.usage?.prompt_tokens_details?.cached_tokens === "number"
          ? json.usage.prompt_tokens_details.cached_tokens
          : undefined;
      const reasoningTokens =
        typeof json.usage?.completion_tokens_details?.reasoning_tokens === "number"
          ? json.usage.completion_tokens_details.reasoning_tokens
          : null;
      const estimatedCost =
        (inputTokens / 1000) * this.config.yenPer1kInput +
        (outputTokens / 1000) * this.config.yenPer1kOutput;

      return {
        output: parsed,
        inputTokens,
        outputTokens,
        cachedTokens,
        estimatedCost,
        actualCost: null,
        currency: this.config.currency,
        provider: this.providerKey,
        model: json.model || args.model,
        finishReason,
        errorClass: "none",
        structuredOutputValid: true,
        metadata: {
          promptIdentifier: args.request.promptIdentifier ?? null,
          promptVersion: args.request.promptVersion ?? null,
          usageKnown,
          reasoningTokens,
          responseModel: json.model ?? null,
        },
      };
    } catch (error) {
      if (error instanceof LLMProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new LLMProviderError("LLM request timed out", "timeout", true);
      }
      throw new LLMProviderError(
        error instanceof Error ? error.message : "LLM network error",
        "retryable",
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async executeThroughGate(request: LLMTaskRequest, model: string): Promise<LLMTaskResult> {
    const store = this.config.executionStore;
    if (!store) {
      throw new LLMProviderError("LLM execution ledger is not bound", "budget_blocked", false);
    }
    const channel = request.safety?.channel ?? channelForTask(request.taskType);
    const tick = currentLlmTick(channel);
    const safety = {
      ...(request.safety ?? {}),
      channel,
      operation: request.safety?.operation ?? request.taskType,
      tickId: request.safety?.tickId ?? tick?.tickId ?? null,
      newGenerationBudget: request.safety?.newGenerationBudget ?? tick?.newGenerationBudget ?? null,
    };
    const system =
      request.systemInstruction ??
      "You are a careful Japanese content operator. Return valid JSON only.";
    const user =
      request.userPrompt ??
      JSON.stringify({
        taskType: request.taskType,
        promptIdentifier: request.promptIdentifier,
        promptVersion: request.promptVersion,
        input: request.input,
        outputSchema: request.outputSchema ?? null,
      });
    const limits = loadLlmSafetyLimits();
    limits.httpRetryLimit = Math.max(1, this.config.maxAttempts);
    try {
      const gated = await executeLlmRun({
        store,
        model,
        taskType: request.taskType,
        provider: this.providerKey,
        promptIdentifier: request.promptIdentifier ?? null,
        promptVersion: request.promptVersion ?? null,
        safety,
        limits,
        transport: async () => {
          try {
            const result = await this.callOnce({ model, system, user, request });
            const known = result.metadata?.usageKnown === true;
            return {
              output: result.output,
              model: String(result.metadata?.responseModel ?? result.model),
              provider: result.provider,
              currency: result.currency,
              usage: known
                ? {
                    inputTokens: result.inputTokens,
                    outputTokens: result.outputTokens,
                    cachedInputTokens: result.cachedTokens ?? null,
                    reasoningTokens:
                      typeof result.metadata?.reasoningTokens === "number"
                        ? result.metadata.reasoningTokens
                        : null,
                  }
                : null,
            };
          } catch (error) {
            throw toGateError(error);
          }
        },
      });
      if (gated.blocked) {
        throw new LLMProviderError(gated.blockReason ?? "BLOCKED", "budget_blocked", false);
      }
      return {
        output: gated.output,
        inputTokens: gated.usage?.inputTokens ?? 0,
        outputTokens: gated.usage?.outputTokens ?? 0,
        cachedTokens: gated.usage?.cachedInputTokens ?? undefined,
        estimatedCost: gated.estimatedCostUsd ?? 0,
        actualCost: gated.estimatedCostUsd,
        currency: "USD",
        provider: gated.provider,
        model: gated.model,
        errorClass: "none",
        structuredOutputValid: true,
        metadata: {
          executionRunId: gated.runId,
          usageKnown: gated.usage?.inputTokens != null,
          ledger: "execution-gate-v1",
        },
      };
    } catch (error) {
      if (error instanceof LLMProviderError) throw error;
      const gateError = error as Error & { executionRunId?: string; failureClass?: FailureClass };
      if (gateError.executionRunId) {
        throw Object.assign(
          new LLMProviderError(gateError.message, mapFailureToErrorClass(gateError.failureClass), false),
          { executionRunId: gateError.executionRunId },
        );
      }
      throw error;
    }
  }

  /** Present only when the provider returned a usage object on a billed response. */
  private billedUsage(
    usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
    model: string,
  ): LLMProviderUsage | null {
    if (!usage) return null;
    const inputTokens = usage.prompt_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? 0;
    const estimatedCost =
      (inputTokens / 1000) * this.config.yenPer1kInput +
      (outputTokens / 1000) * this.config.yenPer1kOutput;
    return {
      inputTokens,
      outputTokens,
      estimatedCost,
      actualCost: null,
      currency: this.config.currency,
      provider: this.providerKey,
      model,
    };
  }
}

function mapErrorClass(errorClass: string): FailureClass {
  switch (errorClass) {
    case "rate_limit":
      return "RATE_LIMIT";
    case "insufficient_quota":
      return "INSUFFICIENT_QUOTA";
    case "timeout":
      return "TIMEOUT";
    case "malformed_output":
    case "schema_mismatch":
      return "SCHEMA_VALIDATION";
    case "policy_refusal":
      return "CONTENT_POLICY";
    case "auth":
    case "non_retryable":
      return "INVALID_REQUEST";
    case "retryable":
      return "SERVER_ERROR";
    default:
      return "UNKNOWN";
  }
}

function mapFailureToErrorClass(
  failure: FailureClass | undefined,
): NonNullable<LLMTaskResult["errorClass"]> {
  switch (failure) {
    case "RATE_LIMIT":
      return "rate_limit";
    case "INSUFFICIENT_QUOTA":
      return "insufficient_quota";
    case "TIMEOUT":
      return "timeout";
    case "SCHEMA_VALIDATION":
      return "malformed_output";
    case "CONTENT_POLICY":
      return "policy_refusal";
    case "SERVER_ERROR":
    case "NETWORK":
      return "retryable";
    default:
      return "non_retryable";
  }
}

function toGateError(error: unknown): Error {
  if (error instanceof LLMProviderError) {
    return Object.assign(new Error(sanitizeGateMessage(error.message)), {
      failureClass: mapErrorClass(error.errorClass),
      retryable: error.retryable,
      httpStatus: null,
      usage: error.usage
        ? {
            inputTokens: error.usage.inputTokens,
            outputTokens: error.usage.outputTokens,
            cachedInputTokens: null,
            reasoningTokens: null,
          }
        : null,
      model: error.usage?.model ?? null,
    });
  }
  return Object.assign(new Error(error instanceof Error ? sanitizeGateMessage(error.message) : "llm_failed"), {
    failureClass: "NETWORK" as const,
    retryable: true,
    httpStatus: null,
    usage: null,
    model: null,
  });
}

function sanitizeGateMessage(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 240);
}

function channelForTask(taskType: string): "X" | "WP" | "UNKNOWN" {
  if (taskType.includes("X")) return "X";
  if (
    taskType === "GENERATION_BLOGGER" ||
    taskType === "GENERATION" ||
    taskType === "REVIEW" ||
    taskType === "REVISION" ||
    taskType === "publication_metadata"
  ) {
    return "WP";
  }
  return "UNKNOWN";
}
