export class DatabaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "DatabaseError";
  }
}

export class CancelledError extends Error {
  constructor(message = "Job cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

export class MappingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "MappingError";
  }
}

export function classifyErrorType(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) {
    const name = String((error as { name: string }).name);
    if (name.endsWith("Error")) {
      return name.replace(/Error$/, "");
    }
    return name;
  }
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: string }).code);
  }
  return "Unknown";
}

export function isRetryableError(error: unknown): boolean {
  if (isNonRetryableError(error)) {
    return false;
  }
  if (error && typeof error === "object" && "retryable" in error) {
    const flag = (error as { retryable?: unknown }).retryable;
    if (typeof flag === "boolean") {
      return flag;
    }
  }
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: string }).name)
      : "";
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: string }).code)
      : "";
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status: unknown }).status)
      : error && typeof error === "object" && "httpStatus" in error
        ? Number((error as { httpStatus: unknown }).httpStatus)
        : NaN;

  if (
    name === "RateLimitError" ||
    name === "TimeoutError" ||
    name === "NetworkError" ||
    code === "rate_limit" ||
    code === "timeout" ||
    code === "network"
  ) {
    return true;
  }
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  // Temporary DB / lock contention — retryable for schedules; permanent DB misconfig is rare and message-based
  if (name === "LockError") {
    return true;
  }
  if (name === "DatabaseError") {
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "";
    if (/configuration|authentication|permission denied|invalid/i.test(message)) {
      return false;
    }
    return true;
  }
  return false;
}

export function isNonRetryableError(error: unknown): boolean {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: string }).name)
      : "";
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: string }).code)
      : "";
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (
    name === "ConfigurationError" ||
    name === "AuthenticationError" ||
    name === "ValidationError" ||
    name === "CancelledError" ||
    name === "CronValidationError" ||
    code === "configuration" ||
    code === "authentication" ||
    code === "validation"
  ) {
    return true;
  }
  if (/configuration incomplete|not configured|API approval|affiliate ID/i.test(message)) {
    return true;
  }
  return false;
}

export function isFatalConfigOrAuthError(error: unknown): boolean {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: string }).name) : "";
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
  return (
    name === "ConfigurationError" ||
    name === "AuthenticationError" ||
    name === "DatabaseError" ||
    name === "LockError" ||
    code === "configuration" ||
    code === "authentication"
  );
}
