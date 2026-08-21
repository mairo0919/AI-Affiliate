import type { PolicyEvalResult, PolicyRule } from "@ai-affiliate/database";

export interface PolicyTarget {
  targetType: string;
  targetId: string;
  title?: string | null;
  body?: string | null;
  language?: string | null;
  adultFlag?: boolean | null;
  platform?: string | null;
  disclosurePresent?: boolean | null;
  metadata?: Record<string, unknown>;
}

export interface PolicyRuleEvaluation {
  rule: PolicyRule;
  result: PolicyEvalResult;
  matched: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface PolicyEvaluationSummary {
  targetType: string;
  targetId: string;
  overall: PolicyEvalResult;
  evaluations: PolicyRuleEvaluation[];
}

const MINOR_KEYWORDS = ["teen", "underage", "未成年"];

function containsMinorKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return MINOR_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

function worstResult(results: PolicyEvalResult[]): PolicyEvalResult {
  const rank: Record<PolicyEvalResult, number> = {
    BLOCKED: 5,
    MANUAL_REVIEW_REQUIRED: 4,
    WARNING: 3,
    PASSED: 2,
    NOT_APPLICABLE: 1,
  };
  let best: PolicyEvalResult = "PASSED";
  for (const r of results) {
    if (rank[r] > rank[best]) best = r;
  }
  return best;
}

function evalAdultRule(
  rule: PolicyRule,
  target: PolicyTarget,
): PolicyRuleEvaluation | null {
  const condition = (rule.condition ?? {}) as Record<string, unknown>;
  if (condition.check !== "adultFlag") return null;
  const requireAdult = condition.requireAdultFlag === true;
  if (!requireAdult) {
    return {
      rule,
      matched: false,
      result: "NOT_APPLICABLE",
      message: rule.message,
    };
  }
  if (target.adultFlag === true) {
    return {
      rule,
      matched: false,
      result: "PASSED",
      message: "adultFlag is set",
      details: { adultFlag: true },
    };
  }
  return {
    rule,
    matched: true,
    result: rule.resultOnMatch,
    message: rule.message,
    details: { adultFlag: target.adultFlag ?? null },
  };
}

function evalLanguageRule(
  rule: PolicyRule,
  target: PolicyTarget,
): PolicyRuleEvaluation | null {
  const condition = (rule.condition ?? {}) as Record<string, unknown>;
  if (condition.check !== "language") return null;
  const expected = String(condition.expected ?? "ja");
  const language = (target.language ?? "").toLowerCase();
  if (language === expected.toLowerCase() || language.startsWith(`${expected.toLowerCase()}-`)) {
    return {
      rule,
      matched: false,
      result: "PASSED",
      message: `language matches ${expected}`,
      details: { language },
    };
  }
  return {
    rule,
    matched: true,
    result: rule.resultOnMatch,
    message: rule.message,
    details: { language, expected },
  };
}

function evalMinorKeywordRule(
  rule: PolicyRule,
  target: PolicyTarget,
): PolicyRuleEvaluation | null {
  const condition = (rule.condition ?? {}) as Record<string, unknown>;
  if (condition.check !== "noMinorKeywords") return null;
  const haystack = `${target.title ?? ""}\n${target.body ?? ""}`;
  if (containsMinorKeyword(haystack)) {
    return {
      rule,
      matched: true,
      result: rule.resultOnMatch,
      message: rule.message,
      details: { keywords: MINOR_KEYWORDS },
    };
  }
  return {
    rule,
    matched: false,
    result: "PASSED",
    message: "no minor-related keywords detected",
  };
}

function evalDisclosureRule(
  rule: PolicyRule,
  target: PolicyTarget,
): PolicyRuleEvaluation | null {
  const condition = (rule.condition ?? {}) as Record<string, unknown>;
  if (condition.check !== "disclosure") return null;
  if (target.disclosurePresent === true) {
    return {
      rule,
      matched: false,
      result: "PASSED",
      message: "disclosure present",
    };
  }
  return {
    rule,
    matched: true,
    result: rule.resultOnMatch,
    message: rule.message,
    details: { disclosurePresent: target.disclosurePresent ?? false },
  };
}

function evaluateSingleRule(rule: PolicyRule, target: PolicyTarget): PolicyRuleEvaluation {
  const specialized =
    evalAdultRule(rule, target) ??
    evalLanguageRule(rule, target) ??
    evalMinorKeywordRule(rule, target) ??
    evalDisclosureRule(rule, target);

  if (specialized) return specialized;

  return {
    rule,
    matched: false,
    result: "NOT_APPLICABLE",
    message: `unhandled rule condition for ${rule.ruleIdentifier}`,
    details: { condition: rule.condition },
  };
}

export function evaluatePolicies(
  rules: PolicyRule[],
  target: PolicyTarget,
): PolicyEvaluationSummary {
  const evaluations = rules
    .filter((r) => r.enabled)
    .map((rule) => evaluateSingleRule(rule, target));

  const applicable = evaluations
    .filter((e) => e.result !== "NOT_APPLICABLE")
    .map((e) => (e.matched ? e.result : "PASSED"));

  return {
    targetType: target.targetType,
    targetId: target.targetId,
    overall: applicable.length === 0 ? "PASSED" : worstResult(applicable),
    evaluations,
  };
}
