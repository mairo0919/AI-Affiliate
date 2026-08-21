/**
 * Deterministic Generator-side Plan Compliance (pre-persist).
 * Semantic inference/filler remain Brain Reviewer's job.
 */

import type { BrainGenerationInputContract } from "./generation-input-contract.js";
import type { ArticleProvenance } from "./provenance.js";
import { allProvenanceClaimIds } from "./provenance.js";

export type PlanComplianceFinding = {
  code:
    | "ROLE_CLAIM_VIOLATION"
    | "OMITTED_CLAIM_USED"
    | "ALLOCATION_OVERLAP"
    | "UNSUPPORTED_CLAIM_ID"
    | "PROVENANCE_MISSING"
    | "CTA_NEW_CLAIM"
    | "PLAN_STRUCTURE";
  message: string;
  role?: string;
  claimIds?: string[];
};

export type PlanComplianceResult = {
  ok: boolean;
  findings: PlanComplianceFinding[];
};

function unknownIds(used: string[], allowedUniverse: Set<string>): string[] {
  return [...new Set(used.filter((id) => !allowedUniverse.has(id)))];
}

function omittedHits(used: string[], omitted: Set<string>): string[] {
  return [...new Set(used.filter((id) => omitted.has(id)))];
}

/**
 * Validate provenance + role allowlists against the generation contract.
 */
export function checkPlanCompliance(input: {
  contract: BrainGenerationInputContract;
  provenance: ArticleProvenance | null;
  sectionCount: number;
  requireProvenance: boolean;
}): PlanComplianceResult {
  const findings: PlanComplianceFinding[] = [];
  const { contract } = input;
  const allow = contract.roleAllowlist;
  const omitted = new Set(allow.omittedClaimIds);
  const selected = new Set(contract.corePlan.selectedClaimIds);
  const universe = new Set([...selected, ...allow.omittedClaimIds]);

  if (input.requireProvenance && !input.provenance) {
    findings.push({
      code: "PROVENANCE_MISSING",
      message: "Generation provenance (claimIdsUsed per segment) is missing",
    });
    return { ok: false, findings };
  }

  const prov = input.provenance;
  if (!prov) return { ok: findings.length === 0, findings };

  const checks: Array<{ role: string; used: string[]; allowed: string[] }> = [
    { role: "title", used: prov.title.claimIdsUsed, allowed: allow.titleAllowedClaimIds },
    { role: "lead", used: prov.lead.claimIdsUsed, allowed: allow.leadAllowedClaimIds },
    { role: "summary", used: prov.summary.claimIdsUsed, allowed: allow.summaryAllowedClaimIds },
  ];
  prov.sections.forEach((sec, i) => {
    checks.push({
      role: `section:${i}`,
      used: sec.claimIdsUsed,
      allowed: allow.developmentAllowedClaimIds,
    });
  });
  if (prov.cta) {
    checks.push({
      role: "cta",
      used: prov.cta.claimIdsUsed,
      allowed: allow.ctaAllowedClaimIds.length
        ? allow.ctaAllowedClaimIds
        : [], // empty allowlist → no claim use in CTA
    });
  }

  for (const c of checks) {
    const allowedSet = new Set(c.allowed);
    const roleViolations = c.used.filter((id) => !allowedSet.has(id) && selected.has(id));
    if (roleViolations.length > 0) {
      findings.push({
        code: "ROLE_CLAIM_VIOLATION",
        message: `Role ${c.role} used claimIds outside allowlist`,
        role: c.role,
        claimIds: roleViolations,
      });
    }
    const om = omittedHits(c.used, omitted);
    if (om.length > 0) {
      findings.push({
        code: "OMITTED_CLAIM_USED",
        message: `Role ${c.role} used omitted claimIds`,
        role: c.role,
        claimIds: om,
      });
    }
    const unk = unknownIds(c.used, universe);
    if (unk.length > 0) {
      findings.push({
        code: "UNSUPPORTED_CLAIM_ID",
        message: `Role ${c.role} referenced unknown claimIds`,
        role: c.role,
        claimIds: unk,
      });
    }
  }

  if (prov.cta && prov.cta.claimIdsUsed.length > 0 && allow.ctaAllowedClaimIds.length === 0) {
    findings.push({
      code: "CTA_NEW_CLAIM",
      message: "CTA used claimIds but plan omits CTA claim allocation",
      claimIds: prov.cta.claimIdsUsed,
    });
  }

  // Plan-level: same claimId must not be allocated to both opening and development
  const planOpening = new Set(
    contract.corePlan.claimAllocation.filter((a) => a.role === "opening").map((a) => a.claimId),
  );
  const planDev = contract.corePlan.claimAllocation
    .filter((a) => a.role === "development" || a.role === "support")
    .map((a) => a.claimId);
  const planOverlap = planDev.filter((id) => planOpening.has(id));
  if (planOverlap.length > 0) {
    findings.push({
      code: "ALLOCATION_OVERLAP",
      message: "Plan opening/development allocation overlap",
      claimIds: planOverlap,
    });
  }

  // Runtime: same claimId used in both lead and a development section
  const leadUsed = new Set(prov.lead.claimIdsUsed);
  const sectionUsed = [...new Set(prov.sections.flatMap((s) => s.claimIdsUsed))];
  const runtimeOverlap = sectionUsed.filter((id) => leadUsed.has(id));
  if (runtimeOverlap.length > 0) {
    findings.push({
      code: "ALLOCATION_OVERLAP",
      message: "Same claimIds used in both lead and development sections",
      claimIds: runtimeOverlap,
    });
  }

  if (input.sectionCount > 0 && prov.sections.length === 0 && input.requireProvenance) {
    findings.push({
      code: "PROVENANCE_MISSING",
      message: "Section provenance arrays empty while sections exist",
    });
  }

  // Soft: empty provenance on all segments when required
  if (input.requireProvenance && allProvenanceClaimIds(prov).length === 0) {
    findings.push({
      code: "PROVENANCE_MISSING",
      message: "No claimIdsUsed recorded on any segment",
    });
  }

  return { ok: findings.length === 0, findings };
}
