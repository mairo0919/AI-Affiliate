export type {
  BrainDecision,
  BrainRunMode,
  ChannelEditorialPlan,
  CoreEditorialPlan,
  EditorialBrainRunTrace,
  EditorialChannelId,
  EditorialFailure,
  EditorialReviewReport,
  ExperienceQuery,
  ExperienceRetrievalResult,
  ExperienceScope,
  ExperienceSourceType,
} from "./core/types.js";
export { EDITORIAL_FAILURE_CODES, FAILURE_CODE_META, isEditorialFailureCode } from "./core/failure-taxonomy.js";
export { buildClaimProfileFingerprint } from "./core/claim-profile.js";
export { buildCoreEditorialPlan } from "./core/planner.js";
export type { BuildCorePlanInput, PlannerClaimInput } from "./core/planner.js";
export {
  channelExtensionBoundaryContract,
  ensureChannelModulesRegistered,
  getChannelModule,
  getChannelCapabilities,
  listRegisteredChannels,
  registerChannelModule,
} from "./core/channel-module.js";
export type { ChannelBrainCapabilities, ChannelEditorialModule } from "./core/channel-module.js";
export {
  resolveEditorialBrainMode,
  isEditorialBrainActive,
  withEditorialBrainModeOverride,
  withEditorialBrainModeOverrideAsync,
} from "./core/mode.js";
export {
  resolveActiveTerminalState,
  buildLifecycleRecord,
  formatActiveFinalDecision,
  MAX_ACTIVE_REPAIR_ATTEMPTS,
  MAX_TARGETED_REPAIR_ATTEMPTS,
} from "./core/active-lifecycle.js";
export type { BrainLifecycleState, BrainLifecycleRecord } from "./core/active-lifecycle.js";
export {
  QUALITY_GATE_STAGE_CATALOG,
  authorityForGateStage,
  isSemanticEditorialStage,
  editorialAuthorityBoundary,
} from "./core/authority.js";
export type { QualityGateAuthorityClass, QualityGateStageCatalogEntry } from "./core/authority.js";
export {
  QUALITY_GATE_EXECUTION_INVENTORY,
  SEMANTIC_COVERAGE_PARITY,
  LEGACY_SEMANTIC_LLM_REVIEW_TYPES,
  BUSINESS_LLM_REVIEW_TYPES,
  buildGateExecutionPlan,
  shouldRunStage,
  inventoryByCategory,
} from "./core/gate-execution-plan.js";
export type {
  GateExecutionPlan,
  SemanticAuthority,
  QualityGateExecutionInventoryEntry,
} from "./core/gate-execution-plan.js";
export {
  classifyContentVersionCompatibility,
  preBrainCutoverPolicy,
} from "./core/compatibility.js";
export type {
  ContentVersionCompatibilityClass,
  CompatibilityCutoverAction,
  CompatibilityAssessment,
} from "./core/compatibility.js";
export {
  readBrainLifecycle,
  mergeBrainLifecycleIntoStructured,
  isBrainAcceptedForDownstream,
  brainAcceptedDoesNotAutoApprove,
  BRAIN_LIFECYCLE_KEY,
} from "./core/acceptance.js";
export { persistBrainLifecycleOnVersion } from "./core/persist-lifecycle.js";
export {
  applyBrainProductionAuthority,
  handleBrainInternalError,
  BRAIN_LIFECYCLE_CODES,
} from "./core/production-authority.js";
export type { BrainLifecycleCode } from "./core/production-authority.js";
export { retrieveExperiences, experienceMustNotMutateLearningRules, rankExperienceScore } from "./core/retrieval.js";
export { blogChannelModule, buildBlogChannelPlan, decideOmitCtaBridge } from "./channels/blog/adapter.js";
export type { BlogChannelPlanSpecifics } from "./channels/blog/adapter.js";
export { xChannelModule, buildXChannelPlan } from "./channels/x/adapter.js";
export type { XChannelPlanSpecifics } from "./channels/x/adapter.js";
export {
  classifyClaimProfiles,
  inferClaimKindFromStatement,
} from "./validation/claim-profile-tags.js";
export {
  buildBrainGenerationInputContract,
  buildRoleClaimAllowlist,
  toBrainGenerationPromptContract,
} from "./generation/generation-input-contract.js";
export type {
  BrainGenerationInputContract,
  RoleClaimAllowlist,
} from "./generation/generation-input-contract.js";
export { normalizeArticleProvenance, allProvenanceClaimIds, clampProvenanceToAllowlist } from "./generation/provenance.js";
export type { ArticleProvenance } from "./generation/provenance.js";
export { checkPlanCompliance } from "./generation/plan-compliance.js";
export type { PlanComplianceFinding, PlanComplianceResult } from "./generation/plan-compliance.js";
export { detectBadInputClaims, isTitleRichClaim, isCastListClaim, looksLikeJammedCastNames } from "./generation/bad-claim-input.js";
export {
  assessXEditorialMaterial,
  buildXGenerationPromptContract,
} from "./generation/x-generation-contract.js";
export type { XMaterialAssessment } from "./generation/x-generation-contract.js";
export {
  buildContributionPlan,
  contributionsFromClaim,
  toRoleContributionBoundaries,
  consumedFacetKeysOutsideTarget,
  facetKey,
  normalizeAtomicFacets,
} from "./generation/informational-contribution.js";
export type {
  InformationalContribution,
  ContributionPlan,
} from "./generation/informational-contribution.js";
export {
  detectSourceTitleRestatement,
  allocateXFacetContributions,
  contributionFacetPresent,
} from "./generation/contribution-compliance.js";
export {
  splitIntoSentences,
  extractTextFacets,
  extractNameTokens,
  isNamingClaimStatement,
} from "./generation/text-surface.js";
export {
  claimSupportsEvalSurface,
  hasPromotionalEvalSurface,
} from "./generation/claim-eval-support.js";
export { hasPadShellSignal, hasInterpretivePadShell } from "./generation/pad-shell-signal.js";
export {
  validateArticlePlanCompliance,
  applyArticlePlanComplianceMutations,
  articlePlanComplianceAllowsPersist,
} from "./generation/article-plan-compliance.js";
export {
  matchFactStrength,
  resolveFactRealization,
  evaluateFactRealization,
  isFactRealized,
} from "./generation/plan-fact-matching.js";
export type { FactRealizationStatus, FactRealizationResult } from "./generation/plan-fact-matching.js";
export type {
  ArticlePlanComplianceResult,
  ArticlePlanComplianceFinding,
  ArticlePlanComplianceMutationResult,
} from "./generation/article-plan-compliance.js";
