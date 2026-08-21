/**
 * Repair success validation — persist前の deterministic gate.
 * MAX repair attempts remains 1; failure → REGEN_CANDIDATE.
 *
 * REPLACE success requires:
 * - replacementContributionUsed = true
 * - forbiddenContributionReused = false
 * - newUnsupported = 0
 * - provenanceConsistent = true
 *
 * DELETE with empty text is a valid success (shorter dense OK).
 */

import { hasEvaluativeRelation } from "../shadow/predicate-families.js";
import {
  countConsumedOverlap,
  facetKey,
  observeFacetsInText,
  type InformationalContribution,
} from "./informational-contribution.js";
import type { RepairOperation } from "./repair-operation.js";

export type RepairSuccessFinding = {
  code:
    | "FORBIDDEN_CONTRIBUTION_REUSE"
    | "OUTSIDE_ALLOWED_CONTRIBUTION"
    | "REPLACEMENT_NOT_USED"
    | "NEW_UNSUPPORTED_RELATION"
    | "PROVENANCE_LIE"
    | "STRUCTURE_UNSATISFIED"
    | "DELETE_REQUIRED_BUT_NONEMPTY";
  message: string;
};

export type RepairSuccessResult = {
  ok: boolean;
  findings: RepairSuccessFinding[];
  metrics?: {
    replacementContributionUsed?: boolean;
    forbiddenContributionReused?: boolean;
    newUnsupported?: number;
    provenanceConsistent?: boolean;
  };
};

const NAME_SETTING_RE =
  /世界観|リアルタイム感|シチュエーションが展開|舞台に|ロケ地/;

/**
 * Validate a single repaired segment before persist.
 */
export function validateRepairedSegment(input: {
  operation: RepairOperation;
  originalText: string;
  repairedText: string;
  claimIdsUsed: string[];
  allowedClaimIds: string[];
  allowedFacets: string[];
  consumedFacetKeys: Set<string>;
  replaceWith?: InformationalContribution[];
}): RepairSuccessResult {
  const findings: RepairSuccessFinding[] = [];
  const text = input.repairedText.trim();
  const metrics = {
    replacementContributionUsed: false,
    forbiddenContributionReused: false,
    newUnsupported: 0,
    provenanceConsistent: true,
  };

  if (input.operation === "DELETE") {
    // Empty / whitespace = success. Meta filler with facets = fail.
    if (text.length === 0) {
      return { ok: true, findings: [], metrics };
    }
    // Allow only empty; any material facet content is not a true DELETE
    if (observeFacetsInText(text).length > 0 || text.length > 8) {
      findings.push({
        code: "DELETE_REQUIRED_BUT_NONEMPTY",
        message: "DELETE operation left material content in segment",
      });
    }
    return { ok: findings.length === 0, findings, metrics };
  }

  const overlap = countConsumedOverlap(text, input.consumedFacetKeys);
  if (overlap >= 1 && input.operation === "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL") {
    metrics.forbiddenContributionReused = true;
    findings.push({
      code: "FORBIDDEN_CONTRIBUTION_REUSE",
      message: "REPLACE still reuses consumed contributions from other segments",
    });
  }
  if (overlap >= 2 && input.operation === "COMPRESS") {
    metrics.forbiddenContributionReused = true;
    findings.push({
      code: "FORBIDDEN_CONTRIBUTION_REUSE",
      message: "COMPRESS still heavily restates consumed lead facets",
    });
  }
  // REWRITE on title/summary may soft-recap; body REWRITE should not heavily restate
  if (overlap >= 3 && input.operation === "REWRITE") {
    metrics.forbiddenContributionReused = true;
    findings.push({
      code: "FORBIDDEN_CONTRIBUTION_REUSE",
      message: "REWRITE heavily reuses consumed facets",
    });
  }

  if (input.operation === "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL") {
    const observed = observeFacetsInText(text);
    const usedReplace = (input.replaceWith ?? []).some(
      (c) =>
        observed.some((f) => facetKey(f) === facetKey(c.facet)) || text.includes(c.facet),
    );
    metrics.replacementContributionUsed = usedReplace;
    if (!usedReplace) {
      findings.push({
        code: "REPLACEMENT_NOT_USED",
        message: "REPLACE did not use the provided unused supported contribution",
      });
    }
    // Same-contribution paraphrase: no novel unused facet beyond consumed
    const novel = observed.filter((f) => !input.consumedFacetKeys.has(facetKey(f)));
    if (novel.length === 0 && text.length > 12) {
      findings.push({
        code: "OUTSIDE_ALLOWED_CONTRIBUTION",
        message: "REPLACE only restated consumed contributions (no unused fact)",
      });
    }
  }

  for (const id of input.claimIdsUsed) {
    if (!input.allowedClaimIds.includes(id)) {
      metrics.provenanceConsistent = false;
      findings.push({
        code: "PROVENANCE_LIE",
        message: `claimIdsUsed includes non-allowed ${id}`,
      });
    }
  }

  if (hasEvaluativeRelation(text)) {
    metrics.newUnsupported += 1;
    findings.push({
      code: "NEW_UNSUPPORTED_RELATION",
      message: "Repaired text contains evaluative relation",
    });
  }

  if (NAME_SETTING_RE.test(text)) {
    metrics.newUnsupported += 1;
    findings.push({
      code: "NEW_UNSUPPORTED_RELATION",
      message: "Repaired text retains name-derived setting language",
    });
  }

  return { ok: findings.length === 0, findings, metrics };
}

export function mergeRepairSuccessResults(results: RepairSuccessResult[]): RepairSuccessResult {
  const findings: RepairSuccessFinding[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    for (const f of r.findings) {
      const k = `${f.code}:${f.message}`;
      if (seen.has(k)) continue;
      seen.add(k);
      findings.push(f);
    }
  }
  return { ok: findings.length === 0, findings };
}
