import type { AppConfig } from "@ai-affiliate/config";
import type {
  ContentRepository,
  ContentTargetChannel,
  ContentValidationIssueType,
  ContentValidationSeverity,
  GeneratedContentType,
  ValidationIssueInput,
} from "@ai-affiliate/database";
import { extractForbiddenSnippetsFromRawData } from "./forbidden-text.js";
import {
  hashNormalizedContent,
  hashSnippet,
  normalizeContentText,
  truncateDetectedValue,
} from "./normalize.js";
import { similarityScore } from "./similarity.js";
import type { SafeContentGenerationInput, StructuredContentOutput } from "./types.js";

const PROHIBITED_PHRASES = [
  "絶対におすすめ",
  "必ず満足",
  "効果を保証",
  "100%満足",
  "全年齢向け",
];

const DISCLOSURE_PATTERNS = [/アフィリエイト/, /広告を含/, /PR\b/i, /promoted/i];

export interface ValidationContext {
  contentType: GeneratedContentType;
  targetChannel: ContentTargetChannel;
  input: SafeContentGenerationInput;
  output: StructuredContentOutput;
  researchItemId: string;
  rawData?: unknown;
  selectedImageId?: string | null;
  imageUsageById?: Map<string, string>;
  excludeContentId?: string;
}

export interface ValidationOutcome {
  issues: ValidationIssueInput[];
  status: "VALIDATION_FAILED" | "REVIEW_REQUIRED";
  contentHash: string;
}

function issue(
  issueType: ContentValidationIssueType,
  severity: ContentValidationSeverity,
  message: string,
  fieldName?: string,
  detectedValue?: string,
): ValidationIssueInput {
  return {
    issueType,
    severity,
    message,
    fieldName: fieldName ?? null,
    detectedValue: detectedValue ?? null,
  };
}

function combinedText(output: StructuredContentOutput): string {
  return [output.title, output.body, output.summary, output.callToAction, ...(output.hashtags ?? [])]
    .filter(Boolean)
    .join("\n");
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+(?:\.\d+)?/g) ?? [];
  return matches.map((m) => Number.parseFloat(m)).filter((n) => Number.isFinite(n));
}

function knownNumbers(input: SafeContentGenerationInput): Set<number> {
  const values = [
    input.price,
    input.discountRate,
    input.reviewAverage,
    input.reviewCount,
    input.rankingPosition,
    input.scores.totalScore,
    input.scores.popularityScore,
    input.scores.trendScore,
    input.scores.reviewScore,
    input.scores.priceScore,
    input.scores.freshnessScore,
    input.scores.dataQualityScore,
  ].filter((v): v is number => v != null && Number.isFinite(v));

  // Allow common structural numbers (years in ISO, durations, percentages already listed)
  const extras = [15, 30, 45, 100, 800, 1500, 140, 280];
  return new Set([...values, ...extras].map((n) => Number(n)));
}

function knownNames(input: SafeContentGenerationInput): Set<string> {
  const names = [
    input.title,
    ...input.tags.actress,
    ...input.tags.genre,
    ...input.tags.maker,
    ...input.tags.label,
    ...input.tags.series,
    ...input.tags.director,
  ];
  return new Set(names.map((n) => n.toLowerCase()));
}

export class ContentValidator {
  constructor(
    private readonly config: AppConfig,
    private readonly contents: ContentRepository,
  ) {}

  async validate(context: ValidationContext): Promise<ValidationOutcome> {
    const issues: ValidationIssueInput[] = [];
    const { output, input } = context;
    const text = combinedText(output);
    const contentHash = hashNormalizedContent(output.body);

    if (!output.title?.trim() || !output.body?.trim()) {
      issues.push(issue("EMPTY_CONTENT", "BLOCKING", "title/body must not be empty"));
    }

    if (!input.affiliateUrl) {
      issues.push(issue("MISSING_AFFILIATE_URL", "BLOCKING", "input affiliateUrl missing"));
    } else if (output.body.includes(input.affiliateUrl) === false && context.contentType !== "SHORT_VIDEO_SCRIPT") {
      // Blog/X/intro should keep URL; short video may put CTA without repeating URL in body
      if (context.contentType === "X_POST" || context.contentType === "PRODUCT_INTRODUCTION") {
        issues.push(
          issue(
            "INVALID_AFFILIATE_URL",
            "BLOCKING",
            "affiliateUrl from input must appear unchanged in body",
            "affiliateUrl",
          ),
        );
      }
    }

    // Detect invented affiliate URLs (http links that are not the input URL)
    const urls = output.body.match(/https?:\/\/[^\s<>"']+/g) ?? [];
    for (const url of urls) {
      const cleaned = url.replace(/[.,)\]。、！？]+$/u, "");
      if (input.affiliateUrl && cleaned !== input.affiliateUrl) {
        issues.push(
          issue(
            "INVALID_AFFILIATE_URL",
            "BLOCKING",
            "body contains URL that is not the input affiliateUrl",
            "affiliateUrl",
            truncateDetectedValue(cleaned),
          ),
        );
      }
    }

    if (/rawData|apiKey|DMM_API|Authorization/i.test(text)) {
      issues.push(
        issue("RAW_DATA_EXPOSURE", "BLOCKING", "possible raw/secret exposure in content"),
      );
    }

    const forbidden = extractForbiddenSnippetsFromRawData(context.rawData);
    const threshold = this.config.contentForbiddenTextSimilarityThreshold;
    for (const snippet of forbidden.descriptions) {
      const score = similarityScore(normalizeContentText(output.body), normalizeContentText(snippet));
      if (score >= threshold || output.body.includes(snippet.slice(0, 40))) {
        issues.push(
          issue(
            "FORBIDDEN_SOURCE_TEXT",
            "BLOCKING",
            "generated text similar to forbidden product description",
            "body",
            `hash:${hashSnippet(snippet)}`,
          ),
        );
      }
    }
    for (const snippet of forbidden.reviews) {
      const score = similarityScore(normalizeContentText(output.body), normalizeContentText(snippet));
      if (score >= threshold || output.body.includes(snippet.slice(0, 40))) {
        issues.push(
          issue(
            "REVIEW_TEXT_DETECTED",
            "BLOCKING",
            "generated text similar to review text",
            "body",
            `hash:${hashSnippet(snippet)}`,
          ),
        );
      }
    }

    // Fabricated numbers (heuristic: large integers not in known set)
    const known = knownNumbers(input);
    for (const num of extractNumbers(text)) {
      if (num >= 1000 && !known.has(num) && !String(input.publishedAt ?? "").includes(String(num))) {
        // ignore year-like and hash-like
        if (num >= 1900 && num <= 2100) continue;
        issues.push(
          issue(
            "FABRICATED_FACT",
            "WARNING",
            "numeric value not present in generation input",
            "body",
            String(num),
          ),
        );
      }
    }

    // Explicit fabricated ranking/discount checks when input lacks them
    if (input.rankingPosition == null && /第\s*\d+\s*位|ランキング\s*\d+/.test(text)) {
      issues.push(
        issue("FABRICATED_FACT", "BLOCKING", "ranking claim without input rankingPosition", "body"),
      );
    }
    if (input.discountRate == null && /\d+\s*%\s*OFF|割引率\s*\d+/i.test(text)) {
      issues.push(
        issue("FABRICATED_FACT", "BLOCKING", "discount claim without input discountRate", "body"),
      );
    }

    // Name fabrication: look for 「出演: XYZ」 patterns with unknown names
    const nameMatches = text.match(/(?:出演|メーカー|シリーズ)[:：]\s*([^\s、。,/]+)/g) ?? [];
    const allowed = knownNames(input);
    for (const match of nameMatches) {
      const name = match.split(/[:：]/)[1]?.trim();
      if (name && !allowed.has(name.toLowerCase()) && name !== input.title) {
        issues.push(
          issue(
            "FABRICATED_FACT",
            "BLOCKING",
            "person/maker/series name not in input tags",
            "body",
            truncateDetectedValue(name),
          ),
        );
      }
    }

    if (context.contentType === "X_POST") {
      const length = [...output.body].length;
      if (length > this.config.contentXMaxLength) {
        issues.push(
          issue(
            "LENGTH_EXCEEDED",
            "BLOCKING",
            `X post length ${length} exceeds ${this.config.contentXMaxLength}`,
            "body",
            String(length),
          ),
        );
      }
    }

    if (context.contentType === "BLOG_ARTICLE") {
      const length = [...output.body].length;
      if (length < this.config.contentBlogMinLength) {
        issues.push(
          issue(
            "LENGTH_TOO_SHORT",
            "WARNING",
            `blog length ${length} below ${this.config.contentBlogMinLength}`,
            "body",
            String(length),
          ),
        );
      }
      if (length > this.config.contentBlogMaxLength) {
        issues.push(
          issue(
            "LENGTH_EXCEEDED",
            "WARNING",
            `blog length ${length} above ${this.config.contentBlogMaxLength}`,
            "body",
            String(length),
          ),
        );
      }
    }

    if (context.contentType === "SHORT_VIDEO_SCRIPT") {
      const seconds = output.metadata?.estimatedDurationSeconds;
      if (
        seconds == null ||
        seconds < this.config.contentVideoMinSeconds ||
        seconds > this.config.contentVideoMaxSeconds
      ) {
        issues.push(
          issue(
            "LENGTH_EXCEEDED",
            "BLOCKING",
            `video seconds out of range ${this.config.contentVideoMinSeconds}-${this.config.contentVideoMaxSeconds}`,
            "metadata.estimatedDurationSeconds",
            seconds == null ? "missing" : String(seconds),
          ),
        );
      }
    }

    if (!output.callToAction?.trim() && !/詳細|チェック|確認/.test(output.body)) {
      issues.push(issue("UNSUPPORTED_CLAIM", "WARNING", "CTA missing", "callToAction"));
    }

    if (
      context.contentType === "BLOG_ARTICLE" ||
      context.contentType === "X_POST" ||
      context.contentType === "PRODUCT_INTRODUCTION"
    ) {
      if (!DISCLOSURE_PATTERNS.some((re) => re.test(text))) {
        issues.push(
          issue("MISSING_DISCLOSURE", "BLOCKING", "affiliate disclosure missing", "body"),
        );
      }
    }

    for (const phrase of PROHIBITED_PHRASES) {
      if (text.includes(phrase)) {
        issues.push(
          issue("UNSUPPORTED_CLAIM", "BLOCKING", `prohibited phrase: ${phrase}`, "body", phrase),
        );
      }
    }

    if (context.selectedImageId) {
      const usage = context.imageUsageById?.get(context.selectedImageId);
      if (usage === "NOT_ALLOWED") {
        issues.push(
          issue("PROHIBITED_IMAGE", "BLOCKING", "NOT_ALLOWED image selected", "imageId"),
        );
      }
      if (usage === "UNKNOWN" || usage === "REQUIRES_CONFIRMATION") {
        issues.push(
          issue(
            "IMAGE_CONFIRMATION_REQUIRED",
            "BLOCKING",
            "unconfirmed image cannot be auto-adopted",
            "imageId",
            usage,
          ),
        );
      }
    }

    // Exact duplicate
    const exact = await this.contents.findDuplicateByHash(contentHash, {
      researchItemId: context.researchItemId,
      contentType: context.contentType,
      targetChannel: context.targetChannel,
      excludeId: context.excludeContentId,
    });
    if (exact) {
      issues.push(
        issue(
          "DUPLICATE_CONTENT",
          "BLOCKING",
          "exact duplicate contentHash detected",
          "body",
          exact.id,
        ),
      );
    }

    // Approximate duplicate
    const recent = await this.contents.findRecentSimilarContents({
      researchItemId: context.researchItemId,
      contentType: context.contentType,
      targetChannel: context.targetChannel,
      excludeId: context.excludeContentId,
      limit: 10,
    });
    const dupThreshold = this.config.contentDuplicateSimilarityThreshold;
    const dupSeverity =
      this.config.contentDuplicateSimilaritySeverity === "BLOCKING" ? "BLOCKING" : "WARNING";
    const normalizedBody = normalizeContentText(output.body);
    for (const row of recent) {
      if (exact && row.id === exact.id) continue;
      const score = similarityScore(normalizedBody, normalizeContentText(row.body));
      if (score >= dupThreshold) {
        issues.push(
          issue(
            "DUPLICATE_CONTENT",
            dupSeverity,
            `approximate duplicate similarity=${score.toFixed(3)}`,
            "body",
            row.id,
          ),
        );
        break;
      }
    }

    const blocking = issues.some((entry) => entry.severity === "BLOCKING");
    return {
      issues,
      status: blocking ? "VALIDATION_FAILED" : "REVIEW_REQUIRED",
      contentHash,
    };
  }
}
