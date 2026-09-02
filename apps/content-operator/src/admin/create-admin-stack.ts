import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { loadConfig, type AppConfig } from "@ai-affiliate/config";
import {
  AdminRepository,
  JobRepository,
  LifecycleRepository,
  P5Repository,
  P6Repository,
  createDatabaseClient,
  type DatabaseClient,
} from "@ai-affiliate/database";
import { MockAffiliateProvider } from "../adapters/affiliate/mock-affiliate-provider.js";
import { createLLMProvider } from "../adapters/llm/create-llm-provider.js";
import { createBloggerPublisherFromConfig } from "../adapters/publisher/blogger-api-publisher.js";
import { createWordPressPublisherFromConfig } from "../adapters/publisher/wordpress-api-publisher.js";
import { MockPublisher } from "../adapters/publisher/mock-publisher.js";
import { NoopNotificationAdapter, type LLMProvider, type PublisherAdapter } from "../adapters/types.js";
import { ContentLifecycleService } from "../lifecycle/lifecycle-service.js";
import { P5LearningService } from "../learning/p5-service.js";
import { OpsService } from "../ops/ops-service.js";
import { AffiliateResultImportService } from "../ops-p6/affiliate-result-import.js";
import { AnalyticsImportService } from "../ops-p6/analytics-import-service.js";
import {
  CsvAnalyticsImportAdapter,
  JsonAnalyticsImportAdapter,
  hashFileContent,
} from "../ops-p6/analytics-import-adapter.js";
import { LearningGovernanceService } from "../ops-p6/learning-governance.js";
import { OrchestrationService } from "../ops-p6/orchestration-service.js";
import { StrategyWithFeedbackService } from "../ops-p6/strategy-with-feedback.js";
import { LinkReplacementService } from "../publication/link-replacement-service.js";
import { ContentComparisonService } from "../generation/content-comparison.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { P45ContentService } from "../generation/p45-service.js";
import { QualityGateService } from "../generation/quality-gate.js";
import { ContentReviewService } from "./content-review-service.js";

export interface AdminStack {
  config: AppConfig;
  database: DatabaseClient;
  adminRepo: AdminRepository;
  lifecycleRepo: LifecycleRepository;
  p5: P5Repository;
  p6: P6Repository;
  jobs: JobRepository;
  lifecycle: ContentLifecycleService;
  ops: OpsService;
  learning: P5LearningService;
  analytics: AnalyticsImportService;
  governance: LearningGovernanceService;
  orchestration: OrchestrationService;
  strategyFeedback: StrategyWithFeedbackService;
  affiliateResults: AffiliateResultImportService;
  linkReplacement: LinkReplacementService;
  contentReview: ContentReviewService;
  p45: P45ContentService;
  qualityGate: QualityGateService;
  contentComparison: ContentComparisonService;
  generation: ContentGenerationService;
  llm: LLMProvider;
  publishers: { BLOGGER: PublisherAdapter; X: PublisherAdapter; WORDPRESS: PublisherAdapter };
  usingMockLlm: boolean;
  usingMockBlogger: boolean;
  usingMockWordPress: boolean;
  disconnect: () => Promise<void>;
}

/**
 * Shared Application Service wiring for Admin API and CLI.
 * Uses Mock adapters unless LLM/Blogger api mode + allow-external + credentials are set.
 * Tests without secrets stay on Mock automatically.
 */
export async function createAdminStack(options?: {
  config?: AppConfig;
  forceMockAdapters?: boolean;
}): Promise<AdminStack> {
  const config = options?.config ?? loadConfig({ requireDatabaseUrl: false });
  const database = createDatabaseClient();
  await database.connect();

  const lifecycleRepo = new LifecycleRepository(database.prisma);
  const p5 = new P5Repository(database.prisma);
  const p6 = new P6Repository(database.prisma);
  const adminRepo = new AdminRepository(database.prisma);
  const jobs = new JobRepository(database.prisma);

  const forceMock =
    options?.forceMockAdapters === true ||
    process.env.NODE_ENV === "test" ||
    process.env.ADMIN_FORCE_MOCK_ADAPTERS === "true";

  const usingMockLlm =
    forceMock ||
    config.llmMode !== "api" ||
    !config.llmAllowExternalRequests ||
    !config.llmApiKey;
  const usingMockBlogger =
    forceMock || config.bloggerMode !== "api" || !config.bloggerAllowExternalRequests;
  const usingMockWordPress =
    forceMock || config.wordpressMode !== "api" || !config.wordpressAllowExternalRequests;

  const llm = usingMockLlm ? createLLMProvider({ ...config, llmMode: "mock" }) : createLLMProvider(config);
  const publishers: {
    BLOGGER: PublisherAdapter;
    X: PublisherAdapter;
    WORDPRESS: PublisherAdapter;
  } = {
    BLOGGER: usingMockBlogger
      ? new MockPublisher("BLOGGER")
      : createBloggerPublisherFromConfig(config),
    X: new MockPublisher("X"),
    WORDPRESS: usingMockWordPress
      ? new MockPublisher("WORDPRESS")
      : createWordPressPublisherFromConfig(config),
  };

  const lifecycle = new ContentLifecycleService({
    repo: lifecycleRepo,
    affiliate: new MockAffiliateProvider(),
    llm,
    publishers,
    notifications: new NoopNotificationAdapter(),
    linkPolicy: {
      preferredAffiliateProvider: config.preferredAffiliateProvider,
      futureAspProviders: config.linkFutureAspProviders,
    },
  });
  const ops = new OpsService({
    repo: lifecycleRepo,
    lifecycle,
    publishers,
    queueConfig: {
      targetPerDay: config.publicationTargetPerDay,
      maximumPerDay: config.publicationMaximumPerDay,
      minimumIntervalMinutes: config.publicationMinimumIntervalMinutes,
      pauseWhenNoQualifiedContent: config.publicationPauseWhenNoQualified,
    },
    linkPolicy: {
      preferredAffiliateProvider: config.preferredAffiliateProvider,
      futureAspProviders: config.linkFutureAspProviders,
    },
  });
  const learning = new P5LearningService(lifecycleRepo, p5, llm);
  const analytics = new AnalyticsImportService(lifecycleRepo, p6);
  const governance = new LearningGovernanceService(p5, p6);
  const strategyFeedback = new StrategyWithFeedbackService(lifecycleRepo, p5, p6, llm);
  const orchestration = new OrchestrationService(lifecycleRepo, p5, p6, lifecycle, ops, llm);
  const affiliateResults = new AffiliateResultImportService(p6);
  const linkReplacement = new LinkReplacementService(lifecycleRepo);
  const contentReview = new ContentReviewService(lifecycleRepo, p6);
  const p45 = new P45ContentService(lifecycleRepo, config, lifecycle, {
    llm,
    blogger: publishers.BLOGGER,
    // Live checklist gate applies only to real Blogger API drafts.
    // Mock verticals / forceMock must not be blocked by .env api-mode readiness.
    assertDraftAllowed: usingMockBlogger
      ? undefined
      : async () => {
          const { buildProductionChecklist, checklistBlockingReasons } = await import(
            "../ops/production-checklist.js"
          );
          const checklist = await buildProductionChecklist({
            config,
            adminRepo,
            lifecycleRepo,
            p6,
            dbConnected: true,
          });
          return checklistBlockingReasons(checklist.items);
        },
  });
  const generation = new ContentGenerationService(lifecycleRepo, llm, {
    generation: config.llmModelGeneration,
    review: config.llmModelReview,
    revision: config.llmModelRevision,
  });
  const qualityGate = new QualityGateService(lifecycleRepo, generation);
  const contentComparison = new ContentComparisonService(lifecycleRepo, llm);

  return {
    config,
    database,
    adminRepo,
    lifecycleRepo,
    p5,
    p6,
    jobs,
    lifecycle,
    ops,
    learning,
    analytics,
    governance,
    orchestration,
    strategyFeedback,
    affiliateResults,
    linkReplacement,
    contentReview,
    p45,
    qualityGate,
    contentComparison,
    generation,
    llm,
    publishers,
    usingMockLlm,
    usingMockBlogger,
    usingMockWordPress,
    disconnect: () => database.disconnect(),
  };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time compare for hashed tokens */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function previewAnalyticsImport(input: {
  format: "csv" | "json";
  content: string;
  platform?: string;
}): {
  format: string;
  platform: string | null;
  rowCount: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  sampleIssues: string[];
  fileHash: string;
} {
  const adapter =
    input.format === "csv"
      ? new CsvAnalyticsImportAdapter(input.platform)
      : new JsonAnalyticsImportAdapter(input.platform);
  const parsed = adapter.parse(input.content);
  const seen = new Set<string>();
  let valid = 0;
  let invalid = 0;
  let duplicate = 0;
  const sampleIssues: string[] = [];
  for (const row of parsed) {
    if (seen.has(row.rowHash)) {
      duplicate += 1;
      continue;
    }
    seen.add(row.rowHash);
    if (row.validationIssues.length > 0) {
      invalid += 1;
      if (sampleIssues.length < 10) {
        sampleIssues.push(`row ${row.rowIndex}: ${row.validationIssues.join(",")}`);
      }
    } else {
      valid += 1;
    }
  }
  return {
    format: input.format,
    platform: input.platform ?? null,
    rowCount: parsed.length,
    validRows: valid,
    invalidRows: invalid,
    duplicateRows: duplicate,
    sampleIssues,
    fileHash: hashFileContent(input.content),
  };
}

export { hashFileContent };
