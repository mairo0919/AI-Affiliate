import type { Claim } from "@ai-affiliate/database";
import type { BloggerArticleStructured } from "./structured-article.js";

export interface ClaimValidationFinding {
  code: string;
  message: string;
  severity: "BLOCKING" | "WARNING";
}

export interface ClaimValidationResult {
  ok: boolean;
  findings: ClaimValidationFinding[];
  allowedClaimIds: string[];
}

/** Absolute / superlative phrasings that are blocked unless Evidence/Plan-attested. */
export const ABSOLUTE_CLAIM_PATTERNS: RegExp[] = [
  /絶対に/,
  /世界一/,
  /確実に稼げる/,
  /必ず当たる/,
];

/**
 * Collect fact surfaces from ARTICLE_PLAN (Evidence → Plan SSOT).
 * Used to distinguish source-attested superlatives from Writer-invented ones.
 */
export function attestedSurfacesFromArticlePlan(plan: {
  title?: { facts?: readonly string[] | null } | null;
  lead?: { facts?: readonly string[] | null } | null;
  body?: ReadonlyArray<{ facts?: readonly string[] | null } | null> | null;
} | null | undefined): string[] {
  if (!plan) return [];
  const out: string[] = [];
  for (const slot of [plan.title, plan.lead, ...(plan.body ?? [])]) {
    if (!slot?.facts) continue;
    for (const fact of slot.facts) {
      if (typeof fact === "string" && fact.trim().length > 0) out.push(fact);
    }
  }
  return out;
}

function isAbsolutePatternAttested(pattern: RegExp, attestedSurfaces: readonly string[]): boolean {
  if (attestedSurfaces.length === 0) return false;
  const blob = attestedSurfaces.join("\n");
  return pattern.test(blob);
}

/**
 * Only SUPPORTED claims may be asserted as facts in publishable body.
 * PARTIALLY_SUPPORTED requires human confirmation / limited wording.
 */
export function validateClaimsAgainstArticle(input: {
  article: BloggerArticleStructured;
  claims: Claim[];
  bodyText: string;
  /**
   * OPTION B: Evidence Pack item ids (title_facet::*, title::full, research ids)
   * are valid provenance refs — not DB Claim rows.
   */
  allowedEvidenceIds?: string[];
  /**
   * Evidence/ARTICLE_PLAN fact surfaces that may contain source-attested
   * absolute/superlative phrasing. When a hard pattern appears in the body
   * AND in these surfaces, it is treated as source-attested (not unsupported).
   * Invented superlatives with empty/non-matching attestation remain BLOCKING.
   */
  attestedEvidenceSurfaces?: readonly string[];
}): ClaimValidationResult {
  const findings: ClaimValidationFinding[] = [];
  const byId = new Map(input.claims.map((c) => [c.id, c]));
  const allowed = input.claims.filter((c) => c.status === "SUPPORTED").map((c) => c.id);
  const evidenceIds = new Set(input.allowedEvidenceIds ?? []);
  const partial = new Set(
    input.claims.filter((c) => c.status === "PARTIALLY_SUPPORTED").map((c) => c.id),
  );
  const blockedStatuses = new Set(["DISPUTED", "OUTDATED", "UNSUPPORTED", "REJECTED"]);
  const attested = input.attestedEvidenceSurfaces ?? [];

  for (const claimId of input.article.usedClaimIds) {
    if (evidenceIds.has(claimId)) {
      // Evidence Pack atom — grounded by pack, not Claim table
      continue;
    }
    const claim = byId.get(claimId);
    if (!claim) {
      findings.push({
        code: "UNKNOWN_CLAIM_ID",
        message: `usedClaimIds references missing claim ${claimId}`,
        severity: "BLOCKING",
      });
      continue;
    }
    if (blockedStatuses.has(claim.status)) {
      findings.push({
        code: "BLOCKED_CLAIM_STATUS",
        message: `Claim ${claimId} status ${claim.status} cannot be asserted as fact`,
        severity: "BLOCKING",
      });
    }
    if (claim.status === "PARTIALLY_SUPPORTED") {
      findings.push({
        code: "PARTIAL_CLAIM_NEEDS_REVIEW",
        message: `Claim ${claimId} is partially supported and needs human confirmation`,
        severity: "WARNING",
      });
    }
  }

  // Absolute/superlative: reject invented uses; allow Evidence/Plan-attested surfaces.
  for (const pattern of ABSOLUTE_CLAIM_PATTERNS) {
    if (!pattern.test(input.bodyText)) continue;
    if (isAbsolutePatternAttested(pattern, attested)) continue;
    findings.push({
      code: "UNSUPPORTED_SUPERLATIVE",
      message: `Body contains unsupported absolute phrasing: ${pattern}`,
      severity: "BLOCKING",
    });
  }

  // Mark unused unsupported claims that appear as statements
  for (const claim of input.claims) {
    if (!blockedStatuses.has(claim.status)) continue;
    const snippet = claim.statement.slice(0, 24);
    if (snippet.length >= 8 && input.bodyText.includes(snippet)) {
      findings.push({
        code: "BLOCKED_CLAIM_IN_BODY",
        message: `Body appears to assert blocked claim ${claim.id}`,
        severity: "BLOCKING",
      });
    }
  }

  void partial;
  const ok = !findings.some((f) => f.severity === "BLOCKING");
  return { ok, findings, allowedClaimIds: allowed };
}
