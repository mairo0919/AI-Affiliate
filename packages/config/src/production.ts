import type { AppConfig } from "@ai-affiliate/config";

export type ProductionOperationMode = "OBSERVE" | "ASSISTED" | "AUTOMATED";

export interface ProductionValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface ProductionValidationResult {
  ok: boolean;
  environment: string;
  operationMode: ProductionOperationMode;
  issues: ProductionValidationIssue[];
}

const DEFAULT_BOOTSTRAP_PASSWORDS = new Set([
  "change-me-admin",
  "admin",
  "password",
  "password123",
  "default",
]);

export function resolveOperationMode(
  raw: string | undefined,
): ProductionOperationMode {
  const v = (raw ?? "ASSISTED").trim().toUpperCase();
  if (v === "OBSERVE" || v === "ASSISTED" || v === "AUTOMATED") return v;
  return "ASSISTED";
}

/**
 * Validate production-facing configuration.
 * Throws only when `throwOnError` and severity=error issues exist.
 */
export function validateProductionConfig(
  config: AppConfig,
  options?: { throwOnError?: boolean; env?: NodeJS.ProcessEnv },
): ProductionValidationResult {
  const env = options?.env ?? process.env;
  const environment = (env.NODE_ENV ?? "development").toLowerCase();
  const operationMode = resolveOperationMode(env.PRODUCTION_OPERATION_MODE);
  const issues: ProductionValidationIssue[] = [];
  const isProd = environment === "production";

  if (isProd) {
    if (
      config.adminBootstrapPassword &&
      DEFAULT_BOOTSTRAP_PASSWORDS.has(config.adminBootstrapPassword)
    ) {
      issues.push({
        code: "DEFAULT_BOOTSTRAP_PASSWORD",
        severity: "error",
        message:
          "production forbids default ADMIN_BOOTSTRAP_PASSWORD — rotate before start",
      });
    }
    if (config.adminCorsOrigin === "*" || config.adminCorsOrigin.trim() === "") {
      issues.push({
        code: "INSECURE_CORS",
        severity: "error",
        message: "production forbids ADMIN_CORS_ORIGIN=*",
      });
    }
    if (config.llmMode === "mock") {
      issues.push({
        code: "MOCK_LLM_IN_PRODUCTION",
        severity: "warning",
        message:
          "LLM_MODE=mock in production — generation uses Mock (explicit only). Prefer LLM_MODE=api with allow flag.",
      });
    }
    if (config.llmMode === "api" && !config.llmApiKey) {
      issues.push({
        code: "LLM_API_KEY_MISSING",
        severity: "warning",
        message: "LLM_MODE=api but LLM_API_KEY missing — LLM features unavailable",
      });
    }
    if (config.llmMode === "api" && !config.llmAllowExternalRequests) {
      issues.push({
        code: "LLM_EXTERNAL_NOT_ALLOWED",
        severity: "warning",
        message:
          "LLM_ALLOW_EXTERNAL_REQUESTS=false — API key present will not be used until allowed",
      });
    }
    if (config.bloggerAllowDirectPublish) {
      issues.push({
        code: "BLOGGER_DIRECT_PUBLISH_ENABLED",
        severity: "warning",
        message:
          "BLOGGER_ALLOW_DIRECT_PUBLISH=true — keep false unless explicitly confirmed for production",
      });
    }
    if (config.adminAllowDirectPublishUi) {
      issues.push({
        code: "ADMIN_DIRECT_PUBLISH_UI",
        severity: "warning",
        message: "ADMIN_ALLOW_DIRECT_PUBLISH_UI=true — direct publish UI should stay disabled",
      });
    }
    if (operationMode === "AUTOMATED") {
      issues.push({
        code: "AUTOMATED_MODE",
        severity: "warning",
        message:
          "PRODUCTION_OPERATION_MODE=AUTOMATED is not the supported initial mode — use ASSISTED",
      });
    }
  }

  if (config.bloggerMode === "api" && config.bloggerDefaultPublishMode === "publish") {
    issues.push({
      code: "BLOGGER_DEFAULT_PUBLISH",
      severity: "warning",
      message: "BLOGGER_DEFAULT_PUBLISH_MODE=publish — initial ops expect draft",
    });
  }

  const ok = !issues.some((i) => i.severity === "error");
  if (!ok && options?.throwOnError) {
    const msg = issues
      .filter((i) => i.severity === "error")
      .map((i) => `${i.code}: ${i.message}`)
      .join("; ");
    throw new Error(`Production config validation failed: ${msg}`);
  }

  return { ok, environment, operationMode, issues };
}

export function assistedModeAllows(action: string, mode: ProductionOperationMode): boolean {
  if (mode === "OBSERVE") {
    return ["read", "export", "diagnose", "checklist", "x_export"].includes(action);
  }
  if (mode === "ASSISTED") {
    // Draft after human approval; never auto-publish / auto X post
    if (action === "blogger_publish" || action === "x_auto_post") return false;
    return true;
  }
  // AUTOMATED: not the supported initial mode — still block direct publish helpers
  if (action === "blogger_publish" || action === "x_auto_post") return false;
  return true;
}
