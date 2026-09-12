/**
 * Ensure published HTML / X body / export never contain internal link machinery.
 */

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "productLinkId", pattern: /\b(?:productLinkId|ProductLink)[:\s=]+[a-z0-9_-]+/gi },
  { name: "cuidProductLink", pattern: /\bpl_[a-z0-9]{8,}\b/gi },
  { name: "affiliateReplacementCandidate", pattern: /affiliateReplacementCandidate/gi },
  { name: "replacementStatus", pattern: /replacementStatus\s*[:=]/gi },
  { name: "templateMustache", pattern: /\{\{[^}]+\}\}/g },
  // Placeholders like %PRODUCT_ID% — not URL-encoding fragments like %E3% / %81%.
  { name: "templatePercent", pattern: /%[A-Za-z_][A-Za-z0-9_]{2,}%/g },
  { name: "pendingUrl", pattern: /\bpending:\/\/\S+/gi },
  { name: "internalScheme", pattern: /\b(?:productlink|internal|aff-candidate):\/\/\S+/gi },
  {
    name: "statusEnumLeak",
    pattern:
      /\b(?:NOT_APPLICABLE|AWAITING_PROVIDER|AWAITING_MATCH|CANDIDATE_FOUND|AWAITING_APPROVAL)\b/g,
  },
];

export interface PublicBodySanitizeResult {
  body: string;
  removed: string[];
  clean: boolean;
}

export function sanitizePublicBody(input: string): PublicBodySanitizeResult {
  let body = input;
  const removed: string[] = [];
  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.pattern.test(body)) {
      removed.push(rule.name);
      body = body.replace(rule.pattern, "");
    }
    // reset lastIndex for global regex reuse
    rule.pattern.lastIndex = 0;
  }
  // Collapse leftover whitespace from removals
  body = body.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { body, removed, clean: removed.length === 0 };
}

export function assertPublicBodyClean(body: string): void {
  const result = sanitizePublicBody(body);
  // Re-scan original for presence (sanitize may clean; we need detect)
  const leaks: string[] = [];
  for (const rule of FORBIDDEN_PATTERNS) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(body)) {
      leaks.push(rule.name);
    }
    rule.pattern.lastIndex = 0;
  }
  if (leaks.length > 0) {
    throw new Error(`Public body contains internal markers: ${leaks.join(", ")}`);
  }
  void result;
}

export function containsInternalLinkMarkers(body: string): boolean {
  for (const rule of FORBIDDEN_PATTERNS) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(body)) {
      rule.pattern.lastIndex = 0;
      return true;
    }
    rule.pattern.lastIndex = 0;
  }
  return false;
}
