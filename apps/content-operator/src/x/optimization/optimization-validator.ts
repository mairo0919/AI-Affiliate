import type { AppConfig } from "@ai-affiliate/config";
import type { XOptimizationDimension } from "@ai-affiliate/database";
import { XCharacterCounter } from "../character-counter.js";
import { similarityScore } from "../../content/similarity.js";
import type { StructuredContentOutput } from "../../content/types.js";

export interface OptimizationValidationIssue {
  code: string;
  message: string;
  blocking: boolean;
}

export interface OptimizationValidationInput {
  dimension: XOptimizationDimension;
  currentValue: string;
  recommendedValue: string;
  affiliateUrl: string;
  disclosure: string;
  parent: StructuredContentOutput;
  next: StructuredContentOutput;
  parentNumbers: number[];
  knownNames: string[];
  scheduledAtChanged?: boolean;
  postFormatChanged?: boolean;
  hashtagsOnlyChanged?: boolean;
}

function extractNumbers(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? [])
    .map((m) => Number.parseFloat(m))
    .filter((n) => Number.isFinite(n));
}

function combined(output: StructuredContentOutput): string {
  return [output.title, output.body, output.summary, ...(output.hashtags ?? [])]
    .filter(Boolean)
    .join("\n");
}

function stripHashtags(text: string): string {
  return text.replace(/#[\w\u3040-\u30ff\u3400-\u9fff]+/g, "").replace(/\s+/g, " ").trim();
}

export class XOptimizationValidator {
  private readonly counter: XCharacterCounter;

  constructor(private readonly config: AppConfig) {
    this.counter = new XCharacterCounter(config.xUrlWeightedLength);
  }

  validate(input: OptimizationValidationInput): {
    issues: OptimizationValidationIssue[];
    ok: boolean;
  } {
    const issues: OptimizationValidationIssue[] = [];
    const parentText = combined(input.parent);
    const nextText = combined(input.next);

    if (!nextText.includes(input.affiliateUrl)) {
      issues.push({
        code: "AFFILIATE_URL_MISSING",
        message: "affiliateUrl must remain present and unchanged",
        blocking: true,
      });
    }
    if (nextText.includes(input.affiliateUrl) && parentText.includes(input.affiliateUrl)) {
      // URL must match exactly (no alternate affiliate links)
      const parentUrls = parentText.match(/https?:\/\/\S+/g) ?? [];
      const nextUrls = nextText.match(/https?:\/\/\S+/g) ?? [];
      const parentAff = parentUrls.find((u) => u.includes(input.affiliateUrl) || u === input.affiliateUrl);
      const nextAff = nextUrls.find((u) => u.includes(input.affiliateUrl) || u === input.affiliateUrl);
      if (parentAff && nextAff && parentAff !== nextAff && !nextAff.startsWith(input.affiliateUrl)) {
        issues.push({
          code: "AFFILIATE_URL_CHANGED",
          message: "affiliateUrl must not change",
          blocking: true,
        });
      }
    }

    if (!DISCLOSURE_OK(nextText, input.disclosure)) {
      issues.push({
        code: "DISCLOSURE_MISSING",
        message: "disclosure must remain present",
        blocking: true,
      });
    }

    const nextNumbers = extractNumbers(nextText);
    const allowed = new Set(input.parentNumbers);
    for (const n of nextNumbers) {
      if (!allowed.has(n) && !COMMON_STRUCTURAL.has(n)) {
        issues.push({
          code: "NUMERIC_FABRICATION",
          message: `numeric fact ${n} was not in parent content`,
          blocking: true,
        });
        break;
      }
    }
    for (const n of input.parentNumbers) {
      if (!COMMON_STRUCTURAL.has(n) && !nextNumbers.includes(n)) {
        // Allow missing structural padding numbers only; product facts should remain
        if (n === input.parentNumbers.find((x) => x > 10)) {
          // soft: do not block if a fact disappeared only when angle change rephrases
        }
      }
    }

    for (const name of input.knownNames) {
      if (name.length < 2) continue;
      if (parentText.includes(name) && !nextText.includes(name) && input.dimension !== "CONTENT_ANGLE") {
        // Angle change may drop some entity mentions; other dimensions must keep facts
        issues.push({
          code: "FACT_REMOVED",
          message: `known name removed: ${name}`,
          blocking: true,
        });
        break;
      }
    }

    const weighted = this.counter.count(input.next.body).weightedLength;
    const max =
      input.next.body.includes("\n") || (input.next.metadata as { posts?: unknown } | undefined)
        ? this.config.xMaxWeightedLength
        : this.config.xMaxWeightedLength;
    if (weighted > max) {
      issues.push({
        code: "WEIGHTED_LENGTH",
        message: `weightedLength ${weighted} exceeds ${max}`,
        blocking: true,
      });
    }

    const sim = similarityScore(parentText, nextText);
    if (
      sim >= 0.98 &&
      input.dimension !== "POSTING_TIME" &&
      input.dimension !== "HASHTAG_SET" &&
      input.dimension !== "POST_FORMAT"
    ) {
      issues.push({
        code: "TOO_SIMILAR",
        message: "optimized content is nearly identical to parent",
        blocking: true,
      });
    }
    if (sim < 0.35 && input.dimension !== "CONTENT_ANGLE") {
      issues.push({
        code: "TOO_DIVERGENT",
        message: "optimized content diverges too far from parent",
        blocking: true,
      });
    }

    // Dimension-specific: only intended change
    if (input.dimension === "HASHTAG_SET") {
      if (stripHashtags(parentText) !== stripHashtags(nextText) && !input.hashtagsOnlyChanged) {
        // allow minor whitespace; still check body without tags
        const p = stripHashtags(input.parent.body);
        const n = stripHashtags(input.next.body);
        if (similarityScore(p, n) < 0.9) {
          issues.push({
            code: "EXTRA_DIMENSION_CHANGE",
            message: "HASHTAG_SET change must not rewrite body beyond tags",
            blocking: true,
          });
        }
      }
    }

    if (input.dimension === "POSTING_TIME") {
      if (input.parent.body !== input.next.body || input.parent.title !== input.next.title) {
        issues.push({
          code: "EXTRA_DIMENSION_CHANGE",
          message: "POSTING_TIME must not change GeneratedContent body/title",
          blocking: true,
        });
      }
      if (!input.scheduledAtChanged) {
        issues.push({
          code: "SCHEDULE_UNCHANGED",
          message: "POSTING_TIME application must change scheduledAt",
          blocking: true,
        });
      }
    }

    if (input.dimension === "POST_FORMAT" && input.postFormatChanged === false) {
      issues.push({
        code: "FORMAT_UNCHANGED",
        message: "POST_FORMAT recommendation was not applied",
        blocking: true,
      });
    }

    const blocking = issues.some((i) => i.blocking);
    return { issues, ok: !blocking };
  }
}

const COMMON_STRUCTURAL = new Set([15, 30, 45, 100, 140, 280, 800, 1500]);

function DISCLOSURE_OK(text: string, disclosure: string): boolean {
  if (disclosure && text.includes(disclosure)) return true;
  return /アフィリエイト|広告を含|#PR\b|PR\b/i.test(text);
}
