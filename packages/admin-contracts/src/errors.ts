export type AdminErrorCode =
  | "validation_error"
  | "authentication_required"
  | "permission_denied"
  | "invalid_state_transition"
  | "approval_required"
  | "policy_blocked"
  | "claim_blocked"
  | "review_failed"
  | "budget_exceeded"
  | "conflict_detected"
  | "external_auth_error"
  | "external_rate_limit"
  | "external_temporary_error"
  | "not_found"
  | "duplicate_operation"
  | "internal_error";

export interface AdminErrorBody {
  error: {
    code: AdminErrorCode;
    message: string;
    correlationId: string;
    details?: Record<string, unknown>;
  };
}
