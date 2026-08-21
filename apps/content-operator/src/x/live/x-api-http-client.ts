import type { AppConfig } from "@ai-affiliate/config";
import type { XLiveRepository } from "@ai-affiliate/database";
import { XPublishError } from "../types.js";

export type XApiEndpointKey =
  | "oauth.token"
  | "oauth.revoke"
  | "users.me"
  | "tweets.create"
  | "tweets.get"
  | "tweets.delete"
  | "tweets.metrics"
  | "usage.get"
  | "other";

export interface XApiHttpRequest {
  method: "GET" | "POST" | "DELETE";
  path: string;
  endpointKey: XApiEndpointKey;
  requestType: string;
  body?: unknown;
  form?: URLSearchParams;
  accessToken?: string;
  basicAuth?: { username: string; password: string };
  accountId?: string | null;
  publicationId?: string | null;
  xPostId?: string | null;
  estimatedCost?: number | null;
  billingUnit?: string | null;
  skipAudit?: boolean;
  signal?: AbortSignal;
  /** When true, do not retry (caller handles refresh). */
  disableRetry?: boolean;
  /** When true, return non-2xx instead of throwing (OAuth error bodies). */
  acceptErrorResponse?: boolean;
}

export interface XApiHttpResponse<T = unknown> {
  ok: boolean;
  statusCode: number;
  data: T | null;
  headers: Headers;
  rateLimitRemaining: number | null;
  rateLimitResetAt: Date | null;
  requestId: string | null;
  durationMs: number;
  attemptCount: number;
  errorCode: string | null;
}

export interface XApiHttpClientDeps {
  config: AppConfig;
  live?: XLiveRepository;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

function parseRateLimitReset(headers: Headers, now: Date): Date | null {
  const reset = headers.get("x-rate-limit-reset");
  if (!reset) return null;
  const asNumber = Number(reset);
  if (Number.isFinite(asNumber) && asNumber > 1_000_000_000) {
    return new Date(asNumber * 1000);
  }
  const asDate = Date.parse(reset);
  if (!Number.isNaN(asDate)) return new Date(asDate);
  void now;
  return null;
}

function classifyStatus(status: number): {
  errorType: XPublishError["errorType"];
  retryable: boolean;
  errorCode: string;
} {
  if (status === 429) {
    return { errorType: "RateLimit", retryable: true, errorCode: "RATE_LIMIT" };
  }
  if (status === 401 || status === 403) {
    return {
      errorType: status === 401 ? "AuthTransient" : "Permission",
      retryable: status === 401,
      errorCode: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
    };
  }
  if (status >= 500) {
    return { errorType: "ServerError", retryable: true, errorCode: "SERVER_ERROR" };
  }
  if (status >= 400) {
    return { errorType: "Validation", retryable: false, errorCode: "CLIENT_ERROR" };
  }
  return { errorType: "Unknown", retryable: false, errorCode: "UNKNOWN" };
}

function sanitizeErrorMessage(status: number, errorCode: string): string {
  return `X API request failed status=${status} code=${errorCode}`;
}

export class XApiHttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: XApiHttpClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  resolveUrl(path: string): string {
    const base = this.deps.config.xApiBaseUrl.replace(/\/$/, "");
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    // Support both https://api.x.com and https://api.x.com/2 as base.
    if (base.endsWith("/2") && normalizedPath.startsWith("/2/")) {
      return `${base.slice(0, -2)}${normalizedPath}`;
    }
    if (!base.endsWith("/2") && !normalizedPath.startsWith("/2") && !normalizedPath.startsWith("/oauth")) {
      return `${base}/2${normalizedPath}`;
    }
    return `${base}${normalizedPath}`;
  }

  async request<T = unknown>(req: XApiHttpRequest): Promise<XApiHttpResponse<T>> {
    const maxAttempts = req.disableRetry
      ? 1
      : Math.max(1, this.deps.config.xApiMaxAttempts);
    let attempt = 0;
    let lastResponse: XApiHttpResponse<T> | null = null;

    while (attempt < maxAttempts) {
      attempt += 1;
      const started = this.now().getTime();
      const headers = new Headers();
      headers.set(
        "User-Agent",
        this.deps.config.xApiUserAgent ?? "AI-Affiliate-Factory/1.0",
      );
      headers.set("Accept", "application/json");

      if (req.accessToken) {
        headers.set("Authorization", `Bearer ${req.accessToken}`);
      } else if (req.basicAuth) {
        const token = Buffer.from(
          `${req.basicAuth.username}:${req.basicAuth.password}`,
          "utf8",
        ).toString("base64");
        headers.set("Authorization", `Basic ${token}`);
      }

      let body: string | undefined;
      if (req.form) {
        headers.set("Content-Type", "application/x-www-form-urlencoded");
        body = req.form.toString();
      } else if (req.body !== undefined) {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(req.body);
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.deps.config.xApiTimeoutMs,
      );
      const onAbort = () => controller.abort();
      req.signal?.addEventListener("abort", onAbort);

      let statusCode = 0;
      let responseHeaders = new Headers();
      let data: T | null = null;
      let responseSize: number | null = null;
      let errorCode: string | null = null;
      let result = "ERROR";

      try {
        const url =
          req.path.startsWith("http") || req.endpointKey.startsWith("oauth")
            ? req.path.startsWith("http")
              ? req.path
              : req.path
            : this.resolveUrl(req.path);
        const resolvedUrl =
          req.endpointKey === "oauth.token" || req.endpointKey === "oauth.revoke"
            ? req.path
            : this.resolveUrl(req.path);

        void url;
        const response = await this.fetchImpl(resolvedUrl, {
          method: req.method,
          headers,
          body,
          signal: controller.signal,
        });
        statusCode = response.status;
        responseHeaders = response.headers;
        const text = await response.text();
        responseSize = text.length;
        if (text) {
          try {
            data = JSON.parse(text) as T;
          } catch {
            data = null;
            errorCode = "INVALID_JSON";
          }
        }
        if (response.ok) {
          result = "SUCCESS";
        } else {
          const classified = classifyStatus(statusCode);
          errorCode = classified.errorCode;
          result = classified.errorCode;
        }
      } catch (error) {
        const aborted =
          (error instanceof Error && error.name === "AbortError") ||
          req.signal?.aborted;
        errorCode = aborted ? "TIMEOUT" : "NETWORK";
        result = errorCode;
        statusCode = 0;
      } finally {
        clearTimeout(timeout);
        req.signal?.removeEventListener("abort", onAbort);
      }

      const durationMs = this.now().getTime() - started;
      const rateLimitRemainingRaw = responseHeaders.get("x-rate-limit-remaining");
      const rateLimitRemaining =
        rateLimitRemainingRaw != null && rateLimitRemainingRaw !== ""
          ? Number.parseInt(rateLimitRemainingRaw, 10)
          : null;
      const rateLimitResetAt = parseRateLimitReset(responseHeaders, this.now());
      const requestId =
        responseHeaders.get("x-request-id") ??
        responseHeaders.get("x-transaction-id");

      lastResponse = {
        ok: result === "SUCCESS",
        statusCode,
        data,
        headers: responseHeaders,
        rateLimitRemaining: Number.isFinite(rateLimitRemaining as number)
          ? rateLimitRemaining
          : null,
        rateLimitResetAt,
        requestId,
        durationMs,
        attemptCount: attempt,
        errorCode,
      };

      if (!req.skipAudit && this.deps.live) {
        await this.deps.live.createRequestLog({
          requestType: req.requestType,
          endpointKey: req.endpointKey,
          accountId: req.accountId,
          publicationId: req.publicationId,
          xPostId: req.xPostId,
          method: req.method,
          result,
          statusCode: statusCode || null,
          attemptCount: attempt,
          rateLimitRemaining: lastResponse.rateLimitRemaining,
          rateLimitResetAt,
          estimatedCost: req.estimatedCost ?? null,
          billingUnit: req.billingUnit ?? null,
          responseSize,
          durationMs,
          errorCode,
        });
      }

      if (lastResponse.ok) {
        return lastResponse;
      }

      if (req.acceptErrorResponse) {
        return lastResponse;
      }

      const classified = classifyStatus(statusCode || 500);
      const canRetry =
        !req.disableRetry &&
        classified.retryable &&
        attempt < maxAttempts &&
        // Never blindly retry write tweets — caller decides after state check
        req.endpointKey !== "tweets.create";

      if (statusCode === 429 && rateLimitResetAt) {
        const waitMs = Math.max(0, rateLimitResetAt.getTime() - this.now().getTime());
        if (canRetry && waitMs <= 60_000) {
          await this.sleep(Math.min(waitMs + 50, 60_000));
          continue;
        }
      }

      if (canRetry) {
        await this.sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
        continue;
      }

      if (errorCode === "TIMEOUT") {
        throw new XPublishError("X API timeout", "Timeout", { retryable: true });
      }
      if (errorCode === "NETWORK") {
        throw new XPublishError("X API network error", "Network", { retryable: true });
      }
      throw new XPublishError(
        sanitizeErrorMessage(statusCode, errorCode ?? "UNKNOWN"),
        classified.errorType,
        { retryable: classified.retryable, httpStatus: statusCode || undefined },
      );
    }

    throw new XPublishError("X API request exhausted retries", "Unknown", {
      retryable: false,
      httpStatus: lastResponse?.statusCode,
    });
  }
}
