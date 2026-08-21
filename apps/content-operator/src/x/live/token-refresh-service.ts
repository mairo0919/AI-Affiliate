import type { AppConfig } from "@ai-affiliate/config";
import type { XLiveRepository } from "@ai-affiliate/database";
import { TokenEncryptionService } from "./token-encryption.js";
import { XApiHttpClient } from "./x-api-http-client.js";
import { XPublishError } from "../types.js";

export interface TokenRefreshServiceDeps {
  config: AppConfig;
  live: XLiveRepository;
  encryption: TokenEncryptionService;
  http: XApiHttpClient;
  now?: () => Date;
  notifications?: {
    emitXEvent?: (
      eventType: "X_TOKEN_REFRESH_FAILED" | "X_CREDENTIAL_REAUTH_REQUIRED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
}

export class TokenRefreshService {
  private readonly now: () => Date;
  private readonly locks = new Map<string, Promise<string>>();

  constructor(private readonly deps: TokenRefreshServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  needsRefresh(expiresAt: Date | null | undefined): boolean {
    if (!expiresAt) return true;
    const bufferMs = this.deps.config.xTokenRefreshBufferMinutes * 60_000;
    return expiresAt.getTime() <= this.now().getTime() + bufferMs;
  }

  async getValidAccessToken(accountId: string): Promise<string> {
    const credential = await this.deps.live.findCredentialByAccountId(accountId);
    if (!credential || !credential.encryptedAccessToken) {
      throw new XPublishError("No X API credential", "Configuration", {
        retryable: false,
      });
    }
    if (
      credential.status === "REVOKED" ||
      credential.status === "DISABLED" ||
      credential.status === "INVALID"
    ) {
      throw new XPublishError(
        `Credential status=${credential.status}`,
        "Permission",
        { retryable: false },
      );
    }
    if (
      !this.needsRefresh(credential.accessTokenExpiresAt) &&
      credential.status === "ACTIVE"
    ) {
      return this.deps.encryption.decrypt(credential.encryptedAccessToken);
    }
    return this.refresh(accountId);
  }

  async refresh(accountId: string): Promise<string> {
    const existing = this.locks.get(accountId);
    if (existing) {
      return existing;
    }
    const work = this.refreshLocked(accountId).finally(() => {
      this.locks.delete(accountId);
    });
    this.locks.set(accountId, work);
    return work;
  }

  private async refreshLocked(accountId: string): Promise<string> {
    const credential = await this.deps.live.findCredentialByAccountId(accountId);
    if (!credential?.encryptedRefreshToken) {
      await this.markInvalid(accountId, "MISSING_REFRESH_TOKEN");
      throw new XPublishError("Refresh token missing", "Permission", {
        retryable: false,
      });
    }

    const refreshToken = this.deps.encryption.decrypt(credential.encryptedRefreshToken);
    const clientId = this.deps.config.xApiClientId;
    if (!clientId) {
      throw new XPublishError("X_API_CLIENT_ID is required", "Configuration", {
        retryable: false,
      });
    }

    const form = new URLSearchParams();
    form.set("grant_type", "refresh_token");
    form.set("refresh_token", refreshToken);
    form.set("client_id", clientId);

    try {
      const response = await this.deps.http.request<{
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        error?: string;
      }>({
        method: "POST",
        path: this.deps.config.xOAuthTokenUrl,
        endpointKey: "oauth.token",
        requestType: "OAUTH_TOKEN_REFRESH",
        form,
        basicAuth: this.deps.config.xApiClientSecret
          ? {
              username: clientId,
              password: this.deps.config.xApiClientSecret,
            }
          : undefined,
        accountId,
        disableRetry: true,
        acceptErrorResponse: true,
      });

      const err = response.data?.error;
      if (err === "invalid_grant" || !response.ok || !response.data?.access_token) {
        await this.markInvalid(
          accountId,
          err === "invalid_grant" ? "INVALID_GRANT" : "REFRESH_FAILED",
        );
        throw new XPublishError("Token refresh rejected", "Permission", {
          retryable: false,
          httpStatus: response.statusCode,
        });
      }

      const newAccess = response.data.access_token;
      const newRefresh = response.data.refresh_token ?? refreshToken;
      const expiresIn = response.data.expires_in ?? 7200;
      const scopes = response.data.scope
        ? response.data.scope.split(/[\s,]+/).filter(Boolean)
        : ((credential.scopes as string[]) ?? []);

      await this.deps.live.upsertCredential({
        accountId,
        status: "ACTIVE",
        encryptedAccessToken: this.deps.encryption.encrypt(newAccess),
        encryptedRefreshToken: this.deps.encryption.encrypt(newRefresh),
        accessTokenExpiresAt: new Date(this.now().getTime() + expiresIn * 1000),
        scopes,
        encryptionKeyVersion: this.deps.encryption.keyVersion,
        lastRefreshedAt: this.now(),
        lastRefreshFailedAt: null,
        lastRefreshErrorCode: null,
        bumpTokenVersion: true,
      });

      return newAccess;
    } catch (error) {
      if (error instanceof XPublishError && error.errorType === "Permission") {
        throw error;
      }
      await this.deps.live.updateCredentialStatus(accountId, "REFRESH_REQUIRED", {
        lastRefreshFailedAt: this.now(),
        lastRefreshErrorCode: "REFRESH_ERROR",
      });
      await this.deps.notifications?.emitXEvent?.("X_TOKEN_REFRESH_FAILED", {
        accountId,
      });
      await this.deps.notifications?.emitXEvent?.("X_CREDENTIAL_REAUTH_REQUIRED", {
        accountId,
      });
      throw error instanceof XPublishError
        ? error
        : new XPublishError("Token refresh failed", "AuthTransient", {
            retryable: true,
          });
    }
  }

  private async markInvalid(accountId: string, code: string): Promise<void> {
    await this.deps.live.updateCredentialStatus(accountId, "INVALID", {
      lastRefreshFailedAt: this.now(),
      lastRefreshErrorCode: code,
    });
    await this.deps.notifications?.emitXEvent?.("X_TOKEN_REFRESH_FAILED", {
      accountId,
      error: code,
    });
    await this.deps.notifications?.emitXEvent?.("X_CREDENTIAL_REAUTH_REQUIRED", {
      accountId,
      error: code,
    });
  }
}
