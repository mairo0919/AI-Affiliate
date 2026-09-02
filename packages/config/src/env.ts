import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import type { LogLevel } from "@ai-affiliate/shared";

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
}

export interface AppConfig {
  nodeEnv: string;
  logLevel: LogLevel;
  databaseUrl: string;
  postgresDb: string;
  postgresUser: string;
  postgresPassword: string;
  postgresPort: string;
  dmmApiId: string | undefined;
  dmmAffiliateId: string | undefined;
  dmmApiBaseUrl: string;
  fanzaDefaultService: string;
  fanzaDefaultFloor: string;
  fanzaDefaultHits: number;
  fanzaRequestIntervalMs: number;
  fanzaRequestTimeoutMs: number;
  fanzaMaxRetries: number;
  researchScheduleFailureLimit: number;
  researchScheduleGraceMs: number;
  researchRetryEnabled: boolean;
  researchRetryMaxAttempts: number;
  researchRetryBaseDelaySeconds: number;
  researchRetryMaxDelaySeconds: number;
  researchNotificationEnabled: boolean;
  researchNotificationChannel: "console" | "webhook";
  researchNotificationWebhookUrl: string | undefined;
  researchNotificationTimeoutMs: number;
  researchNotificationMaxAttempts: number;
  analysisAutoRunEnabled: boolean;
  analysisAutoRunSource: string;
  analysisAutoRunLimit: number;
  analysisAutoRunMinIntervalMinutes: number;
  analysisScoreWeights: {
    popularity: number;
    trend: number;
    review: number;
    price: number;
    freshness: number;
    dataQuality: number;
  };
  analysisDiversityLimits: {
    maxPerActress: number;
    maxPerMaker: number;
    maxPerSeries: number;
  };
  contentGenerationProvider: string;
  contentGenerationModel: string;
  contentGenerationTimeoutMs: number;
  contentGenerationMaxAttempts: number;
  contentDefaultReviewer: string;
  contentXMaxLength: number;
  contentBlogMinLength: number;
  contentBlogMaxLength: number;
  contentVideoMinSeconds: number;
  contentVideoMaxSeconds: number;
  contentForbiddenTextSimilarityThreshold: number;
  contentDuplicateSimilarityThreshold: number;
  contentDuplicateSimilaritySeverity: "WARNING" | "BLOCKING";
  contentAutoGenerationEnabled: boolean;
  contentAutoGenerationLimit: number;
  contentAutoGenerationTypes: string[];
  contentAutoGenerationMinScore: number;
  contentAutoGenerationIncludeRequiresConfirmation: boolean;
  contentAutoGenerationMinIntervalMinutes: number;
  contentNotifyReviewRequired: boolean;
  contentNotifyApproved: boolean;
  contentNotifyRejected: boolean;
  xApiEnabled: boolean;
  xApiProvider: string;
  xApiClientId: string | undefined;
  xApiClientSecret: string | undefined;
  xApiAccessToken: string | undefined;
  xApiRefreshToken: string | undefined;
  xApiAccountId: string | undefined;
  xApiBaseUrl: string;
  xApiTimeoutMs: number;
  xApiMaxAttempts: number;
  xApiUserAgent: string;
  xMaxWeightedLength: number;
  xTargetWeightedLength: number;
  xReservedWeightedLength: number;
  xMaxHashtags: number;
  xMaxPostsPerPublication: number;
  xAutoMaxPostsPerPublication: number;
  xAffiliateDisclosure: string;
  xStrategySelectionMode: "round-robin" | "random" | "weighted" | "manual";
  xStrategyExplorationRate: number;
  xStrategyMinSampleSize: number;
  xStrategyEvaluationWindowHours: number;
  xStrategyAutoOptimizationEnabled: boolean;
  xStrategyEnabledTypes: string[];
  xStrategyAutoEnabledTypes: string[];
  xAutoPublicationEnabled: boolean;
  xMetricsCollectionEnabled: boolean;
  xMetricsCollectionWindowsMinutes: number[];
  xMetricsCollectionBatchSize: number;
  xStrategyEvaluationEnabled: boolean;
  xNotifyPublicationPublished: boolean;
  xNotifyStrategyEvaluationCompleted: boolean;
  xScoreWeights: {
    impressions: number;
    engagementRate: number;
    urlClickRate: number;
    profileClickRate: number;
  };
  xRelatedLookbackDays: number;
  xUrlWeightedLength: number;
  xOptimizationEnabled: boolean;
  xOptimizationMode: "OBSERVE_ONLY" | "RECOMMEND" | "ASSISTED" | "AUTO";
  xOptimizationMinIntervalMinutes: number;
  xOptimizationMinSampleSize: number;
  xOptimizationMinScoreImprovement: number;
  xOptimizationMaxMissingRate: number;
  xOptimizationLookbackDays: number;
  xOptimizationEvaluationWindowHours: number;
  xOptimizationExplorationRate: number;
  xOptimizationRecommendationTtlDays: number;
  xOptimizationMaxActiveRecommendations: number;
  xOptimizationMaxConcurrentExperimentsPerDimension: number;
  xOptimizationDeclineStopThreshold: number;
  xOptimizationDefaultReviewer: string;
  xOptimizationImpactEvaluationEnabled: boolean;
  xOptimizationScoreWeights: {
    urlClickRate: number;
    engagementRate: number;
    impressionCount: number;
    profileClickRate: number;
    bookmarkRate: number;
    repostRate: number;
  };
  xNotifyOptimizationRecommendationCreated: boolean;
  xNotifyOptimizationDeclined: boolean;
  xNotifyOptimizationValidationFailed: boolean;
  xDensity: {
    version: string;
    lowMaxWeightedLength: number;
    mediumMaxWeightedLength: number;
    lowMaxFactCount: number;
    mediumMaxFactCount: number;
    lowMaxEntityCount: number;
    mediumMaxEntityCount: number;
    lowMaxUrlCount: number;
    mediumMaxUrlCount: number;
    lowMaxHashtagCount: number;
    mediumMaxHashtagCount: number;
  };
  xProductCooldownHours: number;
  xProductReservationTtlMinutes: number;
  xAllowDuplicateProductExperiments: boolean;
  xDuplicateProductMinIntervalHours: number;
  xReleaseMode: "DISABLED" | "DRY_RUN" | "ALLOWLIST" | "LIMITED" | "FULL";
  xReleaseAllowedAccountIds: string[];
  xReleaseAllowedStrategies: string[];
  xReleaseAllowedCandidateTypes: string[];
  xReleaseDailyPostLimit: number;
  xReleaseHourlyPostLimit: number;
  xReleaseAllowedStartHourJst: number;
  xReleaseAllowedEndHourJst: number;
  xGlobalKillSwitch: boolean;
  xPostBodyDuplicateLookbackDays: number;
  xPostBodyNearDuplicateThreshold: number;
  xPostBodyNearDuplicateBlocking: boolean;
  xNotifyPublicationBlocked: boolean;
  xNotifyProductCooldownBlocked: boolean;
  xNotifyPublicationLimitReached: boolean;
  xNotifyKillSwitchEnabled: boolean;
  xNotifyDuplicateContentBlocked: boolean;
  xTokenEncryptionKey: string;
  xTokenEncryptionKeyVersion: string;
  xOAuthAuthorizeUrl: string;
  xOAuthTokenUrl: string;
  xOAuthRevokeUrl: string;
  xOAuthCallbackUrl: string;
  xOAuthScopes: string;
  xOAuthSessionTtlMinutes: number;
  xTokenRefreshBufferMinutes: number;
  xVerifyPublishedPostEnabled: boolean;
  xVerifyPublishedPostDelaySeconds: number;
  xDeletePostEnabled: boolean;
  xApiWriteCostPerRequest: number | null;
  xApiReadCostPerResource: number | null;
  xApiAnalyticsCostPerRequest: number | null;
  xApiCostCurrency: string;
  xApiDailySoftBudgetUsd: number;
  xApiDailyHardBudgetUsd: number;
  xApiMonthlySoftBudgetUsd: number;
  xApiMonthlyHardBudgetUsd: number;
  xApiUnknownCostBehavior: "BLOCK" | "WARN" | "ALLOW";
  xApiUsageSyncEnabled: boolean;
  xApiUsageSyncMinIntervalMinutes: number;
  xNotifyTokenRefreshFailed: boolean;
  xNotifyCredentialReauthRequired: boolean;
  xNotifyAccountMismatch: boolean;
  xNotifyHardBudgetReached: boolean;
  xNotifyPostPublishedUnverified: boolean;
  xNotifyLivePostPublished: boolean;
  /** Default preferred affiliate provider for CTA links (DMM/FANZA). */
  preferredAffiliateProvider: string;
  /** Comma-separated future ASP provider keys for link priority band 2. */
  linkFutureAspProviders: string[];
  /** Soft daily publication target (not a hard force). */
  publicationTargetPerDay: number;
  /** Soft maximum publications per day. */
  publicationMaximumPerDay: number;
  /** Minimum minutes between publications when queue runs. */
  publicationMinimumIntervalMinutes: number;
  publicationPauseWhenNoQualified: boolean;
  /** mock | api — production LLM requires explicit api + allow flag */
  llmMode: "mock" | "api";
  llmProvider: string;
  llmModelGeneration: string;
  llmModelReview: string;
  llmModelRevision: string;
  llmModelStrategy: string;
  llmApiKey: string | undefined;
  llmApiBaseUrl: string;
  llmTimeoutMs: number;
  llmMaxAttempts: number;
  llmAllowExternalRequests: boolean;
  llmTemperature: number;
  llmCurrency: string;
  llmDailyTokenBudget: number | null;
  /** Estimated JPY per 1K tokens when provider omits cost */
  llmEstimatedYenPer1kInputTokens: number;
  llmEstimatedYenPer1kOutputTokens: number;
  /** mock | api */
  bloggerMode: "mock" | "api";
  bloggerClientId: string | undefined;
  bloggerClientSecret: string | undefined;
  bloggerRefreshToken: string | undefined;
  bloggerBlogId: string | undefined;
  bloggerDefaultPublishMode: "draft" | "publish";
  bloggerAllowDirectPublish: boolean;
  bloggerAllowExternalRequests: boolean;
  /**
   * Editorial Brain production authority mode.
   * Default SHADOW — never auto-flip to ACTIVE without explicit ops change.
   */
  editorialBrainMode: "SHADOW" | "ACTIVE";
  bloggerApiBaseUrl: string;
  bloggerOAuthAuthorizeUrl: string;
  bloggerOAuthTokenUrl: string;
  bloggerOAuthRedirectUri: string;
  bloggerOAuthScopes: string;
  /** mock | api — WordPress REST (Application Password) */
  wordpressMode: "mock" | "api";
  wordpressBaseUrl: string | undefined;
  wordpressUsername: string | undefined;
  wordpressApplicationPassword: string | undefined;
  wordpressDefaultPublishMode: "draft" | "publish";
  wordpressAllowDirectPublish: boolean;
  wordpressAllowExternalRequests: boolean;
  wordpressApiNamespace: string;
  /** P7 Admin API / Console */
  adminApiPort: number;
  adminApiHost: string;
  adminSessionTtlHours: number;
  adminBootstrapEmail: string | undefined;
  /** Plain bootstrap password used only at seed/bootstrap — never persisted */
  adminBootstrapPassword: string | undefined;
  adminCorsOrigin: string;
  adminAllowDirectPublishUi: boolean;
  /** P8 production operation mode */
  productionOperationMode: "OBSERVE" | "ASSISTED" | "AUTOMATED";
  publicationActiveHoursStart: number;
  publicationActiveHoursEnd: number;
  publicationTimezone: string;
  publicationMinimumQualityScore: number;
  publicationMinimumClaimConfidence: number;
  adminRateLimitPerMinute: number;
  adminLoginMaxAttempts: number;
  adminLoginWindowMinutes: number;
  /** P9: allow server-side public URL research fetch */
  researchAllowExternalRequests: boolean;
  researchFetchTimeoutMs: number;
  researchFetchMaxBytes: number;
  /** Article Pattern Source Discovery search provider */
  articlePatternSearchProvider: "brave" | "mock" | "duckduckgo_html_deprecated";
  articlePatternSearchApiKey: string | undefined;
  articlePatternSearchTimeoutMs: number;
  /** Max Brave/Search API requests per Discovery run */
  articlePatternDiscoveryMaxSearchRequests: number;
  articlePatternDiscoveryMaxSearchRounds: number;
  articlePatternDiscoveryMaxQueries: number;
  articlePatternDiscoveryMaxObservedUrls: number;
  /** Approximate JPY per 1000 Brave web searches (for diagnostics only) */
  articlePatternDiscoveryYenPer1kSearches: number;
  /** Max review-site hub seeds to fetch per Discovery run (not Brave API) */
  articlePatternDiscoveryMaxSeeds: number;
  /** Max same-domain article links to consider per seed HTML */
  articlePatternDiscoveryMaxLinksPerSeed: number;
  /** Max individual-article observes from seed drill-down (depth 1) */
  articlePatternDiscoveryMaxDrilldownFetches: number;
  /** Max URLs per observation scope-refresh run */
  articlePatternRefreshMaxUrls: number;
}

export interface DmmCredentials {
  apiId: string;
  affiliateId: string;
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseUnitInterval(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

function parseSignedFloat(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function parseOptimizationMode(
  value: string | undefined,
): "OBSERVE_ONLY" | "RECOMMEND" | "ASSISTED" | "AUTO" {
  const normalized = value?.trim().toUpperCase().replace(/-/g, "_");
  if (
    normalized === "OBSERVE_ONLY" ||
    normalized === "RECOMMEND" ||
    normalized === "ASSISTED" ||
    normalized === "AUTO"
  ) {
    return normalized;
  }
  return "RECOMMEND";
}

function parseReleaseMode(
  value: string | undefined,
): "DISABLED" | "DRY_RUN" | "ALLOWLIST" | "LIMITED" | "FULL" {
  const normalized = value?.trim().toUpperCase().replace(/-/g, "_");
  if (
    normalized === "DISABLED" ||
    normalized === "DRY_RUN" ||
    normalized === "ALLOWLIST" ||
    normalized === "LIMITED" ||
    normalized === "FULL"
  ) {
    return normalized;
  }
  return "DISABLED";
}

function parseUnknownCostBehavior(value: string | undefined): "BLOCK" | "WARN" | "ALLOW" {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "BLOCK" || normalized === "WARN" || normalized === "ALLOW") {
    return normalized;
  }
  return "BLOCK";
}

function parseOptionalFloat(value: string | undefined): number | null {
  if (!value || value.trim() === "") {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveTokenEncryptionKey(nodeEnv: string): string {
  const key = process.env.X_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  if (!key) {
    if (nodeEnv === "production") {
      throw new Error("X_TOKEN_ENCRYPTION_KEY is required in production");
    }
    // Fixed 32-byte test key (base64) for non-production only.
    return "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  }
  const buf = Buffer.from(key, "base64");
  if (buf.length !== 32) {
    throw new Error("X_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

function parseHourJst(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) {
    return fallback;
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function assertValidDensityThresholds(density: AppConfig["xDensity"]): void {
  const pairs: Array<[string, number, number]> = [
    ["weightedLength", density.lowMaxWeightedLength, density.mediumMaxWeightedLength],
    ["factCount", density.lowMaxFactCount, density.mediumMaxFactCount],
    ["entityCount", density.lowMaxEntityCount, density.mediumMaxEntityCount],
    ["urlCount", density.lowMaxUrlCount, density.mediumMaxUrlCount],
    ["hashtagCount", density.lowMaxHashtagCount, density.mediumMaxHashtagCount],
  ];
  for (const [name, low, medium] of pairs) {
    if (low >= medium) {
      throw new Error(
        `Invalid X density thresholds for ${name}: LOW (${low}) must be < MEDIUM (${medium})`,
      );
    }
  }
}

function parseCsvListPreserveCase(value: string | undefined, fallback: string[]): string[] {
  if (!value || value.trim() === "") {
    return fallback;
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseCsvList(value: string | undefined, fallback: string[]): string[] {
  if (!value || value.trim() === "") {
    return fallback;
  }
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function parseIntList(value: string | undefined, fallback: number[]): number[] {
  if (!value || value.trim() === "") {
    return fallback;
  }
  const parsed = value
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parsed.length > 0 ? parsed : fallback;
}

function resolveEnvFilePath(): string | undefined {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(moduleDir, "../../../.env"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export function loadConfig(options?: { requireDatabaseUrl?: boolean }): AppConfig {
  const envPath = resolveEnvFilePath();
  if (envPath) {
    loadDotenv({ path: envPath });
  } else {
    loadDotenv();
  }

  const requireDatabaseUrl = options?.requireDatabaseUrl ?? true;
  const databaseUrl = process.env.DATABASE_URL;

  const config: AppConfig = {
    nodeEnv: process.env.NODE_ENV ?? "development",
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    databaseUrl: requireDatabaseUrl
      ? requireEnv("DATABASE_URL", databaseUrl)
      : (databaseUrl ?? ""),
    postgresDb: process.env.POSTGRES_DB ?? "ai_affiliate",
    postgresUser: process.env.POSTGRES_USER ?? "ai_affiliate",
    postgresPassword: process.env.POSTGRES_PASSWORD ?? "",
    postgresPort: process.env.POSTGRES_PORT ?? "5432",
    dmmApiId: process.env.DMM_API_ID || undefined,
    dmmAffiliateId: process.env.DMM_AFFILIATE_ID || undefined,
    dmmApiBaseUrl: process.env.DMM_API_BASE_URL ?? "https://api.dmm.com/affiliate/v3",
    fanzaDefaultService: process.env.FANZA_DEFAULT_SERVICE ?? "digital",
    fanzaDefaultFloor: process.env.FANZA_DEFAULT_FLOOR ?? "videoa",
    fanzaDefaultHits: Math.min(parsePositiveInt(process.env.FANZA_DEFAULT_HITS, 100), 100),
    fanzaRequestIntervalMs: parsePositiveInt(process.env.FANZA_REQUEST_INTERVAL_MS, 1000),
    fanzaRequestTimeoutMs: parsePositiveInt(process.env.FANZA_REQUEST_TIMEOUT_MS, 15_000),
    fanzaMaxRetries: parsePositiveInt(process.env.FANZA_MAX_RETRIES, 3),
    researchScheduleFailureLimit: parsePositiveInt(
      process.env.RESEARCH_SCHEDULE_FAILURE_LIMIT,
      5,
    ),
    researchScheduleGraceMs: parsePositiveInt(
      process.env.RESEARCH_SCHEDULE_GRACE_MS,
      15 * 60 * 1000,
    ),
    researchRetryEnabled: parseBooleanEnv(process.env.RESEARCH_RETRY_ENABLED, true),
    researchRetryMaxAttempts: parsePositiveInt(process.env.RESEARCH_RETRY_MAX_ATTEMPTS, 3),
    researchRetryBaseDelaySeconds: parsePositiveInt(
      process.env.RESEARCH_RETRY_BASE_DELAY_SECONDS,
      300,
    ),
    researchRetryMaxDelaySeconds: parsePositiveInt(
      process.env.RESEARCH_RETRY_MAX_DELAY_SECONDS,
      3600,
    ),
    researchNotificationEnabled: parseBooleanEnv(
      process.env.RESEARCH_NOTIFICATION_ENABLED,
      true,
    ),
    researchNotificationChannel:
      process.env.RESEARCH_NOTIFICATION_CHANNEL?.trim().toLowerCase() === "webhook"
        ? "webhook"
        : "console",
    researchNotificationWebhookUrl: process.env.RESEARCH_NOTIFICATION_WEBHOOK_URL || undefined,
    researchNotificationTimeoutMs: parsePositiveInt(
      process.env.RESEARCH_NOTIFICATION_TIMEOUT_MS,
      10_000,
    ),
    researchNotificationMaxAttempts: parsePositiveInt(
      process.env.RESEARCH_NOTIFICATION_MAX_ATTEMPTS,
      3,
    ),
    analysisAutoRunEnabled: parseBooleanEnv(process.env.ANALYSIS_AUTO_RUN_ENABLED, false),
    analysisAutoRunSource: process.env.ANALYSIS_AUTO_RUN_SOURCE?.trim() || "fanza",
    analysisAutoRunLimit: parsePositiveInt(process.env.ANALYSIS_AUTO_RUN_LIMIT, 1000),
    analysisAutoRunMinIntervalMinutes: parsePositiveInt(
      process.env.ANALYSIS_AUTO_RUN_MIN_INTERVAL_MINUTES,
      60,
    ),
    analysisScoreWeights: {
      popularity: parsePositiveInt(process.env.ANALYSIS_WEIGHT_POPULARITY, 25),
      trend: parsePositiveInt(process.env.ANALYSIS_WEIGHT_TREND, 25),
      review: parsePositiveInt(process.env.ANALYSIS_WEIGHT_REVIEW, 15),
      price: parsePositiveInt(process.env.ANALYSIS_WEIGHT_PRICE, 10),
      freshness: parsePositiveInt(process.env.ANALYSIS_WEIGHT_FRESHNESS, 15),
      dataQuality: parsePositiveInt(process.env.ANALYSIS_WEIGHT_DATA_QUALITY, 10),
    },
    analysisDiversityLimits: {
      maxPerActress: parsePositiveInt(process.env.ANALYSIS_DIVERSITY_MAX_ACTRESS, 3),
      maxPerMaker: parsePositiveInt(process.env.ANALYSIS_DIVERSITY_MAX_MAKER, 5),
      maxPerSeries: parsePositiveInt(process.env.ANALYSIS_DIVERSITY_MAX_SERIES, 3),
    },
    contentGenerationProvider: process.env.CONTENT_GENERATION_PROVIDER?.trim() || "mock",
    contentGenerationModel: process.env.CONTENT_GENERATION_MODEL?.trim() || "mock-v1",
    contentGenerationTimeoutMs: parsePositiveInt(
      process.env.CONTENT_GENERATION_TIMEOUT_MS,
      30_000,
    ),
    contentGenerationMaxAttempts: parsePositiveInt(
      process.env.CONTENT_GENERATION_MAX_ATTEMPTS,
      2,
    ),
    contentDefaultReviewer: process.env.CONTENT_DEFAULT_REVIEWER?.trim() || "admin",
    contentXMaxLength: parsePositiveInt(process.env.CONTENT_X_MAX_LENGTH, 140),
    contentBlogMinLength: parsePositiveInt(process.env.CONTENT_BLOG_MIN_LENGTH, 800),
    contentBlogMaxLength: parsePositiveInt(process.env.CONTENT_BLOG_MAX_LENGTH, 1500),
    contentVideoMinSeconds: parsePositiveInt(process.env.CONTENT_VIDEO_MIN_SECONDS, 15),
    contentVideoMaxSeconds: parsePositiveInt(process.env.CONTENT_VIDEO_MAX_SECONDS, 45),
    contentForbiddenTextSimilarityThreshold: parseUnitInterval(
      process.env.CONTENT_FORBIDDEN_TEXT_SIMILARITY_THRESHOLD,
      0.8,
    ),
    contentDuplicateSimilarityThreshold: parseUnitInterval(
      process.env.CONTENT_DUPLICATE_SIMILARITY_THRESHOLD,
      0.9,
    ),
    contentDuplicateSimilaritySeverity:
      process.env.CONTENT_DUPLICATE_SIMILARITY_SEVERITY?.trim().toUpperCase() === "BLOCKING"
        ? "BLOCKING"
        : "WARNING",
    contentAutoGenerationEnabled: parseBooleanEnv(
      process.env.CONTENT_AUTO_GENERATION_ENABLED,
      false,
    ),
    contentAutoGenerationLimit: parsePositiveInt(process.env.CONTENT_AUTO_GENERATION_LIMIT, 20),
    contentAutoGenerationTypes: parseCsvList(process.env.CONTENT_AUTO_GENERATION_TYPES, [
      "x-post",
    ]),
    contentAutoGenerationMinScore: parsePositiveInt(
      process.env.CONTENT_AUTO_GENERATION_MIN_SCORE,
      70,
    ),
    contentAutoGenerationIncludeRequiresConfirmation: parseBooleanEnv(
      process.env.CONTENT_AUTO_GENERATION_INCLUDE_REQUIRES_CONFIRMATION,
      false,
    ),
    contentAutoGenerationMinIntervalMinutes: parsePositiveInt(
      process.env.CONTENT_AUTO_GENERATION_MIN_INTERVAL_MINUTES,
      60,
    ),
    contentNotifyReviewRequired: parseBooleanEnv(
      process.env.CONTENT_NOTIFY_REVIEW_REQUIRED,
      false,
    ),
    contentNotifyApproved: parseBooleanEnv(process.env.CONTENT_NOTIFY_APPROVED, false),
    contentNotifyRejected: parseBooleanEnv(process.env.CONTENT_NOTIFY_REJECTED, false),
    xApiEnabled: parseBooleanEnv(process.env.X_API_ENABLED, false),
    xApiProvider: process.env.X_API_PROVIDER?.trim() || "mock",
    xApiClientId: process.env.X_API_CLIENT_ID || undefined,
    xApiClientSecret: process.env.X_API_CLIENT_SECRET || undefined,
    xApiAccessToken: process.env.X_API_ACCESS_TOKEN || undefined,
    xApiRefreshToken: process.env.X_API_REFRESH_TOKEN || undefined,
    xApiAccountId: process.env.X_API_ACCOUNT_ID || undefined,
    xApiBaseUrl: process.env.X_API_BASE_URL?.trim() || "https://api.x.com",
    xApiTimeoutMs: parsePositiveInt(process.env.X_API_TIMEOUT_MS, 30_000),
    xApiMaxAttempts: parsePositiveInt(process.env.X_API_MAX_ATTEMPTS, 3),
    xApiUserAgent:
      process.env.X_API_USER_AGENT?.trim() || "AI-Affiliate-Factory/1.0",
    xMaxWeightedLength: parsePositiveInt(process.env.X_MAX_WEIGHTED_LENGTH, 280),
    xTargetWeightedLength: parsePositiveInt(process.env.X_TARGET_WEIGHTED_LENGTH, 250),
    xReservedWeightedLength: parsePositiveInt(process.env.X_RESERVED_WEIGHTED_LENGTH, 20),
    xMaxHashtags: parsePositiveInt(process.env.X_MAX_HASHTAGS, 2),
    xMaxPostsPerPublication: parsePositiveInt(process.env.X_MAX_POSTS_PER_PUBLICATION, 3),
    xAutoMaxPostsPerPublication: parsePositiveInt(
      process.env.X_AUTO_MAX_POSTS_PER_PUBLICATION,
      2,
    ),
    xAffiliateDisclosure: process.env.X_AFFILIATE_DISCLOSURE?.trim() || "#PR",
    xStrategySelectionMode: (() => {
      const mode = process.env.X_STRATEGY_SELECTION_MODE?.trim().toLowerCase();
      if (mode === "random" || mode === "weighted" || mode === "manual") {
        return mode;
      }
      return "round-robin";
    })(),
    xStrategyExplorationRate: parseUnitInterval(
      process.env.X_STRATEGY_EXPLORATION_RATE,
      0.2,
    ),
    xStrategyMinSampleSize: parsePositiveInt(process.env.X_STRATEGY_MIN_SAMPLE_SIZE, 30),
    xStrategyEvaluationWindowHours: parsePositiveInt(
      process.env.X_STRATEGY_EVALUATION_WINDOW_HOURS,
      72,
    ),
    xStrategyAutoOptimizationEnabled: parseBooleanEnv(
      process.env.X_STRATEGY_AUTO_OPTIMIZATION_ENABLED,
      false,
    ),
    xStrategyEnabledTypes: parseCsvList(process.env.X_STRATEGY_ENABLED_TYPES, [
      "single-post",
      "root-with-reply",
      "related-post-link",
      "thread",
      "hub-post",
      "control",
    ]),
    xStrategyAutoEnabledTypes: parseCsvList(process.env.X_STRATEGY_AUTO_ENABLED_TYPES, [
      "single-post",
      "root-with-reply",
      "related-post-link",
      "control",
    ]),
    xAutoPublicationEnabled: parseBooleanEnv(process.env.X_AUTO_PUBLICATION_ENABLED, false),
    xMetricsCollectionEnabled: parseBooleanEnv(process.env.X_METRICS_COLLECTION_ENABLED, false),
    xMetricsCollectionWindowsMinutes: parseIntList(
      process.env.X_METRICS_COLLECTION_WINDOWS_MINUTES,
      [60, 360, 1440, 4320, 10080],
    ),
    xMetricsCollectionBatchSize: parsePositiveInt(
      process.env.X_METRICS_COLLECTION_BATCH_SIZE,
      100,
    ),
    xStrategyEvaluationEnabled: parseBooleanEnv(
      process.env.X_STRATEGY_EVALUATION_ENABLED,
      false,
    ),
    xNotifyPublicationPublished: parseBooleanEnv(
      process.env.X_NOTIFY_PUBLICATION_PUBLISHED,
      false,
    ),
    xNotifyStrategyEvaluationCompleted: parseBooleanEnv(
      process.env.X_NOTIFY_STRATEGY_EVALUATION_COMPLETED,
      false,
    ),
    xScoreWeights: {
      impressions: parsePositiveInt(process.env.X_SCORE_WEIGHT_IMPRESSIONS, 20),
      engagementRate: parsePositiveInt(process.env.X_SCORE_WEIGHT_ENGAGEMENT_RATE, 25),
      urlClickRate: parsePositiveInt(process.env.X_SCORE_WEIGHT_URL_CLICK_RATE, 40),
      profileClickRate: parsePositiveInt(process.env.X_SCORE_WEIGHT_PROFILE_CLICK_RATE, 15),
    },
    xRelatedLookbackDays: parsePositiveInt(process.env.X_RELATED_LOOKBACK_DAYS, 30),
    xUrlWeightedLength: parsePositiveInt(process.env.X_URL_WEIGHTED_LENGTH, 23),
    xOptimizationEnabled: parseBooleanEnv(process.env.X_OPTIMIZATION_ENABLED, false),
    xOptimizationMode: parseOptimizationMode(process.env.X_OPTIMIZATION_MODE),
    xOptimizationMinIntervalMinutes: parsePositiveInt(
      process.env.X_OPTIMIZATION_MIN_INTERVAL_MINUTES,
      1440,
    ),
    xOptimizationMinSampleSize: parsePositiveInt(
      process.env.X_OPTIMIZATION_MIN_SAMPLE_SIZE,
      30,
    ),
    xOptimizationMinScoreImprovement: parseUnitInterval(
      process.env.X_OPTIMIZATION_MIN_SCORE_IMPROVEMENT,
      0.05,
    ),
    xOptimizationMaxMissingRate: parseUnitInterval(
      process.env.X_OPTIMIZATION_MAX_MISSING_RATE,
      0.4,
    ),
    xOptimizationLookbackDays: parsePositiveInt(process.env.X_OPTIMIZATION_LOOKBACK_DAYS, 90),
    xOptimizationEvaluationWindowHours: parsePositiveInt(
      process.env.X_OPTIMIZATION_EVALUATION_WINDOW_HOURS,
      72,
    ),
    xOptimizationExplorationRate: Math.max(
      0.05,
      parseUnitInterval(process.env.X_OPTIMIZATION_EXPLORATION_RATE, 0.2),
    ),
    xOptimizationRecommendationTtlDays: parsePositiveInt(
      process.env.X_OPTIMIZATION_RECOMMENDATION_TTL_DAYS,
      30,
    ),
    xOptimizationMaxActiveRecommendations: parsePositiveInt(
      process.env.X_OPTIMIZATION_MAX_ACTIVE_RECOMMENDATIONS,
      10,
    ),
    xOptimizationMaxConcurrentExperimentsPerDimension: parsePositiveInt(
      process.env.X_OPTIMIZATION_MAX_CONCURRENT_EXPERIMENTS_PER_DIMENSION,
      1,
    ),
    xOptimizationDeclineStopThreshold: parseSignedFloat(
      process.env.X_OPTIMIZATION_DECLINE_STOP_THRESHOLD,
      -0.1,
    ),
    xOptimizationDefaultReviewer:
      process.env.X_OPTIMIZATION_DEFAULT_REVIEWER?.trim() || "admin",
    xOptimizationImpactEvaluationEnabled: parseBooleanEnv(
      process.env.X_OPTIMIZATION_IMPACT_EVALUATION_ENABLED,
      false,
    ),
    xOptimizationScoreWeights: {
      urlClickRate: parsePositiveInt(process.env.X_OPT_SCORE_WEIGHT_URL_CLICK, 40),
      engagementRate: parsePositiveInt(process.env.X_OPT_SCORE_WEIGHT_ENGAGEMENT, 25),
      impressionCount: parsePositiveInt(process.env.X_OPT_SCORE_WEIGHT_IMPRESSIONS, 15),
      profileClickRate: parsePositiveInt(process.env.X_OPT_SCORE_WEIGHT_PROFILE, 10),
      bookmarkRate: parsePositiveInt(process.env.X_OPT_SCORE_WEIGHT_BOOKMARK, 5),
      repostRate: parsePositiveInt(process.env.X_OPT_SCORE_WEIGHT_REPOST, 5),
    },
    xNotifyOptimizationRecommendationCreated: parseBooleanEnv(
      process.env.X_NOTIFY_OPTIMIZATION_RECOMMENDATION_CREATED,
      true,
    ),
    xNotifyOptimizationDeclined: parseBooleanEnv(
      process.env.X_NOTIFY_OPTIMIZATION_DECLINED,
      true,
    ),
    xNotifyOptimizationValidationFailed: parseBooleanEnv(
      process.env.X_NOTIFY_OPTIMIZATION_VALIDATION_FAILED,
      true,
    ),
    xDensity: {
      version: "x-density-v1",
      lowMaxWeightedLength: parsePositiveInt(
        process.env.X_DENSITY_LOW_MAX_WEIGHTED_LENGTH,
        120,
      ),
      mediumMaxWeightedLength: parsePositiveInt(
        process.env.X_DENSITY_MEDIUM_MAX_WEIGHTED_LENGTH,
        220,
      ),
      lowMaxFactCount: parseNonNegativeInt(process.env.X_DENSITY_LOW_MAX_FACT_COUNT, 1),
      mediumMaxFactCount: parseNonNegativeInt(process.env.X_DENSITY_MEDIUM_MAX_FACT_COUNT, 4),
      lowMaxEntityCount: parseNonNegativeInt(process.env.X_DENSITY_LOW_MAX_ENTITY_COUNT, 2),
      mediumMaxEntityCount: parseNonNegativeInt(
        process.env.X_DENSITY_MEDIUM_MAX_ENTITY_COUNT,
        5,
      ),
      lowMaxUrlCount: parseNonNegativeInt(process.env.X_DENSITY_LOW_MAX_URL_COUNT, 0),
      mediumMaxUrlCount: parseNonNegativeInt(process.env.X_DENSITY_MEDIUM_MAX_URL_COUNT, 1),
      lowMaxHashtagCount: parseNonNegativeInt(process.env.X_DENSITY_LOW_MAX_HASHTAG_COUNT, 1),
      mediumMaxHashtagCount: parseNonNegativeInt(
        process.env.X_DENSITY_MEDIUM_MAX_HASHTAG_COUNT,
        2,
      ),
    },
    xProductCooldownHours: parsePositiveInt(process.env.X_PRODUCT_COOLDOWN_HOURS, 168),
    xProductReservationTtlMinutes: parsePositiveInt(
      process.env.X_PRODUCT_RESERVATION_TTL_MINUTES,
      30,
    ),
    xAllowDuplicateProductExperiments: parseBooleanEnv(
      process.env.X_ALLOW_DUPLICATE_PRODUCT_EXPERIMENTS,
      false,
    ),
    xDuplicateProductMinIntervalHours: parsePositiveInt(
      process.env.X_DUPLICATE_PRODUCT_MIN_INTERVAL_HOURS,
      72,
    ),
    xReleaseMode: parseReleaseMode(process.env.X_RELEASE_MODE),
    xReleaseAllowedAccountIds: parseCsvListPreserveCase(
      process.env.X_RELEASE_ALLOWED_ACCOUNT_IDS,
      [],
    ),
    xReleaseAllowedStrategies: parseCsvListPreserveCase(
      process.env.X_RELEASE_ALLOWED_STRATEGIES,
      ["CONTROL", "SINGLE_POST"],
    ).map((s) => s.toUpperCase()),
    xReleaseAllowedCandidateTypes: parseCsvListPreserveCase(
      process.env.X_RELEASE_ALLOWED_CANDIDATE_TYPES,
      [],
    ).map((s) => s.toUpperCase()),
    xReleaseDailyPostLimit: parsePositiveInt(process.env.X_RELEASE_DAILY_POST_LIMIT, 3),
    xReleaseHourlyPostLimit: parsePositiveInt(process.env.X_RELEASE_HOURLY_POST_LIMIT, 1),
    xReleaseAllowedStartHourJst: parseHourJst(process.env.X_RELEASE_ALLOWED_START_HOUR_JST, 9),
    xReleaseAllowedEndHourJst: parseHourJst(process.env.X_RELEASE_ALLOWED_END_HOUR_JST, 23),
    xGlobalKillSwitch: parseBooleanEnv(process.env.X_GLOBAL_KILL_SWITCH, true),
    xPostBodyDuplicateLookbackDays: parsePositiveInt(
      process.env.X_POST_BODY_DUPLICATE_LOOKBACK_DAYS,
      30,
    ),
    xPostBodyNearDuplicateThreshold: parseUnitInterval(
      process.env.X_POST_BODY_NEAR_DUPLICATE_THRESHOLD,
      0.92,
    ),
    xPostBodyNearDuplicateBlocking: parseBooleanEnv(
      process.env.X_POST_BODY_NEAR_DUPLICATE_BLOCKING,
      true,
    ),
    xNotifyPublicationBlocked: parseBooleanEnv(
      process.env.X_NOTIFY_PUBLICATION_BLOCKED,
      true,
    ),
    xNotifyProductCooldownBlocked: parseBooleanEnv(
      process.env.X_NOTIFY_PRODUCT_COOLDOWN_BLOCKED,
      true,
    ),
    xNotifyPublicationLimitReached: parseBooleanEnv(
      process.env.X_NOTIFY_PUBLICATION_LIMIT_REACHED,
      false,
    ),
    xNotifyKillSwitchEnabled: parseBooleanEnv(
      process.env.X_NOTIFY_KILL_SWITCH_ENABLED,
      true,
    ),
    xNotifyDuplicateContentBlocked: parseBooleanEnv(
      process.env.X_NOTIFY_DUPLICATE_CONTENT_BLOCKED,
      true,
    ),
    xTokenEncryptionKey: resolveTokenEncryptionKey(
      process.env.NODE_ENV ?? "development",
    ),
    xTokenEncryptionKeyVersion: process.env.X_TOKEN_ENCRYPTION_KEY_VERSION?.trim() || "v1",
    xOAuthAuthorizeUrl:
      process.env.X_OAUTH_AUTHORIZE_URL?.trim() || "https://twitter.com/i/oauth2/authorize",
    xOAuthTokenUrl: process.env.X_OAUTH_TOKEN_URL?.trim() || "https://api.x.com/2/oauth2/token",
    xOAuthRevokeUrl: process.env.X_OAUTH_REVOKE_URL?.trim() || "https://api.x.com/2/oauth2/revoke",
    xOAuthCallbackUrl:
      process.env.X_OAUTH_CALLBACK_URL?.trim() || "http://127.0.0.1:8787/callback",
    xOAuthScopes:
      process.env.X_OAUTH_SCOPES?.trim() ||
      "tweet.read tweet.write users.read offline.access",
    xOAuthSessionTtlMinutes: parsePositiveInt(process.env.X_OAUTH_SESSION_TTL_MINUTES, 15),
    xTokenRefreshBufferMinutes: parsePositiveInt(process.env.X_TOKEN_REFRESH_BUFFER_MINUTES, 10),
    xVerifyPublishedPostEnabled: parseBooleanEnv(
      process.env.X_VERIFY_PUBLISHED_POST_ENABLED,
      true,
    ),
    xVerifyPublishedPostDelaySeconds: parsePositiveInt(
      process.env.X_VERIFY_PUBLISHED_POST_DELAY_SECONDS,
      5,
    ),
    xDeletePostEnabled: parseBooleanEnv(process.env.X_DELETE_POST_ENABLED, false),
    xApiWriteCostPerRequest: parseOptionalFloat(process.env.X_API_WRITE_COST_PER_REQUEST),
    xApiReadCostPerResource: parseOptionalFloat(process.env.X_API_READ_COST_PER_RESOURCE),
    xApiAnalyticsCostPerRequest: parseOptionalFloat(
      process.env.X_API_ANALYTICS_COST_PER_REQUEST,
    ),
    xApiCostCurrency: process.env.X_API_COST_CURRENCY?.trim() || "USD",
    xApiDailySoftBudgetUsd: parseSignedFloat(process.env.X_API_DAILY_SOFT_BUDGET_USD, 1),
    xApiDailyHardBudgetUsd: parseSignedFloat(process.env.X_API_DAILY_HARD_BUDGET_USD, 3),
    xApiMonthlySoftBudgetUsd: parseSignedFloat(process.env.X_API_MONTHLY_SOFT_BUDGET_USD, 10),
    xApiMonthlyHardBudgetUsd: parseSignedFloat(process.env.X_API_MONTHLY_HARD_BUDGET_USD, 30),
    xApiUnknownCostBehavior: parseUnknownCostBehavior(process.env.X_API_UNKNOWN_COST_BEHAVIOR),
    xApiUsageSyncEnabled: parseBooleanEnv(process.env.X_API_USAGE_SYNC_ENABLED, false),
    xApiUsageSyncMinIntervalMinutes: parsePositiveInt(
      process.env.X_API_USAGE_SYNC_MIN_INTERVAL_MINUTES,
      1440,
    ),
    xNotifyTokenRefreshFailed: parseBooleanEnv(
      process.env.X_NOTIFY_TOKEN_REFRESH_FAILED,
      true,
    ),
    xNotifyCredentialReauthRequired: parseBooleanEnv(
      process.env.X_NOTIFY_CREDENTIAL_REAUTH_REQUIRED,
      true,
    ),
    xNotifyAccountMismatch: parseBooleanEnv(process.env.X_NOTIFY_ACCOUNT_MISMATCH, true),
    xNotifyHardBudgetReached: parseBooleanEnv(process.env.X_NOTIFY_HARD_BUDGET_REACHED, true),
    xNotifyPostPublishedUnverified: parseBooleanEnv(
      process.env.X_NOTIFY_POST_PUBLISHED_UNVERIFIED,
      true,
    ),
    xNotifyLivePostPublished: parseBooleanEnv(process.env.X_NOTIFY_LIVE_POST_PUBLISHED, true),
    preferredAffiliateProvider: (
      process.env.PREFERRED_AFFILIATE_PROVIDER ?? "fanza"
    ).trim() || "fanza",
    linkFutureAspProviders: (process.env.LINK_FUTURE_ASP_PROVIDERS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    publicationTargetPerDay: parsePositiveInt(process.env.PUBLICATION_TARGET_PER_DAY, 2),
    publicationMaximumPerDay: parsePositiveInt(process.env.PUBLICATION_MAXIMUM_PER_DAY, 3),
    publicationMinimumIntervalMinutes: parsePositiveInt(
      process.env.PUBLICATION_MINIMUM_INTERVAL_MINUTES,
      180,
    ),
    publicationPauseWhenNoQualified: parseBooleanEnv(
      process.env.PUBLICATION_PAUSE_WHEN_NO_QUALIFIED,
      true,
    ),
    llmMode: (process.env.LLM_MODE ?? "mock").trim().toLowerCase() === "api" ? "api" : "mock",
    llmProvider: (process.env.LLM_PROVIDER ?? "openai-compatible").trim() || "openai-compatible",
    llmModelGeneration: process.env.LLM_MODEL_GENERATION ?? "gpt-4.1-mini",
    llmModelReview: process.env.LLM_MODEL_REVIEW ?? "gpt-4.1-mini",
    llmModelRevision: process.env.LLM_MODEL_REVISION ?? "gpt-4.1-mini",
    llmModelStrategy: process.env.LLM_MODEL_STRATEGY ?? process.env.LLM_MODEL_GENERATION ?? "gpt-4.1-mini",
    llmApiKey: process.env.LLM_API_KEY || undefined,
    llmApiBaseUrl: process.env.LLM_API_BASE_URL ?? "https://api.openai.com/v1",
    llmTimeoutMs: parsePositiveInt(process.env.LLM_TIMEOUT_MS, 60_000),
    llmMaxAttempts: parsePositiveInt(process.env.LLM_MAX_ATTEMPTS, 2),
    llmAllowExternalRequests: parseBooleanEnv(process.env.LLM_ALLOW_EXTERNAL_REQUESTS, false),
    llmTemperature: parseSignedFloat(process.env.LLM_TEMPERATURE, 0.4),
    llmCurrency: process.env.LLM_CURRENCY ?? "JPY",
    llmDailyTokenBudget: parseOptionalFloat(process.env.LLM_DAILY_TOKEN_BUDGET),
    llmEstimatedYenPer1kInputTokens: parseSignedFloat(
      process.env.LLM_ESTIMATED_YEN_PER_1K_INPUT_TOKENS,
      0.15,
    ),
    llmEstimatedYenPer1kOutputTokens: parseSignedFloat(
      process.env.LLM_ESTIMATED_YEN_PER_1K_OUTPUT_TOKENS,
      0.6,
    ),
    bloggerMode:
      (process.env.BLOGGER_MODE ?? "mock").trim().toLowerCase() === "api" ? "api" : "mock",
    bloggerClientId: process.env.BLOGGER_CLIENT_ID || undefined,
    bloggerClientSecret: process.env.BLOGGER_CLIENT_SECRET || undefined,
    bloggerRefreshToken: process.env.BLOGGER_REFRESH_TOKEN || undefined,
    bloggerBlogId: process.env.BLOGGER_BLOG_ID || undefined,
    bloggerDefaultPublishMode:
      (process.env.BLOGGER_DEFAULT_PUBLISH_MODE ?? "draft").trim().toLowerCase() === "publish"
        ? "publish"
        : "draft",
    bloggerAllowDirectPublish: parseBooleanEnv(process.env.BLOGGER_ALLOW_DIRECT_PUBLISH, false),
    bloggerAllowExternalRequests: parseBooleanEnv(
      process.env.BLOGGER_ALLOW_EXTERNAL_REQUESTS,
      false,
    ),
    editorialBrainMode: (() => {
      const v = (process.env.EDITORIAL_BRAIN_MODE ?? "SHADOW").trim().toUpperCase();
      if (v === "ACTIVE") return "ACTIVE" as const;
      return "SHADOW" as const;
    })(),
    bloggerApiBaseUrl: process.env.BLOGGER_API_BASE_URL ?? "https://www.googleapis.com/blogger/v3",
    bloggerOAuthAuthorizeUrl:
      process.env.BLOGGER_OAUTH_AUTHORIZE_URL ?? "https://accounts.google.com/o/oauth2/v2/auth",
    bloggerOAuthTokenUrl:
      process.env.BLOGGER_OAUTH_TOKEN_URL ?? "https://oauth2.googleapis.com/token",
    bloggerOAuthRedirectUri:
      process.env.BLOGGER_OAUTH_REDIRECT_URI ?? "http://localhost:8787/oauth/blogger/callback",
    bloggerOAuthScopes:
      process.env.BLOGGER_OAUTH_SCOPES ?? "https://www.googleapis.com/auth/blogger",
    wordpressMode:
      (process.env.WORDPRESS_MODE ?? "mock").trim().toLowerCase() === "api" ? "api" : "mock",
    wordpressBaseUrl: process.env.WORDPRESS_BASE_URL?.trim() || undefined,
    wordpressUsername: process.env.WORDPRESS_USERNAME?.trim() || undefined,
    wordpressApplicationPassword: process.env.WORDPRESS_APPLICATION_PASSWORD?.trim() || undefined,
    wordpressDefaultPublishMode:
      (process.env.WORDPRESS_DEFAULT_PUBLISH_MODE ?? "draft").trim().toLowerCase() === "publish"
        ? "publish"
        : "draft",
    wordpressAllowDirectPublish: parseBooleanEnv(
      process.env.WORDPRESS_ALLOW_DIRECT_PUBLISH,
      false,
    ),
    wordpressAllowExternalRequests: parseBooleanEnv(
      process.env.WORDPRESS_ALLOW_EXTERNAL_REQUESTS,
      false,
    ),
    wordpressApiNamespace:
      process.env.WORDPRESS_API_NAMESPACE?.trim() || "wp/v2",
    adminApiPort: parsePositiveInt(process.env.ADMIN_API_PORT, 8788),
    adminApiHost: process.env.ADMIN_API_HOST?.trim() || "127.0.0.1",
    adminSessionTtlHours: parsePositiveInt(process.env.ADMIN_SESSION_TTL_HOURS, 12),
    adminBootstrapEmail: process.env.ADMIN_BOOTSTRAP_EMAIL?.trim() || undefined,
    adminBootstrapPassword: process.env.ADMIN_BOOTSTRAP_PASSWORD || undefined,
    adminCorsOrigin: process.env.ADMIN_CORS_ORIGIN?.trim() || "http://localhost:3001",
    adminAllowDirectPublishUi: parseBooleanEnv(process.env.ADMIN_ALLOW_DIRECT_PUBLISH_UI, false),
    productionOperationMode: (() => {
      const v = (process.env.PRODUCTION_OPERATION_MODE ?? "ASSISTED").trim().toUpperCase();
      if (v === "OBSERVE" || v === "ASSISTED" || v === "AUTOMATED") return v;
      return "ASSISTED" as const;
    })(),
    publicationActiveHoursStart: parsePositiveInt(process.env.PUBLICATION_ACTIVE_HOURS_START, 9),
    publicationActiveHoursEnd: parsePositiveInt(process.env.PUBLICATION_ACTIVE_HOURS_END, 22),
    publicationTimezone: process.env.PUBLICATION_TIMEZONE?.trim() || "Asia/Tokyo",
    publicationMinimumQualityScore: parseSignedFloat(
      process.env.PUBLICATION_MINIMUM_QUALITY_SCORE,
      0.55,
    ),
    publicationMinimumClaimConfidence: parseSignedFloat(
      process.env.PUBLICATION_MINIMUM_CLAIM_CONFIDENCE,
      0.5,
    ),
    adminRateLimitPerMinute: parsePositiveInt(process.env.ADMIN_RATE_LIMIT_PER_MINUTE, 120),
    adminLoginMaxAttempts: parsePositiveInt(process.env.ADMIN_LOGIN_MAX_ATTEMPTS, 10),
    adminLoginWindowMinutes: parsePositiveInt(process.env.ADMIN_LOGIN_WINDOW_MINUTES, 15),
    researchAllowExternalRequests: parseBooleanEnv(
      process.env.RESEARCH_ALLOW_EXTERNAL_REQUESTS,
      false,
    ),
    researchFetchTimeoutMs: parsePositiveInt(process.env.RESEARCH_FETCH_TIMEOUT_MS, 15_000),
    researchFetchMaxBytes: parsePositiveInt(process.env.RESEARCH_FETCH_MAX_BYTES, 512_000),
    articlePatternSearchProvider: (() => {
      const v = (process.env.ARTICLE_PATTERN_SEARCH_PROVIDER ?? "brave").trim().toLowerCase();
      if (v === "mock" || v === "duckduckgo_html_deprecated" || v === "brave") return v;
      return "brave" as const;
    })(),
    articlePatternSearchApiKey: process.env.ARTICLE_PATTERN_SEARCH_API_KEY?.trim() || undefined,
    articlePatternSearchTimeoutMs: parsePositiveInt(
      process.env.ARTICLE_PATTERN_SEARCH_TIMEOUT_MS,
      15_000,
    ),
    articlePatternDiscoveryMaxSearchRequests: parsePositiveInt(
      process.env.ARTICLE_PATTERN_DISCOVERY_MAX_SEARCH_REQUESTS,
      12,
    ),
    articlePatternDiscoveryMaxSearchRounds: parsePositiveInt(
      process.env.ARTICLE_PATTERN_DISCOVERY_MAX_SEARCH_ROUNDS,
      4,
    ),
    articlePatternDiscoveryMaxQueries: parsePositiveInt(
      process.env.ARTICLE_PATTERN_DISCOVERY_MAX_QUERIES,
      12,
    ),
    articlePatternDiscoveryMaxObservedUrls: parsePositiveInt(
      process.env.ARTICLE_PATTERN_DISCOVERY_MAX_OBSERVED_URLS,
      30,
    ),
    articlePatternDiscoveryYenPer1kSearches: parsePositiveInt(
      process.env.ARTICLE_PATTERN_DISCOVERY_YEN_PER_1K_SEARCHES,
      750,
    ),
    articlePatternDiscoveryMaxSeeds: parsePositiveInt(
      process.env.ARTICLE_PATTERN_DISCOVERY_MAX_SEEDS,
      5,
    ),
    articlePatternDiscoveryMaxLinksPerSeed: parsePositiveInt(
      process.env.ARTICLE_PATTERN_DISCOVERY_MAX_LINKS_PER_SEED,
      10,
    ),
    articlePatternDiscoveryMaxDrilldownFetches: parsePositiveInt(
      process.env.ARTICLE_PATTERN_DISCOVERY_MAX_DRILLDOWN_FETCHES,
      15,
    ),
    articlePatternRefreshMaxUrls: Math.min(
      100,
      parsePositiveInt(process.env.ARTICLE_PATTERN_REFRESH_MAX_URLS, 20),
    ),
  };

  assertValidDensityThresholds(config.xDensity);
  return config;
}

/**
 * Validate DMM API affiliate ID format without echoing the secret.
 * API affiliate IDs must end with 990-999.
 */
export function assertValidDmmAffiliateId(affiliateId: string | undefined): void {
  if (affiliateId === undefined || affiliateId.trim() === "") {
    throw new Error("DMM affiliate ID is not configured (configuration incomplete)");
  }

  const trimmed = affiliateId.trim();
  const match = trimmed.match(/(\d{3})$/);
  if (!match) {
    throw new Error(
      "DMM affiliate ID format is invalid: must end with digits 990-999 (configuration incomplete)",
    );
  }

  const suffix = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(suffix) || suffix < 990 || suffix > 999) {
    throw new Error(
      "DMM affiliate ID suffix must be between 990 and 999 (configuration incomplete)",
    );
  }
}

export function requireDmmCredentials(config: AppConfig): DmmCredentials {
  if (!config.dmmApiId || config.dmmApiId.trim() === "") {
    throw new Error("DMM_API_ID is not configured (configuration incomplete)");
  }
  assertValidDmmAffiliateId(config.dmmAffiliateId);
  return {
    apiId: config.dmmApiId,
    affiliateId: config.dmmAffiliateId as string,
  };
}
