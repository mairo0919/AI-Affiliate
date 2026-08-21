import type {
  XAccountIdentity,
  XCreatePostRequest,
  XCreatePostResult,
  XPostMetricsResult,
} from "../types.js";
import { XPublishError } from "../types.js";

export interface XPublishingProvider {
  readonly providerName: string;
  getAuthenticatedAccount(): Promise<XAccountIdentity>;
  createPost(request: XCreatePostRequest): Promise<XCreatePostResult>;
  getPostMetrics(postIds: string[]): Promise<XPostMetricsResult[]>;
  deletePost?(postId: string): Promise<void>;
}

export type MockXBehavior =
  | "ok"
  | "root_fail"
  | "reply_fail"
  | "timeout"
  | "rate_limit"
  | "validation"
  | "server_error";

export interface MockXPublishingProviderOptions {
  behavior?: MockXBehavior;
  accountId?: string;
  username?: string;
  /** Fail on Nth createPost call (1-based). */
  failOnAttempt?: number;
  metricsFixture?: Partial<XPostMetricsResult>;
}

export class MockXPublishingProvider implements XPublishingProvider {
  readonly providerName = "mock";
  private seq = 0;
  private createCalls = 0;
  private readonly posts = new Map<string, { text: string; replyTo?: string }>();
  private readonly idempotency = new Map<string, XCreatePostResult>();
  behavior: MockXBehavior;
  private readonly accountId: string;
  private readonly username?: string;
  private readonly failOnAttempt?: number;
  private readonly metricsFixture: Partial<XPostMetricsResult>;

  constructor(options: MockXPublishingProviderOptions = {}) {
    this.behavior = options.behavior ?? "ok";
    this.accountId = options.accountId ?? "mock-account-1";
    this.username = options.username;
    this.failOnAttempt = options.failOnAttempt;
    this.metricsFixture = options.metricsFixture ?? {};
  }

  async getAuthenticatedAccount(): Promise<XAccountIdentity> {
    return {
      accountId: this.accountId,
      ...(this.username ? { username: this.username } : {}),
    };
  }

  async createPost(request: XCreatePostRequest): Promise<XCreatePostResult> {
    const existing = this.idempotency.get(request.idempotencyKey);
    if (existing) {
      return existing;
    }

    this.createCalls += 1;
    if (this.failOnAttempt !== undefined && this.createCalls === this.failOnAttempt) {
      throw new XPublishError("forced mock failure", "ServerError", {
        retryable: true,
        httpStatus: 503,
      });
    }

    if (this.behavior === "timeout") {
      throw new XPublishError("mock timeout", "Timeout", { retryable: true });
    }
    if (this.behavior === "rate_limit") {
      throw new XPublishError("mock rate limit", "RateLimit", {
        retryable: true,
        httpStatus: 429,
      });
    }
    if (this.behavior === "validation") {
      throw new XPublishError("mock validation", "Validation", { retryable: false });
    }
    if (this.behavior === "server_error") {
      throw new XPublishError("mock server error", "ServerError", {
        retryable: true,
        httpStatus: 500,
      });
    }
    if (this.behavior === "root_fail" && !request.replyToPostId) {
      throw new XPublishError("mock root failure", "ServerError", {
        retryable: true,
        httpStatus: 503,
      });
    }
    if (this.behavior === "reply_fail" && request.replyToPostId) {
      throw new XPublishError("mock reply failure", "ServerError", {
        retryable: true,
        httpStatus: 503,
      });
    }

    this.seq += 1;
    const postId = `mock-post-${this.seq}`;
    this.posts.set(postId, { text: request.text, replyTo: request.replyToPostId });
    const result: XCreatePostResult = {
      postId,
      postUrl: this.username
        ? `https://x.com/${this.username}/status/${postId}`
        : undefined,
      conversationId: request.replyToPostId
        ? this.posts.get(request.replyToPostId)
          ? request.replyToPostId
          : postId
        : postId,
    };
    this.idempotency.set(request.idempotencyKey, result);
    return result;
  }

  async getPostMetrics(postIds: string[]): Promise<XPostMetricsResult[]> {
    return postIds.map((postId) => ({
      postId,
      impressionCount: this.metricsFixture.impressionCount ?? 1000,
      likeCount: this.metricsFixture.likeCount ?? 10,
      replyCount: this.metricsFixture.replyCount ?? 2,
      repostCount: this.metricsFixture.repostCount ?? 1,
      quoteCount: this.metricsFixture.quoteCount ?? 0,
      bookmarkCount: this.metricsFixture.bookmarkCount ?? 3,
      urlClickCount: this.metricsFixture.urlClickCount ?? 5,
      profileClickCount: this.metricsFixture.profileClickCount ?? 4,
      detailExpandCount: this.metricsFixture.detailExpandCount ?? null,
      mediaViewCount: this.metricsFixture.mediaViewCount ?? null,
      followerCountAtMeasurement: this.metricsFixture.followerCountAtMeasurement ?? null,
      availability: {
        impressionCount: true,
        likeCount: true,
        replyCount: true,
        repostCount: true,
        quoteCount: true,
        bookmarkCount: true,
        urlClickCount: this.metricsFixture.urlClickCount !== null,
        profileClickCount: true,
        detailExpandCount: false,
        mediaViewCount: false,
        ...(this.metricsFixture.availability ?? {}),
      },
    }));
  }

  async deletePost(postId: string): Promise<void> {
    this.posts.delete(postId);
  }

  getCreateCallCount(): number {
    return this.createCalls;
  }
}

export { XApiPublishingProvider } from "./x-api-publishing-provider.js";
export type { XApiPublishingProviderDeps } from "./x-api-publishing-provider.js";

export interface CreateXPublishingProviderOptions extends MockXPublishingProviderOptions {
  enabled?: boolean;
  accessToken?: string;
  accountId?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Fully wired live provider; required for real X API usage. */
  liveProvider?: XPublishingProvider;
}

/**
 * Factory: mock by default. For x-api, pass `liveProvider` from createLiveStack().
 * Without liveProvider, x-api resolves to a refusing stub (safe default).
 */
export function createXPublishingProvider(
  name: string,
  options?: CreateXPublishingProviderOptions,
): XPublishingProvider {
  const normalized = name.trim().toLowerCase();
  if (normalized === "x-api" || normalized === "api") {
    if (options?.liveProvider) {
      return options.liveProvider;
    }
    return new UnconfiguredXApiPublishingProvider({
      enabled: options?.enabled ?? false,
      accountId: options?.accountId,
    });
  }
  return new MockXPublishingProvider(options);
}

/** Safe stub when live stack is not wired. Never posts. */
class UnconfiguredXApiPublishingProvider implements XPublishingProvider {
  readonly providerName = "x-api";

  constructor(
    private readonly options: { enabled: boolean; accountId?: string },
  ) {}

  async getAuthenticatedAccount(): Promise<XAccountIdentity> {
    if (!this.options.enabled) {
      throw new XPublishError("X API is not enabled or configured", "Configuration", {
        retryable: false,
      });
    }
    return { accountId: this.options.accountId ?? "unknown" };
  }

  async createPost(): Promise<XCreatePostResult> {
    throw new XPublishError(
      "XApiPublishingProvider requires createLiveStack() wiring",
      "Configuration",
      { retryable: false },
    );
  }

  async getPostMetrics(): Promise<XPostMetricsResult[]> {
    throw new XPublishError(
      "XApiPublishingProvider requires createLiveStack() wiring",
      "Configuration",
      { retryable: false },
    );
  }
}
