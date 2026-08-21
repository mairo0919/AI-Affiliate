export type DmmErrorCode =
  | "configuration"
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "network"
  | "api_response"
  | "validation"
  | "http";

export class DmmError extends Error {
  readonly code: DmmErrorCode;
  readonly statusCode?: number;
  readonly endpoint?: string;

  constructor(
    code: DmmErrorCode,
    message: string,
    options?: { statusCode?: number; endpoint?: string; cause?: unknown },
  ) {
    super(sanitizeForLog(message), options?.cause ? { cause: options.cause } : undefined);
    this.name = "DmmError";
    this.code = code;
    this.statusCode = options?.statusCode;
    this.endpoint = options?.endpoint;
  }
}

export class ConfigurationError extends DmmError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("configuration", message, options);
    this.name = "ConfigurationError";
  }
}

export class AuthenticationError extends DmmError {
  constructor(message: string, options?: { statusCode?: number; endpoint?: string; cause?: unknown }) {
    super("authentication", message, options);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends DmmError {
  constructor(message: string, options?: { statusCode?: number; endpoint?: string; cause?: unknown }) {
    super("rate_limit", message, { statusCode: 429, ...options });
    this.name = "RateLimitError";
  }
}

export class TimeoutError extends DmmError {
  constructor(message: string, options?: { endpoint?: string; cause?: unknown }) {
    super("timeout", message, options);
    this.name = "TimeoutError";
  }
}

export class NetworkError extends DmmError {
  constructor(message: string, options?: { endpoint?: string; cause?: unknown }) {
    super("network", message, options);
    this.name = "NetworkError";
  }
}

export class ApiResponseError extends DmmError {
  constructor(message: string, options?: { statusCode?: number; endpoint?: string; cause?: unknown }) {
    super("api_response", message, options);
    this.name = "ApiResponseError";
  }
}

export class ValidationError extends DmmError {
  constructor(message: string, options?: { endpoint?: string; cause?: unknown }) {
    super("validation", message, options);
    this.name = "ValidationError";
  }
}

/** @deprecated Use DmmError subclasses. Kept for compatibility. */
export type DmmErrorKind = DmmErrorCode;

/** @deprecated Use DmmError subclasses. */
export class DmmApiError extends DmmError {
  readonly kind: DmmErrorKind;

  constructor(
    kind: DmmErrorKind | string,
    message: string,
    options?: { statusCode?: number; endpoint?: string; cause?: unknown },
  ) {
    const mapped = mapLegacyKind(kind);
    super(mapped, message, options);
    this.name = "DmmApiError";
    this.kind = mapped;
  }
}

function mapLegacyKind(kind: string): DmmErrorCode {
  switch (kind) {
    case "missing_credentials":
    case "configuration":
      return "configuration";
    case "auth_failed":
    case "authentication":
      return "authentication";
    case "rate_limited":
    case "rate_limit":
      return "rate_limit";
    case "timeout":
      return "timeout";
    case "network_error":
    case "network":
      return "network";
    case "invalid_response":
    case "api_error":
    case "api_response":
      return "api_response";
    case "validation":
      return "validation";
    default:
      return "http";
  }
}

const SECRET_QUERY_KEYS = new Set(["api_id", "affiliate_id"]);

export function sanitizeForLog(value: string): string {
  let sanitized = value;
  try {
    const url = new URL(value);
    for (const key of SECRET_QUERY_KEYS) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    sanitized = url.toString();
  } catch {
    sanitized = value
      .replace(/api_id=[^&]*/gi, "api_id=[redacted]")
      .replace(/affiliate_id=[^&]*/gi, "affiliate_id=[redacted]");
  }

  return sanitized
    .replace(/api_id[=:]["']?[^"'&\s]+/gi, "api_id=[redacted]")
    .replace(/affiliate_id[=:]["']?[^"'&\s]+/gi, "affiliate_id=[redacted]");
}

export function toSafeErrorMessage(error: unknown): string {
  if (error instanceof DmmError) {
    return `[${error.code}] ${sanitizeForLog(error.message)}`;
  }
  if (error instanceof Error) {
    return sanitizeForLog(error.message);
  }
  return sanitizeForLog(String(error));
}

export function isConfigurationIncomplete(error: unknown): boolean {
  if (error instanceof ConfigurationError) {
    return true;
  }
  if (error instanceof Error) {
    return /configuration incomplete|not configured/i.test(error.message);
  }
  return false;
}
