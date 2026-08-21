import type { LLMProvider, LLMTaskRequest, LLMTaskResult } from "../types.js";
import { LLMProviderError } from "../types.js";

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
          temperature: 0.4,
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
        throw new LLMProviderError("LLM rate limited", "rate_limit", true);
      }
      if (response.status >= 500) {
        throw new LLMProviderError(`LLM server error ${response.status}`, "retryable", true);
      }
      if (!response.ok) {
        throw new LLMProviderError(`LLM request failed (${response.status})`, "non_retryable", false);
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      const finishReason = json.choices?.[0]?.finish_reason ?? null;
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
        throw new LLMProviderError("LLM returned malformed JSON", "malformed_output", false);
      }

      const inputTokens = json.usage?.prompt_tokens ?? Math.ceil(args.user.length / 4);
      const outputTokens = json.usage?.completion_tokens ?? Math.ceil(content.length / 4);
      const estimatedCost =
        (inputTokens / 1000) * this.config.yenPer1kInput +
        (outputTokens / 1000) * this.config.yenPer1kOutput;

      return {
        output: parsed,
        inputTokens,
        outputTokens,
        cachedTokens: 0,
        estimatedCost,
        actualCost: null,
        currency: this.config.currency,
        provider: this.providerKey,
        model: args.model,
        finishReason,
        errorClass: "none",
        structuredOutputValid: true,
        metadata: {
          promptIdentifier: args.request.promptIdentifier ?? null,
          promptVersion: args.request.promptVersion ?? null,
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
}
