import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { loadConfig } from "@ai-affiliate/config";
import {
  ContentRepository,
  NotificationRepository,
  XLiveRepository,
  XOpsRepository,
  XPublicationRepository,
  createDatabaseClient,
  hashNormalizedBody,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { NotificationService } from "../notifications/index.js";
import { createLiveStack, assertLivePublishArgs } from "./live/index.js";
import { XPublicationService } from "./publication-service.js";
import { XMetricsCollector } from "./metrics-collector.js";

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

function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

/** Bind only for local OAuth redirect URLs (Developer Console loopback). */
function resolveLocalCallbackBind(callbackUrl: string): {
  host: string;
  port: number;
  pathname: string;
} | null {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return null;
  const port = parsed.port
    ? Number.parseInt(parsed.port, 10)
    : parsed.protocol === "https:"
      ? 443
      : 80;
  if (!Number.isFinite(port) || port <= 0) return null;
  return { host: parsed.hostname, port, pathname: parsed.pathname || "/" };
}

function startOAuthCallbackServer(options: {
  host: string;
  port: number;
  pathname: string;
  timeoutMs: number;
}): {
  ready: Promise<void>;
  result: Promise<
    | { ok: true; code: string; state: string }
    | { ok: false; error: string; errorDescription?: string }
  >;
} {
  let settleResult:
    | ((
        value:
          | { ok: true; code: string; state: string }
          | { ok: false; error: string; errorDescription?: string },
      ) => void)
    | null = null;
  let rejectResult: ((error: unknown) => void) | null = null;
  let settleReady: (() => void) | null = null;
  let rejectReady: ((error: unknown) => void) | null = null;
  let settled = false;

  const ready = new Promise<void>((resolve, reject) => {
    settleReady = resolve;
    rejectReady = reject;
  });
  const result = new Promise<
    | { ok: true; code: string; state: string }
    | { ok: false; error: string; errorDescription?: string }
  >((resolve, reject) => {
    settleResult = resolve;
    rejectResult = reject;
  });

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${options.host}:${options.port}`);
      if (url.pathname !== options.pathname) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        const errorDescription = url.searchParams.get("error_description") ?? undefined;
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(
          "<!doctype html><html><body><h1>Authorization failed</h1><p>You can close this window.</p></body></html>",
        );
        finish({ ok: false, error: oauthError, errorDescription });
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("Missing code or state");
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><html><body><h1>Authorization received</h1><p>You can close this window and return to the terminal.</p></body></html>",
      );
      finish({ ok: true, code, state });
    } catch (error) {
      finishError(error);
    }
  });

  const timer = setTimeout(() => {
    finishError(new Error("Timed out waiting for OAuth callback"));
  }, options.timeoutMs);

  function cleanup(): void {
    clearTimeout(timer);
    server.close();
  }

  function finish(
    value:
      | { ok: true; code: string; state: string }
      | { ok: false; error: string; errorDescription?: string },
  ): void {
    if (settled) return;
    settled = true;
    cleanup();
    settleResult?.(value);
  }

  function finishError(error: unknown): void {
    if (settled) return;
    settled = true;
    cleanup();
    rejectResult?.(error);
    rejectReady?.(error);
  }

  server.on("error", (error) => {
    finishError(error);
  });

  server.listen(options.port, options.host, () => {
    settleReady?.();
  });

  return { ready, result };
}

async function withDb<T>(
  run: (db: ReturnType<typeof createDatabaseClient>) => Promise<T>,
): Promise<T> {
  // pnpm --filter runs with cwd=apps/content-operator; loadConfig resolves ../../.env (repo root).
  // Must populate process.env.DATABASE_URL before PrismaClient constructs.
  loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    return await run(database);
  } finally {
    await database.disconnect();
  }
}

function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    if (/bearer\s+/i.test(value) || value.length > 80) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/token|secret|authorization|verifier|password/i.test(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out;
  }
  return value;
}

export async function runXAuthStart(): Promise<void> {
  await withDb(async (database) => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const notifications = new NotificationService({
      logger,
      config,
      notifications: new NotificationRepository(database.prisma),
    });
    const stack = createLiveStack({
      config,
      prisma: database.prisma,
      allowWrites: false,
      notifications: {
        emitXEvent: (eventType, payload) =>
          notifications
            .emitXEvent(
              eventType as Parameters<NotificationService["emitXEvent"]>[0],
              payload,
            )
            .then(() => undefined),
      },
    });

    const bind = resolveLocalCallbackBind(config.xOAuthCallbackUrl);
    const started = await stack.oauth.startAuthorization();
    const timeoutMs = Math.max(
      5_000,
      started.expiresAt.getTime() - Date.now(),
    );

    if (!bind) {
      console.log(
        JSON.stringify(
          {
            authorizationUrl: started.authorizationUrl,
            sessionId: started.sessionId,
            expiresAt: started.expiresAt.toISOString(),
            scopes: started.scopes,
            callbackListener: false,
            callbackUrl: config.xOAuthCallbackUrl,
            note: "Callback is not a local loopback URL. Open authorizationUrl, then run x:auth:complete with --state and --code.",
            state: started.state,
          },
          null,
          2,
        ),
      );
      return;
    }

    const listener = startOAuthCallbackServer({
      host: bind.host,
      port: bind.port,
      pathname: bind.pathname,
      timeoutMs,
    });
    await listener.ready;

    console.log(
      JSON.stringify(
        {
          authorizationUrl: started.authorizationUrl,
          sessionId: started.sessionId,
          expiresAt: started.expiresAt.toISOString(),
          scopes: started.scopes,
          callbackListener: true,
          listening: `http://${bind.host}:${bind.port}${bind.pathname}`,
          note: "Open authorizationUrl in a browser. This process waits for the local callback, then exchanges the code (tokens are never printed).",
          state: started.state,
        },
        null,
        2,
      ),
    );

    const callback = await listener.result;

    if (!callback.ok) {
      console.error(
        JSON.stringify(
          {
            ok: false,
            error: callback.error,
            errorDescription: callback.errorDescription ?? null,
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }

    const result = await stack.oauth.completeAuthorization({
      state: callback.state,
      code: callback.code,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          accountId: result.accountId,
          username: result.username ?? null,
          scopes: result.scopes,
          authorizedAt: result.authorizedAt.toISOString(),
          note: "OAuth complete. Refresh/access tokens stored encrypted; values are not printed.",
        },
        null,
        2,
      ),
    );
  });
}

export async function runXAuthComplete(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const state = flagString(flags, "state");
  const code = flagString(flags, "code");
  if (!state || !code) {
    console.error("Usage: x:auth:complete -- --state=<STATE> --code=<CODE>");
    process.exitCode = 1;
    return;
  }
  await withDb(async (database) => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const notifications = new NotificationService({
      logger,
      config,
      notifications: new NotificationRepository(database.prisma),
    });
    const stack = createLiveStack({
      config,
      prisma: database.prisma,
      allowWrites: false,
      notifications: {
        emitXEvent: (eventType, payload) =>
          notifications
            .emitXEvent(
              eventType as Parameters<NotificationService["emitXEvent"]>[0],
              payload,
            )
            .then(() => undefined),
      },
    });
    const result = await stack.oauth.completeAuthorization({ state, code });
    console.log(
      JSON.stringify(
        {
          accountId: result.accountId,
          username: result.username,
          scopes: result.scopes,
          authorizedAt: result.authorizedAt.toISOString(),
        },
        null,
        2,
      ),
    );
  });
}

export async function runXAuthStatus(): Promise<void> {
  await withDb(async (database) => {
    const live = new XLiveRepository(database.prisma);
    const cred = await live.findActiveCredential();
    console.log(
      JSON.stringify(
        {
          present: Boolean(cred),
          accountId: cred?.accountId ?? null,
          status: cred?.status ?? null,
          scopes: cred?.scopes ?? null,
          accessTokenExpiresAt: cred?.accessTokenExpiresAt?.toISOString() ?? null,
          lastRefreshedAt: cred?.lastRefreshedAt?.toISOString() ?? null,
          lastRefreshFailedAt: cred?.lastRefreshFailedAt?.toISOString() ?? null,
          lastRefreshErrorCode: cred?.lastRefreshErrorCode ?? null,
          encryptionKeyVersion: cred?.encryptionKeyVersion ?? null,
          tokenVersion: cred?.tokenVersion ?? null,
        },
        null,
        2,
      ),
    );
  });
}

export async function runXAuthRefresh(): Promise<void> {
  await withDb(async (database) => {
    const config = loadConfig();
    const stack = createLiveStack({ config, prisma: database.prisma, allowWrites: false });
    const accountId = config.xApiAccountId;
    if (!accountId) {
      console.error("X_API_ACCOUNT_ID is required");
      process.exitCode = 1;
      return;
    }
    await stack.tokens.refresh(accountId);
    console.log(JSON.stringify({ refreshed: true, accountId }, null, 2));
  });
}

export async function runXAuthRevoke(): Promise<void> {
  await withDb(async (database) => {
    const config = loadConfig();
    const stack = createLiveStack({ config, prisma: database.prisma, allowWrites: false });
    const accountId = config.xApiAccountId;
    if (!accountId) {
      console.error("X_API_ACCOUNT_ID is required");
      process.exitCode = 1;
      return;
    }
    await stack.oauth.revoke(accountId);
    console.log(JSON.stringify({ revoked: true, accountId }, null, 2));
  });
}

export async function runXAuthTest(): Promise<void> {
  await withDb(async (database) => {
    const config = loadConfig();
    const stack = createLiveStack({ config, prisma: database.prisma, allowWrites: false });
    const account = await stack.provider.getAuthenticatedAccount();
    console.log(
      JSON.stringify(
        {
          accountId: account.accountId,
          username: account.username,
          displayName: account.displayName,
          confirmedAt: account.confirmedAt?.toISOString() ?? null,
        },
        null,
        2,
      ),
    );
  });
}

export async function runXLiveStatus(): Promise<void> {
  await withDb(async (database) => {
    const config = loadConfig();
    const live = new XLiveRepository(database.prisma);
    const cred = await live.findActiveCredential();
    const budget = await live.listBudgets(config.xApiAccountId ?? null);
    console.log(
      JSON.stringify(
        {
          xApiEnabled: config.xApiEnabled,
          xApiProvider: config.xApiProvider,
          releaseMode: config.xReleaseMode,
          killSwitch: config.xGlobalKillSwitch,
          autoPublicationEnabled: config.xAutoPublicationEnabled,
          credentialStatus: cred?.status ?? null,
          accountId: cred?.accountId ?? config.xApiAccountId ?? null,
          budgets: budget.map((b) => ({
            periodType: b.periodType,
            status: b.status,
            softLimit: b.softLimit,
            hardLimit: b.hardLimit,
            currentEstimatedUsage: b.currentEstimatedUsage,
            currentReportedUsage: b.currentReportedUsage,
          })),
        },
        null,
        2,
      ),
    );
  });
}

export async function runXLiveDiagnose(): Promise<void> {
  await withDb(async (database) => {
    const config = loadConfig();
    const live = new XLiveRepository(database.prisma);
    const ops = new XOpsRepository(database.prisma);
    const now = new Date();
    const cred = await live.findActiveCredential();
    let anyCred = cred;
    if (!anyCred && config.xApiAccountId) {
      anyCred = await live.findCredentialByAccountId(config.xApiAccountId);
    }
    if (!anyCred) {
      anyCred = await database.prisma.xApiCredential.findFirst({
        orderBy: { updatedAt: "desc" },
      });
    }
    const rateWrite = await live.latestRateLimit("tweets.create");
    const rateMetrics = await live.latestRateLimit("tweets.metrics");
    const budgets = await live.listBudgets(config.xApiAccountId ?? null);
    const usage = await live.latestUsageSnapshot(config.xApiAccountId ?? null);

    const encryptionKeyFromEnv = Boolean(process.env.X_TOKEN_ENCRYPTION_KEY?.trim());
    const scopes = Array.isArray(anyCred?.scopes)
      ? (anyCred!.scopes as string[])
      : [];
    const requiredScopes = ["tweet.read", "tweet.write", "users.read", "offline.access"];
    const missingScopes = requiredScopes.filter((s) => !scopes.includes(s));

    const dbKill = await ops.isControlActive("GLOBAL_KILL_SWITCH", now);
    const dbPublishPaused = await ops.isControlActive("PUBLISHING_PAUSED", now);
    const dbMetricsPaused = await ops.isControlActive("METRICS_PAUSED", now);

    const accessExpiresAt = anyCred?.accessTokenExpiresAt ?? null;
    const refreshBufferMs = config.xTokenRefreshBufferMinutes * 60_000;
    const accessExpiringSoon =
      accessExpiresAt != null &&
      accessExpiresAt.getTime() <= now.getTime() + refreshBufferMs;

    const checks = {
      summary: {
        readyForDryRun:
          config.xApiEnabled &&
          config.xApiProvider === "x-api" &&
          encryptionKeyFromEnv &&
          Boolean(config.xApiClientId) &&
          Boolean(config.xApiClientSecret) &&
          Boolean(config.xApiAccountId) &&
          anyCred?.status === "ACTIVE" &&
          missingScopes.length === 0,
        readyForAllowlistLive:
          config.xReleaseMode === "ALLOWLIST" &&
          !config.xGlobalKillSwitch &&
          !dbKill &&
          !dbPublishPaused &&
          config.xApiEnabled &&
          anyCred?.status === "ACTIVE",
        note: "Token values are never displayed. This is a local diagnosis only.",
      },
      api: {
        enabled: config.xApiEnabled,
        provider: config.xApiProvider,
        baseUrl: config.xApiBaseUrl,
        timeoutMs: config.xApiTimeoutMs,
        maxAttempts: config.xApiMaxAttempts,
        userAgent: config.xApiUserAgent,
        clientIdConfigured: Boolean(config.xApiClientId),
        clientSecretConfigured: Boolean(config.xApiClientSecret),
        accountIdConfigured: config.xApiAccountId ?? null,
        deletePostEnabled: config.xDeletePostEnabled,
        verifyPublishedPostEnabled: config.xVerifyPublishedPostEnabled,
        verifyDelaySeconds: config.xVerifyPublishedPostDelaySeconds,
      },
      oauth: {
        authorizeUrl: config.xOAuthAuthorizeUrl,
        tokenUrl: config.xOAuthTokenUrl,
        revokeUrl: config.xOAuthRevokeUrl,
        callbackUrl: config.xOAuthCallbackUrl,
        requestedScopes: config.xOAuthScopes,
        sessionTtlMinutes: config.xOAuthSessionTtlMinutes,
      },
      encryption: {
        keyConfiguredFromEnv: encryptionKeyFromEnv,
        keyVersion: config.xTokenEncryptionKeyVersion,
        usingBuiltinNonProductionFallback: !encryptionKeyFromEnv && config.nodeEnv !== "production",
        productionWouldRejectEmptyKey: config.nodeEnv === "production" && !encryptionKeyFromEnv,
      },
      credential: {
        present: Boolean(anyCred),
        accountId: anyCred?.accountId ?? null,
        status: anyCred?.status ?? "MISSING",
        tokenVersion: anyCred?.tokenVersion ?? null,
        encryptionKeyVersion: anyCred?.encryptionKeyVersion ?? null,
        authorizedAt: anyCred?.authorizedAt?.toISOString() ?? null,
        lastRefreshedAt: anyCred?.lastRefreshedAt?.toISOString() ?? null,
        lastRefreshFailedAt: anyCred?.lastRefreshFailedAt?.toISOString() ?? null,
        lastRefreshErrorCode: anyCred?.lastRefreshErrorCode ?? null,
        revokedAt: anyCred?.revokedAt?.toISOString() ?? null,
      },
      token: {
        hasEncryptedAccessToken: Boolean(anyCred?.encryptedAccessToken),
        hasEncryptedRefreshToken: Boolean(anyCred?.encryptedRefreshToken),
        accessTokenExpiresAt: accessExpiresAt?.toISOString() ?? null,
        accessExpiringSoon,
        refreshBufferMinutes: config.xTokenRefreshBufferMinutes,
        // never expose token plaintext
      },
      scopes: {
        granted: scopes,
        missingRequired: missingScopes,
        writeLikely: scopes.includes("tweet.write"),
        metricsReadLikely: scopes.includes("tweet.read"),
        offlineAccess: scopes.includes("offline.access"),
      },
      account: {
        configuredAccountId: config.xApiAccountId ?? null,
        credentialAccountId: anyCred?.accountId ?? null,
        matches:
          !config.xApiAccountId || !anyCred
            ? null
            : config.xApiAccountId === anyCred.accountId,
        allowlistAccounts: config.xReleaseAllowedAccountIds,
      },
      releaseMode: {
        mode: config.xReleaseMode,
        allowedStrategies: config.xReleaseAllowedStrategies,
        allowedCandidateTypes: config.xReleaseAllowedCandidateTypes,
        dailyPostLimit: config.xReleaseDailyPostLimit,
        hourlyPostLimit: config.xReleaseHourlyPostLimit,
        allowedHoursJst: {
          start: config.xReleaseAllowedStartHourJst,
          end: config.xReleaseAllowedEndHourJst,
        },
        autoPublicationEnabled: config.xAutoPublicationEnabled,
        writeEnabledByRelease:
          config.xReleaseMode === "LIMITED" ||
          config.xReleaseMode === "FULL" ||
          config.xReleaseMode === "ALLOWLIST",
        schedulerLiveAllowed:
          config.xReleaseMode === "LIMITED" || config.xReleaseMode === "FULL",
      },
      runtime: {
        envKillSwitch: config.xGlobalKillSwitch,
        dbGlobalKillSwitch: dbKill,
        dbPublishingPaused: dbPublishPaused,
        dbMetricsPaused: dbMetricsPaused,
        effectivePublishingBlocked:
          config.xGlobalKillSwitch || dbKill || dbPublishPaused,
      },
      budget: {
        currency: config.xApiCostCurrency,
        unknownCostBehavior: config.xApiUnknownCostBehavior,
        dailySoftUsd: config.xApiDailySoftBudgetUsd,
        dailyHardUsd: config.xApiDailyHardBudgetUsd,
        monthlySoftUsd: config.xApiMonthlySoftBudgetUsd,
        monthlyHardUsd: config.xApiMonthlyHardBudgetUsd,
        writeCostPerRequestConfigured: config.xApiWriteCostPerRequest != null,
        readCostPerResourceConfigured: config.xApiReadCostPerResource != null,
        analyticsCostConfigured: config.xApiAnalyticsCostPerRequest != null,
        periods: budgets.map((b) => ({
          periodType: b.periodType,
          status: b.status,
          softLimit: b.softLimit,
          hardLimit: b.hardLimit,
          currentEstimatedUsage: b.currentEstimatedUsage,
          currentReportedUsage: b.currentReportedUsage,
          periodStartedAt: b.periodStartedAt.toISOString(),
          periodEndsAt: b.periodEndsAt.toISOString(),
        })),
        latestUsageSource: usage?.source ?? null,
        latestReportedCost: usage?.reportedCost ?? null,
        latestEstimatedCost: usage?.estimatedCost ?? null,
      },
      rateLimit: {
        write: {
          remaining: rateWrite?.rateLimitRemaining ?? null,
          resetAt: rateWrite?.rateLimitResetAt?.toISOString() ?? null,
        },
        metrics: {
          remaining: rateMetrics?.rateLimitRemaining ?? null,
          resetAt: rateMetrics?.rateLimitResetAt?.toISOString() ?? null,
        },
      },
      metrics: {
        collectionEnabled: config.xMetricsCollectionEnabled,
        windowsMinutes: config.xMetricsCollectionWindowsMinutes,
      },
    };
    console.log(JSON.stringify(redactSecrets(checks), null, 2));
  });
}

export async function runXLivePublish(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  try {
    assertLivePublishArgs({
      publicationId: flagString(flags, "publication-id"),
      accountId: flagString(flags, "account-id"),
      confirmAccount: flagString(flags, "confirm-account"),
      confirmTextHash: flagString(flags, "confirm-text-hash"),
      live: flags.live === true || flags.live === "true",
      actor: flagString(flags, "actor"),
      reason: flagString(flags, "reason"),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  await withDb(async (database) => {
    const config = loadConfig();
    if (config.xReleaseMode === "DISABLED" || config.xReleaseMode === "DRY_RUN") {
      console.error(`Refuse live publish in release mode=${config.xReleaseMode}`);
      process.exitCode = 1;
      return;
    }
    if (config.xGlobalKillSwitch) {
      console.error("Refuse live publish while X_GLOBAL_KILL_SWITCH=true");
      process.exitCode = 1;
      return;
    }
    const logger = createLogger(config.logLevel);
    const publications = new XPublicationRepository(database.prisma);
    const contents = new ContentRepository(database.prisma);
    const ops = new XOpsRepository(database.prisma);
    const notifications = new NotificationService({
      logger,
      config,
      notifications: new NotificationRepository(database.prisma),
    });
    const stack = createLiveStack({
      config,
      prisma: database.prisma,
      allowWrites: true,
      notifications: {
        emitXEvent: (eventType, payload) =>
          notifications
            .emitXEvent(
              eventType as Parameters<NotificationService["emitXEvent"]>[0],
              payload,
            )
            .then(() => undefined),
      },
    });

    const publicationId = flagString(flags, "publication-id")!;
    const accountId = flagString(flags, "account-id")!;
    const confirmAccount = flagString(flags, "confirm-account")!;
    const confirmTextHash = flagString(flags, "confirm-text-hash")!;

    const account = await stack.provider.getAuthenticatedAccount();
    if (account.accountId !== accountId) {
      console.error("account-id does not match authenticated account");
      process.exitCode = 1;
      return;
    }
    const username = account.username ? `@${account.username}` : null;
    if (username !== confirmAccount) {
      console.error("confirm-account does not match authenticated username");
      process.exitCode = 1;
      return;
    }

    const pub = await publications.findById(publicationId);
    if (!pub) {
      console.error("publication not found");
      process.exitCode = 1;
      return;
    }
    const root = pub.posts.find((p) => p.sequence === 1);
    if (!root) {
      console.error("root post missing");
      process.exitCode = 1;
      return;
    }
    const bodyHash = hashNormalizedBody(root.body);
    const altHash = createHash("sha256").update(root.body, "utf8").digest("hex");
    if (confirmTextHash !== bodyHash && confirmTextHash !== altHash) {
      console.error("confirm-text-hash does not match publication root body");
      process.exitCode = 1;
      return;
    }

    const service = new XPublicationService({
      logger,
      config,
      contents,
      publications,
      provider: stack.provider,
      ops,
      now: () => new Date(),
      livePublishConfirmed: true,
      checkApiBudget: (id) => stack.budget.checkPaidRequest(id),
      notifications: {
        emitXEvent: (eventType, payload) =>
          notifications.emitXEvent(eventType, payload).then(() => undefined),
      },
    });

    const result = await service.publishOne(publicationId, {
      actorType: "CLI",
      actorId: flagString(flags, "actor") ?? "admin",
      phase: "publish",
    });
    console.log(
      JSON.stringify(
        {
          publicationId: result.id,
          status: result.status,
          rootPostId: result.rootPostId,
          rootPostUrl: result.rootPostUrl,
          note:
            result.status === "PUBLISHED" || result.status === "PUBLISHED_UNVERIFIED"
              ? "Live publish attempted via API (verify status separately)."
              : "Publish did not complete successfully.",
        },
        null,
        2,
      ),
    );
  });
}

export async function runXLiveMetrics(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  await withDb(async (database) => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const stack = createLiveStack({ config, prisma: database.prisma, allowWrites: false });
    const collector = new XMetricsCollector({
      logger,
      config,
      publications: new XPublicationRepository(database.prisma),
      provider: stack.provider,
      beforeCollect: async () => {
        const budget = await stack.budget.checkPaidRequest(
          config.xApiAccountId,
          stack.usage.estimateCost("analytics"),
        );
        return { ok: budget.allowed, reason: budget.reason };
      },
    });
    const limit = flagString(flags, "limit")
      ? Number.parseInt(flagString(flags, "limit")!, 10)
      : undefined;
    const result = await collector.collect({ limit });
    console.log(JSON.stringify(result, null, 2));
  });
}

export async function runXUsageStatus(): Promise<void> {
  await withDb(async (database) => {
    const config = loadConfig();
    const stack = createLiveStack({ config, prisma: database.prisma, allowWrites: false });
    const status = await stack.usage.status(config.xApiAccountId);
    console.log(
      JSON.stringify(
        {
          ...status,
          disclaimer:
            status.preferredLabel === "estimate_only"
              ? "Estimated cost is not an invoice amount."
              : "Reported cost preferred when available; estimate shown for delta only.",
        },
        null,
        2,
      ),
    );
  });
}

export async function runXUsageSync(): Promise<void> {
  await withDb(async (database) => {
    const config = loadConfig();
    const stack = createLiveStack({ config, prisma: database.prisma, allowWrites: false });
    const result = await stack.usage.syncOfficialUsage(config.xApiAccountId);
    console.log(JSON.stringify(result, null, 2));
  });
}

export async function runXUsageReport(): Promise<void> {
  await runXUsageStatus();
}

export async function runXBudgetStatus(): Promise<void> {
  await withDb(async (database) => {
    const config = loadConfig();
    const stack = createLiveStack({ config, prisma: database.prisma, allowWrites: false });
    const check = await stack.budget.refreshUsage(config.xApiAccountId);
    const budgets = await stack.live.listBudgets(config.xApiAccountId ?? null);
    console.log(JSON.stringify({ check, budgets }, null, 2));
  });
}

export async function runXBudgetSet(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const periodType = flagString(flags, "period");
  const soft = flagString(flags, "soft");
  const hard = flagString(flags, "hard");
  if (
    (periodType !== "DAILY" && periodType !== "MONTHLY") ||
    soft == null ||
    hard == null
  ) {
    console.error(
      "Usage: x:budget:set -- --period=DAILY|MONTHLY --soft=<N> --hard=<N> [--actor=admin]",
    );
    process.exitCode = 1;
    return;
  }
  await withDb(async (database) => {
    const config = loadConfig();
    const stack = createLiveStack({ config, prisma: database.prisma, allowWrites: false });
    const updated = await stack.budget.setLimits({
      accountId: config.xApiAccountId ?? null,
      periodType,
      softLimit: Number.parseFloat(soft),
      hardLimit: Number.parseFloat(hard),
      updatedBy: flagString(flags, "actor") ?? "admin",
    });
    console.log(
      JSON.stringify(
        {
          id: updated.id,
          periodType: updated.periodType,
          softLimit: updated.softLimit,
          hardLimit: updated.hardLimit,
          status: updated.status,
        },
        null,
        2,
      ),
    );
  });
}

export async function runXBudgetPause(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  await withDb(async (database) => {
    const config = loadConfig();
    const stack = createLiveStack({ config, prisma: database.prisma, allowWrites: false });
    await stack.budget.pause(
      config.xApiAccountId ?? null,
      flagString(flags, "reason") ?? "manual pause",
      flagString(flags, "actor") ?? "admin",
    );
    console.log(JSON.stringify({ paused: true }, null, 2));
  });
}

export async function runXBudgetResume(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  await withDb(async (database) => {
    const config = loadConfig();
    const stack = createLiveStack({ config, prisma: database.prisma, allowWrites: false });
    await stack.budget.resume(
      config.xApiAccountId ?? null,
      flagString(flags, "actor") ?? "admin",
    );
    console.log(JSON.stringify({ resumed: true }, null, 2));
  });
}
