import { createHash, randomBytes } from "node:crypto";
import type { AppConfig } from "@ai-affiliate/config";
import type { XLiveRepository } from "@ai-affiliate/database";
import { TokenEncryptionService } from "./token-encryption.js";
import { XApiHttpClient } from "./x-api-http-client.js";
import { XPublishError } from "../types.js";

const DEFAULT_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
];

export interface OAuthStartResult {
  authorizationUrl: string;
  state: string;
  sessionId: string;
  expiresAt: Date;
  scopes: string[];
}

export interface OAuthCompleteResult {
  accountId: string;
  username?: string;
  scopes: string[];
  authorizedAt: Date;
}

export interface XOAuthServiceDeps {
  config: AppConfig;
  live: XLiveRepository;
  encryption: TokenEncryptionService;
  http: XApiHttpClient;
  now?: () => Date;
  notifications?: {
    emitXEvent?: (
      eventType:
        | "X_AUTHORIZATION_COMPLETED"
        | "X_AUTHORIZATION_FAILED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
}

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function hashState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function parseScopes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export class XOAuthService {
  private readonly now: () => Date;

  constructor(private readonly deps: XOAuthServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  requestedScopes(): string[] {
    const fromEnv = parseScopes(this.deps.config.xOAuthScopes);
    return fromEnv.length > 0 ? fromEnv : [...DEFAULT_SCOPES];
  }

  async startAuthorization(): Promise<OAuthStartResult> {
    const clientId = this.deps.config.xApiClientId;
    if (!clientId) {
      throw new XPublishError(
        "X_API_CLIENT_ID is required — set a non-empty value in repo root .env (missing or empty after load)",
        "Configuration",
        { retryable: false },
      );
    }
    const callbackUrl = this.deps.config.xOAuthCallbackUrl;
    const state = base64Url(randomBytes(32));
    const codeVerifier = base64Url(randomBytes(64));
    const codeChallenge = base64Url(
      createHash("sha256").update(codeVerifier, "utf8").digest(),
    );
    const scopes = this.requestedScopes();
    const expiresAt = new Date(
      this.now().getTime() + this.deps.config.xOAuthSessionTtlMinutes * 60_000,
    );

    const session = await this.deps.live.createOAuthSession({
      stateHash: hashState(state),
      encryptedCodeVerifier: this.deps.encryption.encrypt(codeVerifier),
      callbackUrl,
      requestedScopes: scopes,
      expiresAt,
    });

    const url = new URL(this.deps.config.xOAuthAuthorizeUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", callbackUrl);
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");

    return {
      authorizationUrl: url.toString(),
      state,
      sessionId: session.id,
      expiresAt,
      scopes,
    };
  }

  async completeAuthorization(input: {
    state: string;
    code: string;
  }): Promise<OAuthCompleteResult> {
    const stateHash = hashState(input.state);
    const session = await this.deps.live.findOAuthSessionByStateHash(stateHash);
    if (!session) {
      await this.deps.notifications?.emitXEvent?.("X_AUTHORIZATION_FAILED", {
        reason: "STATE_UNKNOWN",
      });
      throw new XPublishError("OAuth state invalid", "Validation", {
        retryable: false,
      });
    }
    if (session.status !== "PENDING") {
      await this.deps.notifications?.emitXEvent?.("X_AUTHORIZATION_FAILED", {
        reason: "STATE_REUSE",
      });
      throw new XPublishError("OAuth session already used", "Validation", {
        retryable: false,
      });
    }
    if (session.expiresAt.getTime() < this.now().getTime()) {
      await this.deps.live.failOAuthSession(session.id, "EXPIRED");
      await this.deps.notifications?.emitXEvent?.("X_AUTHORIZATION_FAILED", {
        reason: "STATE_EXPIRED",
      });
      throw new XPublishError("OAuth session expired", "Validation", {
        retryable: false,
      });
    }

    const expectedCallback = this.deps.config.xOAuthCallbackUrl;
    if (session.callbackUrl !== expectedCallback) {
      await this.deps.live.failOAuthSession(session.id, "FAILED");
      await this.deps.notifications?.emitXEvent?.("X_AUTHORIZATION_FAILED", {
        reason: "CALLBACK_MISMATCH",
      });
      throw new XPublishError("OAuth callback URL mismatch", "Validation", {
        retryable: false,
      });
    }

    const consumed = await this.deps.live.consumeOAuthSession(session.id);
    if (!consumed) {
      await this.deps.notifications?.emitXEvent?.("X_AUTHORIZATION_FAILED", {
        reason: "STATE_REUSE",
      });
      throw new XPublishError("OAuth session already used", "Validation", {
        retryable: false,
      });
    }

    const codeVerifier = this.deps.encryption.decrypt(session.encryptedCodeVerifier);
    const clientId = this.deps.config.xApiClientId;
    const clientSecret = this.deps.config.xApiClientSecret;
    if (!clientId) {
      throw new XPublishError("X_API_CLIENT_ID is required", "Configuration", {
        retryable: false,
      });
    }

    const form = new URLSearchParams();
    form.set("grant_type", "authorization_code");
    form.set("code", input.code);
    form.set("redirect_uri", expectedCallback);
    form.set("code_verifier", codeVerifier);
    form.set("client_id", clientId);

    const tokenResponse = await this.deps.http.request<{
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
      error?: string;
    }>({
      method: "POST",
      path: this.deps.config.xOAuthTokenUrl,
      endpointKey: "oauth.token",
      requestType: "OAUTH_TOKEN_EXCHANGE",
      form,
      basicAuth: clientSecret
        ? { username: clientId, password: clientSecret }
        : undefined,
      disableRetry: true,
      acceptErrorResponse: true,
    });

    const accessToken = tokenResponse.data?.access_token;
    const refreshToken = tokenResponse.data?.refresh_token;
    if (!tokenResponse.ok || !accessToken || !refreshToken) {
      await this.deps.notifications?.emitXEvent?.("X_AUTHORIZATION_FAILED", {
        reason: "TOKEN_EXCHANGE_FAILED",
      });
      throw new XPublishError("OAuth token exchange failed", "AuthTransient", {
        retryable: false,
        httpStatus: tokenResponse.statusCode,
      });
    }

    const scopes = tokenResponse.data?.scope
      ? parseScopes(tokenResponse.data.scope)
      : (session.requestedScopes as string[]);

    const me = await this.deps.http.request<{
      data?: { id?: string; username?: string; name?: string };
    }>({
      method: "GET",
      path: "/2/users/me",
      endpointKey: "users.me",
      requestType: "USERS_ME",
      accessToken,
      disableRetry: true,
    });

    const accountId = me.data?.data?.id;
    if (!accountId) {
      await this.deps.notifications?.emitXEvent?.("X_AUTHORIZATION_FAILED", {
        reason: "ACCOUNT_LOOKUP_FAILED",
      });
      throw new XPublishError("Failed to resolve authenticated account", "AuthTransient", {
        retryable: false,
      });
    }

    const configured = this.deps.config.xApiAccountId;
    if (configured && configured !== accountId) {
      await this.deps.notifications?.emitXEvent?.("X_AUTHORIZATION_FAILED", {
        reason: "ACCOUNT_MISMATCH",
        accountId,
      });
      throw new XPublishError("Authorized account does not match X_API_ACCOUNT_ID", "Permission", {
        retryable: false,
      });
    }

    const expiresIn = tokenResponse.data?.expires_in ?? 7200;
    const accessTokenExpiresAt = new Date(this.now().getTime() + expiresIn * 1000);
    const authorizedAt = this.now();

    await this.deps.live.upsertCredential({
      accountId,
      status: "ACTIVE",
      encryptedAccessToken: this.deps.encryption.encrypt(accessToken),
      encryptedRefreshToken: this.deps.encryption.encrypt(refreshToken),
      accessTokenExpiresAt,
      scopes,
      encryptionKeyVersion: this.deps.encryption.keyVersion,
      authorizedAt,
      lastRefreshedAt: authorizedAt,
      lastRefreshFailedAt: null,
      lastRefreshErrorCode: null,
      bumpTokenVersion: true,
    });

    await this.deps.notifications?.emitXEvent?.("X_AUTHORIZATION_COMPLETED", {
      accountId,
      username: me.data?.data?.username,
    });

    return {
      accountId,
      username: me.data?.data?.username,
      scopes,
      authorizedAt,
    };
  }

  async revoke(accountId: string): Promise<void> {
    const credential = await this.deps.live.findCredentialByAccountId(accountId);
    if (!credential?.encryptedAccessToken) {
      await this.deps.live.updateCredentialStatus(accountId, "REVOKED", {
        revokedAt: this.now(),
      });
      return;
    }
    const accessToken = this.deps.encryption.decrypt(credential.encryptedAccessToken);
    const clientId = this.deps.config.xApiClientId;
    if (clientId) {
      const form = new URLSearchParams();
      form.set("token", accessToken);
      form.set("token_type_hint", "access_token");
      form.set("client_id", clientId);
      try {
        await this.deps.http.request({
          method: "POST",
          path: this.deps.config.xOAuthRevokeUrl,
          endpointKey: "oauth.revoke",
          requestType: "OAUTH_REVOKE",
          form,
          accountId,
          disableRetry: true,
        });
      } catch {
        // still mark revoked locally
      }
    }
    await this.deps.live.upsertCredential({
      accountId,
      status: "REVOKED",
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      accessTokenExpiresAt: null,
      scopes: (credential.scopes as string[]) ?? [],
      encryptionKeyVersion: credential.encryptionKeyVersion,
      revokedAt: this.now(),
      bumpTokenVersion: true,
    });
  }
}

export function hashOAuthState(state: string): string {
  return hashState(state);
}
