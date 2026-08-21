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
export { auditActiveCutover } from "./cutover/audit-active-cutover.js";
export type { CutoverAuditReport } from "./cutover/audit-active-cutover.js";
export { stampExistingContentVersion } from "./cutover/stamp-existing.js";
export type { StampExistingResult } from "./cutover/stamp-existing.js";
export { evaluateExistingContentVersion } from "./cutover/evaluate-existing.js";
export type {
  EvaluateExistingResult,
  CutoverBucket,
  ProductionRelevance,
} from "./cutover/evaluate-existing.js";
export { planActiveCutover } from "./cutover/plan-active-cutover.js";
export type { ActiveCutoverPlan, CutoverPlanItem } from "./cutover/plan-active-cutover.js";
export { executeActiveCutover } from "./cutover/execute-active-cutover.js";
export type {
  ActiveCutoverExecuteReport,
  CutoverExecuteResultRow,
} from "./cutover/execute-active-cutover.js";
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
export { reviewArtifactShadow } from "./shadow/reviewer.js";
export type { ReviewableArtifact, ReviewableBlogArtifact, ReviewableXArtifact } from "./shadow/reviewer.js";
export { DeterministicSemanticReviewer, defaultSemanticReviewer } from "./shadow/semantic-reviewer.js";
export type {
  AssertionSupportType,
  SemanticAssertion,
  SemanticReviewResult,
  SemanticReviewStats,
  SemanticReviewerPort,
} from "./shadow/semantic-types.js";
export {
  EditorialBrainShadowService,
  ensureChannelModulesRegistered,
} from "./shadow/observe.js";
export type { ShadowObserveInput, ShadowObserveResult } from "./shadow/observe.js";
export { inspectEditorialBrainRun } from "./inspect-run.js";
export type { InspectBrainRunReport } from "./inspect-run.js";
export { runShadowValidation } from "./validation/validate-shadow.js";
export type { ShadowValidationReport, ValidationSampleResult } from "./validation/validate-shadow.js";
export {
  classifyClaimProfiles,
  inferClaimKindFromStatement,
} from "./validation/claim-profile-tags.js";
export { VALIDATION_FIXTURES } from "./validation/fixtures.js";
export {
  detectPredicateFamilies,
  hasEvaluativeRelation,
  classifyRepetitionKind,
} from "./shadow/predicate-families.js";
export type { PredicateFamily, RepetitionKind } from "./shadow/predicate-families.js";
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
export {
  mapFailuresToRepairTargets,
  MAX_TARGETED_REPAIR_ATTEMPTS,
} from "./generation/repair-target.js";
export type {
  RepairTarget,
  RepairStopReason,
  BlogArticleParts,
} from "./generation/repair-target.js";
export { runBoundedTargetedRepair, applyRepairs } from "./generation/targeted-repair.js";
export { detectBadInputClaims, isTitleRichClaim, isCastListClaim, looksLikeJammedCastNames } from "./generation/bad-claim-input.js";
export { evaluateBlogArticleEditorialSufficiency } from "./generation/article-sufficiency.js";
export type { ArticleSufficiencyResult } from "./generation/article-sufficiency.js";
export {
  assessXEditorialMaterial,
  buildXGenerationPromptContract,
} from "./generation/x-generation-contract.js";
export type { XMaterialAssessment } from "./generation/x-generation-contract.js";
export { runBoundedBrainRepairOnVersion } from "./generation/brain-guided-blogger.js";
export type {
  BrainGuidedGenerateResult,
  BrainGuidedGenerateInput,
} from "./generation/brain-guided-blogger.js";
export {
  buildContributionPlan,
  contributionsFromClaim,
  toRoleContributionBoundaries,
  unusedContributionsForRepair,
  consumedFacetKeysOutsideTarget,
  facetKey,
  normalizeAtomicFacets,
} from "./generation/informational-contribution.js";
export type {
  InformationalContribution,
  ContributionPlan,
} from "./generation/informational-contribution.js";
export {
  buildSegmentContributionAllocation,
  validateContributionCompliance,
  detectSourceTitleRestatement,
  allocateXFacetContributions,
} from "./generation/contribution-compliance.js";
export type {
  SegmentContributionAllocation,
  SegmentContributionContract,
  ContributionComplianceResult,
} from "./generation/contribution-compliance.js";
export { selectRepairOperation, buildDeterministicReplaceText, buildDeterministicCompressText, filterStrongUnused, hasFactualCore } from "./generation/repair-operation.js";
export type { RepairOperation, RepairOperationDecision } from "./generation/repair-operation.js";
export { validateRepairedSegment, mergeRepairSuccessResults } from "./generation/repair-success.js";
export { classifyRepairRun, classifyRepairSegment } from "./generation/repair-diagnostics.js";
export type { RepairFailureClass, SegmentRepairDiag } from "./generation/repair-diagnostics.js";
