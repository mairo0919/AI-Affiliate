import { createHash } from "node:crypto";
import type {
  Content,
  ContentVersion,
  LifecycleRepository,
  QualityReviewRecord,
  ReviewResult,
} from "@ai-affiliate/database";
import type { LLMProvider } from "../adapters/types.js";
import { LLMProviderError } from "../adapters/types.js";
import { evaluatePolicies } from "../lifecycle/policy-engine.js";
import { XCharacterCounter } from "../x/character-counter.js";
import { BudgetBlockedError, BudgetGuard } from "./budget-guard.js";
import {
  attestedSurfacesFromArticlePlan,
  validateClaimsAgainstArticle,
} from "./claim-validator.js";
import { selectClaimsForBloggerPrompt } from "./freshness-disclaimer.js";
import { assertBloggerGenerationPreflight, GenerationPreflightError } from "./generation-preflight.js";
import { PromptService } from "./prompt-service.js";
import { resolveArticleImagesForTopic } from "./resolve-article-images.js";
import {
  getBloggerArticleLlmJsonSchema,
  parseBloggerArticle,
  parseXPost,
  structuredToPlainBody,
  summarizeBloggerSchemaValidationError,
  assertSectionHeadingsAgainstStructurePattern,
  fillOptionBArticleDefaults,
  applyOptionBDeterministicCta,
  type BloggerArticleStructured,
} from "./structured-article.js";
import {
  stripArticleLeadKey,
  toWriterVisibleArticlePlan,
} from "../article-pattern/leadless-article.js";
import {
  applyArticleOutputContractToLlmSchema,
  articleOutputContractFromSectionBounds,
  deriveArticleOutputContract,
  getSectionsCardinalityFromLlmSchema,
  type ArticleOutputContract,
} from "./article-output-contract.js";
import {
  selectStructurePattern,
  toStructurePatternPromptContract,
  type StructurePattern,
} from "../article-pattern/structure-pattern.js";
import {
  selectEditorialPattern,
  toEditorialPatternPromptContract,
  type EditorialPattern,
} from "../article-pattern/editorial-pattern.js";
import { selectClaimsForStructurePattern } from "./select-claims-for-structure-pattern.js";
import {
  buildClaimUsagePlan,
  toClaimUsagePlanPromptContract,
} from "./claim-usage-plan.js";
import {
  buildEditorialExecutionPlan,
  toCoreEditorialExecutionSlice,
} from "../editorial-brain/generation/editorial-execution-plan.js";
import { buildCoreEditorialPlan } from "../editorial-brain/core/planner.js";
import { buildBlogChannelPlan } from "../editorial-brain/channels/blog/adapter.js";
import {
  buildBrainGenerationInputContract,
  toBrainGenerationPromptContract,
} from "../editorial-brain/generation/generation-input-contract.js";
import {
  normalizeArticleProvenance,
} from "../editorial-brain/generation/provenance.js";
import type { ArticleProvenance } from "../editorial-brain/generation/provenance.js";
import {
  articlePlanComplianceAllowsPersist,
  buildArticlePlanComplianceMeta,
  buildOptionBArticlePlanRouting,
  routeArticlePlanFailure,
  validateArticlePlanCompliance,
} from "../editorial-brain/generation/article-plan-compliance.js";
import { validatePostTransformIntegrity } from "../editorial-brain/generation/post-transform-integrity.js";
import { detectBadInputClaims } from "../editorial-brain/generation/bad-claim-input.js";
import {
  MAX_PLAN_EXECUTION_ATTEMPTS,
  buildArticlePlanViolationFeedback,
  buildGenerationAttemptTrace,
  buildPlanViolationRegenNote,
} from "../editorial-brain/generation/plan-aware-generation.js";
import type { PlanViolationFeedback } from "./generation-authority.js";
import {
  buildGenerationAuthorityPromptContract,
  slimClaimUsagePlanForPrompt,
  slimEditorialPatternForPrompt,
  slimStructurePatternForPrompt,
} from "./generation-authority.js";
import { retrieveExperiences } from "../editorial-brain/core/retrieval.js";
import {
  formatTendencyHintsForAuthority,
  summarizePlanFailureTendencies,
} from "../editorial-brain/generation/planner-failure-tendencies.js";
import {
  buildReferenceGuidedLayer,
  toReferenceGuidedPromptContract,
} from "../editorial-brain/generation/reference-guided-layer.js";
import { validateReferenceExecution } from "../editorial-brain/generation/reference-execution-compliance.js";
import { buildOptionBBloggerGeneratorPrompt } from "../editorial-brain/generation/option-b-blogger-prompt.js";
import type { ArticlePatternRepository } from "@ai-affiliate/database";
import {
  toWritingSkeletonPromptContract,
  brainHowFromEditorialExecution,
} from "../article-pattern/writing-skeleton.js";
import {
  buildArticlePlan,
  materialDepthFromProfile,
} from "../article-pattern/article-plan.js";
import {
  buildArticlePlanExecutionContract,
  toWriterExecutionContractView,
} from "../article-pattern/plan-execution-contract.js";
import {
  buildEvidencePack,
  evidenceAllowlistIdsFromPack,
  toOptionBWriterSourceMaterial,
  toOptionBWriterSourceMaterialFromPack,
  claimStatementsFromPageEvidence,
} from "../article-pattern/evidence-pack.js";
import { isWriterCatalogConfirmation } from "../article-pattern/writer-evidence-filter.js";
import { buildProductMaterialProfileFromPack } from "../article-pattern/reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../article-pattern/skeleton-feasibility.js";

export interface GenerateBloggerInput {
  topicId: string;
  strategyId: string;
  contentId?: string;
  productTitle: string;
  ctaUrl?: string | null;
  articleFormat?: string;
  productLinkIds?: string[];
  claimIds?: string[];
  parentVersionId?: string | null;
  revisionType?: string;
  /**
   * @deprecated R117 — ignored. Legacy Brain observe/repair removed from production route.
   */
  brainGuidedRepair?: boolean;
}

export interface GenerateXInput {
  topicId: string;
  strategyId: string;
  contentId?: string;
  productTitle: string;
  bloggerUrl?: string | null;
  productUrl?: string | null;
  claimIds?: string[];
  maxWeightedLength?: number;
}

export class ContentGenerationService {
  private readonly prompts: PromptService;
  private readonly budget: BudgetGuard;
  private readonly xCounter = new XCharacterCounter();

  constructor(
    private readonly repo: LifecycleRepository,
    private readonly llm: LLMProvider,
    private readonly models: {
      generation: string;
      review: string;
      revision: string;
    },
    /**
     * ACTIVE ArticleFormat resolver (SSOT). When absent, legacy generation
     * continues without writingPolicy (compat).
     */
    private readonly resolveActiveFormat?: import("../article-pattern/resolve-active-format.js").ResolveActiveFormat,
  ) {
    this.prompts = new PromptService(repo);
    this.budget = new BudgetGuard(repo);
  }

  /**
   * Read-only production contract preflight (no LLM, no ContentVersion write).
   * Use before paid generate: Pattern → Article Output Contract → response schema cardinality.
   */
  async preflightBloggerArticleContract(input: {
    topicId: string;
    strategyId: string;
    productTitle: string;
    claimIds?: string[];
  }): Promise<{
    formatKey: string;
    formatId: string | null;
    patternId: string | null;
    patternLabel: string | null;
    editorialPatternId: string | null;
    editorialPatternLabel: string | null;
    leadTarget: string;
    leadFromRole: string | null;
    sectionRoles: string[];
    expectedMinSections: number | null;
    expectedMaxSections: number | null;
    headingRequirements: boolean[] | null;
    maxNarrativeBlocks: number | null;
    responseSchemaSections: { minItems: number | null; maxItems: number | null };
    selectedClaimIds: string[];
    openingClaimIds: string[];
    hookClaimIds: string[];
    developmentClaimIds: string[];
    omitCtaBridge: boolean;
    claimBudget: Record<string, unknown>;
    deferredClaimIds: string[];
    selectedClaimKinds: Array<{ id: string; kind: string }>;
    imagePolicy: { preferredImageCount: number; heroPosition: string | null };
    structurePatternPromptHasExpectedMax: boolean;
    editorialPatternPromptHasOpeningStrategy: boolean;
    articleOutputContract: ArticleOutputContract | null;
    editorialPattern: Record<string, unknown> | null;
    claimUsagePlan: Record<string, unknown> | null;
    editorialExecution: {
      source: Record<string, unknown>;
      openingStrategy: string;
      developmentStrategy: string;
      informationProgression: string[];
      materialDepth: string;
      sectionRoleCount: number;
    } | null;
  }> {
    const preflight = await assertBloggerGenerationPreflight(this.repo, {
      topicId: input.topicId,
      strategyId: input.strategyId,
      claimIds: input.claimIds,
    });
    const promptClaims = selectClaimsForBloggerPrompt(preflight.claims);
    const articleFormat = preflight.strategy.formatKey?.trim() || "new-release";

    let structurePatterns: StructurePattern[] = [];
    let editorialPatterns: EditorialPattern[] = [];
    let resolvedFormatId: string | null = null;
    if (this.resolveActiveFormat) {
      const resolved = await this.resolveActiveFormat(articleFormat);
      if (resolved) {
        resolvedFormatId = resolved.formatId;
        structurePatterns = resolved.structurePatterns ?? [];
        editorialPatterns = resolved.editorialPatterns ?? [];
      }
    }

    const selected = selectStructurePattern(structurePatterns, {
      claimCount: promptClaims.length,
    });
    const provisionalEditorial = selectEditorialPattern(editorialPatterns, {
      preferSparse: true,
    });
    const draftSelection = selectClaimsForStructurePattern(
      promptClaims.map((c) => ({ id: c.id, statement: c.statement })),
      selected,
      provisionalEditorial,
    );
    const draftDepthPlan = buildCoreEditorialPlan({
      channel: "BLOG",
      formatKey: articleFormat,
      contentType: "blogger-article",
      availableClaims: draftSelection.selectedClaims,
      selectedClaims: draftSelection.selectedClaims,
      openingClaimIds: draftSelection.openingClaimIds,
      hookClaimIds: draftSelection.openingClaimIds,
      developmentClaimIds: draftSelection.selectedClaims
        .map((c) => c.id)
        .filter((id) => !draftSelection.openingClaimIds.includes(id)),
      structurePatternId: selected?.patternId ?? null,
      editorialPatternId: provisionalEditorial?.patternId ?? null,
    });
    const selectedEditorial = selectEditorialPattern(editorialPatterns, {
      materialDepth: draftDepthPlan.developmentDepth,
      preferDense: draftDepthPlan.developmentDepth === "rich",
      preferSparse: draftDepthPlan.developmentDepth === "scarce",
    });
    const claimSelection = selectClaimsForStructurePattern(
      promptClaims.map((c) => ({ id: c.id, statement: c.statement })),
      selected,
      selectedEditorial,
    );
    const claimUsagePlan = buildClaimUsagePlan({
      selectedClaims: claimSelection.selectedClaims,
      openingClaimIds: claimSelection.openingClaimIds,
      structurePattern: selected,
      editorial: selectedEditorial,
    });
    const editorialExecution = buildEditorialExecutionPlan({
      structurePattern: selected,
      editorialPattern: selectedEditorial,
      materialDepth: draftDepthPlan.developmentDepth,
      omitCtaBridge: claimUsagePlan.omitCtaBridge,
      omitInterestDevelopment: claimUsagePlan.omitInterestDevelopment,
    });
    const articleOutputContract = deriveArticleOutputContract(selected);
    if (articleOutputContract) {
      articleOutputContract.maxArticleSections = claimUsagePlan.effectiveMaxArticleSections;
      articleOutputContract.minArticleSections = claimUsagePlan.effectiveMinArticleSections;
    }
    const structurePatternContract = selected ? toStructurePatternPromptContract(selected) : null;
    const editorialPatternContract = selectedEditorial
      ? toEditorialPatternPromptContract(selectedEditorial)
      : null;
    const claimUsagePlanContract = toClaimUsagePlanPromptContract(claimUsagePlan);
    const baseSchema = getBloggerArticleLlmJsonSchema();
    const outputSchema = applyArticleOutputContractToLlmSchema(baseSchema, articleOutputContract);
    const cardinality = getSectionsCardinalityFromLlmSchema(outputSchema);
    const promptJson = JSON.stringify({
      structure: structurePatternContract,
      editorial: editorialPatternContract,
      claimUsagePlan: claimUsagePlanContract,
      editorialExecution,
    });

    return {
      formatKey: articleFormat,
      formatId: resolvedFormatId,
      patternId: selected?.patternId ?? null,
      patternLabel: selected?.label ?? null,
      editorialPatternId: selectedEditorial?.patternId ?? null,
      editorialPatternLabel: selectedEditorial?.label ?? null,
      leadTarget: "lead",
      leadFromRole: articleOutputContract?.leadFromRole ?? null,
      sectionRoles: articleOutputContract?.sectionSlots.map((s) => s.role) ?? [],
      expectedMinSections: articleOutputContract?.minArticleSections ?? null,
      expectedMaxSections: articleOutputContract?.maxArticleSections ?? null,
      headingRequirements: articleOutputContract?.headingRequirements ?? null,
      maxNarrativeBlocks: articleOutputContract?.maxNarrativeBlocks ?? null,
      responseSchemaSections: cardinality,
      selectedClaimIds: claimSelection.selectedClaims.map((c) => c.id),
      openingClaimIds: claimSelection.openingClaimIds,
      hookClaimIds: claimUsagePlan.hookClaimIds,
      developmentClaimIds: claimUsagePlan.developmentClaimIds,
      omitCtaBridge: claimUsagePlan.omitCtaBridge,
      claimBudget: claimUsagePlan.claimBudget,
      deferredClaimIds: claimSelection.deferredClaimIds,
      selectedClaimKinds: claimSelection.selectedClaims.map((c) => ({
        id: c.id,
        kind: c.kind,
      })),
      imagePolicy: {
        preferredImageCount: selected?.imageLayout.preferredImageCount ?? 0,
        heroPosition: selected?.imageLayout.heroPosition ?? null,
      },
      structurePatternPromptHasExpectedMax:
        /expectedMaxSections|expectedSections:\s*min=/.test(promptJson),
      editorialPatternPromptHasOpeningStrategy: /strongest_concrete_trait|opening\.strategy/.test(
        promptJson,
      ),
      articleOutputContract,
      editorialPattern: editorialPatternContract,
      claimUsagePlan: claimUsagePlanContract,
      editorialExecution: {
        source: editorialExecution.source,
        openingStrategy: editorialExecution.openingStrategy,
        developmentStrategy: editorialExecution.developmentStrategy,
        informationProgression: editorialExecution.informationProgression,
        materialDepth: editorialExecution.materialDepth,
        sectionRoleCount: editorialExecution.sectionRoles.length,
      },
    };
  }

  async generateBloggerArticle(input: GenerateBloggerInput): Promise<{
    content: Content;
    version: ContentVersion;
    article: BloggerArticleStructured;
    modelRunId: string;
    publishValidation: {
      articlePlanCompliancePass: boolean;
      claimValidationPass: boolean;
      integrityPass: boolean;
    };
  }> {
    await this.budget.assertCanSpend(1);
    // Fail-fast before any ModelRun / LLM spend when FK parents are missing.
    const preflight = await assertBloggerGenerationPreflight(this.repo, {
      topicId: input.topicId,
      strategyId: input.strategyId,
      claimIds: input.claimIds,
    });
    const claims = preflight.claims;
    const promptClaims = selectClaimsForBloggerPrompt(claims);
    const supportedIds = promptClaims.map((c) => c.id);

    const strategy = preflight.strategy;
    // Strategy.formatKey is SSOT — do not override from CLI/input.
    const articleFormat = strategy.formatKey?.trim() || "new-release";

    let formatSpec: Record<string, unknown> | null = null;
    let resolvedFormatId: string | null = null;
    let resolvedFormatKey: string | null = null;
    let structurePatterns: StructurePattern[] = [];
    let editorialPatterns: EditorialPattern[] = [];
    let selectedStructurePattern: StructurePattern | null = null;
    let selectedEditorialPattern: EditorialPattern | null = null;
    if (this.resolveActiveFormat) {
      const resolved = await this.resolveActiveFormat(articleFormat);
      if (resolved) {
        formatSpec = resolved.spec as unknown as Record<string, unknown>;
        resolvedFormatId = resolved.formatId;
        resolvedFormatKey = resolved.formatKey;
        structurePatterns = resolved.structurePatterns ?? [];
        editorialPatterns = resolved.editorialPatterns ?? [];
      }
    }

    // ACTIVE pattern formats require a non-empty writingPolicy before any LLM spend.
    // Legacy generation (no ACTIVE registry hit) remains compatible without writingPolicy.
    if (formatSpec) {
      const wp =
        "writingPolicy" in formatSpec ? formatSpec.writingPolicy : undefined;
      const nonEmpty =
        wp &&
        typeof wp === "object" &&
        !Array.isArray(wp) &&
        Object.keys(wp as Record<string, unknown>).length > 0;
      if (!nonEmpty) {
        throw new GenerationPreflightError(
          "writing_policy_missing",
          `ACTIVE format ${articleFormat} has empty or missing writingPolicy`,
        );
      }
    }

    // Claim grounding outranks format: if format needs more products than we have claims for,
    // do not invent facts — warn via metadata only (multi-product later).
    const formatProductMin =
      formatSpec &&
      typeof formatSpec === "object" &&
      formatSpec.targetProductCount &&
      typeof formatSpec.targetProductCount === "object"
        ? Number((formatSpec.targetProductCount as { min?: number }).min ?? 1)
        : 1;
    if (formatProductMin > 1 && supportedIds.length < formatProductMin) {
      // Fail-soft for single-product path: do not invent products; continue with warning metadata
      formatSpec = {
        ...(formatSpec ?? {}),
        _claimOverFormat: true,
        _warning: `format wants ${formatProductMin} products but only ${supportedIds.length} supported claims; will not invent facts`,
      };
    }

    selectedStructurePattern = selectStructurePattern(structurePatterns, {
      claimCount: promptClaims.length,
    });
    // Draft claim selection with provisional editorial (prefer sparse until depth known)
    const provisionalEditorial = selectEditorialPattern(editorialPatterns, {
      preferSparse: true,
    });
    const claimSelectionRaw = selectClaimsForStructurePattern(
      promptClaims.map((c) => ({ id: c.id, statement: c.statement })),
      selectedStructurePattern,
      provisionalEditorial,
    );
    // Do not use corrupted upstream Claims (jammed cast etc.) for generation/repair fabrication.
    const badSelected = detectBadInputClaims(
      claimSelectionRaw.selectedClaims.map((c) => ({
        id: c.id,
        statement: c.statement,
        kind: c.kind,
      })),
    );
    const badIds = new Set(badSelected.map((b) => b.claimId));
    // R149 — catalog confirmation shells are not generation fuel (defer, do not invent).
    const catalogClaimIds = new Set(
      claimSelectionRaw.selectedClaims
        .filter((c) => isWriterCatalogConfirmation(c.statement))
        .map((c) => c.id),
    );
    const rejectIds = new Set([...badIds, ...catalogClaimIds]);
    if (badIds.size > 0 && claimSelectionRaw.selectedClaims.every((c) => badIds.has(c.id))) {
      throw new GenerationPreflightError(
        "bad_input_claim",
        `All selected claims are BAD_INPUT_CLAIM: ${[...badIds].join(",")}`,
      );
    }
    const claimSelection = {
      ...claimSelectionRaw,
      selectedClaims: claimSelectionRaw.selectedClaims.filter((c) => !rejectIds.has(c.id)),
      openingClaimIds: claimSelectionRaw.openingClaimIds.filter((id) => !rejectIds.has(id)),
      deferredClaimIds: [
        ...claimSelectionRaw.deferredClaimIds,
        ...claimSelectionRaw.selectedClaims.filter((c) => rejectIds.has(c.id)).map((c) => c.id),
      ],
    };
    if (claimSelection.openingClaimIds.length === 0 && claimSelection.selectedClaims[0]) {
      claimSelection.openingClaimIds = [claimSelection.selectedClaims[0].id];
    }
    // Depth from draft core plan drives dense vs sparse editorial selection
    const draftCore = buildCoreEditorialPlan({
      channel: "BLOG",
      formatKey: resolvedFormatKey ?? articleFormat,
      contentType: "blogger-article",
      availableClaims: promptClaims.map((c) => ({
        id: c.id,
        statement: c.statement,
        kind:
          claimSelection.selectedClaims.find((s) => s.id === c.id)?.kind ?? "other",
      })),
      selectedClaims: claimSelection.selectedClaims.map((c) => ({
        id: c.id,
        statement: c.statement,
        kind: c.kind,
      })),
      deferredClaimIds: claimSelection.deferredClaimIds,
      openingClaimIds: claimSelection.openingClaimIds,
      hookClaimIds: claimSelection.openingClaimIds,
      developmentClaimIds: claimSelection.selectedClaims
        .map((c) => c.id)
        .filter((id) => !claimSelection.openingClaimIds.includes(id)),
      structurePatternId: selectedStructurePattern?.patternId ?? null,
      editorialPatternId: provisionalEditorial?.patternId ?? null,
    });
    selectedEditorialPattern = selectEditorialPattern(editorialPatterns, {
      materialDepth: draftCore.developmentDepth,
      preferDense: draftCore.developmentDepth === "rich",
      preferSparse: draftCore.developmentDepth === "scarce",
    });
    const claimUsagePlan = buildClaimUsagePlan({
      selectedClaims: claimSelection.selectedClaims,
      openingClaimIds: claimSelection.openingClaimIds,
      structurePattern: selectedStructurePattern,
      editorial: selectedEditorialPattern,
    });
    const editorialExecution = buildEditorialExecutionPlan({
      structurePattern: selectedStructurePattern,
      editorialPattern: selectedEditorialPattern,
      materialDepth: draftCore.developmentDepth,
      omitCtaBridge: claimUsagePlan.omitCtaBridge,
      omitInterestDevelopment: claimUsagePlan.omitInterestDevelopment,
    });
    const structurePatternContract = selectedStructurePattern
      ? toStructurePatternPromptContract(selectedStructurePattern)
      : null;
    const editorialPatternContract = selectedEditorialPattern
      ? toEditorialPatternPromptContract(selectedEditorialPattern)
      : null;
    const claimUsagePlanContract = toClaimUsagePlanPromptContract(claimUsagePlan);
    const brainCorePlan = buildCoreEditorialPlan({
      channel: "BLOG",
      formatKey: resolvedFormatKey ?? articleFormat,
      contentType: "blogger-article",
      availableClaims: promptClaims.map((c) => ({
        id: c.id,
        statement: c.statement,
        kind:
          claimSelection.selectedClaims.find((s) => s.id === c.id)?.kind ??
          "other",
      })),
      selectedClaims: claimSelection.selectedClaims.map((c) => ({
        id: c.id,
        statement: c.statement,
        kind: c.kind,
      })),
      deferredClaimIds: claimSelection.deferredClaimIds,
      openingClaimIds: claimSelection.openingClaimIds,
      hookClaimIds: claimUsagePlan.hookClaimIds,
      developmentClaimIds: claimUsagePlan.developmentClaimIds,
      structurePatternId: selectedStructurePattern?.patternId ?? null,
      editorialPatternId: selectedEditorialPattern?.patternId ?? null,
      softLengthGuidance: {
        targetMaxCharsApprox: claimUsagePlan.claimBudget.targetMaxCharsApprox,
        targetMaxParagraphs: claimUsagePlan.claimBudget.targetMaxParagraphs,
      },
      editorialExecution: toCoreEditorialExecutionSlice(editorialExecution),
      titleStrategy: editorialExecution.titleStrategy,
      summaryStrategy: editorialExecution.summaryStrategy,
      ctaStrategy: editorialExecution.ctaBridge.omit
        ? "widget_only_no_generic_bridge"
        : "bridge_only_if_editorial_value",
    });
    const brainChannelPlan = buildBlogChannelPlan(brainCorePlan);
    let brainGenerationContract: ReturnType<typeof buildBrainGenerationInputContract>;
    let brainGenerationPromptContract: Record<string, unknown>;
    // r79 — always bind section cardinality (Structure Pattern optional)
    const scarceDepth = editorialExecution.materialDepth === "scarce";
    const boundMaxSections = scarceDepth
      ? 1
      : claimUsagePlan.effectiveMaxArticleSections;
    const boundMinSections = Math.min(
      claimUsagePlan.effectiveMinArticleSections,
      boundMaxSections,
    );
    let articleOutputContract: ArticleOutputContract | null =
      deriveArticleOutputContract(selectedStructurePattern);
    if (articleOutputContract) {
      articleOutputContract.maxArticleSections = Math.min(
        articleOutputContract.maxArticleSections,
        boundMaxSections,
      );
      articleOutputContract.minArticleSections = Math.min(
        boundMinSections,
        articleOutputContract.maxArticleSections,
      );
    } else {
      articleOutputContract = articleOutputContractFromSectionBounds({
        minArticleSections: boundMinSections,
        maxArticleSections: boundMaxSections,
      });
    }

    // Reference Blueprint → Writing Skeleton + Evidence Pack (OPTION B Generator SSOT)
    const prisma = (this.repo as unknown as { prisma: ConstructorParameters<typeof ArticlePatternRepository>[0] })
      .prisma;
    const pageEvidenceMeta = await this.loadOfficialPageEvidenceMeta(input.ctaUrl);
    const referenceGuided = await buildReferenceGuidedLayer({
      prisma,
      productTitle: input.productTitle,
      claims: claimSelection.selectedClaims.map((c) => ({
        id: c.id,
        statement: c.statement,
        kind: c.kind,
        status: "SUPPORTED",
      })),
      targetFormatKey: resolvedFormatKey ?? articleFormat,
      pageEvidenceMeta,
    });
    if (referenceGuided.defer) {
      throw new GenerationPreflightError(
        "insufficient_editorial_material",
        `DEFER_INSUFFICIENT_REFERENCE_MATERIAL: ${referenceGuided.deferReason ?? "blueprint_unmapped"}`,
      );
    }

    const evidencePack = buildEvidencePack({
      productTitle: input.productTitle,
      claims: claimSelection.selectedClaims.map((c) => ({
        id: c.id,
        statement: c.statement,
        kind: c.kind,
        status: "SUPPORTED",
      })),
      researchEvidence: referenceGuided.researchEvidence,
      pageEvidenceMeta,
    });
    if (evidencePack.insufficientConcrete) {
      throw new GenerationPreflightError(
        "insufficient_editorial_material",
        `DEFER_INSUFFICIENT_CONCRETE_EVIDENCE: ${evidencePack.insufficientReason ?? "catalog_only"}`,
      );
    }

    const materialProfile = buildProductMaterialProfileFromPack(evidencePack);

    const writingSkeletonRaw = skeletonFromMaterialProfile(materialProfile);
    // Reference blueprint retained as advisory metadata only — natural intro HOW wins.
    // writingSkeletonFromReference still available for diagnostics / future merge.

    const feasibility = ensureFeasibleWritingSkeleton({
      skeleton: writingSkeletonRaw,
      pack: evidencePack,
      profile: materialProfile,
    });
    if (feasibility.deferred) {
      throw new GenerationPreflightError(
        "insufficient_editorial_material",
        `DEFER_INSUFFICIENT_MATERIAL: ${feasibility.deferReason ?? "skeleton_infeasible"}`,
      );
    }
    const writingSkeleton = feasibility.skeleton;
    const skeletonAssignment = feasibility.assignment;
    if (skeletonAssignment.anyFallbackCount > 0) {
      throw new GenerationPreflightError(
        "insufficient_editorial_material",
        "DEFER_INSUFFICIENT_MATERIAL: any_fallback_forbidden_on_option_b",
      );
    }

    const writingSkeletonPrompt = toWritingSkeletonPromptContract(
      writingSkeleton,
      brainHowFromEditorialExecution(editorialExecution),
      skeletonAssignment,
    )!;
    const evidencePackPrompt = toOptionBWriterSourceMaterialFromPack(evidencePack);
    const evidenceAllowlistIds = evidenceAllowlistIdsFromPack(evidencePack);
    const articlePlanBase = buildArticlePlan({
      productTitle: input.productTitle,
      pack: evidencePack,
      assignment: skeletonAssignment,
      materialDepth: materialDepthFromProfile(materialProfile),
      profile: materialProfile,
    });
    const articlePlanExecution = toWriterExecutionContractView(
      buildArticlePlanExecutionContract(articlePlanBase),
    );
    // R151 — attach execution on the plan object so authority pickArticlePlan.execution works.
    const articlePlan = { ...articlePlanBase, execution: articlePlanExecution };

    // V2 — allow one section per reader job (Formatter still flattens headings).
    const planBodySlots = Math.max(1, articlePlanBase.body.length);
    if (articleOutputContract) {
      articleOutputContract.maxArticleSections = Math.max(
        articleOutputContract.maxArticleSections,
        Math.min(planBodySlots, 4),
      );
      articleOutputContract.minArticleSections = Math.min(
        Math.max(1, Math.min(planBodySlots, articleOutputContract.minArticleSections || 1)),
        articleOutputContract.maxArticleSections,
      );
    }
    brainGenerationContract = buildBrainGenerationInputContract({
      corePlan: brainCorePlan,
      channelPlan: brainChannelPlan,
      claims: claimSelection.selectedClaims.map((c) => ({
        id: c.id,
        statement: c.statement,
        kind: c.kind,
      })),
      articlePlan,
    });
    brainGenerationPromptContract = toBrainGenerationPromptContract(brainGenerationContract);

    // Keep Reference contract for Brain/compliance advisory — NOT Generator dump
    const referenceGuidedPrompt = toReferenceGuidedPromptContract(referenceGuided);
    {
      const prevRules = Array.isArray(brainGenerationPromptContract.rules)
        ? (brainGenerationPromptContract.rules as string[])
        : [];
      const prevLayers =
        typeof brainGenerationPromptContract.layers === "object" &&
        brainGenerationPromptContract.layers
          ? (brainGenerationPromptContract.layers as Record<string, unknown>)
          : {};
      const writerVisiblePlan = toWriterVisibleArticlePlan(
        articlePlan as unknown as Record<string, unknown>,
      );
      brainGenerationPromptContract = {
        ...brainGenerationPromptContract,
        mode: "OPTION_B",
        articlePlan: writerVisiblePlan,
        ARTICLE_PLAN: writerVisiblePlan,
        ARTICLE_PLAN_EXECUTION: articlePlanExecution,
        /** Internal only — not Writer-injected (r114). */
        writingSkeleton: writingSkeletonPrompt,
        evidencePack: evidencePackPrompt,
        /** Internal validation allowlist — not Writer-visible (r43). */
        evidenceAllowlistIds,
        productMaterialProfile: {
          kind: materialProfile.kind,
          materialDepth: materialProfile.materialDepth,
          sceneFamilies: materialProfile.sceneFamilies,
          quantityFamilies: materialProfile.quantityFamilies,
          durationFamilies: materialProfile.durationFamilies,
          characterTraitFamilies: materialProfile.characterTraitFamilies,
          productFormFamilies: materialProfile.productFormFamilies,
          performerCount: materialProfile.performerCount,
          independentDevelopmentFamilyCount:
            materialProfile.independentDevelopmentFamilyCount,
          uniqueConcreteFamilyCount: materialProfile.uniqueConcreteFamilyCount,
        },
        skeletonFeasibility: {
          shrunk: feasibility.shrunk,
          shrinkFromBodySlots: feasibility.shrinkFromBodySlots,
          shrinkToBodySlots: feasibility.shrinkToBodySlots,
          anyFallbackCount: feasibility.anyFallbackCount,
        },
        layers: {
          ...prevLayers,
          ARTICLE_PLAN: writerVisiblePlan,
          ARTICLE_PLAN_EXECUTION: articlePlanExecution,
          WRITING_SKELETON: writingSkeletonPrompt,
          EVIDENCE_PACK: evidencePackPrompt,
          // Legacy advisory only — not injected into Generator authority when OPTION B active
          REFERENCE_BLUEPRINT: referenceGuidedPrompt?.REFERENCE_BLUEPRINT ?? null,
          EVIDENCE_MAPPING_PLAN: referenceGuidedPrompt?.EVIDENCE_MAPPING_PLAN ?? null,
          REFERENCE_TRANSFORM_BLUEPRINT:
            referenceGuidedPrompt?.REFERENCE_TRANSFORM_BLUEPRINT ?? null,
        },
        referenceGuided: referenceGuidedPrompt,
        referenceTransform: referenceGuidedPrompt?.REFERENCE_TRANSFORM_BLUEPRINT ?? null,
        segmentExecution: {
          ...(typeof brainGenerationPromptContract.segmentExecution === "object" &&
          brainGenerationPromptContract.segmentExecution
            ? (brainGenerationPromptContract.segmentExecution as object)
            : {}),
          referenceSegmentExecution: referenceGuided.segmentExecution,
        },
        priority: [
          "1_ARTICLE_PLAN",
          "2_FACTUAL_SAFETY",
          "3_BLOG_CHANNEL_REQUIREMENTS",
        ],
        priorityRule:
          "OPTION B r114: ARTICLE_PLAN is Writer SSOT. Catalog metadata is not body fuel.",
        rules: [
          ...prevRules,
          "Realize ARTICLE_PLAN slot facts only.",
          "Never pad with catalogMetadata.",
          "Never copy reference article wording.",
        ],
      };
    }

    // Planner-stage DEFER: do not call LLM to invent catalog/eval body when material is insufficient
    if (brainGenerationContract.insufficientDevelopmentMaterial) {
      throw new GenerationPreflightError(
        "insufficient_editorial_material",
        "DEFER_INSUFFICIENT_MATERIAL: no concrete body contributions after opening→body allocation (catalog-only development). Skip generation rather than pad.",
      );
    }

    const prompt = await this.prompts.getPrompt("blogger.generate", "v1");
    const writingPolicy =
      formatSpec &&
      typeof formatSpec === "object" &&
      "writingPolicy" in formatSpec &&
      formatSpec.writingPolicy
        ? formatSpec.writingPolicy
        : {};
    const writingPolicyApplied =
      Boolean(resolvedFormatId) &&
      Boolean(writingPolicy) &&
      typeof writingPolicy === "object" &&
      !Array.isArray(writingPolicy) &&
      Object.keys(writingPolicy as Record<string, unknown>).length > 0;

    const slimStructure = slimStructurePatternForPrompt(
      (structurePatternContract ?? null) as Record<string, unknown> | null,
    );
    const slimEditorial = slimEditorialPatternForPrompt(
      (editorialPatternContract ?? null) as Record<string, unknown> | null,
    );
    const slimClaimUsage = slimClaimUsagePlanForPrompt(
      claimUsagePlanContract as unknown as Record<string, unknown>,
    );

    // Experience → planner tendency hints only (no Experience prose dump / no LearningRule mutation)
    let plannerFailureTendencies: Record<string, unknown> | null = null;
    let retrievedExperienceIds: string[] = [];
    try {
      const brainRepo = this.repo.createEditorialBrainRepository();
      const expResult = await retrieveExperiences(brainRepo, {
        channel: "BLOG",
        formatKey: resolvedFormatKey ?? articleFormat,
        contentType: "blogger-article",
        structurePatternId: selectedStructurePattern?.patternId ?? null,
        editorialPatternId: selectedEditorialPattern?.patternId ?? null,
        failureCodes: [
          "PLAN_EXECUTION_FAILED",
          "LEAD_BODY_OVERLAP",
          "FORBIDDEN_CONTRIBUTION_REUSED",
          "STRUCTURAL_PROGRESSION_FAILURE",
          "REQUIRED_CONTRIBUTION_MISSING",
          "GENERATION_PLAN_UNDERUSE",
          "REPETITION",
          "SEMANTIC_CONTRIBUTION_REUSE",
          "COMPOSITE_COMPONENT_RESTATEMENT",
          "PROVENANCE_CONTRADICTION",
          "REPEATED_PLAN_EXECUTION_FAILURE",
        ],
        limit: 8,
      });
      retrievedExperienceIds = expResult.hits.map((h) => h.id);
      const hints = summarizePlanFailureTendencies(expResult, {
        editorialPatternId: selectedEditorialPattern?.patternId ?? null,
        maxHints: 4,
      });
      plannerFailureTendencies = formatTendencyHintsForAuthority(hints);
      // Experience must change Planner/Contract output — not metadata-only
      if (hints.length > 0) {
        const extraRules = hints.map(
          (h) => `EXPERIENCE_TENDENCY(${h.failureClass}): ${h.executionConstraint}`,
        );
        const prevRules = Array.isArray(brainGenerationPromptContract.rules)
          ? (brainGenerationPromptContract.rules as string[])
          : [];
        brainGenerationPromptContract = {
          ...brainGenerationPromptContract,
          experienceTendencyConstraints: hints.map((h) => ({
            failureClass: h.failureClass,
            sampleCount: h.sampleCount,
            constraint: h.executionConstraint,
          })),
          rules: [...prevRules, ...extraRules],
        };
      }
    } catch {
      plannerFailureTendencies = null;
      retrievedExperienceIds = [];
    }

    const claimSelectionPolicy = {
      mode: "selective",
      maxClaimsSuggested: claimSelection.maxClaimsSuggested,
      deferredClaimIds: claimSelection.deferredClaimIds,
      openingClaimIds: claimSelection.openingClaimIds,
      hookClaimIds: claimUsagePlan.hookClaimIds,
      developmentClaimIds: claimUsagePlan.developmentClaimIds,
      note: "Use generationAuthority + brainGenerationContract segmentExecution. Each claimId in at most one role. Do not force-use deferredClaimIds.",
    };

    // Seed schema from SSOT (includes segmentContributionProvenance); DB schema may be stale.
    const baseSchema = getBloggerArticleLlmJsonSchema();
    let outputSchema = applyArticleOutputContractToLlmSchema(baseSchema, articleOutputContract);

    const modelRun = await this.repo.createModelRun({
      provider: this.llm.providerKey,
      model: this.models.generation,
      taskType: "GENERATION_BLOGGER",
      promptIdentifier: prompt.identifier,
      promptVersion: prompt.version,
      status: "RUNNING",
      inputRef: input.strategyId,
      metadata: {
        topicId: input.topicId,
        articleFormat,
        promptClaimCount: claimSelection.selectedClaims.length,
        deferredClaimCount: claimSelection.deferredClaimIds.length,
        excludedExpiredClaimCount: claims.filter(
          (c) =>
            c.status === "SUPPORTED" &&
            c.expiresAt != null &&
            !promptClaims.some((p) => p.id === c.id),
        ).length,
        formatKey: resolvedFormatKey ?? articleFormat,
        formatId: resolvedFormatId,
        writingPolicyApplied,
        formatSpec,
        writingPolicy,
        structurePatternId: selectedStructurePattern?.patternId ?? null,
        structurePatternLabel: selectedStructurePattern?.label ?? null,
        structurePattern: slimStructure,
        editorialPatternId: selectedEditorialPattern?.patternId ?? null,
        editorialPatternLabel: selectedEditorialPattern?.label ?? null,
        editorialPattern: slimEditorial,
        editorialExecution: {
          source: editorialExecution.source,
          openingStrategy: editorialExecution.openingStrategy,
          developmentStrategy: editorialExecution.developmentStrategy,
          informationProgression: editorialExecution.informationProgression,
          sectionRoles: editorialExecution.sectionRoles,
          scarceStrategy: editorialExecution.scarceStrategy,
          richStrategy: editorialExecution.richStrategy,
          materialDepth: editorialExecution.materialDepth,
        },
        brainGenerationContractLayers: brainGenerationPromptContract.layers
          ? Object.keys(brainGenerationPromptContract.layers as object)
          : [],
        segmentExecution: brainGenerationPromptContract.segmentExecution ?? null,
        retrievedExperienceIds,
        plannerFailureTendencies,
        articleOutputContract,
        responseSchemaSections: getSectionsCardinalityFromLlmSchema(outputSchema),
        claimSelection: {
          selectedClaimIds: claimSelection.selectedClaims.map((c) => c.id),
          openingClaimIds: claimSelection.openingClaimIds,
          deferredClaimIds: claimSelection.deferredClaimIds,
          maxClaimsSuggested: claimSelection.maxClaimsSuggested,
          selectedKinds: claimSelection.selectedClaims.map((c) => c.kind),
          hookClaimIds: claimUsagePlan.hookClaimIds,
          developmentClaimIds: claimUsagePlan.developmentClaimIds,
          omitCtaBridge: claimUsagePlan.omitCtaBridge,
        },
        claimUsagePlan: slimClaimUsage,
      },
    });

    let llm: Awaited<ReturnType<LLMProvider["executeTask"]>> | undefined;
    let article: BloggerArticleStructured | undefined;
    let brainProvenance: ArticleProvenance | null = null;
    let planViolationFeedback: PlanViolationFeedback | null = null;
    let rawPlanComplianceMeta: Record<string, unknown> | null = null;
    let articlePlanComplianceMeta: Record<string, unknown> | null = null;
    let publishValidation = {
      articlePlanCompliancePass: true,
      claimValidationPass: true,
      integrityPass: true,
    };
    let generationAttempt = 0;
    let finalUserPrompt = "";
    let finalSystemInstruction = "";
    let finalGenerationAuthority: Record<string, unknown> | null = null;
    let priorFailureSignature: string | null = null;
    let rawFailureRoutingMeta: Record<string, unknown> | null = null;
    /** R121 — completion-only DROP meta merged into ArticlePlan compliance */
    let articlePlanComplianceMutationMeta: Record<string, unknown> | null = null;
    /** R147 — per-attempt Writer/compliance/regen diagnostics */
    const generationAttemptTraces: ReturnType<typeof buildGenerationAttemptTrace>[] = [];

    try {
      while (generationAttempt < MAX_PLAN_EXECUTION_ATTEMPTS) {
        generationAttempt += 1;
        const generationAuthority = buildGenerationAuthorityPromptContract({
          brainGenerationContract: brainGenerationPromptContract,
          editorialPatternSummary: slimEditorial,
          structurePatternSummary: slimStructure,
          planViolationFeedback,
          plannerFailureTendencies,
        });
        finalGenerationAuthority = generationAuthority;

        const slim = buildOptionBBloggerGeneratorPrompt({
          productTitle: input.productTitle,
          ctaUrl: input.ctaUrl ?? "",
          articleFormat,
          generationAuthority,
          articleOutputContract,
          planViolationNote: planViolationFeedback
            ? buildPlanViolationRegenNote(planViolationFeedback)
            : null,
        });
        const systemInstruction = slim.systemInstruction;
        const userPrompt = slim.userPrompt;
        // r79 — executeTask must use the same cardinality-bound schema as the prompt
        const outputSchema = slim.outputSchema;
        finalSystemInstruction = systemInstruction;
        finalUserPrompt = userPrompt;

        try {
          llm = await this.llm.executeTask({
            taskType: "GENERATION_BLOGGER",
            promptIdentifier: prompt.identifier,
            promptVersion: prompt.version,
            systemInstruction,
            userPrompt,
            outputSchema,
            model: this.models.generation,
            input: {
              productTitle: input.productTitle,
              ctaUrl: input.ctaUrl ?? null,
              articleFormat,
              formatSpec: formatSpec ?? null,
              writingPolicy:
                formatSpec && typeof formatSpec === "object"
                  ? ((formatSpec as { writingPolicy?: unknown }).writingPolicy ?? null)
                  : null,
              generationAuthority,
              structurePattern: slimStructure,
              editorialPattern: slimEditorial,
              claimUsagePlan: slimClaimUsage,
              brainGenerationContract: brainGenerationPromptContract,
              planViolationFeedback,
              generationAttempt,
              supportedClaimIds: claimSelection.selectedClaims.map((c) => c.id),
              openingClaimIds: claimSelection.openingClaimIds,
              productLinkIds: input.productLinkIds ?? [],
            },
          });
        } catch (error) {
          await this.repo.completeModelRun(modelRun.id, {
            status: "FAILED",
            errorType: error instanceof LLMProviderError ? error.errorClass : "unknown",
            errorDetail: error instanceof Error ? error.message : "LLM failed",
            metadata: {
              llmCompleted: false,
              persistenceCompleted: false,
              generationAttempt,
              planViolationFeedback,
            },
          });
          throw error;
        }

        await this.repo.createCostRecord({
          provider: llm.provider,
          serviceOrModel: llm.model,
          operationType: "GENERATION_BLOGGER",
          relatedType: "ContentStrategy",
          relatedId: input.strategyId,
          modelRunId: modelRun.id,
          estimatedAmount: llm.estimatedCost,
          actualAmount: llm.actualCost ?? llm.estimatedCost,
          currency: llm.currency,
        });

        const parsed = parseBloggerArticle(
          fillOptionBArticleDefaults(
            applyOptionBDeterministicCta(
              llm.output as Record<string, unknown>,
              input.ctaUrl ?? null,
            ),
          ),
        );
        // Leadless write contract: never persist/emit lead (even if model hallucinated it).
        const leadlessParsed = stripArticleLeadKey(
          parsed as unknown as Record<string, unknown>,
        ) as unknown as BloggerArticleStructured;

        const articleForRaw = {
          title: leadlessParsed.title,
          summary: leadlessParsed.summary,
          lead: "",
          sections: leadlessParsed.sections.map((s) => ({
            paragraphs: s.paragraphs,
            heading: s.heading,
          })),
        };

        const postIntegrity = validatePostTransformIntegrity({
          title: articleForRaw.title,
          summary: articleForRaw.summary,
          sections: articleForRaw.sections,
        });
        if (!postIntegrity.ok) {
          priorFailureSignature = `POST_TRANSFORM_INTEGRITY_FAILED::${postIntegrity.findings
            .map((f) => f.code)
            .join(",")}`;
          planViolationFeedback = {
            attempt: generationAttempt,
            violatedSegments: ["body"],
            codes: ["POST_TRANSFORM_INTEGRITY_FAILED"],
            prematurelyConsumedContributionIds: [],
            missingRequiredContributionIds: [],
            forbiddenReusedContributionIds: [],
            failureClass: "STRUCTURAL_PLAN_FAILURE",
            failureSignature: priorFailureSignature,
            note: postIntegrity.findings.map((f) => f.message).join("; "),
          };
          rawPlanComplianceMeta = {
            attempt: generationAttempt,
            ok: false,
            planExecutionFailed: true,
            structuralDefect: true,
            findings: postIntegrity.findings.map((f) => ({
              code: f.code,
              message: f.message,
              severity: "BLOCKING" as const,
            })),
            violatedSegments: ["lead"],
            failureSignature: priorFailureSignature,
            postTransformIntegrity: postIntegrity,
          };
          rawFailureRoutingMeta = {
            action: "REGEN_WITH_FEEDBACK",
            failureClass: "STRUCTURAL_PLAN_FAILURE",
            allowTargetedRepair: false,
          };
          generationAttemptTraces.push(
            buildGenerationAttemptTrace({
              attempt: generationAttempt,
              article: articleForRaw,
              articlePlan,
              compliance: {
                findings: postIntegrity.findings.map((f) => ({
                  code: f.code,
                  message: f.message,
                  slot: "lead" as const,
                })),
              },
              regenInput: planViolationFeedback,
              regenOutputOrNextFeedback: planViolationFeedback,
            }),
          );
          if (generationAttempt >= MAX_PLAN_EXECUTION_ATTEMPTS) {
            throw new GenerationPreflightError(
              "plan_execution_failed",
              `PLAN_EXECUTION_FAILED after ${generationAttempt} attempts: POST_TRANSFORM_INTEGRITY_FAILED: ${postIntegrity.findings
                .map((f) => `${f.message}${f.evidence ? ` ::${f.evidence}` : ""}`)
                .join(" | ")
                .slice(0, 400)}`,
            );
          }
          continue;
        }
        publishValidation.integrityPass = postIntegrity.ok;

        const articlePlanCompliance = validateArticlePlanCompliance({
          article: articleForRaw,
          articlePlan,
        });
          publishValidation.articlePlanCompliancePass = articlePlanCompliance.ok;
          const routing = articlePlanCompliance.ok
            ? buildOptionBArticlePlanRouting()
            : routeArticlePlanFailure({
                result: articlePlanCompliance,
                insufficientDevelopmentMaterial:
                  brainGenerationContract.insufficientDevelopmentMaterial,
                scarcityMode: brainGenerationContract.scarcityMode,
                bodyOnlyRestatesLead: articlePlanCompliance.bodyOnlyRestatesLead,
              });
          rawFailureRoutingMeta = { ...routing };
          articlePlanComplianceMeta = buildArticlePlanComplianceMeta({
            attempt: generationAttempt,
            compliance: articlePlanCompliance,
            postIntegrity,
            routing,
          });
          rawPlanComplianceMeta = articlePlanComplianceMeta;

          const nextFeedback =
            !articlePlanCompliance.ok && generationAttempt < MAX_PLAN_EXECUTION_ATTEMPTS
              ? buildArticlePlanViolationFeedback(
                  generationAttempt,
                  articlePlanCompliance,
                  routing,
                  articlePlan,
                  {
                    title: articleForRaw.title,
                    lead: articleForRaw.lead,
                    body: articleForRaw.sections
                      .flatMap((s) => s.paragraphs)
                      .join("\n"),
                  },
                )
              : null;
          generationAttemptTraces.push(
            buildGenerationAttemptTrace({
              attempt: generationAttempt,
              article: articleForRaw,
              articlePlan,
              compliance: articlePlanCompliance,
              regenInput: planViolationFeedback,
              regenOutputOrNextFeedback: nextFeedback,
            }),
          );

          if (articlePlanComplianceAllowsPersist(true, articlePlanCompliance)) {
            if (referenceGuided.mappingPlan) {
              const refExec = validateReferenceExecution({
                article: {
                  title: articleForRaw.title,
                  lead: articleForRaw.lead,
                  summary: articleForRaw.summary,
                  sections: articleForRaw.sections,
                },
                mappingPlan: referenceGuided.mappingPlan,
              });
              articlePlanComplianceMeta = {
                ...articlePlanComplianceMeta,
                referenceExecution: { ...refExec, observeOnly: true },
              };
            }
            article = leadlessParsed;
            break;
          }

          if (generationAttempt >= MAX_PLAN_EXECUTION_ATTEMPTS) {
            try {
              const brainRepo = this.repo.createEditorialBrainRepository();
              await brainRepo.createExperience({
                scope: "CHANNEL",
                channel: "BLOG",
                formatKey: resolvedFormatKey ?? articleFormat,
                contentType: "blogger-article",
                structurePatternId: selectedStructurePattern?.patternId ?? null,
                editorialPatternId: selectedEditorialPattern?.patternId ?? null,
                failureCodes: [
                  "PLAN_EXECUTION_FAILED",
                  ...articlePlanCompliance.findings.map((f) => f.code),
                ],
                outcome: "PLAN_EXECUTION_FAILED",
                sourceType: "INITIAL_GENERATION",
                confidence: 0.55,
                sampleEvidence: 1,
                modelRunIds: [modelRun.id],
                lesson: {
                  note: "Generator failed ArticlePlan compliance",
                  structuralDefect: articlePlanCompliance.structuralDefect,
                  violatedSlots: articlePlanCompliance.violatedSlots,
                  codes: articlePlanCompliance.findings.map((f) => f.code),
                },
              });
            } catch {
              // Experience write is best-effort
            }
            await this.repo.completeModelRun(modelRun.id, {
              status: "FAILED",
              inputTokens: llm.inputTokens,
              outputTokens: llm.outputTokens,
              cachedTokens: llm.cachedTokens ?? 0,
              estimatedCost: llm.estimatedCost,
              actualCost: llm.actualCost ?? llm.estimatedCost,
              currency: llm.currency,
              structuredOutputValid: true,
              errorType: "PLAN_EXECUTION_FAILED",
              errorDetail: articlePlanCompliance.findings
                .map((f) => f.code)
                .join(",")
                .slice(0, 240),
              metadata: {
                finishReason: llm.finishReason,
                output: llm.output,
                llmCompleted: true,
                persistenceCompleted: false,
                generationAttempt,
                generationAttemptTraces,
                articlePlanCompliance: articlePlanComplianceMeta,
                planViolationFeedback,
                generationAuthority: finalGenerationAuthority,
                brainGenerationContract: brainGenerationPromptContract,
                retrievedExperienceIds,
                plannerFailureTendencies,
                userPrompt: finalUserPrompt.slice(0, 12000),
                stopReason: "PLAN_EXECUTION_FAILED",
                regenCandidate: true,
              },
            });
            throw new GenerationPreflightError(
              "plan_execution_failed",
              `PLAN_EXECUTION_FAILED after ${generationAttempt} attempts: ${articlePlanCompliance.findings
                .map((f) => f.code)
                .join(",")}`,
            );
          }

        planViolationFeedback = buildArticlePlanViolationFeedback(
          generationAttempt,
          articlePlanCompliance,
          routing,
          articlePlan,
          {
            title: articleForRaw.title,
            lead: articleForRaw.lead,
            body: articleForRaw.sections.flatMap((s) => s.paragraphs).join("\n"),
          },
        );
        continue;
      }

      if (!article || !llm) {
        throw new Error("blogger generation produced no article");
      }

      // Architecture simplify: no post-LLM prose mutation on OPTION B.
      // Defects are handled inside the Writer loop via VALIDATE → REGENERATE (bounded).
      // Legacy applyArticlePlanComplianceMutations / applyBaselineQualityRepair remain
      // in-repo for LEGACY_ONLY callers but are off the new generation path.
      articlePlanComplianceMutationMeta = {
        applied: false,
        mutated: false,
        proseMutationPolicy: "OPTION_B_NO_POST_LLM_PROSE_MUTATION",
        droppedSentences: 0,
        decisions: [],
      };
      if (articlePlanComplianceMeta) {
        articlePlanComplianceMeta = {
          ...articlePlanComplianceMeta,
          completionOnlyMutations: articlePlanComplianceMutationMeta,
        };
      }

      // Integrity already hard-gated Writer output inside the attempt loop.
      // Re-check here as final inspection only (no rewrite).
      const finalIntegrity = validatePostTransformIntegrity({
        title: article.title,
        summary: article.summary,
        sections: article.sections.map((s) => ({
          paragraphs: s.paragraphs,
          heading: s.heading,
        })),
      });
      publishValidation.integrityPass = finalIntegrity.ok;
      if (!finalIntegrity.ok) {
        throw new GenerationPreflightError(
          "plan_execution_failed",
          `PLAN_EXECUTION_FAILED: POST_TRANSFORM_INTEGRITY_FAILED after accepted Writer output: ${finalIntegrity.findings
            .map((f) => f.message)
            .join(" | ")
            .slice(0, 400)}`,
        );
      }
      assertSectionHeadingsAgainstStructurePattern(article, selectedStructurePattern);
      // Ensure final article object never carries a lead key on the new write path.
      article = stripArticleLeadKey(
        article as unknown as Record<string, unknown>,
      ) as unknown as BloggerArticleStructured;
      const rawOut = llm.output as Record<string, unknown>;
      const hasExplicitProvenance =
        Array.isArray(rawOut.titleClaimIds) ||
        Array.isArray(rawOut.leadClaimIds) ||
        Array.isArray(rawOut.summaryClaimIds) ||
        Array.isArray(rawOut.sectionClaimIds) ||
        (rawOut.provenance != null && typeof rawOut.provenance === "object");
      if (hasExplicitProvenance) {
        brainProvenance = normalizeArticleProvenance({
          titleClaimIds: Array.isArray(rawOut.titleClaimIds)
            ? (rawOut.titleClaimIds as string[])
            : undefined,
          leadClaimIds: Array.isArray(rawOut.leadClaimIds)
            ? (rawOut.leadClaimIds as string[])
            : undefined,
          summaryClaimIds: Array.isArray(rawOut.summaryClaimIds)
            ? (rawOut.summaryClaimIds as string[])
            : undefined,
          sectionClaimIds: Array.isArray(rawOut.sectionClaimIds)
            ? (rawOut.sectionClaimIds as string[][])
            : undefined,
          provenance:
            rawOut.provenance && typeof rawOut.provenance === "object"
              ? (rawOut.provenance as ArticleProvenance)
              : undefined,
          sectionCount: article.sections.length,
        });
      } else {
        const used = new Set(article.usedClaimIds);
        const allow = brainGenerationContract.roleAllowlist;
        brainProvenance = normalizeArticleProvenance({
          titleClaimIds: allow.titleAllowedClaimIds.filter((id) => used.has(id)),
          leadClaimIds: allow.leadAllowedClaimIds.filter((id) => used.has(id)),
          summaryClaimIds: allow.summaryAllowedClaimIds.filter((id) => used.has(id)),
          sectionClaimIds: article.sections.map(() =>
            allow.developmentAllowedClaimIds.filter((id) => used.has(id)),
          ),
          sectionCount: article.sections.length,
        });
      }
    } catch (error) {
      if (error instanceof GenerationPreflightError && error.code === "plan_execution_failed") {
        // Always finalize ModelRun — plan_execution_failed must not leave RUNNING forever
        await this.repo.completeModelRun(modelRun.id, {
          status: "FAILED",
          inputTokens: llm?.inputTokens,
          outputTokens: llm?.outputTokens,
          cachedTokens: llm?.cachedTokens ?? 0,
          estimatedCost: llm?.estimatedCost,
          actualCost: llm?.actualCost ?? llm?.estimatedCost,
          currency: llm?.currency,
          structuredOutputValid: Boolean(llm?.output),
          errorType: "plan_execution_failed",
          errorDetail: error.message.slice(0, 480),
          metadata: {
            finishReason: llm?.finishReason,
            output: llm?.output,
            llmCompleted: Boolean(llm),
            persistenceCompleted: false,
            generationAttempt,
            rawPlanCompliance: rawPlanComplianceMeta,
            rawFailureRouting: rawFailureRoutingMeta,
            generationAuthority: finalGenerationAuthority,
            planViolationFeedback,
          },
        });
        throw error;
      }
      const outputKeys =
        llm?.output && typeof llm.output === "object" ? Object.keys(llm.output) : [];
      await this.repo.completeModelRun(modelRun.id, {
        status: "FAILED",
        inputTokens: llm?.inputTokens,
        outputTokens: llm?.outputTokens,
        cachedTokens: llm?.cachedTokens ?? 0,
        estimatedCost: llm?.estimatedCost,
        actualCost: llm?.actualCost ?? llm?.estimatedCost,
        currency: llm?.currency,
        structuredOutputValid: false,
        errorType: "structured_output_schema_validation_failed",
        errorDetail: summarizeBloggerSchemaValidationError(error),
        metadata: {
          finishReason: llm?.finishReason,
          outputKeys,
          output: llm?.output,
          jsonParsed: llm?.metadata?.jsonParsed ?? true,
          responseFormat: llm?.metadata?.responseFormat ?? null,
          llmCompleted: Boolean(llm),
          persistenceCompleted: false,
          articleOutputContract,
          responseSchemaSections: getSectionsCardinalityFromLlmSchema(outputSchema),
          generationAttempt,
          generationAttemptTraces,
          rawPlanCompliance: rawPlanComplianceMeta,
        },
      });
      throw error;
    }

    // Attach RAW compliance + rendered prompt audit onto model run metadata (pre-persist)
    await this.repo
      .completeModelRun(modelRun.id, {
        status: "RUNNING",
        metadata: {
          generationAttempt,
          generationAttemptTraces,
          rawPlanCompliance: rawPlanComplianceMeta,
          planViolationFeedback,
          generationAuthority: finalGenerationAuthority,
          renderedUserPromptPreview: finalUserPrompt.slice(0, 8000),
          renderedSystemAuthority: finalSystemInstruction.slice(0, 1500),
        },
      })
      .catch(() => undefined);

    // Deterministic product images (URL reference only) — not from LLM.
    // Count = unique safe product images (not limited by article length).
    const imageResolution = await resolveArticleImagesForTopic(this.repo, input.topicId, {
      altBase: input.productTitle,
    });
    const articleImages = imageResolution.images;

    const body = structuredToPlainBody(article, { images: articleImages });
    const storedAllowlist = (
      brainGenerationPromptContract as { evidenceAllowlistIds?: string[] }
    ).evidenceAllowlistIds;
    const allowedEvidenceIds =
      Array.isArray(storedAllowlist) && storedAllowlist.length > 0
        ? storedAllowlist
        : ["title::full", ...Array.from({ length: 24 }, (_, i) => `title_facet::${i}`)];
    const attestedEvidenceSurfaces = attestedSurfacesFromArticlePlan(
      (finalGenerationAuthority?.ARTICLE_PLAN as
        | {
            title?: { facts?: string[] };
            lead?: { facts?: string[] };
            body?: Array<{ facts?: string[] }>;
          }
        | undefined) ??
        (articlePlan as
          | {
              title?: { facts?: string[] };
              lead?: { facts?: string[] };
              body?: Array<{ facts?: string[] }>;
            }
          | undefined),
    );
    const claimCheck = validateClaimsAgainstArticle({
      article,
      claims,
      bodyText: body,
      allowedEvidenceIds,
      attestedEvidenceSurfaces,
    });
    publishValidation.claimValidationPass = claimCheck.ok;
    if (!claimCheck.ok) {
      await this.repo.completeModelRun(modelRun.id, {
        status: "FAILED",
        inputTokens: llm.inputTokens,
        outputTokens: llm.outputTokens,
        cachedTokens: llm.cachedTokens ?? 0,
        estimatedCost: llm.estimatedCost,
        actualCost: llm.actualCost ?? llm.estimatedCost,
        currency: llm.currency,
        structuredOutputValid: true,
        errorType: "claim_validation_failed",
        errorDetail: claimCheck.findings.map((f) => f.code).join(",").slice(0, 240),
        metadata: {
          finishReason: llm.finishReason,
          output: llm.output,
          llmCompleted: true,
          structuredOutputValid: true,
          persistenceCompleted: false,
          rawPlanCompliance: rawPlanComplianceMeta,
          generationAttempt,
        },
      });
      throw new Error(`Claim validation failed: ${claimCheck.findings.map((f) => f.code).join(",")}`);
    }
    try {
      let content: Content;
      if (input.contentId) {
        content = (await this.repo.findContent(input.contentId))!;
        if (!content) {
          throw new Error(`Content not found: ${input.contentId}`);
        }
      } else {
        content = await this.repo.createContent({
          topicCandidateId: input.topicId,
          strategyId: input.strategyId,
          status: "GENERATING",
          primaryLanguage: "ja",
          contentPurpose: "blogger-article",
          monetizationStatus: input.ctaUrl ? "PENDING_AFFILIATE" : "UNMONETIZED",
        });
      }

      const latest = await this.repo.findLatestContentVersion(content.id);
      const versionNumber = (latest?.versionNumber ?? 0) + 1;
      const version = await this.repo.createContentVersion({
        contentId: content.id,
        versionNumber,
        parentVersionId: input.parentVersionId ?? latest?.id ?? null,
        revisionType: input.revisionType ?? "initial",
        title: article.title,
        summary: article.summary,
        body,
        structuredContent: {
          channel: "BLOGGER",
          article,
          brainProvenance,
          brainGenerationContract: brainGenerationPromptContract,
          images: articleImages,
          imageMeta: {
            productId: imageResolution.productId,
            externalIdsTried: imageResolution.externalIdsTried,
            researchImageCount: imageResolution.researchImageCount,
            pageImageCount: imageResolution.pageImageCount,
            displayMode: "url_reference",
          },
          imageLayout: selectedStructurePattern?.imageLayout ?? null,
          structurePatternId: selectedStructurePattern?.patternId ?? null,
          structurePattern: structurePatternContract,
          disclosure: true,
          seo: {
            title: article.seoTitle,
            metaDescription: article.metaDescription,
            labels: article.labels,
          },
        },
        status: "REVIEWING",
        createdBy: "llm-generation",
        modelRunId: modelRun.id,
      });

      for (const claimId of article.usedClaimIds) {
        // OPTION B: Evidence Pack ids (title_facet::*, page_atom::*, etc.) are provenance
        // refs — not Claim rows. Only attach real Claim FKs.
        if (allowedEvidenceIds?.includes(claimId)) continue;
        const exists = claims.some((c) => c.id === claimId);
        if (!exists) continue;
        await this.repo.attachVersionClaim({
          contentVersionId: version.id,
          claimId,
          usageType: "supporting",
          validationStatus: "validated",
        });
      }

      await this.repo.completeModelRun(modelRun.id, {
        status: "COMPLETED",
        inputTokens: llm.inputTokens,
        outputTokens: llm.outputTokens,
        cachedTokens: llm.cachedTokens ?? 0,
        estimatedCost: llm.estimatedCost,
        actualCost: llm.actualCost ?? llm.estimatedCost,
        currency: llm.currency,
        structuredOutputValid: true,
        metadata: {
          topicId: input.topicId,
          articleFormat,
          formatKey: resolvedFormatKey ?? articleFormat,
          formatId: resolvedFormatId,
          writingPolicyApplied,
          formatSpec: formatSpec ?? null,
          writingPolicy,
          structurePatternId: selectedStructurePattern?.patternId ?? null,
          structurePatternLabel: selectedStructurePattern?.label ?? null,
          editorialPatternId: selectedEditorialPattern?.patternId ?? null,
          editorialPatternLabel: selectedEditorialPattern?.label ?? null,
          editorialPattern: editorialPatternContract,
          articleOutputContract,
          responseSchemaSections: getSectionsCardinalityFromLlmSchema(outputSchema),
          claimUsagePlan: claimUsagePlanContract,
          brainGenerationContract: brainGenerationPromptContract,
          referenceGuided: referenceGuidedPrompt,
          referenceGuidedLayer: {
            enabled: referenceGuided.enabled,
            candidateCount: referenceGuided.candidateCount,
            blueprintReferenceId: referenceGuided.blueprint?.referenceId ?? null,
            extractionMode: referenceGuided.blueprint?.extractionMode ?? null,
            materialDepth: referenceGuided.blueprint?.materialDepth ?? null,
            productMaterialProfile: referenceGuided.productMaterialProfile,
            referenceType: referenceGuided.referenceType,
            transformReadiness: referenceGuided.transformReadiness,
            transformation: referenceGuided.transformation
              ? {
                  readiness: referenceGuided.transformation.readiness,
                  titleTransformation: referenceGuided.transformation.titleTransformation,
                  cutOffStrategy: referenceGuided.transformation.cutOffStrategy,
                  segmentOps: referenceGuided.transformation.segmentOps.map((s) => ({
                    segmentIndex: s.segmentIndex,
                    role: s.role,
                    factLexicalization: s.factLexicalization,
                    clausePackaging: s.clausePackaging,
                    transitionStrategy: s.transitionStrategy,
                  })),
                }
              : null,
            mappingPlan: referenceGuided.mappingPlan,
            segmentExecution: referenceGuided.segmentExecution,
            researchEvidence: referenceGuided.researchEvidence.map((e) => ({
              evidenceId: e.evidenceId,
              facetType: e.facetType,
              fact: e.observedFact.slice(0, 120),
              claimId: e.claimId,
            })),
          },
          claimSelection: {
            selectedClaimIds: claimSelection.selectedClaims.map((c) => c.id),
            openingClaimIds: claimSelection.openingClaimIds,
            deferredClaimIds: claimSelection.deferredClaimIds,
            hookClaimIds: claimUsagePlan.hookClaimIds,
            developmentClaimIds: claimUsagePlan.developmentClaimIds,
            omitCtaBridge: claimUsagePlan.omitCtaBridge,
          },
          brainProvenance,
          generationAttempt,
          generationAttemptTraces,
          rawPlanCompliance: rawPlanComplianceMeta,
          articlePlanCompliance: articlePlanComplianceMeta,
          articlePlanComplianceMutations: articlePlanComplianceMutationMeta,
          planViolationFeedback,
          generationAuthority: finalGenerationAuthority,
          retrievedExperienceIds,
          plannerFailureTendencies,
          renderedUserPromptPreview: finalUserPrompt.slice(0, 8000),
          finishReason: llm.finishReason,
          output: llm.output,
          jsonParsed: llm.metadata?.jsonParsed ?? true,
          responseFormat: llm.metadata?.responseFormat ?? null,
          llmCompleted: true,
          structuredOutputValid: true,
          persistenceCompleted: true,
          persistenceErrorType: null,
        },
      });

      // R117: full Brain observe / bounded Brain repair path remain removed.
      // Minimal deterministic OPTION B baseline hygiene (REPETITION/catalog/eval pad)
      // is applied above as a bounded TARGETED_REPAIR-equivalent — not a Brain revive.
      return {
        content,
        version,
        article,
        modelRunId: modelRun.id,
        publishValidation,
      };
    } catch (error) {
      // Do not clobber a COMPLETED Generator ModelRun when post-persist Brain repair fails.
      const alreadyPersisted = Boolean(llm);
      const existing = alreadyPersisted ? await this.repo.findModelRun(modelRun.id).catch(() => null) : null;
      if (existing?.status === "COMPLETED") {
        throw error;
      }
      const persistenceErrorType =
        error instanceof Error && /Foreign key constraint/i.test(error.message)
          ? "foreign_key_violation"
          : "persistence_failed";
      await this.repo.completeModelRun(modelRun.id, {
        status: "FAILED",
        inputTokens: llm?.inputTokens,
        outputTokens: llm?.outputTokens,
        cachedTokens: llm?.cachedTokens ?? 0,
        estimatedCost: llm?.estimatedCost,
        actualCost: llm?.actualCost ?? llm?.estimatedCost,
        currency: llm?.currency,
        structuredOutputValid: Boolean(llm?.output),
        errorType: "persistence_failed",
        errorDetail: `${persistenceErrorType}:${error instanceof Error ? error.name : "unknown"}`.slice(
          0,
          240,
        ),
        metadata: {
          finishReason: llm?.finishReason,
          output: llm?.output,
          jsonParsed: llm?.metadata?.jsonParsed ?? true,
          responseFormat: llm?.metadata?.responseFormat ?? null,
          llmCompleted: Boolean(llm),
          structuredOutputValid: Boolean(llm?.output),
          persistenceCompleted: false,
          persistenceErrorType,
        },
      });
      throw error;
    }
  }

  async generateXPost(input: GenerateXInput): Promise<{
    content: Content;
    version: ContentVersion;
    body: string;
    modelRunId: string;
  }> {
    const claims = input.claimIds?.length
      ? await this.repo.listClaimsByIds(input.claimIds)
      : await this.repo.listClaimsForStrategy(input.strategyId);
    const supported = claims.filter((c) => c.status === "SUPPORTED");
    const supportedIds = supported.map((c) => c.id);
    const claimStatements = supported.map((c) => ({ id: c.id, statement: c.statement }));

    const { buildCoreEditorialPlan } = await import("../editorial-brain/core/planner.js");
    const { buildXChannelPlan } = await import("../editorial-brain/channels/x/adapter.js");
    const {
      assessXEditorialMaterial,
      buildXGenerationPromptContract,
    } = await import("../editorial-brain/generation/x-generation-contract.js");

    const { classifyClaimKind } = await import("./select-claims-for-structure-pattern.js");
    const typedClaims = claimStatements.map((c) => ({
      ...c,
      kind: classifyClaimKind(c.statement),
    }));
    const concreteIds = typedClaims
      .filter((c) => !["maker", "availability", "temporal_sale"].includes(c.kind))
      .map((c) => c.id);
    const hookIds = (concreteIds.length ? concreteIds : supportedIds).slice(0, 1);
    const supportIds = (concreteIds.length ? concreteIds : supportedIds)
      .filter((id) => !hookIds.includes(id))
      .slice(0, 2);
    const corePlan = buildCoreEditorialPlan({
      channel: "X",
      formatKey: null,
      contentType: "x-post",
      availableClaims: typedClaims,
      selectedClaims: typedClaims.filter((c) => [...hookIds, ...supportIds].includes(c.id)),
      openingClaimIds: hookIds,
      hookClaimIds: hookIds,
      developmentClaimIds: supportIds,
      structurePatternId: null,
      editorialPatternId: null,
    });
    const channelPlan = buildXChannelPlan(corePlan);
    const specifics = channelPlan.specifics as import("../editorial-brain/channels/x/adapter.js").XChannelPlanSpecifics;
    const material = assessXEditorialMaterial({
      corePlan,
      claimStatements,
      specifics,
    });

    const content = input.contentId
      ? (await this.repo.findContent(input.contentId))!
      : await this.repo.createContent({
          topicCandidateId: input.topicId,
          strategyId: input.strategyId,
          status: "GENERATING",
          primaryLanguage: "ja",
          contentPurpose: "x-post",
          monetizationStatus: input.productUrl || input.bloggerUrl ? "PENDING_AFFILIATE" : "UNMONETIZED",
        });

    // Insufficient material → defer without inventing promotional copy (no LLM)
    if (!material.sufficient) {
      const modelRun = await this.repo.createModelRun({
        provider: this.llm.providerKey,
        model: this.models.generation,
        taskType: "GENERATION_X",
        promptIdentifier: "x.generate",
        promptVersion: "v1",
        status: "COMPLETED",
        inputRef: input.strategyId,
        metadata: { deferred: true, reason: material.reason },
      });
      const latest = await this.repo.findLatestContentVersion(content.id);
      const version = await this.repo.createContentVersion({
        contentId: content.id,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        parentVersionId: latest?.id ?? null,
        revisionType: "initial",
        title: `X: ${input.productTitle}`,
        summary: "DEFER_INSUFFICIENT_MATERIAL",
        body: "",
        structuredContent: {
          channel: "X",
          deferred: true,
          deferReason: material.reason,
          posts: [],
          xPost: { body: "", reply: null, usedClaimIds: [], ctaUrl: null },
        },
        status: "REVIEWING",
        createdBy: "brain-defer",
        modelRunId: modelRun.id,
      });
      // R117: no Brain observe / lifecycle stamp on defer path
      return { content, version, body: "", modelRunId: modelRun.id };
    }

    await this.budget.assertCanSpend(1);
    const prompt = await this.prompts.getPrompt("x.generate", "v1");
    const xContract = buildXGenerationPromptContract({
      productTitle: input.productTitle,
      productUrl: input.productUrl,
      bloggerUrl: input.bloggerUrl,
      corePlan,
      specifics,
      claimStatements,
      material,
    });
    const rendered = this.prompts.render(prompt, {
      productTitle: input.productTitle,
      bloggerUrl: input.bloggerUrl ?? "",
      productUrl: input.productUrl ?? "",
    });
    const systemInstruction = [
      rendered.systemInstruction,
      "You write short editorial X posts from SUPPORTED claims only.",
      "Do not write ad copy. Do not invent evaluation, recommendation, or urgency.",
      "Hook = concrete supported fact. Support = different supported fact. CTA = URL only when provided.",
      "Return JSON {body, reply, usedClaimIds, ctaUrl}.",
    ].join("\n");
    const userPrompt = [
      rendered.userPrompt,
      "",
      "xEditorialContract:",
      JSON.stringify(xContract, null, 2),
    ].join("\n");

    const modelRun = await this.repo.createModelRun({
      provider: this.llm.providerKey,
      model: this.models.generation,
      taskType: "GENERATION_X",
      promptIdentifier: prompt.identifier,
      promptVersion: prompt.version,
      status: "RUNNING",
      inputRef: input.strategyId,
      metadata: { xEditorialContract: xContract },
    });

    const llm = await this.llm.executeTask({
      taskType: "GENERATION_X",
      promptIdentifier: prompt.identifier,
      promptVersion: prompt.version,
      systemInstruction,
      userPrompt,
      model: this.models.generation,
      input: {
        productTitle: input.productTitle,
        bloggerUrl: input.bloggerUrl ?? null,
        productUrl: input.productUrl ?? null,
        supportedClaimIds: supportedIds,
        xEditorialContract: xContract,
      },
    });

    await this.repo.completeModelRun(modelRun.id, {
      status: "COMPLETED",
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      estimatedCost: llm.estimatedCost,
      actualCost: llm.actualCost ?? llm.estimatedCost,
      currency: llm.currency,
      structuredOutputValid: true,
      metadata: { output: llm.output, xEditorialContract: xContract },
    });
    await this.repo.createCostRecord({
      provider: llm.provider,
      serviceOrModel: llm.model,
      operationType: "GENERATION_X",
      relatedType: "ContentStrategy",
      relatedId: input.strategyId,
      modelRunId: modelRun.id,
      estimatedAmount: llm.estimatedCost,
      actualAmount: llm.actualCost ?? llm.estimatedCost,
      currency: llm.currency,
    });

    const parsed = parseXPost(llm.output);
    if (parsed.reply && /続きはこちら/.test(parsed.reply) && parsed.reply.length < 20) {
      throw new Error("Low-value reply-only X content is forbidden");
    }
    const { hasPromotionalEvalSurface } = await import(
      "../editorial-brain/generation/claim-eval-support.js"
    );
    const { detectSourceTitleRestatement, allocateXFacetContributions } = await import(
      "../editorial-brain/generation/contribution-compliance.js"
    );
    let xBody = parsed.body.trim();
    const restatement = detectSourceTitleRestatement({
      body: xBody,
      sourceStatements: claimStatements.map((c) => c.statement),
    });
    const facetAlloc = allocateXFacetContributions({
      claimStatements,
      hookClaimIds: material.hookClaimIds,
      supportClaimIds: material.supportClaimIds,
    });
    if (restatement.hit || hasPromotionalEvalSurface(xBody) || material.hookFacets.length > 0) {
      if (restatement.hit || hasPromotionalEvalSurface(xBody)) {
        xBody = compactFacetsToXPost({
          hookFacets: facetAlloc.hookContributions.map((c) => c.facet),
          supportFacets: facetAlloc.supportContributions.map((c) => c.facet),
          url: null,
        });
      }
    }
    parsed.body = xBody;
    const max = input.maxWeightedLength ?? 140;
    try {
      this.xCounter.assertWithinLimit(parsed.body, max);
    } catch {
      parsed.body = compactFacetsToXPost({
        hookFacets: facetAlloc.hookContributions.map((c) => c.facet),
        supportFacets: facetAlloc.supportContributions.map((c) => c.facet),
        url: null,
      }).slice(0, 120);
      this.xCounter.assertWithinLimit(parsed.body, max);
    }

    const latest = await this.repo.findLatestContentVersion(content.id);
    const version = await this.repo.createContentVersion({
      contentId: content.id,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      parentVersionId: latest?.id ?? null,
      revisionType: "initial",
      title: `X: ${input.productTitle}`,
      summary: "LLM X post",
      body: parsed.body,
      structuredContent: {
        channel: "X",
        xPost: parsed,
        posts: [
          {
            order: 1,
            text: parsed.body,
            claimIdsUsed: parsed.usedClaimIds ?? material.hookClaimIds,
            function: "hook",
          },
        ],
        xEditorialContract: xContract,
        weightedLength: this.xCounter.count(parsed.body).weightedLength,
      },
      status: "REVIEWING",
      createdBy: "llm-generation",
      modelRunId: modelRun.id,
    });

    // R117: no Brain observe / lifecycle stamp on X generation path
    return { content, version, body: parsed.body, modelRunId: modelRun.id };
  }

  async runQualityReviews(
    contentVersionId: string,
    options?: {
      allowedReviewTypes?: string[];
      skipSemanticEditorialLlm?: boolean;
      skipSemanticDeterministicExtras?: boolean;
    },
  ): Promise<{
    overall: "passed" | "warning" | "failed" | "manual_review_required";
    reviews: QualityReviewRecord[];
    reusedCount: number;
    newLlmReviewCount: number;
    skippedSemanticLlmTypes: string[];
  }> {
    const version = await this.repo.findContentVersion(contentVersionId);
    if (!version) throw new Error(`ContentVersion not found: ${contentVersionId}`);

    const rules = await this.repo.listEnabledPolicies();
    const policy = evaluatePolicies(rules, {
      targetType: "ContentVersion",
      targetId: version.id,
      title: version.title,
      body: version.body,
      language: "ja",
      adultFlag: true,
      disclosurePresent: /アフィリエイト/.test(version.body),
    });
    for (const evaluation of policy.evaluations) {
      await this.repo.createPolicyEvaluation({
        policyRuleId: evaluation.rule.id,
        targetType: "ContentVersion",
        targetId: version.id,
        result: evaluation.matched ? evaluation.result : "PASSED",
        message: evaluation.message,
        details: evaluation.details ?? null,
      });
    }

    const reviews: QualityReviewRecord[] = [];
    const allReviewTypes = [
      "claim-consistency",
      "factual-consistency",
      "writing-quality",
      "seo-basic",
      "adult-policy",
      "blogger-readiness",
    ] as const;
    const semanticTypes = new Set([
      "claim-consistency",
      "factual-consistency",
      "writing-quality",
    ]);
    const allowed = options?.allowedReviewTypes
      ? new Set(options.allowedReviewTypes)
      : null;
    const skippedSemanticLlmTypes: string[] = [];
    const reviewTypes = allReviewTypes.filter((t) => {
      if (options?.skipSemanticEditorialLlm && semanticTypes.has(t)) {
        skippedSemanticLlmTypes.push(t);
        return false;
      }
      if (allowed && !allowed.has(t)) {
        if (semanticTypes.has(t)) skippedSemanticLlmTypes.push(t);
        return false;
      }
      return true;
    });

    const bodyFingerprint = createBodyFingerprint(version.title, version.body);
    const existing = await this.repo.listReviewsForContentVersion(version.id);
    let reusedCount = 0;
    let newLlmReviewCount = 0;

    let overall: "passed" | "warning" | "failed" | "manual_review_required" = "passed";
    for (const reviewType of reviewTypes) {
      const promptId =
        reviewType === "claim-consistency"
          ? "review.claim"
          : reviewType === "factual-consistency"
            ? "review.factual"
            : reviewType === "seo-basic"
              ? "review.seo"
              : reviewType === "adult-policy"
                ? "review.adult-policy"
                : reviewType === "blogger-readiness"
                  ? "review.channel-fit"
                  : "review.writing-quality";

      const prompt = await this.prompts.getPrompt(promptId, "v1");
      const reusable = existing.find((r) => {
        if (r.reviewType !== reviewType || r.reviewerType !== "llm") return false;
        const criteria = (r.criteria ?? {}) as Record<string, unknown>;
        return (
          criteria.promptVersion === prompt.version &&
          criteria.bodyFingerprint === bodyFingerprint &&
          r.status === "completed"
        );
      });
      if (reusable) {
        reviews.push(reusable);
        reusedCount += 1;
        overall = mergeReviewOverall(overall, reusable.result);
        continue;
      }

      const rendered = this.prompts.render(prompt, {
        title: version.title,
        body: version.body,
      });
      await this.budget.assertCanSpend(0.5);

      const modelRun = await this.repo.createModelRun({
        provider: this.llm.providerKey,
        model: this.models.review,
        taskType: "REVIEW",
        promptIdentifier: prompt.identifier,
        promptVersion: prompt.version,
        status: "RUNNING",
        inputRef: version.id,
      });

      const llm = await this.llm.executeTask({
        taskType: "REVIEW",
        promptIdentifier: prompt.identifier,
        promptVersion: prompt.version,
        systemInstruction: rendered.systemInstruction,
        userPrompt: rendered.userPrompt,
        model: this.models.review,
        input: { title: version.title, body: version.body, reviewType },
      });

      await this.repo.completeModelRun(modelRun.id, {
        status: "COMPLETED",
        inputTokens: llm.inputTokens,
        outputTokens: llm.outputTokens,
        estimatedCost: llm.estimatedCost,
        actualCost: llm.actualCost ?? llm.estimatedCost,
        currency: llm.currency,
        structuredOutputValid: true,
        metadata: { output: llm.output },
      });
      await this.repo.createCostRecord({
        provider: llm.provider,
        serviceOrModel: llm.model,
        operationType: "REVIEW",
        relatedType: "ContentVersion",
        relatedId: version.id,
        modelRunId: modelRun.id,
        estimatedAmount: llm.estimatedCost,
        actualAmount: llm.actualCost ?? llm.estimatedCost,
        currency: llm.currency,
      });

      const resultRaw = String(llm.output.result ?? "passed").toUpperCase();
      const mapped =
        resultRaw === "FAILED"
          ? "FAILED"
          : resultRaw === "WARNING"
            ? "WARNING"
            : resultRaw === "MANUAL_REVIEW_REQUIRED"
              ? "MANUAL_REVIEW_REQUIRED"
              : "PASSED";

      const review = await this.repo.createReview({
        reviewType,
        reviewerType: "llm",
        targetType: "ContentVersion",
        targetId: version.id,
        contentVersionId: version.id,
        criteria: {
          reviewType,
          promptIdentifier: prompt.identifier,
          promptVersion: prompt.version,
          bodyFingerprint,
        },
        result: mapped,
        score: typeof llm.output.score === "number" ? llm.output.score : null,
        findings: Array.isArray(llm.output.findings) ? llm.output.findings : [],
        requiredActions: Array.isArray(llm.output.requiredActions)
          ? llm.output.requiredActions
          : [],
        modelRunId: modelRun.id,
      });
      reviews.push(review);
      newLlmReviewCount += 1;
      overall = mergeReviewOverall(overall, mapped);
    }

    // Deterministic writing-quality / intro — skip when ACTIVE Brain owns semantic
    if (!options?.skipSemanticDeterministicExtras) {
      const { evaluateIntroQuality } = await import("./intro-quality.js");
      const intro = evaluateIntroQuality({
        title: version.title,
        body: version.body,
        lead: version.summary,
      });
      const existingIntro = existing.find(
        (r) =>
          r.reviewType === "intro-quality-deterministic" &&
          (r.criteria as Record<string, unknown> | null)?.bodyFingerprint === bodyFingerprint,
      );
      if (!intro.ok) {
        if (existingIntro) {
          reviews.push(existingIntro);
          reusedCount += 1;
        } else {
          const review = await this.repo.createReview({
            reviewType: "intro-quality-deterministic",
            reviewerType: "system",
            targetType: "ContentVersion",
            targetId: version.id,
            contentVersionId: version.id,
            criteria: { bodyFingerprint },
            result: "WARNING",
            findings: intro.findings,
            requiredActions: ["partial_revision"],
          });
          reviews.push(review);
        }
        if (overall === "passed") overall = "warning";
      }

      const aiPhrases = [/と言えるでしょう/g, /いかがでしょうか/g];
      for (const pattern of aiPhrases) {
        const matches = version.body.match(pattern);
        if (matches && matches.length >= 2) {
          const review = await this.repo.createReview({
            reviewType: "writing-quality-deterministic",
            reviewerType: "system",
            targetType: "ContentVersion",
            targetId: version.id,
            contentVersionId: version.id,
            criteria: { pattern: String(pattern), bodyFingerprint },
            result: "WARNING",
            findings: [
              {
                code: "REPETITIVE_AI_PHRASE",
                message: `Repeated phrase detected: ${String(pattern)}`,
              },
            ],
            requiredActions: ["partial_revision"],
          });
          reviews.push(review);
          if (overall === "passed") overall = "warning";
        }
      }
    }

    if (policy.overall === "BLOCKED") overall = "failed";
    else if (policy.overall === "WARNING" && overall === "passed") overall = "warning";

    // Human approval remains required: never auto-APPROVE on review pass.
    await this.repo.updateContentVersionStatus(
      version.id,
      overall === "failed" ? "REVISION_REQUIRED" : "REVIEWING",
    );

    return {
      overall,
      reviews,
      reusedCount,
      newLlmReviewCount,
      skippedSemanticLlmTypes: [...new Set(skippedSemanticLlmTypes)],
    };
  }

  async reviseContentVersion(input: {
    contentVersionId: string;
    mode: "partial_revision" | "full_regeneration";
    rationale: string;
    productTitle: string;
    ctaUrl?: string | null;
  }): Promise<{ version: ContentVersion; modelRunId: string }> {
    const source = await this.repo.findContentVersion(input.contentVersionId);
    if (!source) throw new Error(`ContentVersion not found: ${input.contentVersionId}`);
    const content = await this.repo.findContent(source.contentId);
    if (!content?.strategyId || !content.topicCandidateId) {
      throw new Error("Content missing strategy/topic for revision");
    }

    if (input.mode === "full_regeneration") {
      const regenerated = await this.generateBloggerArticle({
        topicId: content.topicCandidateId,
        strategyId: content.strategyId,
        contentId: content.id,
        productTitle: input.productTitle,
        ctaUrl: input.ctaUrl,
        parentVersionId: source.id,
        revisionType: "full_regeneration",
      });
      await this.repo.createRevisionAction({
        actionType: "full_regeneration",
        rationale: input.rationale,
        needsFullRegenerate: true,
        changeScope: "full",
      });
      return { version: regenerated.version, modelRunId: regenerated.modelRunId };
    }

    await this.budget.assertCanSpend(1);
    const prompt = await this.prompts.getPrompt("revision.partial", "v1");
    const rendered = this.prompts.render(prompt, {
      title: source.title,
      body: source.body,
      rationale: input.rationale,
    });
    const modelRun = await this.repo.createModelRun({
      provider: this.llm.providerKey,
      model: this.models.revision,
      taskType: "REVISION",
      promptIdentifier: prompt.identifier,
      promptVersion: prompt.version,
      status: "RUNNING",
      inputRef: source.id,
    });
    const llm = await this.llm.executeTask({
      taskType: "REVISION",
      promptIdentifier: prompt.identifier,
      promptVersion: prompt.version,
      systemInstruction: rendered.systemInstruction,
      userPrompt: rendered.userPrompt,
      model: this.models.revision,
      input: {
        title: source.title,
        body: source.body,
        productTitle: input.productTitle,
        ctaUrl: input.ctaUrl ?? null,
        rationale: input.rationale,
      },
    });
    await this.repo.completeModelRun(modelRun.id, {
      status: "COMPLETED",
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      estimatedCost: llm.estimatedCost,
      actualCost: llm.actualCost ?? llm.estimatedCost,
      currency: llm.currency,
      structuredOutputValid: true,
      metadata: { output: llm.output },
    });
    await this.repo.createCostRecord({
      provider: llm.provider,
      serviceOrModel: llm.model,
      operationType: "REVISION",
      relatedType: "ContentVersion",
      relatedId: source.id,
      modelRunId: modelRun.id,
      estimatedAmount: llm.estimatedCost,
      actualAmount: llm.actualCost ?? llm.estimatedCost,
      currency: llm.currency,
    });

    const article = parseBloggerArticle(llm.output);
    const sourceStructured = (source.structuredContent ?? {}) as Record<string, unknown>;
    const priorImages = Array.isArray(sourceStructured.images) ? sourceStructured.images : [];
    const body = structuredToPlainBody(article, {
      images: priorImages as Array<{ role: string; sourceUrl: string; alt?: string }>,
    });
    const latest = await this.repo.findLatestContentVersion(source.contentId);
    const version = await this.repo.createContentVersion({
      contentId: source.contentId,
      versionNumber: (latest?.versionNumber ?? source.versionNumber) + 1,
      parentVersionId: source.id,
      revisionType: "partial_revision",
      title: article.title,
      summary: article.summary,
      body,
      structuredContent: {
        channel: "BLOGGER",
        article,
        images: priorImages,
        imageMeta: sourceStructured.imageMeta ?? null,
        disclosure: true,
      },
      status: "REVIEWING",
      createdBy: "llm-revision",
      modelRunId: modelRun.id,
    });
    await this.repo.createRevisionAction({
      actionType: "partial_revision",
      rationale: input.rationale,
      changeScope: "partial",
      improvementDelta: 0.1,
    });
    return { version, modelRunId: modelRun.id };
  }

  /** Load official pageEvidence from SourceDocument when product CTA URL is known. */
  private async loadOfficialPageEvidenceMeta(
    ctaUrl: string | null | undefined,
  ): Promise<import("../article-pattern/official-page-evidence-atoms.js").PageEvidenceMetaShape | null> {
    if (!ctaUrl?.trim()) return null;
    const m = ctaUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
    const frag = m?.[1] ?? ctaUrl.trim();
    const doc = await this.repo.findLatestSourceDocumentByUrlContains(frag);
    if (!doc?.metadata || typeof doc.metadata !== "object" || Array.isArray(doc.metadata)) {
      return null;
    }
    const pe = (doc.metadata as Record<string, unknown>).pageEvidence;
    if (!pe || typeof pe !== "object" || Array.isArray(pe)) return null;
    return pe as import("../article-pattern/official-page-evidence-atoms.js").PageEvidenceMetaShape;
  }
}

export { BudgetBlockedError };

function compactFacetsToXPost(input: {
  hookFacets: string[];
  supportFacets: string[];
  url: string | null;
}): string {
  const hook = input.hookFacets.filter(Boolean).slice(0, 2);
  const support = input.supportFacets.filter(Boolean).slice(0, 1);
  let t =
    hook.length === 0
      ? ""
      : support.length > 0
        ? `${hook.join("、")}。${support[0]}。`
        : `${hook.join("、")}。`;
  if (!t) t = "公開事実を確認。";
  if (input.url) t = `${t} ${input.url}`;
  return t;
}

function createBodyFingerprint(title: string, body: string): string {
  return createHash("sha256").update(`${title}\n${body}`).digest("hex");
}

function mergeReviewOverall(
  current: "passed" | "warning" | "failed" | "manual_review_required",
  result: ReviewResult | string,
): "passed" | "warning" | "failed" | "manual_review_required" {
  if (result === "FAILED") return "failed";
  if (result === "MANUAL_REVIEW_REQUIRED" && current !== "failed") return "manual_review_required";
  if (result === "WARNING" && current === "passed") return "warning";
  return current;
}
