/**
 * Shadow observation orchestration — records BrainRun + Experience without production authority.
 */

import { EditorialBrainRepository } from "@ai-affiliate/database";
import { blogChannelModule } from "../channels/blog/adapter.js";
import { xChannelModule } from "../channels/x/adapter.js";
import { registerChannelModule, getChannelModule } from "../core/channel-module.js";
import { resolveEditorialBrainMode } from "../core/mode.js";
import { buildCoreEditorialPlan, type PlannerClaimInput } from "../core/planner.js";
import { retrieveExperiences } from "../core/retrieval.js";
import type {
  BrainDecision,
  ChannelEditorialPlan,
  CoreEditorialPlan,
  EditorialBrainRunTrace,
  EditorialChannelId,
  EditorialReviewReport,
} from "../core/types.js";
import { reviewArtifactShadow, type ReviewableArtifact } from "./reviewer.js";

let modulesRegistered = false;

export function ensureChannelModulesRegistered(): void {
  if (modulesRegistered) return;
  registerChannelModule(blogChannelModule);
  registerChannelModule(xChannelModule);
  modulesRegistered = true;
}

export type ShadowObserveInput = {
  channel: EditorialChannelId;
  topicId?: string | null;
  strategyId?: string | null;
  contentId?: string | null;
  contentVersionId?: string | null;
  formatKey?: string | null;
  contentType: string;
  structurePatternId?: string | null;
  editorialPatternId?: string | null;
  availableClaims: PlannerClaimInput[];
  selectedClaims: PlannerClaimInput[];
  deferredClaimIds?: string[];
  openingClaimIds: string[];
  hookClaimIds: string[];
  developmentClaimIds: string[];
  softLengthGuidance?: {
    targetMaxCharsApprox: number;
    targetMaxParagraphs: number;
  } | null;
  generatorModelRunIds: string[];
  validatorResults?: unknown;
  legacyDecision: string;
  artifact: ReviewableArtifact;
  claimStatements: Array<{ id: string; statement: string }>;
  /** OPTION B natural FANZA product intro Brain priorities */
  optionBNaturalIntro?: boolean;
  /** Writer-visible source texts (officialDescription) for Brain entailment. */
  sourceTexts?: string[];
};

export type ShadowObserveResult = {
  trace: EditorialBrainRunTrace;
  corePlan: CoreEditorialPlan;
  channelPlan: ChannelEditorialPlan;
  review: EditorialReviewReport;
};

export class EditorialBrainShadowService {
  constructor(private readonly repo: EditorialBrainRepository) {
    ensureChannelModulesRegistered();
  }

  async observeGeneration(input: ShadowObserveInput): Promise<ShadowObserveResult> {
    const claimProfileProbe = buildCoreEditorialPlan({
      channel: input.channel,
      formatKey: input.formatKey ?? null,
      contentType: input.contentType,
      availableClaims: input.availableClaims,
      selectedClaims: input.selectedClaims,
      deferredClaimIds: input.deferredClaimIds,
      openingClaimIds: input.openingClaimIds,
      hookClaimIds: input.hookClaimIds,
      developmentClaimIds: input.developmentClaimIds,
      structurePatternId: input.structurePatternId ?? null,
      editorialPatternId: input.editorialPatternId ?? null,
      softLengthGuidance: input.softLengthGuidance,
    });

    const retrieval = await retrieveExperiences(this.repo, {
      channel: input.channel,
      formatKey: input.formatKey ?? null,
      contentType: input.contentType,
      claimProfile: claimProfileProbe.claimProfile,
      structurePatternId: input.structurePatternId ?? null,
      editorialPatternId: input.editorialPatternId ?? null,
      limit: 8,
    });

    const corePlan = buildCoreEditorialPlan({
      channel: input.channel,
      formatKey: input.formatKey ?? null,
      contentType: input.contentType,
      availableClaims: input.availableClaims,
      selectedClaims: input.selectedClaims,
      deferredClaimIds: input.deferredClaimIds,
      openingClaimIds: input.openingClaimIds,
      hookClaimIds: input.hookClaimIds,
      developmentClaimIds: input.developmentClaimIds,
      structurePatternId: input.structurePatternId ?? null,
      editorialPatternId: input.editorialPatternId ?? null,
      retrievedExperienceIds: retrieval.hits.map((h) => h.id),
      softLengthGuidance: input.softLengthGuidance,
    });

    const channelPlan = getChannelModule(input.channel).buildChannelPlan(corePlan);
    const review = reviewArtifactShadow({
      artifact: input.artifact,
      corePlan,
      claimStatements: input.claimStatements,
      optionBNaturalIntro: input.optionBNaturalIntro === true,
      sourceTexts: input.sourceTexts,
    });

    const brainShadowDecision: BrainDecision = review.decision;
    const mode = resolveEditorialBrainMode();
    // SHADOW: legacy remains authority for ops clarity. ACTIVE: Brain is production authority.
    const finalDecision =
      mode === "ACTIVE"
        ? `BRAIN_ACTIVE:${brainShadowDecision}`
        : `LEGACY:${input.legacyDecision}|BRAIN_SHADOW:${brainShadowDecision}`;

    const assertionSnapshot = {
      ...review.metrics.assertionSupportStats,
      inferenceClasses: {
        nameDerived: review.metrics.assertionSupportStats.nameDerivedCount,
        interpretive: review.metrics.assertionSupportStats.interpretiveCount,
        evaluative: review.metrics.assertionSupportStats.evaluativeCount,
        socialProof: review.metrics.assertionSupportStats.socialProofCount,
        unsupported: review.metrics.assertionSupportStats.unsupportedAssertionCount,
      },
      failingAssertionSamples: (review.semanticAssertions ?? [])
        .filter((a) => a.failureCodes.length > 0)
        .slice(0, 12)
        .map((a) => ({
          supportType: a.supportType,
          sourceSegment: a.sourceSegment,
          failureCodes: a.failureCodes,
          assertionPreview: a.assertion.slice(0, 160),
        })),
    };

    // Persist compact review in BrainRun (full assertions capped)
    const reviewForPersist = {
      ...review,
      semanticAssertions: (review.semanticAssertions ?? []).slice(0, 40),
    };

    const run = await this.repo.createBrainRun({
      channel: input.channel,
      mode,
      status: "RUNNING",
      topicId: input.topicId ?? null,
      strategyId: input.strategyId ?? null,
      contentId: input.contentId ?? null,
      contentVersionId: input.contentVersionId ?? null,
      formatKey: input.formatKey ?? null,
      contentType: input.contentType,
      structurePatternId: input.structurePatternId ?? null,
      editorialPatternId: input.editorialPatternId ?? null,
      claimProfile: corePlan.claimProfile,
      selectedClaimIds: corePlan.selectedClaimIds,
      retrievedExperienceIds: corePlan.retrievedExperienceIds,
      corePlan,
      channelPlan,
      generatorModelRunIds: input.generatorModelRunIds,
      validatorResults: input.validatorResults ?? null,
      reviewResult: reviewForPersist,
      repairAttempts: [],
      brainDecision: brainShadowDecision,
      legacyDecision: input.legacyDecision,
      finalDecision,
      failureCodes: review.failures.map((f) => f.code),
      metadata: {
        retrievalHitCount: retrieval.hits.length,
        lengthWasNotSoleJudge: true,
        assertionSnapshot,
        mode,
        initialModelRunId: input.generatorModelRunIds[0] ?? null,
      },
    });

    await this.repo.completeBrainRun(run.id, {
      status: "COMPLETED",
      contentId: input.contentId ?? null,
      contentVersionId: input.contentVersionId ?? null,
      brainDecision: brainShadowDecision,
      legacyDecision: input.legacyDecision,
      finalDecision,
      reviewResult: reviewForPersist,
      failureCodes: review.failures.map((f) => f.code),
      metadata: {
        retrievalHitCount: retrieval.hits.length,
        lengthWasNotSoleJudge: true,
        assertionSnapshot,
      },
    });

    // Append-only experiences (CHANNEL + optional CORE signal). Never touches LearningRule.
    await this.repo.createExperience({
      scope: "CHANNEL",
      channel: input.channel,
      formatKey: input.formatKey ?? null,
      contentType: input.contentType,
      claimProfile: corePlan.claimProfile,
      structurePatternId: input.structurePatternId ?? null,
      editorialPatternId: input.editorialPatternId ?? null,
      planSummary: {
        selectedClaimIds: corePlan.selectedClaimIds,
        informationGainTarget: corePlan.informationGainTarget,
        scarcityMode: corePlan.scarcityMode,
        developmentDepth: corePlan.developmentDepth,
      },
      validatorSummary: input.validatorResults ?? null,
      reviewSummary: {
        decision: review.decision,
        mode,
        metrics: {
          supportedNovelAssertionCount: review.metrics.supportedNovelAssertionCount,
          unsupportedAssertionCount: review.metrics.unsupportedAssertionCount,
          semanticRepetitionHits: review.metrics.semanticRepetitionHits,
          fillerHits: review.metrics.fillerHits,
          bodyUnits: review.metrics.bodyUnits,
          assertionSupportStats: review.metrics.assertionSupportStats,
        },
        failureCodes: review.failures.map((f) => f.code),
        assertionSnapshot,
      },
      failureCodes: review.failures.map((f) => f.code),
      outcome: mode === "ACTIVE" ? `ACTIVE_INITIAL:${brainShadowDecision}` : brainShadowDecision,
      sourceType: "INITIAL_GENERATION",
      confidence: brainShadowDecision === "PASS" ? 0.45 : 0.35,
      sampleEvidence: 1,
      brainRunId: run.id,
      contentVersionId: input.contentVersionId ?? null,
      modelRunIds: input.generatorModelRunIds,
      lesson: null, // no product-specific global lesson
    });

    const groundingCodes = new Set([
      "GROUNDING",
      "UNSUPPORTED_INFERENCE",
      "NAME_DERIVED_INFERENCE",
      "INTERPRETIVE_INFERENCE",
      "EVALUATIVE_INFERENCE",
    ]);
    if (review.failures.some((f) => groundingCodes.has(f.code))) {
      await this.repo.createExperience({
        scope: "CORE",
        channel: input.channel,
        formatKey: input.formatKey ?? null,
        contentType: input.contentType,
        claimProfile: corePlan.claimProfile,
        planSummary: { inferencePolicy: corePlan.inferencePolicy },
        reviewSummary: {
          failureCodes: review.failures.map((f) => f.code),
          assertionSnapshot,
        },
        failureCodes: review.failures.map((f) => f.code),
        outcome: brainShadowDecision,
        sourceType: "BRAIN_REVIEW",
        confidence: 0.3,
        sampleEvidence: 1,
        brainRunId: run.id,
        contentVersionId: input.contentVersionId ?? null,
        modelRunIds: input.generatorModelRunIds,
      });
    }

    const trace: EditorialBrainRunTrace = {
      brainRunId: run.id,
      channel: input.channel,
      mode: "SHADOW",
      corePlan,
      channelPlan,
      retrievedExperienceIds: corePlan.retrievedExperienceIds,
      review,
      legacyDecision: input.legacyDecision,
      brainShadowDecision,
      generatorModelRunIds: input.generatorModelRunIds,
      contentVersionId: input.contentVersionId ?? null,
      contentId: input.contentId ?? null,
    };

    return { trace, corePlan, channelPlan, review };
  }
}
