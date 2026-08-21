/**
 * RAW failure routing SSOT — STRUCTURAL / LOCAL / INSUFFICIENT.
 * Determines regen vs targeted repair vs DEFER. No Reviewer threshold changes.
 */

import type { RawPlanComplianceFinding, RawPlanComplianceResult } from "./raw-plan-compliance.js";

export type RawFailureClass =
  | "STRUCTURAL_PLAN_FAILURE"
  | "LOCAL_GENERATION_DEFECT"
  | "INSUFFICIENT_MATERIAL";

export type RawFailureRoute =
  | "PLAN_AWARE_REGEN"
  | "TARGETED_REPAIR"
  | "DEFER_INSUFFICIENT_MATERIAL"
  | "PASS";

export type RawFailureRouting = {
  failureClass: RawFailureClass | null;
  route: RawFailureRoute;
  allowTargetedRepair: boolean;
  allowPlanAwareRegen: boolean;
  defer: boolean;
  codes: string[];
  reason: string;
};

const STRUCTURAL_CODES = new Set([
  "LEAD_BODY_OVERLAP",
  "FORBIDDEN_CONTRIBUTION_REUSED",
  "PREMATURE_CONTRIBUTION_CONSUMPTION",
  "STRUCTURAL_PROGRESSION_FAILURE",
  "EMPTY_REQUIRED_SEGMENT",
  "SEMANTIC_CONTRIBUTION_REUSE",
  "COMPOSITE_COMPONENT_RESTATEMENT",
  "PROVENANCE_CONTRADICTION",
]);

const LOCAL_CODES = new Set([
  "UNSUPPORTED_EVALUATION",
  "CATALOG_ONLY_PARAGRAPH",
  "SOURCE_TITLE_RESTATEMENT",
  "PARAGRAPH_NO_NEW_CONTRIBUTION",
]);

const INSUFFICIENT_CODES = new Set([
  "INSUFFICIENT_MATERIAL",
  "REQUIRED_CONTRIBUTION_MISSING", // when body cannot advance without restating lead
]);

/**
 * Classify RAW compliance result into routing decision.
 */
export function routeRawPlanFailure(input: {
  result: RawPlanComplianceResult;
  insufficientDevelopmentMaterial?: boolean;
  scarcityMode?: boolean;
  /** Body would only restate lead — material-insufficient for progression */
  bodyOnlyRestatesLead?: boolean;
}): RawFailureRouting {
  if (input.result.ok) {
    return {
      failureClass: null,
      route: "PASS",
      allowTargetedRepair: true,
      allowPlanAwareRegen: false,
      defer: false,
      codes: [],
      reason: "raw_plan_compliant",
    };
  }

  const blocking = input.result.findings.filter((f) => f.severity === "BLOCKING");
  const codes = [...new Set(blocking.map((f) => f.code))];

  // Immediate DEFER: planner insufficient, OR scarce structural failure (no pointless regen)
  if (input.insufficientDevelopmentMaterial) {
    return {
      failureClass: "INSUFFICIENT_MATERIAL",
      route: "DEFER_INSUFFICIENT_MATERIAL",
      allowTargetedRepair: false,
      allowPlanAwareRegen: false,
      defer: true,
      codes,
      reason: "supported_contributions_cannot_progress_without_lead_restatement",
    };
  }

  if (
    input.scarcityMode &&
    (input.bodyOnlyRestatesLead ||
      input.result.structuralDefect ||
      codes.some((c) =>
        [
          "PREMATURE_CONTRIBUTION_CONSUMPTION",
          "SEMANTIC_CONTRIBUTION_REUSE",
          "FORBIDDEN_CONTRIBUTION_REUSED",
          "LEAD_BODY_OVERLAP",
          "COMPOSITE_COMPONENT_RESTATEMENT",
          "STRUCTURAL_PROGRESSION_FAILURE",
        ].includes(c),
      ))
  ) {
    return {
      failureClass: "INSUFFICIENT_MATERIAL",
      route: "DEFER_INSUFFICIENT_MATERIAL",
      allowTargetedRepair: false,
      allowPlanAwareRegen: false,
      defer: true,
      codes,
      reason: "scarce_material_exhausted_no_regen",
    };
  }

  // Rich material but body only restates lead → structural (regen), not DEFER
  if (input.bodyOnlyRestatesLead) {
    return {
      failureClass: "STRUCTURAL_PLAN_FAILURE",
      route: "PLAN_AWARE_REGEN",
      allowTargetedRepair: false,
      allowPlanAwareRegen: true,
      defer: false,
      codes: [...codes, "BODY_ONLY_RESTATES_LEAD"],
      reason: "body_only_restates_lead_with_available_material",
    };
  }

  const structural =
    input.result.structuralDefect ||
    blocking.some((f) => STRUCTURAL_CODES.has(f.code)) ||
    blocking.filter((f) => f.code === "PARAGRAPH_NO_NEW_CONTRIBUTION").length >= 2;

  if (structural) {
    return {
      failureClass: "STRUCTURAL_PLAN_FAILURE",
      route: "PLAN_AWARE_REGEN",
      allowTargetedRepair: false,
      allowPlanAwareRegen: true,
      defer: false,
      codes,
      reason: "structural_plan_execution_failure",
    };
  }

  const localOnly =
    blocking.length > 0 && blocking.every((f) => LOCAL_CODES.has(f.code) || f.code === "REQUIRED_CONTRIBUTION_MISSING");

  if (localOnly) {
    return {
      failureClass: "LOCAL_GENERATION_DEFECT",
      route: "TARGETED_REPAIR",
      allowTargetedRepair: true,
      allowPlanAwareRegen: false,
      defer: false,
      codes,
      reason: "local_generation_defect",
    };
  }

  // Default: treat as structural to avoid hiding plan failures in COMPRESS/DELETE
  return {
    failureClass: "STRUCTURAL_PLAN_FAILURE",
    route: "PLAN_AWARE_REGEN",
    allowTargetedRepair: false,
    allowPlanAwareRegen: true,
    defer: false,
    codes,
    reason: "unclassified_blocking_treated_as_structural",
  };
}

export function isStructuralFinding(f: RawPlanComplianceFinding): boolean {
  return STRUCTURAL_CODES.has(f.code);
}
