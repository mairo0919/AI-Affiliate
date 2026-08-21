import type {
  ContentGenerationRequest,
  ContentGenerationResult,
  StructuredContentOutput,
} from "../types.js";
import {
  parseStructuredOutput,
  repairStructuredJsonOnce,
  tryParseJsonObject,
} from "../structured-output.js";
import type { ContentGenerationProvider } from "./types.js";

export interface MockContentGenerationProviderOptions {
  defaultBehavior?: ContentGenerationRequest["mockBehavior"];
  delayMs?: number;
}

function padJapanese(base: string, minLength: number): string {
  if (base.length >= minLength) {
    return base;
  }
  const filler =
    "公開されている数値・タグ情報のみに基づき紹介します。作品の詳細な内容や感想は断定しません。アフィリエイト広告を含みます。";
  let out = base;
  while (out.length < minLength) {
    out += filler;
  }
  return out.slice(0, Math.max(minLength, base.length));
}

function buildOkOutput(request: ContentGenerationRequest): StructuredContentOutput {
  const input = request.input;
  const url = input.affiliateUrl;
  const facts: string[] = [];
  if (input.rankingPosition != null) {
    facts.push(`ランキング順位 ${input.rankingPosition}`);
  }
  if (input.reviewAverage != null && input.reviewCount != null) {
    facts.push(`評価 ${input.reviewAverage}（件数 ${input.reviewCount}）`);
  }
  if (input.price != null) {
    facts.push(`価格 ${input.price}`);
  }
  if (input.discountRate != null) {
    facts.push(`割引率 ${input.discountRate}%`);
  }
  if (input.publishedAt) {
    facts.push(`公開日 ${input.publishedAt.slice(0, 10)}`);
  }
  if (input.tags.actress[0]) {
    facts.push(`タグ: ${input.tags.actress[0]}`);
  }
  if (input.tags.genre[0]) {
    facts.push(`ジャンル: ${input.tags.genre[0]}`);
  }

  const factLine = facts.length > 0 ? facts.join(" / ") : "公開メタデータが限られています";
  const cta = "詳細は公式ページでご確認ください";
  const disclosure = "※アフィリエイト広告を含みます";

  switch (request.contentType) {
    case "X_POST": {
      const highlight = facts.slice(0, 2).join("・") || "注目作品";
      let body = `${input.title} ${highlight} ${cta} ${url} ${disclosure}`;
      const max = 140;
      if (body.length > max) {
        body = `${input.title.slice(0, 40)} ${highlight.slice(0, 30)} ${url}`;
      }
      return {
        title: input.title,
        body,
        summary: highlight,
        hashtags: ["FANZA", input.tags.genre[0] ?? "アダルト"].filter(Boolean),
        callToAction: cta,
        metadata: { contentAngle: input.contentAngle },
      };
    }
    case "PRODUCT_INTRODUCTION": {
      const disclosure = "※アフィリエイト広告を含みます";
      const core = [input.title, factLine, cta, url].join(" / ");
      const trimmedCore = core.length > 240 ? `${core.slice(0, 240)}…` : core;
      const body = `${trimmedCore} ${disclosure}`;
      return {
        title: input.title,
        body,
        summary: factLine,
        hashtags: [],
        callToAction: cta,
      };
    }
    case "SHORT_VIDEO_SCRIPT": {
      const hasMedia = input.allowedImages.length > 0;
      const hook = `${input.title}の公開情報をチェック`;
      const narration = [
        hook,
        factLine,
        hasMedia ? "確認済みパッケージ画像を表示可能" : "画像素材は前提にしないナレーション",
        `${cta}。${disclosure}`,
      ].join("。");
      return {
        title: `${input.title} ショート台本`,
        body: narration,
        summary: hook,
        hashtags: [],
        callToAction: cta,
        metadata: {
          estimatedDurationSeconds: 30,
          contentAngle: input.contentAngle,
          hook,
          narration,
          onScreenText: input.title,
          scenes: [
            { order: 1, hook: true, narration: hook, onScreenText: input.title },
            { order: 2, narration: factLine, onScreenText: factLine.slice(0, 40) },
            { order: 3, narration: `${cta} ${disclosure}`, onScreenText: "詳細はリンクから" },
          ],
        },
      };
    }
    case "BLOG_ARTICLE":
    default: {
      const sections = [
        `## ${input.title}`,
        "",
        "導入: 公開されているメタデータをもとに紹介します。作品内容の断定や感想の創作は行いません。",
        "",
        "### 基本情報",
        `- 商品名: ${input.title}`,
        input.publishedAt ? `- 公開日: ${input.publishedAt}` : "- 公開日: 不明",
        input.affiliateUrl ? `- URL: ${input.affiliateUrl}` : "",
        "",
        "### 注目ポイント（入力データのみ）",
        factLine,
        "",
        "### 数値情報",
        facts.map((f) => `- ${f}`).join("\n") || "- 追加の数値はありません",
        "",
        "### 向いているユーザー像",
        "公開タグ・数値を確認したうえで興味を持てる人向けです。実在しない保証はしません。",
        "",
        "### 注意事項",
        "成人向けサービスです。作品の詳細内容は公式情報をご確認ください。",
        "",
        "### CTA",
        `${cta}: ${url}`,
        "",
        disclosure,
      ]
        .filter((line) => line !== undefined)
        .join("\n");
      const body = padJapanese(sections, 800);
      return {
        title: `${input.title} の公開情報まとめ`,
        body,
        summary: factLine,
        hashtags: input.tags.genre.slice(0, 3),
        callToAction: cta,
      };
    }
  }
}

export class MockContentGenerationProvider implements ContentGenerationProvider {
  readonly providerName = "mock";
  private readonly defaultBehavior: ContentGenerationRequest["mockBehavior"];
  private readonly delayMs: number;

  constructor(options: MockContentGenerationProviderOptions = {}) {
    this.defaultBehavior = options.defaultBehavior ?? "ok";
    this.delayMs = options.delayMs ?? 0;
  }

  async generate(request: ContentGenerationRequest): Promise<ContentGenerationResult> {
    const behavior = request.mockBehavior ?? this.defaultBehavior ?? "ok";
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (behavior === "timeout") {
      await new Promise((resolve) => setTimeout(resolve, request.timeoutMs + 1));
      return {
        providerName: this.providerName,
        modelName: request.modelName,
        rawText: "",
        output: null,
        repaired: false,
        timedOut: true,
        errorMessage: "mock timeout",
      };
    }

    if (behavior === "invalid_json") {
      // Intentionally irreparable — one repair attempt still fails.
      return {
        providerName: this.providerName,
        modelName: request.modelName,
        rawText: "",
        output: null,
        repaired: false,
        timedOut: false,
        errorMessage: "structured output parse failed",
      };
    }

    if (behavior === "repairable_json") {
      const ok = buildOkOutput(request);
      // Missing closing brace / hashtags as string — repairable once
      const rawText = `{"title":${JSON.stringify(ok.title)},"body":${JSON.stringify(ok.body)},"hashtags":"tag"}`;
      return this.finalize(request, rawText, true);
    }

    const output = buildOkOutput(request);
    if (request.input.regenerationInstruction) {
      const instruction = request.input.regenerationInstruction;
      output.summary = `${output.summary ?? ""} / revision:${instruction}`.trim();
      if (request.contentType === "X_POST") {
        const angleMatch = instruction.match(/TO=([A-Z_]+)/);
        if (angleMatch?.[1] && instruction.includes("CONTENT_ANGLE")) {
          const angle = angleMatch[1];
          const angleLead: Record<string, string> = {
            RANKING: "ランキング注目",
            HIGH_RATING: "高評価注目",
            NEW_RELEASE: "新作注目",
            ACTRESS: "出演者注目",
            DISCOUNT: "セール注目",
            SIMPLE_INTRODUCTION: "作品紹介",
            DATA_FACT: "公開数値まとめ",
            CURIOSITY: "気になる一本",
          };
          const lead = angleLead[angle] ?? "注目作品";
          const url = request.input.affiliateUrl;
          const disclosure = "※アフィリエイト広告を含みます";
          const facts: string[] = [];
          if (request.input.rankingPosition != null) facts.push(`順位${request.input.rankingPosition}`);
          if (request.input.reviewAverage != null) facts.push(`評価${request.input.reviewAverage}`);
          if (request.input.price != null) facts.push(`価格${request.input.price}`);
          const fact = facts.slice(0, 2).join("・") || "公開情報";
          output.body = `${lead} ${request.input.title} ${fact} ${url} ${disclosure}`;
          output.metadata = { ...(output.metadata ?? {}), contentAngle: angle };
        }
        // Keep X body within configured length; put revision note in summary only for other dims.
      } else {
        output.body = `${output.body}\n\n(改稿指示反映: ${instruction})`;
      }
    }
    const rawText = JSON.stringify(output);
    return this.finalize(request, rawText, false);
  }

  private finalize(
    request: ContentGenerationRequest,
    rawText: string,
    allowRepair: boolean,
  ): ContentGenerationResult {
    const parsed = tryParseJsonObject(rawText);
    if (parsed) {
      try {
        const output = parseStructuredOutput(parsed);
        return {
          providerName: this.providerName,
          modelName: request.modelName,
          rawText,
          output,
          repaired: false,
          timedOut: false,
        };
      } catch {
        // fall through to repair
      }
    }

    if (allowRepair || request.mockBehavior === "invalid_json" || request.mockBehavior === "repairable_json") {
      const repairedText = repairStructuredJsonOnce(rawText);
      if (repairedText) {
        const repairedParsed = tryParseJsonObject(repairedText);
        if (repairedParsed) {
          try {
            const output = parseStructuredOutput(repairedParsed);
            return {
              providerName: this.providerName,
              modelName: request.modelName,
              rawText: repairedText,
              output,
              repaired: true,
              timedOut: false,
            };
          } catch {
            // fail below
          }
        }
      }
    }

    return {
      providerName: this.providerName,
      modelName: request.modelName,
      rawText,
      output: null,
      repaired: false,
      timedOut: false,
      errorMessage: "structured output parse failed",
    };
  }
}

/** Placeholder for future OpenAI wiring — not used in this phase. */
export class OpenAIContentGenerationProvider implements ContentGenerationProvider {
  readonly providerName = "openai";
  async generate(): Promise<ContentGenerationResult> {
    throw new Error("OpenAIContentGenerationProvider is not configured in this phase");
  }
}

/** Placeholder for future Anthropic wiring — not used in this phase. */
export class AnthropicContentGenerationProvider implements ContentGenerationProvider {
  readonly providerName = "anthropic";
  async generate(): Promise<ContentGenerationResult> {
    throw new Error("AnthropicContentGenerationProvider is not configured in this phase");
  }
}

/** Placeholder for future local model wiring — not used in this phase. */
export class LocalContentGenerationProvider implements ContentGenerationProvider {
  readonly providerName = "local";
  async generate(): Promise<ContentGenerationResult> {
    throw new Error("LocalContentGenerationProvider is not configured in this phase");
  }
}

export function createContentGenerationProvider(
  name: string,
): ContentGenerationProvider {
  const normalized = name.trim().toLowerCase();
  if (normalized === "mock") {
    return new MockContentGenerationProvider();
  }
  if (normalized === "openai") {
    return new OpenAIContentGenerationProvider();
  }
  if (normalized === "anthropic") {
    return new AnthropicContentGenerationProvider();
  }
  if (normalized === "local") {
    return new LocalContentGenerationProvider();
  }
  return new MockContentGenerationProvider();
}
