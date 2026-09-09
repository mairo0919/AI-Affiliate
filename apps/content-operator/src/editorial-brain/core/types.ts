/**
 * Editorial Brain Core types — channel-agnostic contracts.
 * Channel-specific plans live under channels/blog and channels/x.
 */

export type EditorialChannelId = "BLOG" | "X";

/** Extension boundary: future channels register as modules; Core never switches on TikTok stubs. */
export type ChannelModuleId = EditorialChannelId | (string & {});

export type ExperienceScope = "CORE" | "CHANNEL";

export type ExperienceSourceType =
  | "SYSTEM_VALIDATOR"
  | "BRAIN_REVIEW"
  | "INITIAL_GENERATION"
  | "TARGETED_REPAIR_RESULT"
  | "HUMAN_FEEDBACK"
  | "PERFORMANCE"
  | "OTHER_APPROVED_SOURCE";

export type BrainDecision =
  | "PASS"
  | "TARGETED_REPAIR"
  | "REPLAN"
  | "FULL_REGEN"
  | "ESCALATE"
  | "SKIPPED"
  /** Not enough SUPPORTED material — do not invent; pick another product upstream. */
  | "DEFER_INSUFFICIENT_MATERIAL";

export type BrainRunMode = "SHADOW" | "ACTIVE";

export type ClaimAllocationRole = "opening" | "development" | "support" | "cta" | "unused";

export type ClaimAllocation = {
  claimId: string;
  role: ClaimAllocationRole;
  kind?: string;
};

export type OmittedClaim = {
  claimId: string;
  reason: string;
};

export type InferencePolicy = {
  allowed: Array<"direct_paraphrase" | "safe_composition" | "editorial_interpretation">;
  forbidden: Array<
    | "interpretive_inference"
    | "evaluative_inference"
    | "social_proof"
    | "name_derived_setting"
    | "external_world_claim"
  >;
};

export type CatalogMetadataPolicy = {
  allowCatalogDump: false;
  preferNaturalProse: true;
};

export type DevelopmentDepth = "scarce" | "standard" | "rich";

/** Executable HOW from reference-derived patterns (no competitor prose). */
export type CoreEditorialExecutionSlice = {
  openingStrategy: string;
  developmentStrategy: string;
  informationProgression: string[];
  sectionRoles: Array<{
    role: string;
    readerFunction: string;
    transitionFunction: string;
    maxNewClaims: number;
    optional: boolean;
  }>;
  scarceStrategyMode: "short_dense" | "standard" | "multi_detail";
  repetitionPolicy: string;
  summaryStrategy: string;
  ctaBridgeOmit: boolean;
  titleStrategy: string;
  avoidCategories: string[];
  patternSource: {
    structurePatternId: string | null;
    editorialPatternId: string | null;
    structurePatternLabel: string | null;
    editorialPatternLabel: string | null;
    sourceDomains: string[];
  };
};

export type CoreEditorialPlan = {
  channel: EditorialChannelId;
  formatKey: string | null;
  contentType: string;
  availableClaimIds: string[];
  selectedClaimIds: string[];
  omittedClaimIds: OmittedClaim[];
  openingDriverClaimIds: string[];
  claimAllocation: ClaimAllocation[];
  structurePatternId: string | null;
  editorialPatternId: string | null;
  developmentDepth: DevelopmentDepth;
  /** Expected count of distinct SUPPORTED details to surface — not a char budget. */
  informationGainTarget: number;
  scarcityMode: boolean;
  titleStrategy: string;
  summaryStrategy: string;
  ctaStrategy: string;
  inferencePolicy: InferencePolicy;
  catalogMetadataPolicy: CatalogMetadataPolicy;
  retrievedExperienceIds: string[];
  claimProfile: string;
  /** Soft guidance only — never quality hard-fail SSOT */
  softLengthGuidance?: {
    targetMaxCharsApprox: number;
    targetMaxParagraphs: number;
  } | null;
  /**
   * Reference-derived editorial HOW (Planner output).
   * When present, Generator must execute this — not free-write from claims alone.
   */
  editorialExecution?: CoreEditorialExecutionSlice | null;
};

export type ChannelEditorialPlan = {
  channel: EditorialChannelId;
  corePlan: CoreEditorialPlan;
  /** Channel-specific fields (BlogChannelPlan | XChannelPlan serialized) */
  specifics: Record<string, unknown>;
};

export type EditorialFailure = {
  code: string;
  severity: "BLOCKING" | "WARNING" | "INFO";
  message: string;
  evidence?: Record<string, unknown>;
};

export type EditorialAxisScore = {
  axis: string;
  score: number; // 0..1
  notes?: string;
};

export type AssertionSupportStatsSnapshot = {
  assertionCount: number;
  supportedNovelAssertionCount: number;
  unsupportedAssertionCount: number;
  interpretiveCount: number;
  evaluativeCount: number;
  nameDerivedCount: number;
  socialProofCount: number;
  repetitionCount: number;
  fillerCount: number;
  novelFacetCoverage: number;
  affectedSegmentRoles: string[];
};

export type EditorialReviewReport = {
  decision: BrainDecision;
  axes: EditorialAxisScore[];
  failures: EditorialFailure[];
  /** True when length alone would mislead — for tests/observability */
  lengthWasNotSoleJudge: true;
  metrics: {
    /** @deprecated Prefer supportedNovelAssertionCount — kept as alias for inspect compat */
    uniqueSupportedDetailEstimate: number;
    supportedNovelAssertionCount: number;
    unsupportedAssertionCount: number;
    semanticRepetitionHits: number;
    fillerHits: number;
    bodyUnits: number;
    assertionSupportStats: AssertionSupportStatsSnapshot;
  };
  /** Full assertion list for Shadow/tests; may be omitted when persisting large runs */
  semanticAssertions?: Array<{
    assertion: string;
    sourceSegment: string;
    supportingClaimIds: string[];
    supportType: string;
    confidence: number;
    addsInformation: boolean;
    failureCodes: string[];
    novelFacets: string[];
  }>;
};

export type ExperienceQuery = {
  channel: EditorialChannelId;
  formatKey?: string | null;
  contentType?: string | null;
  claimProfile?: string | null;
  structurePatternId?: string | null;
  editorialPatternId?: string | null;
  failureCodes?: string[];
  limit?: number;
};

export type ExperienceRetrievalHit = {
  id: string;
  scope: ExperienceScope;
  channel: string;
  score: number;
  confidence: number;
  failureCodes: string[];
  outcome: string | null;
  sourceType?: string | null;
};

export type ExperienceRetrievalResult = {
  hits: ExperienceRetrievalHit[];
  query: ExperienceQuery;
};

export type EditorialBrainRunTrace = {
  brainRunId: string;
  channel: EditorialChannelId;
  mode: BrainRunMode;
  corePlan: CoreEditorialPlan;
  channelPlan: ChannelEditorialPlan;
  retrievedExperienceIds: string[];
  review: EditorialReviewReport;
  legacyDecision: string;
  brainShadowDecision: BrainDecision;
  generatorModelRunIds: string[];
  contentVersionId: string | null;
  contentId: string | null;
};
