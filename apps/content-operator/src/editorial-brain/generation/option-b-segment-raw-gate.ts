/**
 * OPTION B SEGMENT RAW observe-only gate — restored from r31 CGS (patch line 3468).
 * SEGMENT contracts are non-authoritative on OPTION B: record for Brain, never block lifecycle.
 */

import type { RawPlanComplianceResult } from "./raw-plan-compliance.js";
import type { RawFailureRouting } from "./raw-failure-routing.js";
import type { PostTransformIntegrityResult } from "./post-transform-integrity.js";

export const OPTION_B_SEGMENT_RAW_OBSERVE_REASON = "option_b_segment_raw_observe_only";

/** r31: fixed PASS routing when OPTION B active — no plan-aware regen on SEGMENT overlap. */
export function buildOptionBSegmentRawRouting(): RawFailureRouting {
  return {
    failureClass: null,
    route: "PASS",
    allowTargetedRepair: true,
    allowPlanAwareRegen: false,
    defer: false,
    codes: [],
    reason: OPTION_B_SEGMENT_RAW_OBSERVE_REASON,
  };
}

export function buildOptionBObservedRawPlanComplianceMeta(input: {
  attempt: number;
  rawPlan: RawPlanComplianceResult;
  genericProse: {
    ok: boolean;
    findings: Array<{ code: string; message: string; severity: string; segment?: string }>;
  };
  postIntegrity: PostTransformIntegrityResult;
  routing: RawFailureRouting;
  leadRedacted: boolean;
  bodyRedacted: boolean;
}): Record<string, unknown> {
  const optionBObserveFindings = [
    ...input.rawPlan.findings.map((f) => ({
      ...f,
      severity: "INFO" as const,
      observeOnly: true,
    })),
    ...input.genericProse.findings.map((f) => ({
      code: f.code,
      message: f.message,
      severity: "INFO" as const,
      segment: f.segment,
      observeOnly: true,
    })),
  ];
  return {
    attempt: input.attempt,
    optionB: true,
    optionBSkipSegmentMutation: true,
    ok: true,
    planExecutionFailed: false,
    structuralDefect: false,
    findings: optionBObserveFindings,
    violatedSegments: [],
    missingRequiredContributionIds: input.rawPlan.missingRequiredContributionIds,
    forbiddenReusedContributionIds: input.rawPlan.forbiddenReusedContributionIds,
    prematurelyConsumedContributionIds: input.rawPlan.prematurelyConsumedContributionIds,
    semanticReusedFacets: input.rawPlan.semanticReusedFacets,
    leadConsumedFacets: input.rawPlan.leadConsumedFacets,
    failureSignature: "OPTION_B_PASS",
    bodyOnlyRestatesLead: input.rawPlan.bodyOnlyRestatesLead,
    leadRedacted: input.leadRedacted,
    bodyRedacted: input.bodyRedacted,
    postTransformIntegrity: input.postIntegrity,
    genericProse: { ...input.genericProse, observeOnly: true, blocking: false },
    routing: input.routing,
  };
}

/** OPTION B bypasses rawPlan.planExecutionFailed for persist/Brain (r31). */
export function optionBSegmentRawAllowsPersist(
  optionB: boolean,
  rawPlan: RawPlanComplianceResult,
): boolean {
  return optionB || !rawPlan.planExecutionFailed;
}
