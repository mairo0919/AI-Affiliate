import { randomUUID } from "node:crypto";
import type { Context, Next } from "hono";
import type { AdminErrorCode } from "@ai-affiliate/admin-contracts";
import {
  BudgetBlockedError,
  ContentReviewError,
  LearningGovernanceError,
} from "@ai-affiliate/content-operator/admin";

export class AdminHttpError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AdminHttpError";
  }
}

export function correlationMiddleware() {
  return async (c: Context, next: Next) => {
    const incoming = c.req.header("x-correlation-id");
    const correlationId = incoming && incoming.trim() !== "" ? incoming : randomUUID();
    c.set("correlationId", correlationId);
    await next();
    c.header("x-correlation-id", correlationId);
  };
}

export function mapError(
  error: unknown,
  correlationId: string,
): {
  status: number;
  body: {
    error: {
      code: AdminErrorCode;
      message: string;
      correlationId: string;
      details?: Record<string, unknown>;
    };
  };
} {
  if (error instanceof AdminHttpError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          correlationId,
          details: error.details,
        },
      },
    };
  }
  if (error instanceof ContentReviewError) {
    const code = error.code as AdminErrorCode;
    return {
      status: code === "not_found" ? 404 : 409,
      body: { error: { code, message: error.message, correlationId } },
    };
  }
  if (error instanceof LearningGovernanceError) {
    const code: AdminErrorCode =
      error.code === "CONFLICT"
        ? "conflict_detected"
        : error.code === "NOT_FOUND"
          ? "not_found"
          : error.code === "MISSING_APPROVAL"
            ? "approval_required"
            : "invalid_state_transition";
    return {
      status: code === "not_found" ? 404 : 409,
      body: { error: { code, message: error.message, correlationId } },
    };
  }
  if (error instanceof BudgetBlockedError) {
    return {
      status: 409,
      body: {
        error: {
          code: "budget_exceeded",
          message: error.message,
          correlationId,
          details: { jobStatusEquivalent: "BUDGET_BLOCKED" },
        },
      },
    };
  }
  if (error instanceof Error) {
    const msg = error.message;
    if (/not found/i.test(msg)) {
      return {
        status: 404,
        body: { error: { code: "not_found", message: msg, correlationId } },
      };
    }
    if (/cannot |must be |required|invalid status|duplicate/i.test(msg)) {
      const code: AdminErrorCode = /duplicate/i.test(msg)
        ? "duplicate_operation"
        : "invalid_state_transition";
      return {
        status: 409,
        body: { error: { code, message: msg, correlationId } },
      };
    }
  }
  console.error("[admin-api]", correlationId, error);
  return {
    status: 500,
    body: {
      error: {
        code: "internal_error",
        message: "Internal server error",
        correlationId,
      },
    },
  };
}
