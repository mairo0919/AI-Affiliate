/**
 * X backlog / publication eligibility — distribution gate only.
 * Does not change WordPress article generation decisions.
 */

export type XAuditIssueClass =
  | "NORMAL"
  | "TITLE_ISSUE"
  | "BODY_ISSUE"
  | "IDENTITY_ISSUE"
  | "TAXONOMY_ISSUE"
  | "IMAGE_ISSUE"
  | "AFFILIATE_LINK_ISSUE"
  | "PUBLICATION_ISSUE"
  | "SEO_TITLE_DIVERGENCE"
  | "MULTIPLE_ISSUES";

/** Classes that must never auto-backfill to X from legacy inventory. */
export const X_BACKLOG_BLOCKING_CLASSES: ReadonlySet<XAuditIssueClass> = new Set([
  "IDENTITY_ISSUE",
  "TITLE_ISSUE",
  "MULTIPLE_ISSUES",
  "AFFILIATE_LINK_ISSUE",
  "PUBLICATION_ISSUE",
  "BODY_ISSUE",
]);

export type XBacklogEligibilityInput = {
  cid?: string | null;
  classification?: string | null;
  issues?: string[] | null;
  reasons?: string[] | null;
  factoryLinked?: boolean | null;
  bodyEmpty?: boolean | null;
  /** WordPress post status when known (publish / future / draft). */
  wpStatus?: string | null;
};

export type XBacklogEligibility = {
  eligible: boolean;
  reasons: string[];
  /** True when CID is missing / unknown. */
  cidUnknown: boolean;
};

/**
 * Legacy backlog gate: only audit NORMAL + Factory-linked articles.
 * New canonical pipeline articles use Review/approval gates instead (not this).
 */
export function evaluateXBacklogEligibility(
  input: XBacklogEligibilityInput,
): XBacklogEligibility {
  const reasons: string[] = [];
  const cid = input.cid?.trim().toLowerCase() ?? "";
  const cidUnknown = !cid || cid === "unknown" || cid.startsWith("wp-");
  if (cidUnknown) {
    reasons.push("CID_UNKNOWN");
  }
  if (input.factoryLinked !== true) {
    reasons.push("FACTORY_UNLINKED");
  }
  const classification = (input.classification ?? "").trim().toUpperCase();
  if (classification !== "NORMAL") {
    reasons.push(`CLASSIFICATION_${classification || "MISSING"}`);
  }
  for (const issue of input.issues ?? []) {
    const key = issue.trim().toUpperCase() as XAuditIssueClass;
    if (X_BACKLOG_BLOCKING_CLASSES.has(key)) {
      reasons.push(`ISSUE_${key}`);
    }
  }
  for (const reason of input.reasons ?? []) {
    const r = reason.trim().toUpperCase();
    if (
      r === "NO_FACTORY_PUBLICATION_TARGET" ||
      r.includes("AFFILIATE") ||
      r.includes("EMPTY_BODY") ||
      r.includes("BODY_EMPTY")
    ) {
      reasons.push(`REASON_${r}`);
    }
  }
  if (input.bodyEmpty === true) {
    reasons.push("BODY_EMPTY");
  }
  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    cidUnknown,
  };
}

/**
 * WP-guided X posts require a publicly reachable published article.
 * future / draft / scheduled must not drive traffic yet.
 */
export function isWordPressPublicForXTraffic(wpStatus?: string | null): boolean {
  const s = (wpStatus ?? "").trim().toLowerCase();
  return s === "publish" || s === "published";
}

/**
 * Factory PublicationTarget status that may be used as X WP destination.
 */
export function isPublicationTargetPublicForX(status?: string | null): boolean {
  const s = (status ?? "").trim().toUpperCase();
  return s === "PUBLISHED";
}
