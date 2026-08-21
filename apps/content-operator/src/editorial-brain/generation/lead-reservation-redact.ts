/**
 * Safe reservation / lead-consumed redaction.
 * NEVER blind-deletes tokens mid-clause (creates 「は、を目指す」).
 * Prefer clause-level removal; if unsafe → fail (caller routes as plan failure).
 */

import { contributionFacetPresent } from "./contribution-compliance.js";
import { validatePostTransformIntegrity } from "./post-transform-integrity.js";

export type SafeRedactResult = {
  ok: boolean;
  lead: string;
  sections?: Array<{ paragraphs: string[]; heading?: string | null; lists?: string[] }>;
  method: "unchanged" | "clause_removed" | "failed_unsafe";
  failureCode?: "RAW_PLAN_EXECUTION_FAILED" | "POST_TRANSFORM_INTEGRITY_FAILED";
  failureMessage?: string;
};

function cleanupProse(text: string): string {
  return text
    .replace(/のの+/g, "の")
    .replace(/、+/g, "、")
    .replace(/。。+/g, "。")
    .replace(/\s{2,}/g, " ")
    .replace(/のとして/g, "として")
    .replace(/は、、/g, "は、")
    .trim();
}

export function expandReservationRedactionTokens(facets: string[]): string[] {
  const out = new Set<string>();
  for (const raw of facets) {
    const f = raw.trim();
    if (f.length < 2) continue;
    out.add(f);
    const stems =
      f.match(
        /大?乱交|発掘|育成|ベロキス|生ハメ|潮吹[きき]?|ピストン|イヤラ|舐め尽|わからせ|痴女|メスガキ|姉妹洗脳|濃厚親父/g,
      ) ?? [];
    for (const s of stems) {
      if (s.length >= 2) out.add(s);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Split into clause-like units ending with 。！？ or 、-bounded phrases when needed. */
function splitClauses(text: string): string[] {
  const parts = text.split(/(?<=[。．!！?？])/);
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    // If still contains reserved-risk mid structure, keep as single clause unit
    out.push(t);
  }
  return out.length > 0 ? out : [text];
}

function clauseContainsFacet(clause: string, facet: string): boolean {
  return clause.includes(facet);
}

/**
 * Remove reserved body facets from lead by dropping whole clauses that contain them.
 * If removal would destroy required facets or leave broken Japanese → fail.
 */
export function redactReservedLeadAssertions(input: {
  lead: string;
  reservedFacets: string[];
  requiredFacets: string[];
}): string {
  // Back-compat: return string. Prefer safeRedactReservedLead for ok/fail.
  const safe = safeRedactReservedLead(input);
  return safe.ok ? safe.lead : input.lead;
}

export function safeRedactReservedLead(input: {
  lead: string;
  reservedFacets: string[];
  requiredFacets: string[];
}): SafeRedactResult {
  const lead = (input.lead ?? "").trim();
  if (!lead) return { ok: true, lead, method: "unchanged" };

  const required = input.requiredFacets.map((f) => f.trim()).filter((f) => f.length >= 2);
  const reserved = expandReservationRedactionTokens(input.reservedFacets).filter(
    (f) => !required.some((r) => r === f || r.includes(f) || f.includes(r)),
  );

  const hits = reserved.filter((f) => lead.includes(f));
  if (hits.length === 0) return { ok: true, lead, method: "unchanged" };

  // Blind token deletion is forbidden — attempt clause removal only
  const clauses = splitClauses(lead);
  const kept = clauses.filter((c) => !hits.some((f) => clauseContainsFacet(c, f)));
  if (kept.length === 0) {
    return {
      ok: false,
      lead,
      method: "failed_unsafe",
      failureCode: "RAW_PLAN_EXECUTION_FAILED",
      failureMessage: "reserved facets present but no safe clause remains after removal",
    };
  }

  // If every clause had a hit and we kept nothing useful
  const next = cleanupProse(kept.join(""));
  const requiredOk =
    required.length === 0 || required.some((r) => contributionFacetPresent(next, r));
  if (!requiredOk) {
    return {
      ok: false,
      lead,
      method: "failed_unsafe",
      failureCode: "RAW_PLAN_EXECUTION_FAILED",
      failureMessage: "clause redaction would drop required lead facets",
    };
  }

  // Still contains reserved? mid-clause only — cannot safely delete tokens
  if (hits.some((f) => next.includes(f))) {
    return {
      ok: false,
      lead,
      method: "failed_unsafe",
      failureCode: "RAW_PLAN_EXECUTION_FAILED",
      failureMessage: "reserved facet embedded mid-clause; blind token delete forbidden",
    };
  }

  const integrity = validatePostTransformIntegrity({
    lead: next,
    sections: [],
  });
  if (!integrity.ok) {
    return {
      ok: false,
      lead,
      method: "failed_unsafe",
      failureCode: "POST_TRANSFORM_INTEGRITY_FAILED",
      failureMessage: integrity.findings.map((f) => f.message).join("; "),
    };
  }

  return { ok: true, lead: next, method: "clause_removed" };
}

/**
 * Body redaction: drop whole paragraphs that only restate lead-consumed facets,
 * never mid-token delete.
 */
export function redactLeadConsumedFromBody(input: {
  sections: Array<{ paragraphs: string[]; heading?: string | null; lists?: string[] }>;
  leadConsumedFacets: string[];
  bodyRequiredFacets: string[];
}): Array<{ paragraphs: string[]; heading?: string | null; lists?: string[] }> {
  const safe = safeRedactLeadConsumedFromBody(input);
  return safe.sections ?? input.sections;
}

export function safeRedactLeadConsumedFromBody(input: {
  sections: Array<{ paragraphs: string[]; heading?: string | null; lists?: string[] }>;
  leadConsumedFacets: string[];
  bodyRequiredFacets: string[];
}): SafeRedactResult {
  const consumed = expandReservationRedactionTokens(input.leadConsumedFacets);
  const required = input.bodyRequiredFacets.map((f) => f.trim()).filter((f) => f.length >= 2);

  let changed = false;
  const sections = input.sections.map((sec) => {
    const paragraphs = sec.paragraphs
      .map((p) => {
        const hit = consumed.filter((f) => p.includes(f));
        if (hit.length === 0) return p;
        const hasRequired = required.some((r) => contributionFacetPresent(p, r));
        // Whole-paragraph drop when only restating lead without body-required
        if (!hasRequired && p.replace(/\s+/g, "").length < 120) {
          changed = true;
          return "";
        }
        // Clause-level: drop clauses that contain consumed but not required
        const clauses = splitClauses(p);
        if (clauses.length > 1) {
          const kept = clauses.filter((c) => {
            const hasCons = hit.some((f) => c.includes(f));
            if (!hasCons) return true;
            const hasReq = required.some((r) => contributionFacetPresent(c, r));
            return hasReq; // keep only if required evidence lives in same clause
          });
          if (kept.length > 0 && kept.length < clauses.length) {
            const next = cleanupProse(kept.join(""));
            if (hit.some((f) => next.includes(f))) {
              // Still embedded mid-clause with required — do not blind-delete
              return p;
            }
            changed = true;
            return next;
          }
        }
        // Mixed required+consumed in single clause: leave for plan compliance (no blind delete)
        return p;
      })
      .map((p) => cleanupProse(p))
      .filter((p) => p.replace(/\s+/g, "").length >= 4);
    return { ...sec, paragraphs };
  });

  const flat = sections.flatMap((s) => s.paragraphs);
  for (const p of flat) {
    const paraIntegrity = validatePostTransformIntegrity({
      lead: p,
      sections: [],
    });
    if (!paraIntegrity.ok) {
      return {
        ok: false,
        lead: "",
        sections: input.sections,
        method: "failed_unsafe",
        failureCode: "POST_TRANSFORM_INTEGRITY_FAILED",
        failureMessage: paraIntegrity.findings.map((f) => f.message).join("; "),
      };
    }
  }

  return {
    ok: true,
    lead: "",
    sections,
    method: changed ? "clause_removed" : "unchanged",
  };
}
