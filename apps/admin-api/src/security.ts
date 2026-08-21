import type { Context, Next } from "hono";
import type { AppConfig } from "@ai-affiliate/config";

/** Security headers for Admin API */
export function securityHeadersMiddleware() {
  return async (c: Context, next: Next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    c.header("Cache-Control", "no-store");
    if ((process.env.NODE_ENV ?? "").toLowerCase() === "production") {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  };
}

/** Simple in-memory sliding window rate limit (per IP) */
export function rateLimitMiddleware(config: AppConfig) {
  const hits = new Map<string, number[]>();
  const limit = config.adminRateLimitPerMinute;
  return async (c: Context, next: Next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const now = Date.now();
    const windowMs = 60_000;
    const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      return c.json(
        {
          error: {
            code: "permission_denied",
            message: "Rate limit exceeded",
            correlationId: c.get("correlationId") ?? "rate-limit",
          },
        },
        429,
      );
    }
    arr.push(now);
    hits.set(ip, arr);
    await next();
  };
}

/** Login brute-force protection (email keyed) */
export class LoginAttemptTracker {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMinutes: number,
  ) {}

  assertAllowed(email: string): void {
    const key = email.toLowerCase();
    const now = Date.now();
    const windowMs = this.windowMinutes * 60_000;
    const arr = (this.attempts.get(key) ?? []).filter((t) => now - t < windowMs);
    this.attempts.set(key, arr);
    if (arr.length >= this.maxAttempts) {
      throw new Error("Too many login attempts — try again later");
    }
  }

  recordFailure(email: string): void {
    const key = email.toLowerCase();
    const arr = this.attempts.get(key) ?? [];
    arr.push(Date.now());
    this.attempts.set(key, arr);
  }

  clear(email: string): void {
    this.attempts.delete(email.toLowerCase());
  }
}

export { sanitizeCsvCell } from "@ai-affiliate/shared";
