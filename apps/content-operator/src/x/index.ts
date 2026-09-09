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
export { CONTENT_POLICY_SURFACE } from "./content-policy-surfaces.js";
export type { ContentPolicySurface } from "./content-policy-surfaces.js";
export {
  detectXAdultExpressions,
  filterClaimsForXSocialContent,
  enforceXSocialContentBody,
  buildXSocialSafeBodyFromEvidence,
  X_SOCIAL_CONTENT_POLICY_VERSION,
} from "./x-social-content-policy.js";
export {
  evaluateXSocialMedia,
  selectXSocialMediaImage,
  collectOfficialSampleCandidates,
  parseOfficialSampleIndex,
  assessXSocialVisualContent,
  X_SOCIAL_MEDIA_POLICY_VERSION,
} from "./x-social-media-gate.js";
export type {
  XSocialMediaDecision,
  XSocialMediaCandidate,
  XSocialMediaCandidateReport,
  XSocialMediaEvaluation,
  XSocialVisualHints,
  XSocialVisualStatus,
} from "./x-social-media-gate.js";
export {
  evaluateFanzaOfficialSampleMaterialRights,
  FANZA_X_SAMPLE_TRANSFORM_POLICY,
} from "./x-fanza-sample-rights.js";
export type {
  FanzaOfficialSampleMaterialRights,
  FanzaXMaterialRightsStatus,
} from "./x-fanza-sample-rights.js";
export { buildXDryRunPayload, isXLivePostBlocked } from "./x-dry-run.js";
export type { XDryRunPayload } from "./x-dry-run.js";
