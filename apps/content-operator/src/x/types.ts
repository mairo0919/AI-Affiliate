import type { XPublicationStrategyType, XPublicationPostRole } from "@ai-affiliate/database";

export type { XPublicationStrategyType, XPublicationPostRole };

export const STRATEGY_VERSION = "x-strategy-v1";
export const METRICS_VERSION = "x-metrics-v1";

export interface GeneratedXPostSpec {
  sequence: number;
  role: XPublicationPostRole;
  body: string;
  replyToSequence?: number;
  relatedPublicationId?: string;
}

export interface GeneratedXPublication {
  strategyType: XPublicationStrategyType;
  strategyVersion: string;
  experimentGroup?: string;
  posts: GeneratedXPostSpec[];
}

export interface XAccountIdentity {
  accountId: string;
  username?: string;
  displayName?: string;
  confirmedAt?: Date;
}

export interface XCreatePostRequest {
  text: string;
  replyToPostId?: string;
  idempotencyKey: string;
}

export interface XCreatePostResult {
  postId: string;
  postUrl?: string;
  conversationId?: string;
  textHash?: string;
  requestedTextHash?: string;
  returnedTextHash?: string | null;
  providerRequestId?: string;
  formalPostUrl?: string;
  createdAt?: Date;
  verified?: boolean;
  accountId?: string;
  replyToPostId?: string;
}

export interface XPostMetricsResult {
  postId: string;
  impressionCount: number | null;
  likeCount: number | null;
  replyCount: number | null;
  repostCount: number | null;
  quoteCount: number | null;
  bookmarkCount: number | null;
  urlClickCount: number | null;
  profileClickCount: number | null;
  detailExpandCount: number | null;
  mediaViewCount: number | null;
  followerCountAtMeasurement: number | null;
  availability: Record<string, boolean>;
  rawMetricAvailability?: Record<string, unknown>;
}

export type XPublishErrorType =
  | "Timeout"
  | "Network"
  | "RateLimit"
  | "ServerError"
  | "AuthTransient"
  | "Validation"
  | "Permission"
  | "ContentRejected"
  | "AccountRestricted"
  | "Configuration"
  | "Unknown";

export class XPublishError extends Error {
  readonly errorType: XPublishErrorType;
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(
    message: string,
    errorType: XPublishErrorType,
    options?: { retryable?: boolean; httpStatus?: number },
  ) {
    super(message);
    this.name = "XPublishError";
    this.errorType = errorType;
    this.retryable = options?.retryable ?? isRetryableType(errorType);
    this.httpStatus = options?.httpStatus;
  }
}

export function isRetryableType(errorType: XPublishErrorType): boolean {
  return (
    errorType === "Timeout" ||
    errorType === "Network" ||
    errorType === "RateLimit" ||
    errorType === "ServerError" ||
    errorType === "AuthTransient"
  );
}

export function parseStrategyTypeFlag(
  value?: string,
): XPublicationStrategyType | "AUTO" | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "auto") return "AUTO";
  switch (normalized) {
    case "single-post":
      return "SINGLE_POST";
    case "root-with-reply":
      return "ROOT_WITH_REPLY";
    case "thread":
      return "THREAD";
    case "related-post-link":
      return "RELATED_POST_LINK";
    case "hub-post":
      return "HUB_POST";
    case "control":
      return "CONTROL";
    default:
      return undefined;
  }
}

export function strategyTypeToSlug(type: XPublicationStrategyType): string {
  return type.toLowerCase().replace(/_/g, "-");
}
