export { XCharacterCounter } from "./character-counter.js";
export { XPublicationBuilder, XPublicationValidationError } from "./publication-builder.js";
export { XStrategySelector } from "./strategy-selector.js";
export { XRelatedPostSelector } from "./related-selector.js";
export { XPublicationService } from "./publication-service.js";
export { XMetricsCollector, computeEngagementRate, computeRate } from "./metrics-collector.js";
export { XStrategyEvaluator } from "./strategy-evaluator.js";
export {
  MockXPublishingProvider,
  XApiPublishingProvider,
  createXPublishingProvider,
} from "./providers/index.js";
export type { XPublishingProvider } from "./providers/index.js";
export {
  parseStrategyTypeFlag,
  strategyTypeToSlug,
  XPublishError,
  STRATEGY_VERSION,
  METRICS_VERSION,
} from "./types.js";
export type {
  GeneratedXPublication,
  GeneratedXPostSpec,
  XCreatePostRequest,
  XCreatePostResult,
  XPostMetricsResult,
  XAccountIdentity,
} from "./types.js";
export {
  XContentFeatureExtractor,
  XOptimizationEngine,
  XContentOptimizer,
  XOptimizationImpactEvaluator,
  XOptimizationRecommendationService,
  XOptimizationValidator,
  computeOptimizationScore,
  ratesFromSnapshot,
  tokyoParts,
  postingTimeBucket,
  classifyDensity,
} from "./optimization/index.js";
export type {
  XContentFeatures,
  OptimizationRunResult,
  OptimizeApplyResult,
  ImpactEvaluationResult,
} from "./optimization/index.js";
export {
  buildProductKey,
  extractProviderProductId,
  XPrePublishGuard,
  XRuntimeControlService,
  XAssistedPublicationService,
} from "./ops/index.js";
export {
  createLiveStack,
  TokenEncryptionService,
  XOAuthService,
  TokenRefreshService,
  XApiUsageService,
  XApiBudgetService,
  XApiHttpClient,
  assertLivePublishArgs,
} from "./live/index.js";
