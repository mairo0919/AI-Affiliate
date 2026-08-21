import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runBloggerExchangeCode,
  runBloggerListBlogs,
  safeRequestEndpoint,
  summarizeGoogleApiError,
  upsertEnvVarLine,
  writeBloggerRefreshTokenToEnv,
} from "./blogger-auth-cli.js";

describe("upsertEnvVarLine / writeBloggerRefreshTokenToEnv", () => {
  it("appends BLOGGER_REFRESH_TOKEN when missing", () => {
    const next = upsertEnvVarLine("FOO=1\n", "BLOGGER_REFRESH_TOKEN", "rt-new");
    expect(next).toContain("FOO=1\n");
    expect(next).toMatch(/^BLOGGER_REFRESH_TOKEN=rt-new$/m);
  });

  it("updates existing BLOGGER_REFRESH_TOKEN line only", () => {
    const prev = "A=1\nBLOGGER_REFRESH_TOKEN=old\nB=2\n";
    const next = upsertEnvVarLine(prev, "BLOGGER_REFRESH_TOKEN", "rt-new");
    expect(next).toBe("A=1\nBLOGGER_REFRESH_TOKEN=rt-new\nB=2\n");
    expect(next).not.toContain("old");
  });

  it("writes env file without exposing token in return besides fingerprint", () => {
    const dir = mkdtempSync(join(tmpdir(), "blogger-env-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "BLOGGER_CLIENT_ID=cid\n", "utf8");
    const result = writeBloggerRefreshTokenToEnv(envPath, "super-secret-refresh");
    const body = readFileSync(envPath, "utf8");
    expect(body).toContain("BLOGGER_REFRESH_TOKEN=super-secret-refresh");
    expect(result.envPath).toBe(envPath);
    expect(result.refreshTokenFingerprint).toHaveLength(12);
    expect(JSON.stringify(result)).not.toContain("super-secret-refresh");
  });
});

describe("runBloggerExchangeCode --write-env", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes refresh token to env when --write-env and token present", async () => {
    const dir = mkdtempSync(join(tmpdir(), "blogger-ex-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "BLOGGER_MODE=mock\n", "utf8");
    process.env.BLOGGER_CLIENT_ID = "cid-test";
    process.env.BLOGGER_CLIENT_SECRET = "secret-test";

    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ refresh_token: "rt-from-google", access_token: "atk", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
      logs.push(String(msg));
    });

    await runBloggerExchangeCode(["--code=auth-code-1", "--write-env"], { fetchImpl, envPath });

    const saved = readFileSync(envPath, "utf8");
    expect(saved).toMatch(/^BLOGGER_REFRESH_TOKEN=rt-from-google$/m);
    expect(saved).not.toContain("access_token");
    expect(saved).not.toContain("atk");

    const printed = logs.join("\n");
    expect(printed).toContain('"envUpdated": true');
    expect(printed).toContain('"hasRefreshToken": true');
    expect(printed).not.toContain("rt-from-google");
    expect(printed).not.toContain("secret-test");
    expect(printed).not.toContain("atk");
    spy.mockRestore();
  });

  it("updates existing refresh token line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "blogger-ex2-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "BLOGGER_REFRESH_TOKEN=old-token\nOTHER=1\n", "utf8");
    process.env.BLOGGER_CLIENT_ID = "cid-test";
    process.env.BLOGGER_CLIENT_SECRET = "secret-test";

    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ refresh_token: "rt-updated" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runBloggerExchangeCode(["--code=auth-code-2", "--write-env"], { fetchImpl, envPath });
    const saved = readFileSync(envPath, "utf8");
    expect(saved).toBe("BLOGGER_REFRESH_TOKEN=rt-updated\nOTHER=1\n");
  });

  it("does not modify env when refresh_token missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "blogger-ex3-"));
    const envPath = join(dir, ".env");
    const original = "BLOGGER_REFRESH_TOKEN=keep-me\n";
    writeFileSync(envPath, original, "utf8");
    process.env.BLOGGER_CLIENT_ID = "cid-test";
    process.env.BLOGGER_CLIENT_SECRET = "secret-test";

    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "atk-only" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.exitCode = 0;
    await runBloggerExchangeCode(["--code=auth-code-3", "--write-env"], { fetchImpl, envPath });
    expect(process.exitCode).toBe(1);
    expect(readFileSync(envPath, "utf8")).toBe(original);
    errSpy.mockRestore();
    logSpy.mockRestore();
    process.exitCode = 0;
  });

  it("does not write env without --write-env", async () => {
    const dir = mkdtempSync(join(tmpdir(), "blogger-ex4-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "FOO=1\n", "utf8");
    process.env.BLOGGER_CLIENT_ID = "cid-test";
    process.env.BLOGGER_CLIENT_SECRET = "secret-test";

    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ refresh_token: "rt-not-written" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
      logs.push(String(msg));
    });
    await runBloggerExchangeCode(["--code=auth-code-4"], { fetchImpl, envPath });
    expect(readFileSync(envPath, "utf8")).toBe("FOO=1\n");
    expect(logs.join("\n")).toContain('"envUpdated": false');
    expect(logs.join("\n")).not.toContain("rt-not-written");
  });
});

describe("summarizeGoogleApiError / blogger-list-blogs errors", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it("strips query tokens from endpoints", () => {
    expect(
      safeRequestEndpoint("https://www.googleapis.com/blogger/v3/users/self/blogs?access_token=atk"),
    ).toBe("https://www.googleapis.com/blogger/v3/users/self/blogs");
  });

  it("summarizes Google 403 without secrets", () => {
    const summary = summarizeGoogleApiError(
      403,
      "https://blogger.googleapis.com/v3/users/self/blogs?key=sekrit",
      {
        error: {
          code: 403,
          message: "The request is missing a valid API key.",
          status: "PERMISSION_DENIED",
          details: [
            {
              reason: "API_KEY_INVALID",
              domain: "googleapis.com",
              metadata: {
                service: "blogger.googleapis.com",
                access_token: "must-not-appear",
                client_secret: "must-not-appear",
              },
            },
          ],
        },
      },
    );
    expect(summary.httpStatus).toBe(403);
    expect(summary.endpoint).toBe("https://blogger.googleapis.com/v3/users/self/blogs");
    expect(summary.error.code).toBe(403);
    expect(summary.error.message).toContain("API key");
    expect(summary.error.status).toBe("PERMISSION_DENIED");
    expect(summary.error.details[0]?.reason).toBe("API_KEY_INVALID");
    expect(summary.error.details[0]?.domain).toBe("googleapis.com");
    expect(summary.error.details[0]?.metadata).toEqual({ service: "blogger.googleapis.com" });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("must-not-appear");
    expect(serialized).not.toContain("sekrit");
    expect(serialized).not.toContain("access_token");
  });

  it("prints safe 403 fields from list-blogs and hides tokens", async () => {
    process.env.BLOGGER_MODE = "api";
    process.env.BLOGGER_ALLOW_EXTERNAL_REQUESTS = "true";
    process.env.BLOGGER_CLIENT_ID = "cid-list";
    process.env.BLOGGER_CLIENT_SECRET = "secret-list";
    process.env.BLOGGER_REFRESH_TOKEN = "refresh-list";

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2") || url.includes("token")) {
        return new Response(JSON.stringify({ access_token: "atk-list-secret" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          error: {
            code: 403,
            message: "Request had insufficient authentication scopes.",
            status: "PERMISSION_DENIED",
            details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT", domain: "googleapis.com" }],
          },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((msg: unknown) => {
      errors.push(String(msg));
    });

    process.exitCode = 0;
    await runBloggerListBlogs({ fetchImpl });
    expect(process.exitCode).toBe(1);
    const printed = errors.join("\n");
    expect(printed).toContain('"httpStatus": 403');
    expect(printed).toContain('"status": "PERMISSION_DENIED"');
    expect(printed).toContain("ACCESS_TOKEN_SCOPE_INSUFFICIENT");
    expect(printed).toContain("/users/self/blogs");
    expect(printed).not.toContain("atk-list-secret");
    expect(printed).not.toContain("secret-list");
    expect(printed).not.toContain("refresh-list");
    expect(printed).not.toContain("Bearer");
    expect(printed).not.toContain("Authorization");
  });
});
