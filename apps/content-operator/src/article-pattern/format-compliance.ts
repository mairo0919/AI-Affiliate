import type { ArticleFormatSpec } from "./types.js";
import { LEGACY_FORMAT_KEYS, normalizeFormatKey } from "./types.js";

export type FormatComplianceFinding = {
  code: string;
  severity: "blocking" | "warning";
  message: string;
};

export type FormatComplianceInput = {
  formatKey?: string | null;
  spec?: ArticleFormatSpec | null;
  /** Structured blogger article if present */
  article?: {
    sections?: Array<{ heading?: string | null; paragraphs?: string[]; lists?: unknown[] }>;
    cta?: { url?: string | null; label?: string | null } | null;
    lead?: string;
    summary?: string;
  } | null;
  body?: string;
  title?: string;
  /** Estimated product slots represented in article (single-product path defaults to 1) */
  estimatedProductCount?: number;
  rankingSignals?: boolean;
  comparisonTableSignals?: boolean;
  imageCount?: number;
};

/**
 * Deterministic article-format-compliance checks.
 * Legacy format keys without ACTIVE spec → pass-through (compat).
 */
export function evaluateArticleFormatCompliance(
  input: FormatComplianceInput,
): {
  ok: boolean;
  findings: FormatComplianceFinding[];
  stageOk: boolean;
} {
  const findings: FormatComplianceFinding[] = [];
  const formatKey = normalizeFormatKey(input.formatKey);
  if (!input.spec || LEGACY_FORMAT_KEYS.has(formatKey)) {
    // Compat path: no ACTIVE registry spec → do not block existing generation
    if (!input.spec) {
      return { ok: true, findings: [], stageOk: true };
    }
  }

  const spec = input.spec;
  if (!spec) return { ok: true, findings: [], stageOk: true };

  const productCount = input.estimatedProductCount ?? 1;
  if (
    productCount < spec.targetProductCount.min ||
    productCount > spec.targetProductCount.max
  ) {
    // Single-product vertical: warn when Format asks for multi until Multi Product ships
    const severity =
      spec.targetProductCount.min <= 1 ? "blocking" : "warning";
    findings.push({
      code: "FORMAT_PRODUCT_COUNT",
      severity,
      message: `productCount=${productCount} outside ${spec.targetProductCount.min}-${spec.targetProductCount.max}`,
    });
  }

  const body = input.body ?? "";
  const sectionHints = [
    ...(input.article?.sections ?? []).map((s) => (s.heading ?? "").toLowerCase()),
    body.toLowerCase(),
  ].join("\n");

  const detectedOrder: string[] = [];
  const hasIntro =
    (input.article?.lead?.length ?? 0) > 0 ||
    (input.title?.length ?? 0) > 0 ||
    body.length >= 40;
  if (hasIntro) detectedOrder.push("intro");
  if ((input.article?.sections?.length ?? 0) > 0 || body.length >= 80) {
    detectedOrder.push("product_sections");
  }
  if (/\|.+\|/.test(body) || /比較/.test(body) || input.comparisonTableSignals) {
    detectedOrder.push("comparison_table");
  }
  if (Boolean(input.article?.cta?.url) || /https?:\/\//i.test(body)) {
    detectedOrder.push("cta");
  }
  if (/faq|よくある質問/i.test(sectionHints)) detectedOrder.push("faq");
  if (/まとめ|要約|summary/i.test(sectionHints)) detectedOrder.push("summary");

  for (const required of spec.requiredSectionOrder) {
    if (required === "intro") {
      if (!hasIntro) {
        findings.push({
          code: "FORMAT_SECTION_MISSING",
          severity: "blocking",
          message: "required section intro missing",
        });
      }
      continue;
    }
    if (required === "cta") {
      if (!detectedOrder.includes("cta")) {
        findings.push({
          code: "FORMAT_CTA_MISSING",
          severity: "blocking",
          message: "required CTA missing",
        });
      }
      continue;
    }
    if (required === "product_sections") {
      if (!detectedOrder.includes("product_sections")) {
        findings.push({
          code: "FORMAT_SECTION_MISSING",
          severity: "blocking",
          message: "required product_sections missing",
        });
      }
      continue;
    }
    if (required === "faq" && !detectedOrder.includes("faq")) {
      findings.push({
        code: "FORMAT_SECTION_MISSING",
        severity: "warning",
        message: "required faq section not detected",
      });
    }
    if (required === "summary" && !detectedOrder.includes("summary")) {
      findings.push({
        code: "FORMAT_SECTION_MISSING",
        severity: "warning",
        message: "required summary section not detected",
      });
    }
  }

  // Soft order check: required roles should appear in relative order when both present
  const requiredPresent = spec.requiredSectionOrder.filter((s) => detectedOrder.includes(s));
  if (requiredPresent.length >= 2) {
    let lastIdx = -1;
    for (const role of requiredPresent) {
      const idx = detectedOrder.indexOf(role);
      if (idx < lastIdx) {
        findings.push({
          code: "FORMAT_SECTION_ORDER",
          severity: "warning",
          message: `section order drift around ${role}`,
        });
        break;
      }
      lastIdx = idx;
    }
  }

  const ctaCount =
    (input.article?.cta?.url ? 1 : 0) + ([...body.matchAll(/https?:\/\/\S+/gi)].length > 0 ? 0 : 0);
  const effectiveCta = Math.max(ctaCount, /https?:\/\//i.test(body) ? 1 : 0);
  if (effectiveCta < spec.ctaPolicy.minCount) {
    findings.push({
      code: "FORMAT_CTA_COUNT",
      severity: "blocking",
      message: `ctaCount=${effectiveCta} < min ${spec.ctaPolicy.minCount}`,
    });
  }

  if (spec.rankingRequired && !(input.rankingSignals || /ランキング|ベスト\s*\d+|best\s*\d+/i.test(body))) {
    findings.push({
      code: "FORMAT_RANKING_REQUIRED",
      severity: "warning",
      message: "rankingRequired but ranking signals not detected",
    });
  }

  if (
    spec.comparisonTableRequired &&
    !(input.comparisonTableSignals || /\|.+\|/.test(body) || /比較/.test(body))
  ) {
    findings.push({
      code: "FORMAT_COMPARISON_REQUIRED",
      severity: "warning",
      message: "comparisonTableRequired but table/comparison not detected",
    });
  }

  if (spec.imagePolicy.enforce && (input.imageCount ?? 0) < spec.imagePolicy.minCount) {
    findings.push({
      code: "FORMAT_IMAGE_POLICY",
      severity: "warning",
      message: `imageCount below min ${spec.imagePolicy.minCount}`,
    });
  }

  if (body.length < spec.lengthPolicy.minChars) {
    findings.push({
      code: "FORMAT_LENGTH",
      severity: "blocking",
      message: `body length ${body.length} < min ${spec.lengthPolicy.minChars}`,
    });
  }

  const blocking = findings.some((f) => f.severity === "blocking");
  return { ok: !blocking, findings, stageOk: !blocking };
}
