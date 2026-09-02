/**
 * Deterministic generation-time checks for claim budget / reuse / generic CTA.
 * Complements Prompt contracts — does not replace Quality Gate.
 */

import type { BloggerArticleStructured } from "./structured-article.js";
import type { ClaimUsagePlan } from "./claim-usage-plan.js";

export type ClaimUsageValidationFinding = {
  code:
    | "CLAIM_ROLE_OVERLAP"
    | "SEMANTIC_EXPANSION_OVER_BUDGET"
    | "GENERIC_CTA_BRIDGE_ONLY"
    | "CTA_BRIDGE_SHOULD_OMIT"
    | "TOO_MANY_SECTIONS_FOR_BUDGET"
    | "SUMMARY_META_INTRO";
  message: string;
  severity: "BLOCKING" | "WARNING";
};

const GENERIC_CTA_RE =
  /ぜひチェック|詳しく確認でき|より深く|詳細は.{0,12}確認|興味を持った方|チェックしてみて/;

const SUMMARY_META_RE = /について紹介します|本記事では|この記事では|をご紹介します/;

/** Rough token-ish units for expansion ratio (script-agnostic). */
function approxUnits(text: string): number {
  return text.replace(/\s+/g, "").length;
}

export function isGenericCtaBridgeSection(section: {
  paragraphs: string[];
  lists: string[];
}): boolean {
  if (section.lists.length > 0) return false;
  const text = section.paragraphs.join("");
  if (text.length < 8) return true;
  if (text.length > 180) return false;
  return GENERIC_CTA_RE.test(text) && !/[A-Za-z0-9一-龯]{8,}/.test(text.replace(GENERIC_CTA_RE, ""));
}

/**
 * Validate article against ClaimUsagePlan (deterministic upstream of Gate).
 */
export function validateArticleAgainstClaimUsagePlan(
  article: BloggerArticleStructured,
  plan: ClaimUsagePlan,
  opts?: { claimStatements?: Array<{ id: string; statement: string }> },
): { ok: boolean; findings: ClaimUsageValidationFinding[]; metrics: Record<string, number> } {
  const findings: ClaimUsageValidationFinding[] = [];

  // Role overlap in plan itself (should never happen)
  const hook = new Set(plan.hookClaimIds);
  for (const id of plan.developmentClaimIds) {
    if (hook.has(id)) {
      findings.push({
        code: "CLAIM_ROLE_OVERLAP",
        message: `claimId ${id} assigned to both hook and interest_development`,
        severity: "BLOCKING",
      });
    }
  }

  if (article.sections.length > plan.effectiveMaxArticleSections) {
    findings.push({
      code: "TOO_MANY_SECTIONS_FOR_BUDGET",
      message: `sections.length=${article.sections.length} > effectiveMaxArticleSections=${plan.effectiveMaxArticleSections}`,
      severity: "BLOCKING",
    });
  }

  if (plan.omitCtaBridge && article.sections.length >= 2) {
    const last = article.sections[article.sections.length - 1]!;
    if (isGenericCtaBridgeSection(last)) {
      findings.push({
        code: "CTA_BRIDGE_SHOULD_OMIT",
        message: "omitCtaBridge=true but last section looks like generic CTA boilerplate",
        severity: "BLOCKING",
      });
    }
  }

  // Generic CTA as sole last section even when not omitted by plan
  // Only when there is a prior substance section — a single section is the body, not a CTA bridge.
  if (article.sections.length >= 2) {
    const last = article.sections[article.sections.length - 1]!;
    if (isGenericCtaBridgeSection(last) && last.paragraphs.join("").length < 100) {
      findings.push({
        code: "GENERIC_CTA_BRIDGE_ONLY",
        message: "Last section is generic CTA encouragement without informational value",
        severity: plan.omitCtaBridge ? "BLOCKING" : "WARNING",
      });
    }
  }

  if (SUMMARY_META_RE.test(article.summary)) {
    findings.push({
      code: "SUMMARY_META_INTRO",
      message: "summary uses article-meta intro phrasing; use list/search snippet instead",
      severity: "WARNING",
    });
  }

  const bodyText = [
    article.lead,
    ...article.sections.flatMap((s) => [...s.paragraphs, ...s.lists]),
  ].join("");
  const bodyUnits = approxUnits(bodyText);
  const claimUnits = (opts?.claimStatements ?? [])
    .filter((c) => plan.hookClaimIds.includes(c.id) || plan.developmentClaimIds.includes(c.id))
    .reduce((acc, c) => acc + Math.min(120, approxUnits(c.statement)), 0);
  const expansionRatio =
    claimUnits > 0 ? Number((bodyUnits / Math.max(80, claimUnits)).toFixed(3)) : 0;
  const paragraphCount =
    ((article.lead ?? "").trim() ? 1 : 0) +
    article.sections.reduce((acc, s) => acc + Math.max(1, s.paragraphs.length), 0);

  // Decision 2: char/paragraph budgets are soft guidance / observability — not quality hard gates.
  if (bodyUnits > plan.claimBudget.targetMaxCharsApprox * 1.35) {
    findings.push({
      code: "SEMANTIC_EXPANSION_OVER_BUDGET",
      message: `body ~${bodyUnits} chars exceeds soft claimBudget.targetMaxCharsApprox=${plan.claimBudget.targetMaxCharsApprox} (expansionRatio=${expansionRatio}) — WARNING only; quality uses information gain / repetition`,
      severity: "WARNING",
    });
  }
  if (paragraphCount > plan.claimBudget.targetMaxParagraphs + 1) {
    findings.push({
      code: "SEMANTIC_EXPANSION_OVER_BUDGET",
      message: `paragraphCount=${paragraphCount} exceeds soft claimBudget.targetMaxParagraphs=${plan.claimBudget.targetMaxParagraphs}`,
      severity: "WARNING",
    });
  }

  const blocking = findings.some((f) => f.severity === "BLOCKING");
  return {
    ok: !blocking,
    findings,
    metrics: {
      bodyUnits,
      claimUnits,
      expansionRatio,
      paragraphCount,
      sectionCount: article.sections.length,
      uniqueClaimsAssigned: plan.claimBudget.assignedCount,
    },
  };
}

/** Fixture helpers: v6-like failure signals (category-level, not product names). */
export function detectV6FailureClasses(article: BloggerArticleStructured): string[] {
  const hits: string[] = [];
  const body = [
    article.lead,
    ...article.sections.flatMap((s) => s.paragraphs),
    article.summary,
  ].join("\n");

  // Semantic repetition heuristic: distinctive katakana/kanji facets reused lead→body
  const lead = article.lead ?? "";
  const rest = article.sections.flatMap((s) => s.paragraphs).join("");
  const facets = [
    ...(lead.match(/[\u30a0-\u30ff]{3,}/g) ?? []),
    ...(lead.match(/[\u4e00-\u9fff]{2,}/g) ?? []),
    ...(lead.match(/[A-Za-z0-9]+[\u30a0-\u30ff\u4e00-\u9fff]{2,}/g) ?? []),
  ];
  const uniqueFacets = [...new Set(facets.filter((f) => f.length >= 2))];
  let reuse = 0;
  for (const f of uniqueFacets) {
    if (rest.includes(f)) reuse += 1;
  }
  if (reuse >= 3) hits.push("semantic_claim_repetition");

  if (/舞台にした|見た目とは裏腹|楽しめます|適した作品|ギャップが興味/.test(body)) {
    hits.push("unsupported_or_weak_inference");
  }
  if (article.sections.some((s) => isGenericCtaBridgeSection(s))) {
    hits.push("generic_cta_boilerplate");
  }
  if (SUMMARY_META_RE.test(article.summary)) hits.push("summary_meta_intro");
  if (article.sections.reduce((a, s) => a + s.paragraphs.length, 0) >= 5 && facets.length <= 8) {
    hits.push("claim_scarce_padding");
  }
  return hits;
}
