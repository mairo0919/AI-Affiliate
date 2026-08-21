/**
 * Brain-guided BLOG generation + bounded targeted repair.
 * Respects EDITORIAL_BRAIN_MODE (default SHADOW). ACTIVE stamps production authority
 * onto ContentVersion.structuredContent.brainLifecycle — never auto-approves/publishes.
 *
 * Loop: Plan → Generate → Brain Review → targeted repair (max 1) → re-review → stop.
 * Never publishes / auto-approves / mutates LearningRules / unlimited regen.
 */

import type { Content, ContentVersion, LifecycleRepository } from "@ai-affiliate/database";
import type { LLMProvider } from "../../adapters/types.js";
import {
  parseBloggerArticle,
  structuredToPlainBody,
  type BloggerArticleStructured,
} from "../../generation/structured-article.js";
import { blogChannelModule, buildBlogChannelPlan } from "../channels/blog/adapter.js";
import { applyBrainProductionAuthority } from "../core/production-authority.js";
import { persistBrainLifecycleOnVersion } from "../core/persist-lifecycle.js";
import { resolveEditorialBrainMode } from "../core/mode.js";
import { buildCoreEditorialPlan, type PlannerClaimInput } from "../core/planner.js";
import type { BrainDecision, EditorialReviewReport } from "../core/types.js";
import { reviewArtifactShadow } from "../shadow/reviewer.js";
import { detectBadInputClaims } from "./bad-claim-input.js";
import {
  buildBrainGenerationInputContract,
  type BrainGenerationInputContract,
  type ClaimStatementRef,
} from "./generation-input-contract.js";
import type { ArticleProvenance } from "./provenance.js";
import {
  mapFailuresToRepairTargets,
  MAX_TARGETED_REPAIR_ATTEMPTS,
  type BlogArticleParts,
  type RepairStopReason,
  type RepairTarget,
} from "./repair-target.js";
import { runBoundedTargetedRepair } from "./targeted-repair.js";

export type BrainGuidedGenerateInput = {
  topicId: string;
  strategyId: string;
  contentId?: string;
  productTitle: string;
  ctaUrl?: string | null;
  claimIds?: string[];
  productLinkIds?: string[];
};

export type BrainGuidedGenerateResult = {
  content: Content;
  version: ContentVersion;
  article: BloggerArticleStructured;
  modelRunId: string;
  brainRunId: string | null;
  initialDecision: BrainDecision | null;
  repairNeeded: boolean;
  repairFailureCodes: string[];
  repairTargetSegments: string[];
  repairOperations?: Array<{ segmentId: string; operation: string; reason: string }>;
  repairModelRunId: string | null;
  finalDecision: BrainDecision | string | null;
  stopReason: RepairStopReason;
  llmCallCount: number;
  initialTitle: string;
  finalTitle: string;
  unchangedCleanSegments: boolean;
  newUnsupportedAssertions?: number;
};

function articleToParts(article: BloggerArticleStructured): BlogArticleParts {
  return {
    title: article.title,
    summary: article.summary,
    lead: article.lead,
    sections: article.sections.map((s) => ({
      heading: s.heading,
      paragraphs: [...s.paragraphs],
    })),
    ctaLabel: article.cta.label,
  };
}

function applyPartsToArticle(
  article: BloggerArticleStructured,
  parts: BlogArticleParts,
): BloggerArticleStructured {
  return {
    ...article,
    title: parts.title,
    summary: parts.summary,
    lead: parts.lead,
    sections: parts.sections.map((s, i) => ({
      heading: s.heading,
      paragraphs: s.paragraphs,
      lists: article.sections[i]?.lists ?? [],
    })),
    cta: {
      ...article.cta,
      label: parts.ctaLabel ?? article.cta.label,
    },
  };
}

function segmentsUnchangedExcept(
  before: BlogArticleParts,
  after: BlogArticleParts,
  targets: RepairTarget[],
): boolean {
  const touched = new Set(targets.map((t) => t.segmentId));
  if (!touched.has("title") && before.title !== after.title) return false;
  if (!touched.has("summary") && before.summary !== after.summary) return false;
  if (!touched.has("lead") && before.lead !== after.lead) return false;
  for (let si = 0; si < before.sections.length; si++) {
    const bp = before.sections[si]!.paragraphs;
    const ap = after.sections[si]!.paragraphs;
    for (let pi = 0; pi < bp.length; pi++) {
      const id = `section:${si}:p${pi}`;
      const secId = `section:${si}`;
      if (touched.has(id) || touched.has(secId)) continue;
      if (bp[pi] !== ap[pi]) return false;
    }
  }
  return true;
}

async function stampGuidedAuthority(
  repo: LifecycleRepository,
  guided: BrainGuidedGenerateResult,
  initialVersionId: string,
): Promise<BrainGuidedGenerateResult> {
  const mode = resolveEditorialBrainMode();
  const repairAttempted =
    guided.repairNeeded &&
    guided.stopReason !== "BAD_INPUT_CLAIM" &&
    (guided.repairOperations != null || guided.version.id !== initialVersionId);
  const applied = applyBrainProductionAuthority({
    mode,
    channel: "BLOG",
    channelCapabilities: blogChannelModule.capabilities,
    // Prefer terminal outcome (post-repair / defer), not the initial repair trigger
    brainDecision: (guided.finalDecision as BrainDecision | string) ?? guided.initialDecision ?? "ESCALATE",
    legacyDecision: "GENERATED_OK",
    repairAttempted:
      repairAttempted ||
      guided.stopReason === "REPAIR_SUCCEEDED" ||
      guided.stopReason === "REGEN_CANDIDATE",
    repairOutcome: guided.finalDecision,
    badInput: guided.stopReason === "BAD_INPUT_CLAIM",
    brainRunId: guided.brainRunId,
    initialContentVersionId: initialVersionId,
    repairContentVersionId:
      guided.version.id !== initialVersionId ? guided.version.id : null,
  });

  const stampVersionId =
    applied.lifecycle.acceptedContentVersionId ?? guided.version.id;
  await persistBrainLifecycleOnVersion(repo, stampVersionId, applied.lifecycle);
  // Also stamp initial version when blocked so draft gate sees block on either id
  if (stampVersionId !== initialVersionId) {
    await persistBrainLifecycleOnVersion(repo, initialVersionId, {
      ...applied.lifecycle,
      acceptedContentVersionId: applied.lifecycle.acceptedContentVersionId,
    });
  }

  if (guided.brainRunId) {
    const brainRepo = repo.createEditorialBrainRepository();
    const run = await brainRepo.findBrainRun(guided.brainRunId);
    if (run) {
      await brainRepo.completeBrainRun(run.id, {
        finalDecision: applied.finalDecision,
        metadata: {
          ...(typeof run.metadata === "object" && run.metadata ? (run.metadata as object) : {}),
          brainLifecycle: applied.lifecycle,
          downstreamAllowed: applied.downstreamAllowed,
          acceptedContentVersionId: applied.lifecycle.acceptedContentVersionId,
          blockReason: applied.lifecycle.blockReason,
          mode,
        },
      });
    }
  }

  return {
    ...guided,
    finalDecision: applied.finalDecision,
  };
}

/**
 * After initial generate+observe, optionally run one bounded repair and persist a new version.
 */
export async function runBoundedBrainRepairOnVersion(input: {
  repo: LifecycleRepository;
  llm: LLMProvider;
  generationModel: string;
  content: Content;
  version: ContentVersion;
  article: BloggerArticleStructured;
  modelRunId: string;
  strategyId: string;
  availableClaims: PlannerClaimInput[];
  selectedClaims: PlannerClaimInput[];
  deferredClaimIds: string[];
  openingClaimIds: string[];
  hookClaimIds: string[];
  developmentClaimIds: string[];
  formatKey: string | null;
  structurePatternId: string | null;
  editorialPatternId: string | null;
  softLengthGuidance?: { targetMaxCharsApprox: number; targetMaxParagraphs: number };
  brainProvenance?: ArticleProvenance | null;
  images?: unknown;
  /** When true, structural progression failures become REGEN_CANDIDATE — never local COMPRESS/DELETE. */
  skipStructuralTargetedRepair?: boolean;
  /** RAW plan already passed — repair must not destroy body substance / empty required segments */
  rawPlanCompliant?: boolean;
}): Promise<BrainGuidedGenerateResult> {
  const initialVersionId = input.version.id;
  const result = await runBoundedBrainRepairOnVersionInner(input);
  return stampGuidedAuthority(input.repo, result, initialVersionId);
}

async function runBoundedBrainRepairOnVersionInner(input: {
  repo: LifecycleRepository;
  llm: LLMProvider;
  generationModel: string;
  content: Content;
  version: ContentVersion;
  article: BloggerArticleStructured;
  modelRunId: string;
  strategyId: string;
  availableClaims: PlannerClaimInput[];
  selectedClaims: PlannerClaimInput[];
  deferredClaimIds: string[];
  openingClaimIds: string[];
  hookClaimIds: string[];
  developmentClaimIds: string[];
  formatKey: string | null;
  structurePatternId: string | null;
  editorialPatternId: string | null;
  softLengthGuidance?: { targetMaxCharsApprox: number; targetMaxParagraphs: number };
  brainProvenance?: ArticleProvenance | null;
  images?: unknown;
  skipStructuralTargetedRepair?: boolean;
  rawPlanCompliant?: boolean;
}): Promise<BrainGuidedGenerateResult> {
  const brainRepo = input.repo.createEditorialBrainRepository();
  const brainRun = await brainRepo.findLatestBrainRunByContentVersion(input.version.id);
  const initialReview = (brainRun?.reviewResult ?? null) as EditorialReviewReport | null;
  const initialDecision = (brainRun?.brainDecision as BrainDecision | null) ?? null;

  const claimRefs: ClaimStatementRef[] = input.selectedClaims.map((c) => ({
    id: c.id,
    statement: c.statement,
    kind: c.kind,
  }));

  const bad = detectBadInputClaims(claimRefs);
  if (bad.length > 0) {
    if (brainRun) {
      await brainRepo.completeBrainRun(brainRun.id, {
        status: "COMPLETED",
        finalDecision: `LEGACY:GENERATED_OK|BRAIN_SHADOW:HUMAN_REVIEW_CANDIDATE|BAD_INPUT_CLAIM`,
        metadata: {
          ...(typeof brainRun.metadata === "object" && brainRun.metadata
            ? (brainRun.metadata as object)
            : {}),
          initialModelRunId: input.modelRunId,
          initialReview,
          repairDecision: "SKIPPED_BAD_INPUT_CLAIM",
          badInputClaims: bad,
          finalShadowDecision: "HUMAN_REVIEW_CANDIDATE",
        },
      });
      await brainRepo.createExperience({
        scope: "CHANNEL",
        channel: "BLOG",
        formatKey: input.formatKey,
        contentType: "blogger-article",
        claimProfile: brainRun.claimProfile,
        failureCodes: ["BAD_INPUT_CLAIM"],
        outcome: "BAD_INPUT_CLAIM",
        sourceType: "INITIAL_GENERATION",
        confidence: 0.5,
        sampleEvidence: 1,
        brainRunId: brainRun.id,
        contentVersionId: input.version.id,
        modelRunIds: [input.modelRunId],
        lesson: { badInputClaims: bad, note: "Do not invent missing cast in repair" },
      });
    }
    return {
      content: input.content,
      version: input.version,
      article: input.article,
      modelRunId: input.modelRunId,
      brainRunId: brainRun?.id ?? null,
      initialDecision,
      repairNeeded: false,
      repairFailureCodes: bad.map((b) => b.code),
      repairTargetSegments: [],
      repairModelRunId: null,
      finalDecision: "HUMAN_REVIEW_CANDIDATE",
      stopReason: "BAD_INPUT_CLAIM",
      llmCallCount: 1,
      initialTitle: input.article.title,
      finalTitle: input.article.title,
      unchangedCleanSegments: true,
    };
  }

  if (!initialReview || initialDecision === "PASS" || !brainRun) {
    return {
      content: input.content,
      version: input.version,
      article: input.article,
      modelRunId: input.modelRunId,
      brainRunId: brainRun?.id ?? null,
      initialDecision: initialDecision ?? "PASS",
      repairNeeded: false,
      repairFailureCodes: [],
      repairTargetSegments: [],
      repairModelRunId: null,
      finalDecision: initialDecision ?? "PASS",
      stopReason: "PASS",
      llmCallCount: 1,
      initialTitle: input.article.title,
      finalTitle: input.article.title,
      unchangedCleanSegments: true,
    };
  }

  if (initialDecision !== "TARGETED_REPAIR") {
    return {
      content: input.content,
      version: input.version,
      article: input.article,
      modelRunId: input.modelRunId,
      brainRunId: brainRun.id,
      initialDecision,
      repairNeeded: false,
      repairFailureCodes: initialReview.failures.map((f) => f.code),
      repairTargetSegments: [],
      repairModelRunId: null,
      finalDecision: initialDecision,
      stopReason: "SKIPPED",
      llmCallCount: 1,
      initialTitle: input.article.title,
      finalTitle: input.article.title,
      unchangedCleanSegments: true,
    };
  }

  // Structural defects are Generator plan failures — do not locally COMPRESS/DELETE to hide them.
  const STRUCTURAL_ONLY_CODES = new Set([
    "LEAD_BODY_OVERLAP",
    "STRUCTURAL_PROGRESSION_FAILURE",
    "FORBIDDEN_CONTRIBUTION_REUSED",
    "PLAN_EXECUTION_FAILED",
  ]);
  const structuralFailures = initialReview.failures.filter((f) =>
    STRUCTURAL_ONLY_CODES.has(f.code),
  );
  // Many REPETITION findings on distinct segments still indicate progression collapse.
  const repetitionCascade =
    initialReview.failures.filter((f) => f.code === "REPETITION").length >= 3;
  const structuralHeavy =
    input.skipStructuralTargetedRepair !== false &&
    (structuralFailures.length > 0 || repetitionCascade);
  if (structuralHeavy) {
    await brainRepo.completeBrainRun(brainRun.id, {
      status: "COMPLETED",
      finalDecision: `LEGACY:GENERATED_OK|BRAIN_SHADOW:REGEN_CANDIDATE|STRUCTURAL_PLAN_DEFECT`,
      metadata: {
        ...(typeof brainRun.metadata === "object" && brainRun.metadata
          ? (brainRun.metadata as object)
          : {}),
        initialModelRunId: input.modelRunId,
        initialReview,
        repairDecision: "SKIPPED_STRUCTURAL_PLAN_DEFECT",
        structuralFailureCodes: structuralFailures.map((f) => f.code),
        finalShadowDecision: "REGEN_CANDIDATE",
      },
    });
    return {
      content: input.content,
      version: input.version,
      article: input.article,
      modelRunId: input.modelRunId,
      brainRunId: brainRun.id,
      initialDecision,
      repairNeeded: true,
      repairFailureCodes: structuralFailures.map((f) => f.code),
      repairTargetSegments: [],
      repairModelRunId: null,
      finalDecision: "REGEN_CANDIDATE",
      stopReason: "REGEN_CANDIDATE",
      llmCallCount: 1,
      initialTitle: input.article.title,
      finalTitle: input.article.title,
      unchangedCleanSegments: true,
    };
  }

  const corePlan = buildCoreEditorialPlan({
    channel: "BLOG",
    formatKey: input.formatKey,
    contentType: "blogger-article",
    availableClaims: input.availableClaims,
    selectedClaims: input.selectedClaims,
    deferredClaimIds: input.deferredClaimIds,
    openingClaimIds: input.openingClaimIds,
    hookClaimIds: input.hookClaimIds,
    developmentClaimIds: input.developmentClaimIds,
    structurePatternId: input.structurePatternId,
    editorialPatternId: input.editorialPatternId,
    softLengthGuidance: input.softLengthGuidance,
  });
  const channelPlan = buildBlogChannelPlan(corePlan);
  const contract: BrainGenerationInputContract = buildBrainGenerationInputContract({
    corePlan,
    channelPlan,
    claims: claimRefs,
  });

  const partsBefore = articleToParts(input.article);
  const targets = mapFailuresToRepairTargets({
    review: initialReview,
    article: partsBefore,
    roleAllowlist: contract.roleAllowlist,
  });

  if (targets.length === 0) {
    return {
      content: input.content,
      version: input.version,
      article: input.article,
      modelRunId: input.modelRunId,
      brainRunId: brainRun.id,
      initialDecision,
      repairNeeded: true,
      repairFailureCodes: initialReview.failures.map((f) => f.code),
      repairTargetSegments: [],
      repairModelRunId: null,
      finalDecision: "HUMAN_REVIEW_CANDIDATE",
      stopReason: "HUMAN_REVIEW_CANDIDATE",
      llmCallCount: 1,
      initialTitle: input.article.title,
      finalTitle: input.article.title,
      unchangedCleanSegments: true,
    };
  }

  const authFromVersion =
    (input.version.structuredContent as {
      generationAuthority?: {
        mode?: string;
        EVIDENCE_PACK?: {
          concreteEvidence?: Array<{ id: string; type: string; fact: string }>;
          slotAssignment?: Record<string, unknown>;
        };
        WRITING_SKELETON?: Record<string, unknown>;
      };
    } | null)?.generationAuthority ?? null;
  const optionBRepairPayload =
    authFromVersion?.mode === "OPTION_B"
      ? {
          evidencePackSubset: (authFromVersion.EVIDENCE_PACK?.concreteEvidence ?? []).slice(0, 12),
          writingSkeletonBySegment: {
            lead: {
              slot: "opening",
              ...(typeof authFromVersion.WRITING_SKELETON?.opening === "object"
                ? (authFromVersion.WRITING_SKELETON.opening as object)
                : {}),
            },
            title: {
              slot: "title",
              ...(typeof authFromVersion.WRITING_SKELETON?.title === "object"
                ? (authFromVersion.WRITING_SKELETON.title as object)
                : {}),
            },
            summary: { slot: "summary" },
            ...(Array.isArray(authFromVersion.WRITING_SKELETON?.body)
              ? Object.fromEntries(
                  (authFromVersion.WRITING_SKELETON.body as Array<Record<string, unknown>>).map(
                    (b, i) => [`section:0:p${i}`, { slot: "body", ...b }],
                  ),
                )
              : {}),
          },
        }
      : undefined;

  const repair = await runBoundedTargetedRepair({
    llm: input.llm,
    model: input.generationModel,
    article: partsBefore,
    targets,
    claims: claimRefs,
    openingClaimIds: input.openingClaimIds,
    developmentClaimIds: input.developmentClaimIds,
    inferencePolicy: corePlan.inferencePolicy,
    contributionPlan: contract.contributionPlan,
    optionBRepair: optionBRepairPayload,
    createModelRun: async (meta) => {
      const run = await input.repo.createModelRun({
        provider: input.llm.providerKey,
        model: input.generationModel,
        taskType: "REVISION",
        promptIdentifier: "editorial-brain.targeted-repair",
        promptVersion: "v2",
        status: "RUNNING",
        inputRef: input.strategyId,
        metadata: meta,
      });
      return { id: run.id };
    },
    completeModelRun: async (id, result) => {
      await input.repo.completeModelRun(id, {
        status: result.status === "COMPLETED" ? "COMPLETED" : "FAILED",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCost: result.estimatedCost,
        actualCost: result.actualCost,
        currency: result.currency,
        structuredOutputValid: true,
        errorDetail: result.errorDetail,
        metadata:
          result.metadata && typeof result.metadata === "object"
            ? (result.metadata as Record<string, unknown>)
            : undefined,
      });
    },
  });

  // Success validation failed → stop as REGEN without treating as clean repair
  if (!repair.successValidation.ok) {
    if (brainRun) {
      await brainRepo.completeBrainRun(brainRun.id, {
        status: "COMPLETED",
        finalDecision: `LEGACY:GENERATED_OK|BRAIN_SHADOW:REGEN_CANDIDATE`,
        repairAttempts: [
          {
            attempt: 1,
            maxAttempts: MAX_TARGETED_REPAIR_ATTEMPTS,
            targets: targets.map((t) => ({
              segmentId: t.segmentId,
              failureCodes: t.failureCodes,
            })),
            operations: repair.operations,
            repairModelRunId: repair.modelRunId,
            successValidation: repair.successValidation,
            postRepairDecision: "REGEN_CANDIDATE",
          },
        ],
        metadata: {
          ...(typeof brainRun.metadata === "object" && brainRun.metadata
            ? (brainRun.metadata as object)
            : {}),
          initialModelRunId: input.modelRunId,
          initialReview: {
            decision: initialReview.decision,
            failureCodes: initialReview.failures.map((f) => f.code),
          },
          repairDecision: "SUCCESS_VALIDATION_FAILED",
          repairTargetSegments: targets.map((t) => t.segmentId),
          repairOperations: repair.operations,
          repairModelRunId: repair.modelRunId,
          successValidation: repair.successValidation,
          finalShadowDecision: "REGEN_CANDIDATE",
          maxRepairAttempts: MAX_TARGETED_REPAIR_ATTEMPTS,
        },
      });
    }
    return {
      content: input.content,
      version: input.version,
      article: input.article,
      modelRunId: input.modelRunId,
      brainRunId: brainRun.id,
      initialDecision,
      repairNeeded: true,
      repairFailureCodes: initialReview.failures.map((f) => f.code),
      repairTargetSegments: targets.map((t) => t.segmentId),
      repairOperations: repair.operations.map((o) => ({
        segmentId: o.segmentId,
        operation: o.operation,
        reason: o.reason,
      })),
      repairModelRunId: repair.modelRunId,
      finalDecision: "REGEN_CANDIDATE",
      stopReason: "REGEN_CANDIDATE",
      llmCallCount: repair.llmCallUsed ? 2 : 1,
      initialTitle: input.article.title,
      finalTitle: input.article.title,
      unchangedCleanSegments: true,
      newUnsupportedAssertions: 0,
    };
  }

  const repairedArticleRaw = applyPartsToArticle(input.article, repair.article);
  // OPTION B: validator ≠ rewriter — do not strip/mutate prose after repair LLM
  const optionBRepair =
    Boolean((input as { optionB?: boolean }).optionB) ||
    Boolean(
      (input.version.structuredContent as { generationAuthority?: { mode?: string } } | null)
        ?.generationAuthority?.mode === "OPTION_B",
    );
  let repairedArticle = repairedArticleRaw;
  if (!optionBRepair) {
    const { stripUnsupportedEvaluativePadding } = await import("./strip-evaluative-padding.js");
    const keepFacets = claimRefs
      .flatMap((c) => {
        const statement = typeof c.statement === "string" ? c.statement : "";
        return statement.length >= 2 ? [statement] : [];
      })
      .concat(
        contract.segmentAllocation.leadContributions.map((c) => c.facet),
        contract.segmentAllocation.bodyContributions.map((c) => c.facet),
      );
    const scrubbed = stripUnsupportedEvaluativePadding({
      article: {
        title: repairedArticleRaw.title,
        summary: repairedArticleRaw.summary,
        lead: repairedArticleRaw.lead,
        sections: repairedArticleRaw.sections.map((s) => ({
          heading: s.heading,
          paragraphs: s.paragraphs,
          lists: s.lists,
        })),
      },
      claimStatements: claimRefs,
      keepFacets,
    });
    repairedArticle = {
      ...repairedArticleRaw,
      title: scrubbed.title,
      summary: scrubbed.summary,
      lead: scrubbed.lead,
      sections: scrubbed.sections.map((s, i) => ({
        ...repairedArticleRaw.sections[i]!,
        paragraphs: s.paragraphs,
      })),
    };
  }

  // If repair DELETE emptied development but unused concrete contributions remain,
  // fill deterministically (0 LLM) — empty body must not "succeed" as repair.
  const bodyJoined = repairedArticle.sections.flatMap((s) => s.paragraphs).join("").trim();
  if (bodyJoined.length < 4 && contract.segmentAllocation.bodyContributions.length > 0) {
    const { buildDeterministicReplaceText } = await import("./repair-operation.js");
    const filled = buildDeterministicReplaceText({
      replaceWith: contract.segmentAllocation.bodyContributions.slice(0, 3),
      claims: claimRefs,
    });
    if (filled.text.length > 0) {
      repairedArticle = {
        ...repairedArticle,
        sections: [
          {
            heading: repairedArticle.sections[0]?.heading ?? null,
            paragraphs: [filled.text],
            lists: repairedArticle.sections[0]?.lists ?? [],
          },
        ],
      };
    }
  }

  // Article-level post-repair gate: empty required segment / catalog-only / lost progression → reject ACCEPT
  if (input.rawPlanCompliant !== false) {
    const bodyAfter = repairedArticle.sections.flatMap((s) => s.paragraphs).join("").trim();
    const leadAfter = (repairedArticle.lead ?? "").trim();
    const bodyReqCount = contract.segmentContracts.development.requiredContributions.length;
    if (!leadAfter || (bodyReqCount > 0 && bodyAfter.length < 8)) {
      return {
        content: input.content,
        version: input.version,
        article: input.article,
        modelRunId: input.modelRunId,
        brainRunId: brainRun.id,
        initialDecision,
        repairNeeded: true,
        repairFailureCodes: initialReview.failures.map((f) => f.code),
        repairTargetSegments: targets.map((t) => t.segmentId),
        repairOperations: repair.operations.map((o) => ({
          segmentId: o.segmentId,
          operation: o.operation,
          reason: o.reason,
        })),
        repairModelRunId: repair.modelRunId,
        finalDecision: "REGEN_CANDIDATE",
        stopReason: "REGEN_CANDIDATE",
        llmCallCount: repair.llmCallUsed ? 2 : 1,
        initialTitle: input.article.title,
        finalTitle: input.article.title,
        unchangedCleanSegments: false,
        newUnsupportedAssertions: 0,
      };
    }
  }

  const body = structuredToPlainBody(repairedArticle, {
    images: Array.isArray(input.images) ? (input.images as never) : undefined,
  });
  const latest = await input.repo.findLatestContentVersion(input.content.id);
  const versionNumber = (latest?.versionNumber ?? input.version.versionNumber) + 1;
  const priorStructured =
    input.version.structuredContent && typeof input.version.structuredContent === "object"
      ? (input.version.structuredContent as Record<string, unknown>)
      : {};

  const repairedVersion = await input.repo.createContentVersion({
    contentId: input.content.id,
    versionNumber,
    parentVersionId: input.version.id,
    revisionType: "targeted_repair",
    title: repairedArticle.title,
    summary: repairedArticle.summary,
    body,
    structuredContent: {
      ...priorStructured,
      channel: "BLOGGER",
      article: repairedArticle,
      brainProvenance: input.brainProvenance ?? priorStructured.brainProvenance ?? null,
      brainRepair: {
        attempt: MAX_TARGETED_REPAIR_ATTEMPTS,
        targets: targets.map((t) => t.segmentId),
        operations: repair.operations,
        repairModelRunId: repair.modelRunId,
        parentVersionId: input.version.id,
        llmCallUsed: repair.llmCallUsed,
        successValidation: repair.successValidation,
      },
    },
    status: "REVIEWING",
    createdBy: "brain-targeted-repair",
    modelRunId: repair.modelRunId,
  });

  const optionBNaturalIntro =
    Boolean((input as { optionB?: boolean }).optionB) ||
    Boolean(
      (input.version.structuredContent as { generationAuthority?: { mode?: string } } | null)
        ?.generationAuthority?.mode === "OPTION_B",
    );

  const postRepairReview = reviewArtifactShadow({
    artifact: {
      channel: "BLOG",
      title: repairedArticle.title,
      summary: repairedArticle.summary,
      lead: repairedArticle.lead,
      sections: repairedArticle.sections.map((s) => ({
        paragraphs: s.paragraphs,
        lists: s.lists,
      })),
      bodyText: body,
    },
    corePlan,
    claimStatements: claimRefs,
    optionBNaturalIntro,
  });

  const finalShadow: BrainDecision | "REGEN_CANDIDATE" | "HUMAN_REVIEW_CANDIDATE" =
    postRepairReview.decision === "PASS"
      ? "PASS"
      : postRepairReview.decision === "DEFER_INSUFFICIENT_MATERIAL"
        ? "DEFER_INSUFFICIENT_MATERIAL"
        : postRepairReview.decision === "TARGETED_REPAIR"
          ? "REGEN_CANDIDATE"
          : "HUMAN_REVIEW_CANDIDATE";

  const stopReason: RepairStopReason =
    finalShadow === "PASS"
      ? "REPAIR_SUCCEEDED"
      : finalShadow === "REGEN_CANDIDATE" || finalShadow === "DEFER_INSUFFICIENT_MATERIAL"
        ? "REGEN_CANDIDATE"
        : "HUMAN_REVIEW_CANDIDATE";

  await brainRepo.completeBrainRun(brainRun.id, {
    status: "COMPLETED",
    contentVersionId: repairedVersion.id,
    generatorModelRunIds: [input.modelRunId, repair.modelRunId].filter(Boolean),
    repairAttempts: [
      {
        attempt: 1,
        maxAttempts: MAX_TARGETED_REPAIR_ATTEMPTS,
        targets: targets.map((t) => ({
          segmentId: t.segmentId,
          failureCodes: t.failureCodes,
        })),
        operations: repair.operations,
        repairModelRunId: repair.modelRunId,
        postRepairDecision: postRepairReview.decision,
        llmCallUsed: repair.llmCallUsed,
      },
    ],
    brainDecision: initialDecision,
    finalDecision: `LEGACY:GENERATED_OK|BRAIN_SHADOW:${finalShadow}`,
    failureCodes: postRepairReview.failures.map((f) => f.code),
    reviewResult: {
      initial: initialReview,
      postRepair: {
        ...postRepairReview,
        semanticAssertions: (postRepairReview.semanticAssertions ?? []).slice(0, 40),
      },
    },
    metadata: {
      ...(typeof brainRun.metadata === "object" && brainRun.metadata
        ? (brainRun.metadata as object)
        : {}),
      initialModelRunId: input.modelRunId,
      initialReview: {
        decision: initialReview.decision,
        failureCodes: initialReview.failures.map((f) => f.code),
      },
      repairDecision: postRepairReview.decision,
      repairTargetSegments: targets.map((t) => t.segmentId),
      repairOperations: repair.operations,
      repairModelRunId: repair.modelRunId,
      postRepairReview: {
        decision: postRepairReview.decision,
        failureCodes: postRepairReview.failures.map((f) => f.code),
      },
      finalShadowDecision: finalShadow,
      maxRepairAttempts: MAX_TARGETED_REPAIR_ATTEMPTS,
      llmCallUsed: repair.llmCallUsed,
    },
  });

  await brainRepo.createExperience({
    scope: "CHANNEL",
    channel: "BLOG",
    formatKey: input.formatKey,
    contentType: "blogger-article",
    claimProfile: brainRun.claimProfile,
    planSummary: {
      selectedClaimIds: corePlan.selectedClaimIds,
      scarcityMode: corePlan.scarcityMode,
    },
    reviewSummary: {
      decision: postRepairReview.decision,
      failureCodes: postRepairReview.failures.map((f) => f.code),
      priorDecision: initialDecision,
    },
    failureCodes: postRepairReview.failures.map((f) => f.code),
    outcome: finalShadow,
    sourceType: "TARGETED_REPAIR_RESULT",
    confidence: finalShadow === "PASS" ? 0.55 : 0.4,
    sampleEvidence: 1,
    brainRunId: brainRun.id,
    contentVersionId: repairedVersion.id,
    modelRunIds: [input.modelRunId, repair.modelRunId].filter(Boolean) as string[],
    lesson: null,
  });

  const initialCodes = new Set(initialReview.failures.map((f) => f.code));
  const newUnsupportedAssertions = postRepairReview.failures.filter(
    (f) =>
      !initialCodes.has(f.code) &&
      [
        "UNSUPPORTED_INFERENCE",
        "EVALUATIVE_INFERENCE",
        "NAME_DERIVED_INFERENCE",
        "INTERPRETIVE_INFERENCE",
        "GROUNDING",
      ].includes(f.code),
  ).length;

  return {
    content: input.content,
    version: repairedVersion,
    article: repairedArticle,
    modelRunId: input.modelRunId,
    brainRunId: brainRun.id,
    initialDecision,
    repairNeeded: true,
    repairFailureCodes: initialReview.failures.map((f) => f.code),
    repairTargetSegments: targets.map((t) => t.segmentId),
    repairOperations: repair.operations.map((o) => ({
      segmentId: o.segmentId,
      operation: o.operation,
      reason: o.reason,
    })),
    repairModelRunId: repair.modelRunId,
    finalDecision: finalShadow,
    stopReason,
    llmCallCount: repair.llmCallUsed ? 2 : 1,
    initialTitle: input.article.title,
    finalTitle: repairedArticle.title,
    unchangedCleanSegments: segmentsUnchangedExcept(partsBefore, repair.article, targets),
    newUnsupportedAssertions,
  };
}

/** Re-export parse helper for tests that inject raw JSON. */
export { parseBloggerArticle };
