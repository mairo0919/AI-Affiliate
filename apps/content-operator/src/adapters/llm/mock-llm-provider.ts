import type { LLMProvider, LLMTaskRequest, LLMTaskResult } from "../types.js";
import { LLMProviderError } from "../types.js";

export type MockLLMBehavior =
  | "ok"
  | "malformed_json"
  | "schema_mismatch"
  | "timeout"
  | "retryable"
  | "non_retryable"
  | "policy_refusal";

export interface MockLLMUsageRecord {
  taskType: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  at: Date;
}

/**
 * Structured Mock LLM for P4.5 generation/review/revision paths.
 * Legacy callers still get a generic echo for unknown task types.
 */
export class MockLLMProvider implements LLMProvider {
  readonly providerKey = "mock-llm";
  readonly model = "mock-llm-v1";
  private readonly usage: MockLLMUsageRecord[] = [];
  behavior: MockLLMBehavior = "ok";

  getUsageRecords(): readonly MockLLMUsageRecord[] {
    return this.usage;
  }

  async executeTask(request: LLMTaskRequest): Promise<LLMTaskResult> {
    if (this.behavior === "timeout") {
      throw new LLMProviderError("mock timeout", "timeout", true);
    }
    if (this.behavior === "retryable") {
      throw new LLMProviderError("mock retryable failure", "retryable", true);
    }
    if (this.behavior === "non_retryable") {
      throw new LLMProviderError("mock non-retryable failure", "non_retryable", false);
    }
    if (this.behavior === "policy_refusal") {
      return this.record(request, {
        output: { refused: true, reason: "policy" },
        finishReason: "content_filter",
        errorClass: "policy_refusal",
        structuredOutputValid: false,
      });
    }
    if (this.behavior === "malformed_json") {
      return this.record(request, {
        output: { raw: "{not-json" },
        finishReason: "stop",
        errorClass: "malformed_output",
        structuredOutputValid: false,
      });
    }

    const id = request.promptIdentifier ?? "";
    const title =
      typeof request.input.productTitle === "string"
        ? request.input.productTitle
        : typeof request.input.title === "string"
          ? request.input.title
          : "Sample Catalog Item";
    const ctaUrl =
      typeof request.input.ctaUrl === "string"
        ? request.input.ctaUrl
        : typeof request.input.productUrl === "string"
          ? request.input.productUrl
          : null;
    const claimIds = Array.isArray(request.input.supportedClaimIds)
      ? (request.input.supportedClaimIds as string[])
      : [];

    if (id.includes("blogger.generate") || request.taskType === "GENERATION_BLOGGER") {
      if (this.behavior === "schema_mismatch") {
        return this.record(request, {
          output: { title: "x", body: "y" },
          structuredOutputValid: false,
          errorClass: "schema_mismatch",
        });
      }
      return this.record(request, {
        output: {
          title: `${title} の公開情報まとめ`,
          summary: `${title} の確認できる事実と購入導線を整理。`,
          lead: `${title} は公開カタログ上で確認できる項目がある。`,
          sections: [
            {
              heading: "確認できる情報",
              paragraphs: [
                `${title} について、公開ページで確認できた事実だけを整理する。`,
                "確認できない内容は断定しない。価格・発売日・出演者などは根拠がある場合のみ記載する。",
              ],
              lists: ["公開情報を優先", "レビューと事実を区別"],
            },
            {
              heading: "注意",
              paragraphs: ["18歳未満は対象外です。アフィリエイト広告を含む場合があります。"],
            },
          ],
          cta: {
            label: "商品ページを見る",
            url: ctaUrl,
          },
          sourceReferences: [],
          seoTitle: `${title} 概要`,
          metaDescription: `${title} の概要と注意点。`,
          labels: ["catalog", "overview"],
          warnings: [],
          usedClaimIds: claimIds,
          usedProductLinkIds: Array.isArray(request.input.productLinkIds)
            ? request.input.productLinkIds
            : [],
          articleFormat: request.input.articleFormat ?? "new-release",
        },
        structuredOutputValid: true,
      });
    }

    if (id.includes("x.generate") || request.taskType === "GENERATION_X") {
      const link = typeof request.input.bloggerUrl === "string" && request.input.bloggerUrl
        ? request.input.bloggerUrl
        : ctaUrl ?? "";
      const body = link
        ? `${title}の概要をまとめました。詳細はこちら ${link} ※アフィリエイト広告を含む場合があります`
        : `${title}の概要メモ。リンク準備中 ※アフィリエイト広告を含む場合があります`;
      return this.record(request, {
        output: {
          body,
          reply: null,
          usedClaimIds: claimIds,
          ctaUrl: link || null,
        },
        structuredOutputValid: true,
      });
    }

    if (
      id.includes("review") ||
      request.taskType.startsWith("REVIEW") ||
      request.taskType === "CLAIM_VALIDATION"
    ) {
      return this.record(request, {
        output: {
          result: "passed",
          score: 0.88,
          findings: [],
          requiredActions: [],
          revisionRecommendation: "no_change",
        },
        structuredOutputValid: true,
      });
    }

    if (id.includes("revision") || request.taskType === "REVISION") {
      return this.record(request, {
        output: {
          title: `${title} の概要（修正版）`,
          summary: "レビュー指摘を反映した修正版です。",
          lead: "要点を先に述べます。",
          sections: [
            {
              heading: "概要",
              paragraphs: ["指摘箇所を具体的に直しました。根拠のない断定は避けています。"],
            },
          ],
          cta: { label: "商品ページを見る", url: ctaUrl },
          seoTitle: `${title} 概要`,
          metaDescription: `${title} の修正版概要。`,
          labels: ["catalog"],
          warnings: [],
          usedClaimIds: claimIds,
          usedProductLinkIds: [],
        },
        structuredOutputValid: true,
      });
    }

    if (request.taskType === "EVALUATION" || id.includes("evaluation")) {
      return this.record(request, {
        output: {
          recommendations: ["次回は導入を短くし、CTAを1つに絞る"],
          notes: "LLM refinement only; scores remain deterministic-led",
        },
        structuredOutputValid: true,
      });
    }

    if (request.taskType === "EXPERIMENT" || id.includes("experiment")) {
      return this.record(request, {
        output: {
          autoPublish: false,
          notes: "Variants proposed for human approval only",
        },
        structuredOutputValid: true,
      });
    }

    if (request.taskType === "LEARNING" || id.includes("learning")) {
      return this.record(request, {
        output: {
          rules: [
            {
              ruleType: "timing",
              statement: "カタログ系ジャンルは週末のCTRが相対的に高い傾向（要サンプル追加）",
              successRate: 0.55,
            },
          ],
        },
        structuredOutputValid: true,
      });
    }

    if (request.taskType === "STRATEGY_FEEDBACK" || id.includes("strategy.feedback")) {
      return this.record(request, {
        output: {
          strategyHints: ["prefer-single-cta", "title-max-40"],
          doNotRewritePublishedContent: true,
        },
        structuredOutputValid: true,
      });
    }

    return this.record(request, {
      output: {
        taskType: request.taskType,
        summary: `mock output for ${request.taskType}`,
        echo: request.input,
      },
      structuredOutputValid: true,
    });
  }

  private record(
    request: LLMTaskRequest,
    partial: Partial<LLMTaskResult> & { output: Record<string, unknown> },
  ): LLMTaskResult {
    const inputTokens = Math.max(10, JSON.stringify(request.input).length);
    const outputTokens = Math.max(20, JSON.stringify(partial.output).length / 4);
    const estimatedCost = 0;
    this.usage.push({
      taskType: request.taskType,
      inputTokens,
      outputTokens,
      estimatedCost,
      at: new Date(),
    });
    return {
      output: partial.output,
      inputTokens,
      outputTokens,
      cachedTokens: 0,
      estimatedCost,
      actualCost: 0,
      currency: "JPY",
      provider: this.providerKey,
      model: request.model ?? this.model,
      finishReason: partial.finishReason ?? "stop",
      errorClass: partial.errorClass ?? "none",
      errorDetail: partial.errorDetail ?? null,
      structuredOutputValid: partial.structuredOutputValid ?? true,
      metadata: { mock: true, promptIdentifier: request.promptIdentifier ?? null },
    };
  }
}
