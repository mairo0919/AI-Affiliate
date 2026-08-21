import { loadConfig } from "@ai-affiliate/config";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq <= 0) {
      flags[body] = true;
      continue;
    }
    flags[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return flags;
}

function fingerprintToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

/** Resolve project .env for writing (prefer existing file; root when run from content-operator). */
export function resolveWritableEnvPath(cwd = process.cwd()): string {
  const candidates = [resolve(cwd, ".env"), resolve(cwd, "../../.env")];
  const existing = candidates.find((p) => existsSync(p));
  return existing ?? candidates[1]!;
}

/**
 * Upsert KEY=value in .env content. Never logs the value.
 * Returns updated file text.
 */
export function upsertEnvVarLine(fileContent: string, key: string, value: string): string {
  const linePattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
  const nextLine = `${key}=${value}`;
  if (linePattern.test(fileContent)) {
    return fileContent.replace(linePattern, nextLine);
  }
  const base =
    fileContent.length === 0 || fileContent.endsWith("\n") ? fileContent : `${fileContent}\n`;
  return `${base}${nextLine}\n`;
}

export function writeBloggerRefreshTokenToEnv(envPath: string, refreshToken: string): {
  envPath: string;
  refreshTokenFingerprint: string;
} {
  const previous = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const next = upsertEnvVarLine(previous, "BLOGGER_REFRESH_TOKEN", refreshToken);
  writeFileSync(envPath, next, { encoding: "utf8", mode: 0o600 });
  return {
    envPath,
    refreshTokenFingerprint: fingerprintToken(refreshToken),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Blogger OAuth helper CLIs. Never print client_secret or refresh_token values.
 */
export async function runBloggerAuthUrl(): Promise<void> {
  const config = loadConfig({ requireDatabaseUrl: false });
  if (!config.bloggerClientId) {
    console.error("BLOGGER_CLIENT_ID is required to build the auth URL");
    process.exitCode = 1;
    return;
  }
  const state = randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: config.bloggerClientId,
    redirect_uri: config.bloggerOAuthRedirectUri,
    response_type: "code",
    scope: config.bloggerOAuthScopes,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  const url = `${config.bloggerOAuthAuthorizeUrl}?${params.toString()}`;
  console.log(
    JSON.stringify(
      {
        authorizeUrl: url,
        state,
        redirectUri: config.bloggerOAuthRedirectUri,
        note: "Open authorizeUrl in a browser, then run blogger-exchange-code with the code.",
      },
      null,
      2,
    ),
  );
}

export async function runBloggerExchangeCode(
  argv: string[],
  options?: { fetchImpl?: typeof fetch; envPath?: string },
): Promise<void> {
  const flags = parseFlags(argv);
  const config = loadConfig({ requireDatabaseUrl: false });
  const writeEnv = flags["write-env"] === true;
  if (!flags.code || typeof flags.code !== "string") {
    console.error(
      "Usage: blogger-exchange-code -- --code=<AUTH_CODE> [--write-env]",
    );
    process.exitCode = 1;
    return;
  }
  if (!config.bloggerClientId || !config.bloggerClientSecret) {
    console.error("BLOGGER_CLIENT_ID and BLOGGER_CLIENT_SECRET are required");
    process.exitCode = 1;
    return;
  }

  const body = new URLSearchParams({
    code: flags.code,
    client_id: config.bloggerClientId,
    client_secret: config.bloggerClientSecret,
    redirect_uri: config.bloggerOAuthRedirectUri,
    grant_type: "authorization_code",
  });
  const fetchImpl = options?.fetchImpl ?? fetch;
  const response = await fetchImpl(config.bloggerOAuthTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    console.error(`Token exchange failed (${response.status})`);
    process.exitCode = 1;
    return;
  }
  const json = (await response.json()) as {
    refresh_token?: string;
    access_token?: string;
    expires_in?: number;
  };

  if (!json.refresh_token) {
    console.error(
      "Token response did not include refresh_token. .env was not modified. Re-run auth-url with consent if needed.",
    );
    process.exitCode = 1;
    console.log(
      JSON.stringify(
        {
          ok: false,
          hasRefreshToken: false,
          envUpdated: false,
          nextStep: "Re-authorize with prompt=consent (pnpm blogger:auth-url) and exchange again.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const refreshFingerprint = fingerprintToken(json.refresh_token);
  let envUpdated = false;
  let envPath: string | null = null;

  if (writeEnv) {
    envPath = options?.envPath ?? resolveWritableEnvPath();
    writeBloggerRefreshTokenToEnv(envPath, json.refresh_token);
    envUpdated = true;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        hasRefreshToken: true,
        refreshTokenFingerprint: refreshFingerprint,
        envUpdated,
        envPath,
        nextStep: envUpdated
          ? "Set BLOGGER_MODE=api and BLOGGER_ALLOW_EXTERNAL_REQUESTS=true, then run blogger:list-blogs / blogger:validate-auth."
          : "Re-run with --write-env to save refresh token into .env (token value is never printed).",
      },
      null,
      2,
    ),
  );
}

export async function runBloggerValidateAuth(options?: {
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const config = loadConfig({ requireDatabaseUrl: false });
  const missing: string[] = [];
  if (config.bloggerMode !== "api") missing.push("BLOGGER_MODE=api");
  if (!config.bloggerAllowExternalRequests) missing.push("BLOGGER_ALLOW_EXTERNAL_REQUESTS=true");
  if (!config.bloggerClientId) missing.push("BLOGGER_CLIENT_ID");
  if (!config.bloggerClientSecret) missing.push("BLOGGER_CLIENT_SECRET");
  if (!config.bloggerRefreshToken) missing.push("BLOGGER_REFRESH_TOKEN");
  if (!config.bloggerBlogId) missing.push("BLOGGER_BLOG_ID");
  if (missing.length > 0) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          missing,
          defaultPublishMode: config.bloggerDefaultPublishMode,
          allowDirectPublish: config.bloggerAllowDirectPublish,
          tokenRefresh: null,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  // Live check: config presence alone previously masked invalid_grant.
  const fetchImpl = options?.fetchImpl ?? fetch;
  const tokenBody = new URLSearchParams({
    client_id: config.bloggerClientId!,
    client_secret: config.bloggerClientSecret!,
    refresh_token: config.bloggerRefreshToken!,
    grant_type: "refresh_token",
  });
  const tokenRes = await fetchImpl(config.bloggerOAuthTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });
  let tokenRefresh: Record<string, unknown> = {
    httpStatus: tokenRes.status,
    ok: tokenRes.ok,
  };
  if (!tokenRes.ok) {
    try {
      const errJson = (await tokenRes.json()) as {
        error?: string;
        error_description?: string;
      };
      tokenRefresh = {
        ...tokenRefresh,
        error: typeof errJson.error === "string" ? errJson.error : null,
        errorDescription:
          typeof errJson.error_description === "string" ? errJson.error_description : null,
      };
    } catch {
      // ignore
    }
    console.log(
      JSON.stringify(
        {
          ok: false,
          missing: [],
          defaultPublishMode: config.bloggerDefaultPublishMode,
          allowDirectPublish: config.bloggerAllowDirectPublish,
          tokenRefresh,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  tokenRefresh = {
    ...tokenRefresh,
    accessTokenPresent: Boolean(tokenJson.access_token),
  };
  console.log(
    JSON.stringify(
      {
        ok: Boolean(tokenJson.access_token),
        missing: [],
        defaultPublishMode: config.bloggerDefaultPublishMode,
        allowDirectPublish: config.bloggerAllowDirectPublish,
        tokenRefresh,
      },
      null,
      2,
    ),
  );
  if (!tokenJson.access_token) process.exitCode = 1;
}

const SECRET_METADATA_KEY =
  /^(authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|password|secret|api[_-]?key)$/i;

/** Strip query/hash so endpoints never print tokens or credentials. */
export function safeRequestEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}

function sanitizeErrorMetadata(
  metadata: unknown,
): Record<string, string | number | boolean | null> | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (SECRET_METADATA_KEY.test(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Summarize a Google API error body for CLI output.
 * Never includes tokens, Authorization, client secrets, or raw response text.
 */
export function summarizeGoogleApiError(
  httpStatus: number,
  endpoint: string,
  body: unknown,
): {
  httpStatus: number;
  endpoint: string;
  error: {
    code: number | string | null;
    message: string | null;
    status: string | null;
    details: Array<{
      reason?: string;
      domain?: string;
      metadata?: Record<string, string | number | boolean | null>;
    }>;
  };
} {
  const err =
    body && typeof body === "object" && "error" in body
      ? (body as { error?: Record<string, unknown> }).error
      : undefined;
  const detailsRaw = Array.isArray(err?.details) ? err.details : [];
  const legacyErrors = Array.isArray(err?.errors) ? err.errors : [];
  const details = [...detailsRaw, ...legacyErrors]
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object" && !Array.isArray(d))
    .map((d) => {
      const item: {
        reason?: string;
        domain?: string;
        metadata?: Record<string, string | number | boolean | null>;
      } = {};
      if (typeof d.reason === "string") item.reason = d.reason;
      if (typeof d.domain === "string") item.domain = d.domain;
      const metadata = sanitizeErrorMetadata(d.metadata);
      if (metadata) item.metadata = metadata;
      return item;
    })
    .filter((d) => d.reason || d.domain || d.metadata);

  return {
    httpStatus,
    endpoint: safeRequestEndpoint(endpoint),
    error: {
      code: typeof err?.code === "number" || typeof err?.code === "string" ? err.code : null,
      message: typeof err?.message === "string" ? err.message : null,
      status: typeof err?.status === "string" ? err.status : null,
      details,
    },
  };
}

export async function runBloggerListBlogs(options?: {
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const config = loadConfig({ requireDatabaseUrl: false });
  if (
    config.bloggerMode !== "api" ||
    !config.bloggerAllowExternalRequests ||
    !config.bloggerClientId ||
    !config.bloggerClientSecret ||
    !config.bloggerRefreshToken
  ) {
    console.error(
      "blogger-list-blogs requires BLOGGER_MODE=api, BLOGGER_ALLOW_EXTERNAL_REQUESTS=true, and OAuth credentials",
    );
    process.exitCode = 1;
    return;
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  const tokenBody = new URLSearchParams({
    client_id: config.bloggerClientId,
    client_secret: config.bloggerClientSecret,
    refresh_token: config.bloggerRefreshToken,
    grant_type: "refresh_token",
  });
  const tokenRes = await fetchImpl(config.bloggerOAuthTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });
  if (!tokenRes.ok) {
    console.error("Failed to refresh access token");
    process.exitCode = 1;
    return;
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    console.error("Token response missing access_token");
    process.exitCode = 1;
    return;
  }

  const blogsEndpoint = `${config.bloggerApiBaseUrl}/users/self/blogs`;
  const blogsRes = await fetchImpl(blogsEndpoint, {
    headers: { authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!blogsRes.ok) {
    let body: unknown = null;
    try {
      body = await blogsRes.json();
    } catch {
      body = null;
    }
    const summary = summarizeGoogleApiError(blogsRes.status, blogsEndpoint, body);
    console.error(
      JSON.stringify(
        {
          ok: false,
          httpStatus: summary.httpStatus,
          endpoint: summary.endpoint,
          error: summary.error,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }
  const blogsJson = (await blogsRes.json()) as {
    items?: Array<{ id?: string; name?: string; url?: string }>;
  };
  console.log(
    JSON.stringify(
      {
        blogs: (blogsJson.items ?? []).map((b) => ({
          id: b.id,
          name: b.name,
          url: b.url,
        })),
      },
      null,
      2,
    ),
  );
}
