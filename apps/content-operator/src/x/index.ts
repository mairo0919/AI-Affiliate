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
  stripXAdultSpans,
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
export {
  evaluateXBacklogEligibility,
  isWordPressPublicForXTraffic,
  isPublicationTargetPublicForX,
  X_BACKLOG_BLOCKING_CLASSES,
} from "./x-eligibility.js";
export type { XBacklogEligibility, XBacklogEligibilityInput, XAuditIssueClass } from "./x-eligibility.js";
export {
  adaptCanonicalToXSocial,
  chooseXLinkMode,
  chooseXThreadShape,
  extractXSocialHooks,
  adaptationPostsToGeneratedBodies,
} from "./x-social-adaptation.js";
export type {
  XLinkMode,
  XThreadShape,
  XAdaptedPost,
  XSocialAdaptationInput,
  XSocialAdaptationResult,
} from "./x-social-adaptation.js";
export {
  extractArticlePlanSocialFacts,
  groundedPlanFactTexts,
  composeXSocialPosts,
  toGroundedPlanAtom,
  chooseWpTrafficCta,
} from "./x-social-facts.js";
export type { XSocialFact, XSocialFactKind } from "./x-social-facts.js";
export {
  resolveXPublicationStrategy,
  composeXThreadPublication,
  extractThreadPostIds,
  resolveThreadReplyOrder,
  isStrongRelatedRelation,
  isPublishedXPostUrl,
  X_THREAD_NAV_TEMPLATES,
  X_THREAD_NAV_TEMPLATE_POOLS,
} from "./x-thread-publication.js";
export type {
  XPublicationStrategy,
  XThreadPostRole,
  XThreadComposedPost,
  XPublicationIntent,
  XRelatedNavCandidate,
  XThreadReplyOrder,
} from "./x-thread-publication.js";
export { planXSocial } from "./social-plan.js";
export type {
  SocialPlan,
  SocialPlanResult,
  SocialPlannerInput,
  XSocialPlan,
  XPlanResult,
  XPlannerInput,
  XSocialPublicationIntent,
} from "./social-plan.js";
export { writeXSocialCopy, synthesizeXSocialFromPlan, X_SOCIAL_WRITER_SYSTEM } from "./social-write.js";
export {
  reviewXSocialCopy,
  reviewXSocialPublicationUnit,
  rewriteXSocialCopyOnce,
} from "./social-review.js";
export type {
  SocialReviewFinding,
  SocialReviewResult,
  SocialReviewDimension,
  XPublicationUnitPost,
} from "./social-review.js";
export {
  runXSocialPipeline,
  assembleWpTrafficPost,
  X_COPY_PRODUCTION_PATH,
  classifySocialFailure,
} from "./social-pipeline.js";
export type {
  SocialPipelineInput,
  SocialPipelineResult,
  SocialPipelineOk,
  SocialPipelineSkip,
  SocialFailureClass,
} from "./social-pipeline.js";
export type { SocialThinSkip } from "./x-social-adaptation.js";
export {
  selectXMediaFromArticleImages,
  exposureProxyScoreForX,
  X_ARTICLE_MEDIA_POLICY_VERSION,
} from "./x-article-media.js";
export type { XArticleMediaPick, XArticleMediaCandidate } from "./x-article-media.js";
export {
  resolveWordPressCanonicalUrl,
  isWordPressQueryPermalink,
} from "./x-wordpress-url.js";
export {
  loadCanonicalXSource,
  adaptLoadedCanonicalToX,
} from "./canonical-x-source.js";
export type { CanonicalXSource } from "./canonical-x-source.js";
