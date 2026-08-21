export { extractArticleStructureFeatures, assertFeaturesAreStructuralOnly } from "./structure-extraction.js";
export {
  extractArticleContentScope,
  ARTICLE_SCOPE_VERSION,
  type ArticleContentScope,
  type ArticleScopeSelectorKind,
  type ArticleScopeDiagnostics,
} from "./article-content-scope.js";
export { aggregateArticlePatterns } from "./pattern-aggregation.js";
export { ArticlePatternService, ArticlePatternError } from "./article-pattern-service.js";
export { evaluateArticleFormatCompliance } from "./format-compliance.js";
export {
  extractWritingFeaturesDeterministic,
  extractWritingFeaturesWithDiagnostics,
  mergeWritingFeatures,
  assertWritingFeaturesAreAbstract,
  getWritingFeaturesLlmJsonSchema,
  type WritingFeatureLlmExtractor,
  type InformationDensityDiagnostics,
  type WritingFeaturesExtractionResult,
} from "./writing-extraction.js";
export {
  computeInformationDensity,
  densityLengthBucket,
  INFORMATION_DENSITY_VERSION,
} from "./information-density.js";
export {
  buildAnalysisVersions,
  readInformationDensityVersion,
  getRequiredAnalysisVersionsForLearning,
  observationMeetsRequiredAnalysisVersions,
  STRUCTURE_ANALYSIS_VERSION,
  WRITING_ANALYSIS_VERSION,
  type ObservationAnalysisVersions,
} from "./analysis-versions.js";
export { createWritingFeatureLlmExtractor } from "./writing-llm-extractor.js";
export {
  resolveObservationSourceKind,
  parseSourceKind,
  isNonEmptyWritingPolicy,
  type ArticlePatternSourceKind,
} from "./source-kind.js";
export {
  evaluateSingleArticleLearningSuitability,
  readLearningSuitability,
  countEditorialSignals,
  type LearningSuitabilityClass,
  type LearningSuitabilityResult,
} from "./learning-suitability.js";
export {
  buildClassifyObservationsSummary,
  buildClassifyObservationsCliPayload,
  type ClassifyObservationSummaryInput,
  type ClassifyObservationsSummary,
} from "./classify-observations-summary.js";
export {
  createResolveActiveFormat,
  asResolveFormatSpec,
  type ResolvedActiveFormat,
  type ResolveActiveFormat,
} from "./resolve-active-format.js";
export {
  ArticlePatternSourceDiscoveryService,
  collectEligibleAForDiscoveryGoal,
  type SourceDiscoveryResult,
} from "./source-discovery.js";
export {
  MockArticlePatternSearchAdapter,
  DuckDuckGoHtmlSearchAdapter,
  qualifyCandidateUrl,
  parseDuckDuckGoHtmlResults,
  detectDuckDuckGoChallenge,
  DEFAULT_SINGLE_DISCOVERY_QUERIES,
} from "./source-search.js";
export {
  NEW_RELEASE_SINGLE_QUERY_STRATEGY,
  listNewReleaseSingleQueries,
} from "./discovery-query-strategy.js";
export {
  scoreNewReleaseSingleHit,
  rankDiscoveryHits,
  tallyRejectReasons,
} from "./discovery-hit-scoring.js";
export {
  classifyNewReleaseSingleHit,
  classifyAndPartitionHits,
  scoreSeedQuality,
  tallyClassifiedRejects,
  type DiscoveryHitKind,
  type ClassifiedDiscoveryHit,
} from "./discovery-classify.js";
export {
  extractIndividualArticleLinksFromSeedHtml,
  type ExtractedSeedLink,
} from "./discovery-seed-links.js";
export {
  BraveSearchApiAdapter,
  parseBraveWebSearchHits,
  createBraveSearchApiAdapterFromConfig,
} from "./brave-search-api.js";
export { createArticlePatternSearchAdapter } from "./search-adapter-factory.js";
export { canonicalizeArticlePatternUrl } from "./canonical-url.js";
export {
  prepareObservationsForLearning,
  type LearningInputPreparation,
} from "./observation-dedupe.js";
export {
  ArticlePatternObservationRefreshService,
  selectObservationsForScopeRefresh,
  readArticleScopeVersion,
  type ObservationRefreshResult,
} from "./observation-refresh.js";
export {
  hashNormalizedArticleContent,
  extractNormalizedMainArticleText,
  ARTICLE_PATTERN_HASH_BASIS,
} from "./content-hash.js";
export {
  validateWritingFeaturesLlmOverlay,
} from "./writing-extraction.js";
export {
  LEGACY_FORMAT_KEYS,
  normalizeFormatKey,
  DEFAULT_SINGLE_WRITING_POLICY,
  type ArticleStructureFeatures,
  type ArticleWritingFeatures,
  type ArticleWritingPolicy,
  type ArticleFormatSpec,
} from "./types.js";
export {
  clusterEditorialPatterns,
  extractEditorialPatternFromCluster,
  selectEditorialPattern,
  toEditorialPatternPromptContract,
  parseEditorialPatterns,
  detectEditorialFailureCategories,
} from "./editorial-pattern.js";
export type {
  EditorialPattern,
  EditorialAvoidCategory,
  EditorialOpeningContract,
} from "./editorial-pattern.js";
export {
  extractReferenceEditorialBlueprint,
  buildWeakBlueprintFromWritingFeatures,
  isReferenceEditorialBlueprint,
  classifyEvidenceTypesInText,
} from "./reference-editorial-blueprint.js";
export type {
  ReferenceEditorialBlueprint,
  ReferenceBlueprintSegment,
  BlueprintEvidenceType,
} from "./reference-editorial-blueprint.js";
export { buildResearchEvidence } from "./research-evidence.js";
export type { ResearchEvidence, EvidenceSourceType } from "./research-evidence.js";
export {
  buildReferenceEvidenceMappingPlan,
  scoreBlueprintForEvidence,
} from "./reference-evidence-mapping.js";
export type { ReferenceEvidenceMappingPlan, MappedSegment } from "./reference-evidence-mapping.js";
export { selectReferenceBlueprints, blueprintFromObservation } from "./retrieve-reference-blueprints.js";
export { detectReferenceNearCopy } from "./reference-near-copy.js";
export {
  extractTransformationFromEditorialBlueprint,
  isReferenceEditorialTransformationBlueprint,
  toTransformationPromptContract,
} from "./reference-editorial-transformation.js";
export type {
  ReferenceEditorialTransformationBlueprint,
  TransformationReadiness,
  FactLexicalization,
} from "./reference-editorial-transformation.js";
export {
  classifyProductMaterialProfile,
  classifyReferenceEditorialType,
  referenceTypeCompatible,
  buildProductMaterialProfileFromEvidence,
  buildProductMaterialProfileFromPack,
  buildProductMaterialProfileFromFacts,
  profileSatisfiesReferenceRequirements,
  referenceMaterialRequirements,
} from "./reference-type-profile.js";
export type {
  ProductMaterialKind,
  ProductMaterialProfile,
  ReferenceMaterialRequirements,
} from "./reference-type-profile.js";
export {
  classifySemanticEvidence,
  buildSemanticFamilyId,
  titleLabelAttributionAllowed,
  TITLE_SCOPE_ATTRIBUTION_FAIL_RE,
} from "./semantic-evidence.js";
export type { SemanticEvidenceClass } from "./semantic-evidence.js";
export {
  NATURAL_PRODUCT_INTRO_STRUCTURE,
  GROUNDED_PROMOTION_POLICY,
  TITLE_SERIES_PERSONA_SCOPE,
  EVIDENCE_DRIVEN_LENGTH_POLICY,
  OPTION_B_GENERATOR_POLICY,
} from "./natural-product-intro-policy.js";
export {
  extractOfficialPageFactAtoms,
  extractAtomsFromPageEvidenceMeta,
  officialPageAtomsToResearchEvidence,
} from "./official-page-evidence-atoms.js";
export type {
  OfficialPageFactAtom,
  OfficialPageFactBucket,
  PageEvidenceMetaShape,
} from "./official-page-evidence-atoms.js";
export {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "./skeleton-feasibility.js";
export { assignEvidenceToWritingSkeleton } from "./skeleton-evidence-assignment.js";
export { buildReferenceSegmentExecution } from "./reference-segment-execution.js";
