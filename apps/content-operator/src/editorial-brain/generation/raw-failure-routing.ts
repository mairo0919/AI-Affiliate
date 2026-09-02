/**
 * Failure routing types for ArticlePlan compliance / generation regen.
 * Legacy SEGMENT raw-plan routing removed (R124).
 */

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
