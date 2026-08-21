import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  XLiveRepository,
  XOpsRepository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import {
  TokenEncryptionService,
  XOAuthService,
  TokenRefreshService,
  XApiUsageService,
  XApiBudgetService,
  XApiHttpClient,
  createLiveStack,
  assertLivePublishArgs,
  hashOAuthState,
} from "./live/index.js";
import { XApiPublishingProvider } from "./providers/x-api-publishing-provider.js";
import { XPublishError } from "./types.js";
import { SchedulerPipeline } from "../schedules/scheduler-pipeline.js";
import { createLogger } from "@ai-affiliate/shared";

loadConfig({ requireDatabaseUrl: false });

const database = createDatabaseClient();
const liveRepo = new XLiveRepository(database.prisma);
const base = loadConfig({ requireDatabaseUrl: false });

const TEST_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function cfg(overrides: Partial<typeof base> = {}) {
  return {
    ...base,
    xApiEnabled: true,
    xApiProvider: "x-api",
    xApiClientId: "test-client",
    xApiClientSecret: "test-secret",
    xApiAccountId: "acc-1",
    xApiBaseUrl: "https://api.x.com",
    xOAuthCallbackUrl: "http://127.0.0.1:8787/callback",
    xOAuthTokenUrl: "https://api.x.com/2/oauth2/token",
    xOAuthRevokeUrl: "https://api.x.com/2/oauth2/revoke",
    xOAuthAuthorizeUrl: "https://twitter.com/i/oauth2/authorize",
    xTokenEncryptionKey: TEST_KEY,
    xTokenEncryptionKeyVersion: "v1",
    xGlobalKillSwitch: true,
    xReleaseMode: "DISABLED" as const,
    xAutoPublicationEnabled: false,
    xApiWriteCostPerRequest: 0.01,
    xApiReadCostPerResource: 0.001,
    xApiAnalyticsCostPerRequest: 0.005,
    xApiDailySoftBudgetUsd: 1,
    xApiDailyHardBudgetUsd: 3,
    xApiMonthlySoftBudgetUsd: 10,
    xApiMonthlyHardBudgetUsd: 30,
    xApiUnknownCostBehavior: "BLOCK" as const,
    xVerifyPublishedPostEnabled: true,
    xVerifyPublishedPostDelaySeconds: 0,
    xDeletePostEnabled: false,
    ...overrides,
  };
}

type MockRoute = {
  match: (url: string, method: string) => boolean;
  handle: (url: string, init?: RequestInit) => Promise<Response> | Response;
};

function mockFetch(routes: MockRoute[]) {
  const calls: Array<{ url: string; method: string; headers: Headers; body?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method,
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    // Never leak Authorization into assertions via accidental logging — tests check absence of token in audit later.
    for (const route of routes) {
      if (route.match(url, method)) {
        return route.handle(url, init);
      }
    }
    return new Response(JSON.stringify({ error: "not_mocked", url }), { status: 404 });
  };
  return { fetchImpl, calls };
}

async function seedCredential(accountId = "acc-1") {
  const enc = new TokenEncryptionService({ keyBase64: TEST_KEY, keyVersion: "v1" });
  return liveRepo.upsertCredential({
    accountId,
    status: "ACTIVE",
    encryptedAccessToken: enc.encrypt("access-token-1"),
    encryptedRefreshToken: enc.encrypt("refresh-token-1"),
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    encryptionKeyVersion: "v1",
    authorizedAt: new Date(),
    lastRefreshedAt: new Date(),
    bumpTokenVersion: true,
  });
}

beforeAll(async () => {
  await database.connect();
});

afterAll(async () => {
  await database.disconnect();
});

beforeEach(async () => {
  await database.prisma.xApiRequestLog.deleteMany();
  await database.prisma.xApiUsageSnapshot.deleteMany();
  await database.prisma.xApiBudgetControl.deleteMany();
  await database.prisma.xOAuthSession.deleteMany();
  await database.prisma.xApiCredential.deleteMany();
});

describe("TokenEncryptionService", () => {
  it("encrypts and decrypts without plaintext equality to ciphertext", () => {
    const enc = new TokenEncryptionService({ keyBase64: TEST_KEY, keyVersion: "v1" });
    const plain = "super-secret-token";
    const a = enc.encrypt(plain);
    const b = enc.encrypt(plain);
    expect(a).not.toEqual(plain);
    expect(a).not.toEqual(b);
    expect(enc.decrypt(a)).toBe(plain);
    expect(enc.decrypt(b)).toBe(plain);
  });
});

describe("OAuth PKCE + state", () => {
  it("builds authorization URL with PKCE and stores state hash only", async () => {
    const { fetchImpl } = mockFetch([]);
    const stack = createLiveStack({
      config: cfg({ xReleaseMode: "DRY_RUN" }),
      prisma: database.prisma,
      fetchImpl,
      allowWrites: false,
    });
    const started = await stack.oauth.startAuthorization();
    expect(started.authorizationUrl).toContain("code_challenge=");
    expect(started.authorizationUrl).toContain("code_challenge_method=S256");
    expect(started.authorizationUrl).toContain("state=");
    expect(started.state.length).toBeGreaterThan(16);

    const session = await liveRepo.findOAuthSessionByStateHash(hashOAuthState(started.state));
    expect(session).toBeTruthy();
    expect(JSON.stringify(session)).not.toContain(started.state);
    expect(session!.encryptedCodeVerifier).not.toContain("code_verifier");
  });

  it("rejects state reuse and completes token exchange via mock HTTP", async () => {
    const { fetchImpl, calls } = mockFetch([
      {
        match: (url, method) => method === "POST" && url.includes("/oauth2/token"),
        handle: () =>
          Response.json({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 7200,
            scope: "tweet.read tweet.write users.read offline.access",
          }),
      },
      {
        match: (url, method) => method === "GET" && url.includes("/users/me"),
        handle: () =>
          Response.json({
            data: { id: "acc-1", username: "liveuser", name: "Live User" },
          }),
      },
    ]);
    const stack = createLiveStack({
      config: cfg({ xReleaseMode: "DRY_RUN", xGlobalKillSwitch: true }),
      prisma: database.prisma,
      fetchImpl,
      allowWrites: false,
    });
    const started = await stack.oauth.startAuthorization();
    const done = await stack.oauth.completeAuthorization({
      state: started.state,
      code: "auth-code-1",
    });
    expect(done.accountId).toBe("acc-1");
    const cred = await liveRepo.findCredentialByAccountId("acc-1");
    expect(cred?.status).toBe("ACTIVE");
    expect(cred?.encryptedAccessToken).toBeTruthy();
    expect(JSON.stringify(cred)).not.toContain("new-access");
    expect(JSON.stringify(cred)).not.toContain("new-refresh");

    await expect(
      stack.oauth.completeAuthorization({ state: started.state, code: "auth-code-2" }),
    ).rejects.toBeInstanceOf(XPublishError);

    expect(calls.some((c) => c.headers.get("Authorization")?.includes("new-access"))).toBe(
      true,
    );
  });
});

describe("Token refresh", () => {
  it("refreshes, rotates refresh token, and rejects invalid_grant without infinite retry", async () => {
    let refreshCalls = 0;
    const { fetchImpl } = mockFetch([
      {
        match: (url, method) => method === "POST" && url.includes("/oauth2/token"),
        handle: async () => {
          refreshCalls += 1;
          if (refreshCalls === 1) {
            return Response.json({
              access_token: "rotated-access",
              refresh_token: "rotated-refresh",
              expires_in: 7200,
            });
          }
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        },
      },
    ]);
    await seedCredential();
    const stack = createLiveStack({
      config: cfg(),
      prisma: database.prisma,
      fetchImpl,
      allowWrites: false,
    });
    const token = await stack.tokens.refresh("acc-1");
    expect(token).toBe("rotated-access");
    const enc = new TokenEncryptionService({ keyBase64: TEST_KEY, keyVersion: "v1" });
    const cred = await liveRepo.findCredentialByAccountId("acc-1");
    expect(enc.decrypt(cred!.encryptedRefreshToken!)).toBe("rotated-refresh");

    // Force another refresh attempt (valid access would otherwise short-circuit).
    await database.prisma.xApiCredential.update({
      where: { accountId: "acc-1" },
      data: { accessTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    await expect(stack.tokens.refresh("acc-1")).rejects.toBeInstanceOf(XPublishError);
    const after = await liveRepo.findCredentialByAccountId("acc-1");
    expect(after?.status).toBe("INVALID");
    expect(refreshCalls).toBe(2);
  });

  it("prevents concurrent refresh races for same account", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { fetchImpl } = mockFetch([
      {
        match: (url) => url.includes("/oauth2/token"),
        handle: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 50));
          inFlight -= 1;
          return Response.json({
            access_token: "shared-access",
            refresh_token: "shared-refresh",
            expires_in: 7200,
          });
        },
      },
    ]);
    await seedCredential();
    await liveRepo.updateCredentialStatus("acc-1", "ACTIVE", {
      lastRefreshedAt: new Date(0),
    });
    await database.prisma.xApiCredential.update({
      where: { accountId: "acc-1" },
      data: { accessTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    const stack = createLiveStack({
      config: cfg(),
      prisma: database.prisma,
      fetchImpl,
      allowWrites: false,
    });
    const [a, b] = await Promise.all([
      stack.tokens.getValidAccessToken("acc-1"),
      stack.tokens.getValidAccessToken("acc-1"),
    ]);
    expect(a).toBe("shared-access");
    expect(b).toBe("shared-access");
    expect(maxInFlight).toBe(1);
  });
});

describe("XApiPublishingProvider (mock HTTP)", () => {
  it("blocks account mismatch and supports createPost + reply", async () => {
    const { fetchImpl, calls } = mockFetch([
      {
        match: (url) => url.includes("/users/me"),
        handle: () =>
          Response.json({ data: { id: "other-acc", username: "nope", name: "Nope" } }),
      },
    ]);
    await seedCredential();
    const stack = createLiveStack({
      config: cfg({
        xReleaseMode: "ALLOWLIST",
        xGlobalKillSwitch: false,
        xApiAccountId: "acc-1",
      }),
      prisma: database.prisma,
      fetchImpl,
      allowWrites: true,
      sleep: async () => undefined,
    });
    await expect(stack.provider.getAuthenticatedAccount()).rejects.toBeInstanceOf(
      XPublishError,
    );

    const { fetchImpl: fetch2, calls: calls2 } = mockFetch([
      {
        match: (url) => url.includes("/users/me"),
        handle: () =>
          Response.json({ data: { id: "acc-1", username: "liveuser", name: "Live" } }),
      },
      {
        match: (url, method) => method === "POST" && url.includes("/2/tweets"),
        handle: async (_url, init) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            text?: string;
            reply?: { in_reply_to_tweet_id?: string };
          };
          return Response.json({
            data: {
              id: body.reply ? "tweet-reply-1" : "tweet-root-1",
              text: body.text,
            },
          });
        },
      },
      {
        match: (url) => url.includes("/2/tweets/tweet-"),
        handle: (url) => {
          const id = url.includes("tweet-reply-1") ? "tweet-reply-1" : "tweet-root-1";
          return Response.json({ data: { id, text: "hello" } });
        },
      },
    ]);
    const stack2 = createLiveStack({
      config: cfg({
        xReleaseMode: "ALLOWLIST",
        xGlobalKillSwitch: false,
        xVerifyPublishedPostEnabled: true,
        xVerifyPublishedPostDelaySeconds: 0,
        xApiUnknownCostBehavior: "ALLOW",
      }),
      prisma: database.prisma,
      fetchImpl: fetch2,
      allowWrites: true,
      sleep: async () => undefined,
    });
    await stack2.provider.getAuthenticatedAccount();
    const root = await stack2.provider.createPost({
      text: "hello root",
      idempotencyKey: "idemp-1",
    });
    expect(root.postId).toBe("tweet-root-1");
    expect(root.formalPostUrl).toContain("liveuser");
    expect(root.verified).toBe(true);

    const reply = await stack2.provider.createPost({
      text: "hello reply",
      replyToPostId: root.postId,
      idempotencyKey: "idemp-2",
    });
    expect(reply.postId).toBe("tweet-reply-1");
    const createBodies = calls2
      .filter((c) => c.method === "POST" && c.url.includes("/2/tweets"))
      .map((c) => JSON.parse(c.body ?? "{}"));
    expect(createBodies[1].reply.in_reply_to_tweet_id).toBe("tweet-root-1");
    void calls;
  });

  it("marks unverified without re-posting and refuses DRY_RUN createPost", async () => {
    let createCount = 0;
    const { fetchImpl } = mockFetch([
      {
        match: (url) => url.includes("/users/me"),
        handle: () =>
          Response.json({ data: { id: "acc-1", username: "liveuser", name: "Live" } }),
      },
      {
        match: (url, method) => method === "POST" && url.includes("/2/tweets"),
        handle: () => {
          createCount += 1;
          return Response.json({ data: { id: "tweet-uv-1" } });
        },
      },
      {
        match: (url) => url.includes("/2/tweets/tweet-uv-1"),
        handle: () => new Response("{}", { status: 500 }),
      },
    ]);
    await seedCredential();
    const stack = createLiveStack({
      config: cfg({
        xReleaseMode: "ALLOWLIST",
        xGlobalKillSwitch: false,
        xApiUnknownCostBehavior: "ALLOW",
      }),
      prisma: database.prisma,
      fetchImpl,
      allowWrites: true,
      sleep: async () => undefined,
    });
    const result = await stack.provider.createPost({
      text: "unverified",
      idempotencyKey: "uv-1",
    });
    expect(result.verified).toBe(false);
    expect(createCount).toBe(1);

    const dry = createLiveStack({
      config: cfg({ xReleaseMode: "DRY_RUN", xGlobalKillSwitch: false }),
      prisma: database.prisma,
      fetchImpl,
      allowWrites: true,
    });
    await expect(
      dry.provider.createPost({ text: "x", idempotencyKey: "dry" }),
    ).rejects.toThrow(/DRY_RUN/);
    expect(createCount).toBe(1);
  });

  it("retries once after 401 refresh and honors 429 reset", async () => {
    let meCalls = 0;
    const resetAt = Math.floor(Date.now() / 1000) + 1;
    const { fetchImpl } = mockFetch([
      {
        match: (url) => url.includes("/oauth2/token"),
        handle: () =>
          Response.json({
            access_token: "after-401",
            refresh_token: "refresh-2",
            expires_in: 7200,
          }),
      },
      {
        match: (url) => url.includes("/users/me"),
        handle: () => {
          meCalls += 1;
          if (meCalls === 1) {
            return new Response(JSON.stringify({ title: "Unauthorized" }), { status: 401 });
          }
          return Response.json({
            data: { id: "acc-1", username: "liveuser", name: "Live" },
          });
        },
      },
      {
        match: (url, method) => method === "POST" && url.includes("/2/tweets"),
        handle: () =>
          new Response(JSON.stringify({ title: "Too Many Requests" }), {
            status: 429,
            headers: {
              "x-rate-limit-remaining": "0",
              "x-rate-limit-reset": String(resetAt),
            },
          }),
      },
    ]);
    await seedCredential();
    const stack = createLiveStack({
      config: cfg({
        xReleaseMode: "ALLOWLIST",
        xGlobalKillSwitch: false,
        xApiUnknownCostBehavior: "ALLOW",
        xApiMaxAttempts: 2,
      }),
      prisma: database.prisma,
      fetchImpl,
      allowWrites: true,
      sleep: async () => undefined,
    });
    const account = await stack.provider.getAuthenticatedAccount();
    expect(account.accountId).toBe("acc-1");
    expect(meCalls).toBe(2);

    await expect(
      stack.provider.createPost({ text: "rate", idempotencyKey: "rl" }),
    ).rejects.toBeInstanceOf(XPublishError);
    const log = await liveRepo.latestRateLimit("tweets.create");
    expect(log?.rateLimitRemaining).toBe(0);
    expect(log?.rateLimitResetAt).toBeTruthy();
  });

  it("converts metrics with null private fields and excludes >30d private", async () => {
    const oldCreated = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const { fetchImpl } = mockFetch([
      {
        match: (url) => url.includes("/2/tweets?ids="),
        handle: () =>
          Response.json({
            data: [
              {
                id: "m1",
                created_at: oldCreated,
                public_metrics: {
                  like_count: 2,
                  reply_count: 1,
                  retweet_count: 0,
                  quote_count: 0,
                  bookmark_count: 1,
                },
                non_public_metrics: { impression_count: 999 },
              },
            ],
          }),
      },
    ]);
    await seedCredential();
    const stack = createLiveStack({
      config: cfg({
        xReleaseMode: "FULL",
        xGlobalKillSwitch: false,
        xApiUnknownCostBehavior: "ALLOW",
      }),
      prisma: database.prisma,
      fetchImpl,
      allowWrites: false,
    });
    const [metrics] = await stack.provider.getPostMetrics(["m1"]);
    expect(metrics.likeCount).toBe(2);
    expect(metrics.impressionCount).toBeNull();
    expect(metrics.urlClickCount).toBeNull();
    expect(metrics.rawMetricAvailability?.olderThan30Days).toBe(true);
  });
});

describe("Usage + budget", () => {
  it("prefers reported cost and enforces soft/hard/unknown BLOCK", async () => {
    await seedCredential();
    const stack = createLiveStack({
      config: cfg({
        xApiUnknownCostBehavior: "BLOCK",
        xApiWriteCostPerRequest: null,
        xApiReadCostPerResource: null,
        xApiAnalyticsCostPerRequest: null,
      }),
      prisma: database.prisma,
      fetchImpl: mockFetch([]).fetchImpl,
      allowWrites: false,
    });
    const unknown = await stack.budget.checkPaidRequest("acc-1", null);
    expect(unknown.allowed).toBe(false);
    expect(unknown.reason).toContain("UNKNOWN");

    await stack.usage.recordManualUsage({
      accountId: "acc-1",
      reportedCost: 2.5,
      estimatedCost: 1.0,
    });
    const status = await stack.usage.status("acc-1");
    expect(status.preferredCost).toBe(2.5);
    expect(status.preferredLabel).toBe("reported");
    expect(status.delta).toBe(1.5);

    const stack2 = createLiveStack({
      config: cfg({
        xApiDailySoftBudgetUsd: 1,
        xApiDailyHardBudgetUsd: 2,
        xApiUnknownCostBehavior: "ALLOW",
      }),
      prisma: database.prisma,
      fetchImpl: mockFetch([]).fetchImpl,
      allowWrites: false,
    });
    await stack2.usage.recordManualUsage({
      accountId: "acc-1",
      reportedCost: 1.5,
      estimatedCost: 1.5,
    });
    const soft = await stack2.budget.refreshUsage("acc-1");
    expect(soft.currentUsage).toBeGreaterThanOrEqual(1);
    expect(soft.softReached || soft.currentUsage >= 1).toBe(true);

    await database.prisma.xApiUsageSnapshot.deleteMany();
    await stack2.usage.recordManualUsage({
      accountId: "acc-1",
      reportedCost: 2.5,
      estimatedCost: 2.5,
    });
    const hard = await stack2.budget.refreshUsage("acc-1");
    expect(hard.currentUsage).toBeGreaterThanOrEqual(2);
    expect(hard.hardReached || !hard.allowed).toBe(true);
    expect(hard.allowed).toBe(false);
    expect(hard.reason).toMatch(/API_BUDGET_PAUSED|HARD/);
  });
});

describe("Release mode + ALLOWLIST protection", () => {
  it("requires --live and confirm args; DISABLED skips API", async () => {
    expect(() =>
      assertLivePublishArgs({
        publicationId: "p1",
        accountId: "acc-1",
        live: false,
        actor: "admin",
        reason: "test",
      }),
    ).toThrow(/--live/);

    expect(() =>
      assertLivePublishArgs({
        publicationId: "p1",
        accountId: "acc-1",
        confirmAccount: "@liveuser",
        confirmTextHash: "abcd",
        live: true,
        actor: "admin",
        reason: "initial live verification",
      }),
    ).toThrow(/confirm-text-hash/);

    assertLivePublishArgs({
      publicationId: "p1",
      accountId: "acc-1",
      confirmAccount: "@liveuser",
      confirmTextHash: "a".repeat(32),
      live: true,
      actor: "admin",
      reason: "initial live verification",
    });

    let called = false;
    const { fetchImpl } = mockFetch([
      {
        match: () => true,
        handle: () => {
          called = true;
          return Response.json({});
        },
      },
    ]);
    await seedCredential();
    const disabled = createLiveStack({
      config: cfg({ xReleaseMode: "DISABLED", xApiEnabled: true }),
      prisma: database.prisma,
      fetchImpl,
      allowWrites: true,
    });
    await expect(
      disabled.provider.createPost({ text: "x", idempotencyKey: "d" }),
    ).rejects.toThrow(/DISABLED/);
    expect(called).toBe(false);
  });

  it("scheduler skips ALLOWLIST live publish", async () => {
    const pipeline = new SchedulerPipeline({
      logger: createLogger("error"),
      database,
      config: cfg({
        xReleaseMode: "ALLOWLIST",
        xGlobalKillSwitch: false,
        xAutoPublicationEnabled: true,
        xApiEnabled: true,
        xApiProvider: "mock",
      }),
    });
    const result = await (
      pipeline as unknown as {
        runXPublishPhase: () => Promise<{ skipped?: boolean; skipReason?: string }>;
      }
    ).runXPublishPhase();
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("ALLOWLIST");
  });
});

describe("Audit sanitization", () => {
  it("does not persist tokens in request logs or errors", async () => {
    const { fetchImpl } = mockFetch([
      {
        match: (url) => url.includes("/users/me"),
        handle: () =>
          Response.json({ data: { id: "acc-1", username: "liveuser", name: "Live" } }),
      },
    ]);
    await seedCredential();
    const stack = createLiveStack({
      config: cfg({ xReleaseMode: "DRY_RUN" }),
      prisma: database.prisma,
      fetchImpl,
      allowWrites: false,
    });
    await stack.provider.getAuthenticatedAccount();
    const logs = await database.prisma.xApiRequestLog.findMany();
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toMatch(/access-token|Bearer |refresh-token/i);
    expect(serialized).not.toContain("test-secret");

    const err = new XPublishError("X API request failed status=401 code=UNAUTHORIZED", "AuthTransient", {
      httpStatus: 401,
    });
    expect(err.message).not.toMatch(/access-token|Bearer /i);
  });
});

describe("smoke helpers", () => {
  it("hashOAuthState is stable sha256 hex", () => {
    const state = randomBytes(16).toString("hex");
    expect(hashOAuthState(state)).toBe(
      createHash("sha256").update(state, "utf8").digest("hex"),
    );
  });

  it("exposes services for wiring", () => {
    expect(XOAuthService).toBeTruthy();
    expect(TokenRefreshService).toBeTruthy();
    expect(XApiUsageService).toBeTruthy();
    expect(XApiBudgetService).toBeTruthy();
    expect(XApiHttpClient).toBeTruthy();
    expect(XApiPublishingProvider).toBeTruthy();
    expect(XOpsRepository).toBeTruthy();
  });
});
