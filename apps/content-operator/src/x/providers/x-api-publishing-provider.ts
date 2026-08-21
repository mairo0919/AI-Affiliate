import { createHash } from "node:crypto";
import type { AppConfig } from "@ai-affiliate/config";
import type { XApiBudgetService } from "../live/budget-service.js";
import type { TokenRefreshService } from "../live/token-refresh-service.js";
import type { XApiUsageService } from "../live/usage-service.js";
import type { XApiHttpClient } from "../live/x-api-http-client.js";
import type {
  XAccountIdentity,
  XCreatePostRequest,
  XCreatePostResult,
  XPostMetricsResult,
} from "../types.js";
import { XPublishError } from "../types.js";
import type { XPublishingProvider } from "./mock-provider.js";

const PRIVATE_METRICS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface XApiPublishingProviderDeps {
  config: AppConfig;
  http: XApiHttpClient;
  tokens: TokenRefreshService;
  usage: XApiUsageService;
  budget: XApiBudgetService;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** When false, createPost is a no-op throw (DISABLED/DRY_RUN handled upstream). */
  allowWrites?: boolean;
  notifications?: {
    emitXEvent?: (
      eventType:
        | "X_ACCOUNT_MISMATCH"
        | "X_API_RATE_LIMITED"
        | "X_POST_PUBLISHED_UNVERIFIED"
        | "X_LIVE_POST_PUBLISHED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
}

function textHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export class XApiPublishingProvider implements XPublishingProvider {
  readonly providerName = "x-api";
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private cachedAccount: XAccountIdentity | null = null;
  private refreshedOnceForRequest = false;

  constructor(private readonly deps: XApiPublishingProviderDeps) {
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private resolveAccountId(): string {
    const configured = this.deps.config.xApiAccountId;
    if (configured) return configured;
    if (this.cachedAccount?.accountId) return this.cachedAccount.accountId;
    throw new XPublishError("X_API_ACCOUNT_ID is required", "Configuration", {
      retryable: false,
    });
  }

  async getAuthenticatedAccount(): Promise<XAccountIdentity> {
    if (!this.deps.config.xApiEnabled) {
      throw new XPublishError("X API is not enabled", "Configuration", {
        retryable: false,
      });
    }
    const accountId = this.resolveAccountId();
    const accessToken = await this.deps.tokens.getValidAccessToken(accountId);
    const response = await this.withAuthRetry(accountId, (token) =>
      this.deps.http.request<{
        data?: { id?: string; username?: string; name?: string };
      }>({
        method: "GET",
        path: "/2/users/me",
        endpointKey: "users.me",
        requestType: "USERS_ME",
        accessToken: token,
        accountId,
        estimatedCost: this.deps.usage.estimateCost("read"),
        billingUnit: "read",
        disableRetry: true,
      }),
      accessToken,
    );

    const id = response.data?.data?.id;
    if (!id) {
      throw new XPublishError("users/me missing id", "ServerError", {
        retryable: true,
      });
    }
    const configured = this.deps.config.xApiAccountId;
    if (configured && configured !== id) {
      await this.deps.notifications?.emitXEvent?.("X_ACCOUNT_MISMATCH", {
        accountId: id,
      });
      throw new XPublishError("Authenticated account mismatch", "Permission", {
        retryable: false,
      });
    }

    const identity: XAccountIdentity = {
      accountId: id,
      username: response.data?.data?.username,
      displayName: response.data?.data?.name,
      confirmedAt: this.now(),
    };
    this.cachedAccount = identity;
    return identity;
  }

  async createPost(request: XCreatePostRequest): Promise<XCreatePostResult> {
    if (!this.deps.config.xApiEnabled) {
      throw new XPublishError("X API is not enabled", "Configuration", {
        retryable: false,
      });
    }
    if (this.deps.allowWrites === false) {
      throw new XPublishError("Live writes are disabled", "Configuration", {
        retryable: false,
      });
    }
    if (this.deps.config.xReleaseMode === "DISABLED") {
      throw new XPublishError("X_RELEASE_MODE=DISABLED", "Configuration", {
        retryable: false,
      });
    }
    if (this.deps.config.xReleaseMode === "DRY_RUN") {
      throw new XPublishError("DRY_RUN refuses createPost", "Configuration", {
        retryable: false,
      });
    }

    const account = this.cachedAccount ?? (await this.getAuthenticatedAccount());
    const writeCost = this.deps.usage.estimateCost("write");
    const budget = await this.deps.budget.checkPaidRequest(account.accountId, writeCost);
    if (!budget.allowed) {
      throw new XPublishError(budget.reason ?? "API_BUDGET_PAUSED", "Configuration", {
        retryable: false,
      });
    }

    const requestedHash = textHash(request.text);
    const body: Record<string, unknown> = { text: request.text };
    if (request.replyToPostId) {
      body.reply = { in_reply_to_tweet_id: request.replyToPostId };
    }

    const accessToken = await this.deps.tokens.getValidAccessToken(account.accountId);
    let response;
    try {
      response = await this.withAuthRetry(account.accountId, (token) =>
        this.deps.http.request<{
          data?: { id?: string; text?: string };
          errors?: unknown;
        }>({
          method: "POST",
          path: "/2/tweets",
          endpointKey: "tweets.create",
          requestType: "TWEETS_CREATE",
          body,
          accessToken: token,
          accountId: account.accountId,
          estimatedCost: writeCost,
          billingUnit: "write",
          disableRetry: true,
        }),
        accessToken,
      );
    } catch (error) {
      if (error instanceof XPublishError && error.errorType === "RateLimit") {
        await this.deps.notifications?.emitXEvent?.("X_API_RATE_LIMITED", {
          accountId: account.accountId,
        });
      }
      // Timeout after write: do not auto-repost; surface for state check
      throw error;
    }

    const xPostId = response.data?.data?.id;
    if (!xPostId) {
      throw new XPublishError("createPost missing id", "ServerError", {
        retryable: false,
        httpStatus: response.statusCode,
      });
    }

    const returnedText = response.data?.data?.text;
    const returnedHash = returnedText != null ? textHash(returnedText) : null;

    let verified = false;
    if (this.deps.config.xVerifyPublishedPostEnabled) {
      const delayMs = this.deps.config.xVerifyPublishedPostDelaySeconds * 1000;
      if (delayMs > 0) await this.sleep(delayMs);
      try {
        const verifyToken = await this.deps.tokens.getValidAccessToken(account.accountId);
        const verify = await this.deps.http.request<{
          data?: { id?: string; text?: string };
        }>({
          method: "GET",
          path: `/2/tweets/${xPostId}?tweet.fields=text`,
          endpointKey: "tweets.get",
          requestType: "TWEETS_VERIFY",
          accessToken: verifyToken,
          accountId: account.accountId,
          xPostId,
          estimatedCost: this.deps.usage.estimateCost("read"),
          billingUnit: "read",
          disableRetry: true,
        });
        if (verify.data?.data?.id === xPostId) {
          verified = true;
          if (verify.data.data.text != null && returnedHash == null) {
            // do not invent returned text earlier; verify can confirm existence only
          }
        }
      } catch {
        verified = false;
      }
    } else {
      verified = true;
    }

    const formalPostUrl =
      account.username && xPostId
        ? `https://x.com/${account.username}/status/${xPostId}`
        : undefined;

    const result: XCreatePostResult = {
      postId: xPostId,
      postUrl: formalPostUrl,
      conversationId: request.replyToPostId ?? xPostId,
      textHash: returnedHash ?? requestedHash,
      requestedTextHash: requestedHash,
      returnedTextHash: returnedHash,
      providerRequestId: response.requestId ?? undefined,
      formalPostUrl,
      createdAt: this.now(),
      verified,
      accountId: account.accountId,
      replyToPostId: request.replyToPostId,
    };

    if (!verified) {
      await this.deps.notifications?.emitXEvent?.("X_POST_PUBLISHED_UNVERIFIED", {
        accountId: account.accountId,
        xPostId,
      });
    } else {
      await this.deps.notifications?.emitXEvent?.("X_LIVE_POST_PUBLISHED", {
        accountId: account.accountId,
        xPostId,
      });
    }

    void request.idempotencyKey;
    return result;
  }

  async getPostMetrics(postIds: string[]): Promise<XPostMetricsResult[]> {
    if (!this.deps.config.xApiEnabled) {
      throw new XPublishError("X API is not enabled", "Configuration", {
        retryable: false,
      });
    }
    if (postIds.length === 0) return [];

    const accountId = this.resolveAccountId();
    const readCost = this.deps.usage.estimateCost("analytics", postIds.length);
    const budget = await this.deps.budget.checkPaidRequest(accountId, readCost);
    if (!budget.allowed) {
      throw new XPublishError(budget.reason ?? "API_BUDGET_PAUSED", "Configuration", {
        retryable: false,
      });
    }

    const fields = [
      "public_metrics",
      "non_public_metrics",
      "organic_metrics",
      "created_at",
    ].join(",");
    const ids = postIds.join(",");
    const accessToken = await this.deps.tokens.getValidAccessToken(accountId);
    const response = await this.withAuthRetry(accountId, (token) =>
      this.deps.http.request<{
        data?: Array<{
          id: string;
          created_at?: string;
          public_metrics?: Record<string, number>;
          non_public_metrics?: Record<string, number>;
          organic_metrics?: Record<string, number>;
        }>;
        errors?: Array<{ title?: string; detail?: string; type?: string }>;
      }>({
        method: "GET",
        path: `/2/tweets?ids=${encodeURIComponent(ids)}&tweet.fields=${fields}`,
        endpointKey: "tweets.metrics",
        requestType: "TWEETS_METRICS",
        accessToken: token,
        accountId,
        estimatedCost: readCost,
        billingUnit: "analytics",
        disableRetry: true,
      }),
      accessToken,
    );

    const rows = response.data?.data ?? [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const privateDenied =
      response.data?.errors?.some(
        (e) =>
          /non.?public|organic|authorized/i.test(`${e.title ?? ""} ${e.detail ?? ""}`),
      ) ?? false;

    return postIds.map((postId) => {
      const row = byId.get(postId);
      if (!row) {
        return emptyMetrics(postId, {
          missing: true,
          reason: "not_found",
        });
      }
      const createdAt = row.created_at ? new Date(row.created_at) : null;
      const ageMs = createdAt ? this.now().getTime() - createdAt.getTime() : 0;
      const privateEligible = createdAt != null && ageMs <= PRIVATE_METRICS_MAX_AGE_MS;
      const pub = row.public_metrics ?? {};
      const nonPub = privateEligible && !privateDenied ? row.non_public_metrics ?? {} : {};
      const organic = privateEligible && !privateDenied ? row.organic_metrics ?? {} : {};

      const impression =
        asNullableNumber(nonPub.impression_count) ??
        asNullableNumber(organic.impression_count) ??
        asNullableNumber(pub.impression_count);

      const availability: Record<string, boolean> = {
        impressionCount: impression != null,
        likeCount: pub.like_count != null,
        replyCount: pub.reply_count != null,
        repostCount: pub.retweet_count != null,
        quoteCount: pub.quote_count != null,
        bookmarkCount: pub.bookmark_count != null,
        urlClickCount: organic.url_link_clicks != null || nonPub.url_link_clicks != null,
        profileClickCount:
          organic.user_profile_clicks != null || nonPub.user_profile_clicks != null,
        detailExpandCount: false,
        mediaViewCount: false,
      };

      const rawMetricAvailability = {
        privateMetricsEligible: privateEligible,
        privateMetricsDenied: privateDenied,
        olderThan30Days: createdAt != null && ageMs > PRIVATE_METRICS_MAX_AGE_MS,
        publicOnly: !privateEligible || privateDenied,
      };

      return {
        postId,
        impressionCount: impression,
        likeCount: asNullableNumber(pub.like_count),
        replyCount: asNullableNumber(pub.reply_count),
        repostCount: asNullableNumber(pub.retweet_count),
        quoteCount: asNullableNumber(pub.quote_count),
        bookmarkCount: asNullableNumber(pub.bookmark_count),
        urlClickCount:
          asNullableNumber(organic.url_link_clicks) ??
          asNullableNumber(nonPub.url_link_clicks),
        profileClickCount:
          asNullableNumber(organic.user_profile_clicks) ??
          asNullableNumber(nonPub.user_profile_clicks),
        detailExpandCount: null,
        mediaViewCount: null,
        followerCountAtMeasurement: null,
        availability,
        rawMetricAvailability,
      };
    });
  }

  async deletePost(postId: string): Promise<void> {
    if (!this.deps.config.xDeletePostEnabled) {
      throw new XPublishError("X_DELETE_POST_ENABLED=false", "Configuration", {
        retryable: false,
      });
    }
    const accountId = this.resolveAccountId();
    const token = await this.deps.tokens.getValidAccessToken(accountId);
    await this.deps.http.request({
      method: "DELETE",
      path: `/2/tweets/${postId}`,
      endpointKey: "tweets.delete",
      requestType: "TWEETS_DELETE",
      accessToken: token,
      accountId,
      xPostId: postId,
      estimatedCost: this.deps.usage.estimateCost("write"),
      billingUnit: "write",
      disableRetry: true,
    });
  }

  private async withAuthRetry<T>(
    accountId: string,
    exec: (token: string) => Promise<T>,
    initialToken: string,
  ): Promise<T> {
    try {
      this.refreshedOnceForRequest = false;
      return await exec(initialToken);
    } catch (error) {
      if (
        error instanceof XPublishError &&
        error.httpStatus === 401 &&
        !this.refreshedOnceForRequest
      ) {
        this.refreshedOnceForRequest = true;
        const refreshed = await this.deps.tokens.refresh(accountId);
        return exec(refreshed);
      }
      throw error;
    }
  }
}

function emptyMetrics(
  postId: string,
  raw: Record<string, unknown>,
): XPostMetricsResult {
  return {
    postId,
    impressionCount: null,
    likeCount: null,
    replyCount: null,
    repostCount: null,
    quoteCount: null,
    bookmarkCount: null,
    urlClickCount: null,
    profileClickCount: null,
    detailExpandCount: null,
    mediaViewCount: null,
    followerCountAtMeasurement: null,
    availability: {},
    rawMetricAvailability: raw,
  };
}
