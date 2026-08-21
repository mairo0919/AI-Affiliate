/**
 * Generation input contract — Core/Channel plan as Generator SSOT.
 * Role-scoped claim allowlists + facet-level segment contribution contracts.
 */

import type { ChannelEditorialPlan, CoreEditorialPlan } from "../core/types.js";
import {
  toRoleContributionBoundaries,
  type ContributionPlan,
  type RoleContributionBoundary,
} from "./informational-contribution.js";
import {
  buildSegmentContributionAllocation,
  type SegmentContributionAllocation,
  type SegmentContributionContract,
} from "./contribution-compliance.js";
import { claimStatesEvaluativeRelation } from "../shadow/predicate-families.js";
import type { EditorialExecutionPlan } from "./editorial-execution-plan.js";
import { toEditorialExecutionPromptContract } from "./editorial-execution-plan.js";
import { buildSegmentExecutionContract } from "./segment-execution.js";

export type ClaimStatementRef = { id: string; statement: string; kind?: string };

export type RoleClaimAllowlist = {
  titleAllowedClaimIds: string[];
  leadAllowedClaimIds: string[];
  developmentAllowedClaimIds: string[];
  summaryAllowedClaimIds: string[];
  ctaAllowedClaimIds: string[];
  omittedClaimIds: string[];
};

export type BrainGenerationInputContract = {
  corePlan: CoreEditorialPlan;
  channelPlan: ChannelEditorialPlan;
  roleAllowlist: RoleClaimAllowlist;
  roleClaims: {
    title: ClaimStatementRef[];
    lead: ClaimStatementRef[];
    development: ClaimStatementRef[];
    summary: ClaimStatementRef[];
  };
  roleFactualBoundaries: Record<
    "title" | "lead" | "development" | "summary",
    RoleContributionBoundary
  >;
  contributionPlan: ContributionPlan;
  segmentAllocation: SegmentContributionAllocation;
  segmentContracts: Record<"title" | "lead" | "development" | "summary", SegmentContributionContract>;
  inferencePolicy: CoreEditorialPlan["inferencePolicy"];
  scarcityMode: boolean;
  developmentDepth: CoreEditorialPlan["developmentDepth"];
  titleStrategy: string;
  summaryStrategy: string;
  ctaStrategy: string;
  informationGainTarget: number;
  omitDevelopmentSubstance: boolean;
  /** Preflight: do not generate body substance / consider DEFER */
  insufficientDevelopmentMaterial: boolean;
  /** Reference-derived HOW — Generator executes this; not free-write */
  editorialExecution: EditorialExecutionPlan | null;
};

function refsFor(
  ids: string[],
  byId: Map<string, ClaimStatementRef>,
): ClaimStatementRef[] {
  return ids.map((id) => byId.get(id)).filter((c): c is ClaimStatementRef => Boolean(c));
}

export function buildRoleClaimAllowlist(core: CoreEditorialPlan): RoleClaimAllowlist {
  const opening = core.claimAllocation.filter((a) => a.role === "opening").map((a) => a.claimId);
  const development = core.claimAllocation
    .filter((a) => a.role === "development" || a.role === "support")
    .map((a) => a.claimId);
  const cta = core.claimAllocation.filter((a) => a.role === "cta").map((a) => a.claimId);
  const omitted = core.omittedClaimIds.map((o) => o.claimId);

  const titleAllowedClaimIds = [...new Set([...core.openingDriverClaimIds, ...opening])];
  const leadAllowedClaimIds = [...titleAllowedClaimIds];
  const summaryAllowedClaimIds = [...new Set([...titleAllowedClaimIds, ...development])];

  return {
    titleAllowedClaimIds,
    leadAllowedClaimIds,
    developmentAllowedClaimIds: development,
    summaryAllowedClaimIds,
    ctaAllowedClaimIds: cta,
    omittedClaimIds: omitted,
  };
}

export function buildBrainGenerationInputContract(input: {
  corePlan: CoreEditorialPlan;
  channelPlan: ChannelEditorialPlan;
  claims: ClaimStatementRef[];
  editorialExecution?: EditorialExecutionPlan | null;
}): BrainGenerationInputContract {
  const byId = new Map(input.claims.map((c) => [c.id, c]));
  const roleAllowlist = buildRoleClaimAllowlist(input.corePlan);
  const specifics = input.channelPlan.specifics as { ctaStrategy?: string };
  const openingClaimIds = roleAllowlist.leadAllowedClaimIds;
  const developmentClaimIds = roleAllowlist.developmentAllowedClaimIds;
  const claimsAllowEvaluation = input.claims.some((c) =>
    claimStatesEvaluativeRelation(c.statement),
  );
  const segmentAllocation = buildSegmentContributionAllocation({
    claims: input.claims,
    openingClaimIds,
    developmentClaimIds,
    claimsAllowEvaluation,
  });
  const contributionPlan = segmentAllocation.plan;
  const roleFactualBoundaries = toRoleContributionBoundaries(contributionPlan, input.claims);
  const omitDevelopmentSubstance =
    segmentAllocation.insufficientDevelopmentMaterial ||
    contributionPlan.byRole.development.length === 0;

  // Development allowlist must include claimIds that carry body facets (often opening title claim)
  const bodyClaimIds = [
    ...new Set(segmentAllocation.bodyContributions.map((c) => c.claimId)),
  ];
  const mergedAllowlist: RoleClaimAllowlist = {
    ...roleAllowlist,
    developmentAllowedClaimIds: [
      ...new Set([...roleAllowlist.developmentAllowedClaimIds, ...bodyClaimIds]),
    ],
  };

  const editorialExecution =
    input.editorialExecution ??
    (input.corePlan.editorialExecution
      ? ({
          // Minimal revive from core slice when full plan not passed
          source: {
            structurePatternId: input.corePlan.editorialExecution.patternSource.structurePatternId,
            structurePatternLabel:
              input.corePlan.editorialExecution.patternSource.structurePatternLabel,
            editorialPatternId: input.corePlan.editorialExecution.patternSource.editorialPatternId,
            editorialPatternLabel:
              input.corePlan.editorialExecution.patternSource.editorialPatternLabel,
            sourceDomains: input.corePlan.editorialExecution.patternSource.sourceDomains,
          },
          materialDepth: input.corePlan.developmentDepth,
          openingStrategy: input.corePlan.editorialExecution.openingStrategy,
          developmentStrategy: input.corePlan.editorialExecution.developmentStrategy,
          informationProgression: input.corePlan.editorialExecution.informationProgression,
          sectionRoles: input.corePlan.editorialExecution.sectionRoles.map((s) => ({
            ...s,
            headingRequired: false,
            avoidCatalogMetadata: true,
            forbidRestatePriorClaims: true,
          })),
          contributionPolicy: {
            leadMaxClaims: 2,
            eachParagraphMustAdvance: true,
            forbidRestatePriorClaims: true,
            forbidCatalogMetadataDetour: true,
            forbidGenericMetaEvaluation: true,
          },
          scarceStrategy: {
            mode: input.corePlan.editorialExecution.scarceStrategyMode,
            allowCatalogPadding: false as const,
            preferDeferWhenNoConcreteBody: true,
            note: "from core slice",
          },
          richStrategy: {
            mode:
              input.corePlan.developmentDepth === "rich"
                ? ("sequential_new_detail" as const)
                : ("compressed" as const),
            preferDenseEditorialPattern: input.corePlan.developmentDepth === "rich",
            note: "from core slice",
          },
          repetitionPolicy: {
            style: "no_cross_role_restatement" as const,
            requireNewAngleOrFact: true,
          },
          summaryStrategy: input.corePlan.editorialExecution.summaryStrategy,
          ctaBridge: {
            strategy: "bridge_from_established_interest",
            omit: input.corePlan.editorialExecution.ctaBridgeOmit,
            allowNewClaims: false as const,
          },
          titleStrategy: input.corePlan.editorialExecution.titleStrategy,
          avoidCategories: input.corePlan.editorialExecution.avoidCategories,
          generatorDuty: [
            "Execute EDITORIAL_PLAN using only FACTS.",
            "Do not invent or pad with catalog metadata.",
          ],
        } satisfies EditorialExecutionPlan)
      : null);

  return {
    corePlan: input.corePlan,
    channelPlan: input.channelPlan,
    roleAllowlist: mergedAllowlist,
    roleClaims: {
      title: refsFor(mergedAllowlist.titleAllowedClaimIds, byId),
      lead: refsFor(mergedAllowlist.leadAllowedClaimIds, byId),
      development: refsFor(mergedAllowlist.developmentAllowedClaimIds, byId),
      summary: refsFor(mergedAllowlist.summaryAllowedClaimIds, byId),
    },
    roleFactualBoundaries,
    contributionPlan,
    segmentAllocation,
    segmentContracts: segmentAllocation.segmentContracts,
    inferencePolicy: input.corePlan.inferencePolicy,
    scarcityMode: input.corePlan.scarcityMode,
    developmentDepth: input.corePlan.developmentDepth,
    titleStrategy: editorialExecution?.titleStrategy ?? input.corePlan.titleStrategy,
    summaryStrategy: editorialExecution?.summaryStrategy ?? input.corePlan.summaryStrategy,
    ctaStrategy: specifics.ctaStrategy ?? input.corePlan.ctaStrategy,
    informationGainTarget: input.corePlan.informationGainTarget,
    omitDevelopmentSubstance,
    insufficientDevelopmentMaterial: segmentAllocation.insufficientDevelopmentMaterial,
    editorialExecution,
  };
}

function contractSlice(c: SegmentContributionContract): Record<string, unknown> {
  return {
    allowedContributions: c.allowedContributions.map((x) => ({
      id: x.id,
      claimId: x.claimId,
      facet: x.facet,
    })),
    requiredContributions: c.requiredContributions.map((x) => ({
      id: x.id,
      claimId: x.claimId,
      facet: x.facet,
    })),
    reservedForLaterContributions: (c.reservedForLaterContributions ?? []).map((x) => ({
      id: x.id,
      claimId: x.claimId,
      facet: x.facet,
    })),
    forbiddenConsumedContributions: c.forbiddenConsumedContributions.map((x) => ({
      id: x.id,
      claimId: x.claimId,
      facet: x.facet,
    })),
    allowedRelationFamilies: c.allowedRelationFamilies,
  };
}

export function toBrainGenerationPromptContract(
  contract: BrainGenerationInputContract,
): Record<string, unknown> {
  const facts = {
    roleClaims: {
      title: contract.roleClaims.title.map((c) => ({ id: c.id, statement: c.statement, kind: c.kind })),
      lead: contract.roleClaims.lead.map((c) => ({ id: c.id, statement: c.statement, kind: c.kind })),
      development: contract.roleClaims.development.map((c) => ({
        id: c.id,
        statement: c.statement,
        kind: c.kind,
      })),
      summary: contract.roleClaims.summary.map((c) => ({
        id: c.id,
        statement: c.statement,
        kind: c.kind,
      })),
    },
    roleAllowlist: contract.roleAllowlist,
    roleFactualBoundaries: {
      title: contract.roleFactualBoundaries.title.allowedClaims,
      lead: contract.roleFactualBoundaries.lead.allowedClaims,
      development: contract.roleFactualBoundaries.development.allowedClaims,
      summary: contract.roleFactualBoundaries.summary.allowedClaims,
    },
    inferencePolicy: contract.inferencePolicy,
  };

  const editorialPlan = contract.editorialExecution
    ? toEditorialExecutionPromptContract(contract.editorialExecution)
    : {
        openingStrategy: contract.titleStrategy,
        developmentStrategy: "deepen_interest_with_new_supported_detail",
        materialDepth: contract.developmentDepth,
        note: "No reference editorialExecution attached — still obey segmentContracts and avoid catalog padding.",
      };

  const segmentContracts = {
    title: contractSlice(contract.segmentContracts.title),
    lead: contractSlice(contract.segmentContracts.lead),
    development: contractSlice(contract.segmentContracts.development),
    summary: contractSlice(contract.segmentContracts.summary),
  };

  const segmentExecution = buildSegmentExecutionContract(contract);

  return {
    /** Layer separation SSOT for Generator */
    layers: {
      FACTS: facts,
      EDITORIAL_PLAN: editorialPlan,
      SEGMENT_CONTRACTS: segmentContracts,
    },
    priority: [
      "1_FACTUAL_SAFETY",
      "2_EVIDENCE_PACK",
      "3_WRITING_SKELETON",
      "4_BLOG_CHANNEL_REQUIREMENTS",
      "5_MINIMAL_STYLE",
    ],
    priorityRule:
      "OPTION B: FACTUAL > EVIDENCE_PACK > WRITING_SKELETON > CHANNEL > style. Catalog metadata is not body fuel.",
    scarcityMode: contract.scarcityMode,
    developmentDepth: contract.developmentDepth,
    informationGainTarget: contract.informationGainTarget,
    omitDevelopmentSubstance: contract.omitDevelopmentSubstance,
    insufficientDevelopmentMaterial: contract.insufficientDevelopmentMaterial,
    titleStrategy: contract.titleStrategy,
    summaryStrategy: contract.summaryStrategy,
    ctaStrategy: contract.ctaStrategy,
    editorialExecution: editorialPlan,
    segmentExecution,
    // Backward-compatible flat fields (same data as layers)
    inferencePolicy: contract.inferencePolicy,
    roleAllowlist: contract.roleAllowlist,
    roleFactualBoundaries: facts.roleFactualBoundaries,
    segmentContracts,
    rules: [
      "Execute SEGMENT_CONTRACTS via segmentExecution slots (progressive contribution consumption).",
      "Execute EDITORIAL_PLAN HOW using FACTS only — do not free-write from the full claim dump.",
      "requiredContributions MUST appear (paraphrase OK) in that segment; forbiddenConsumedContributions must not reappear later.",
      "reservedForLaterContributions are hard-forbidden in lead (RESERVED_FOR_LATER) — keep them for body progression.",
      "Return segmentContributionProvenance with required/used contribution ids per segment; false provenance is rejected.",
      "When omitDevelopmentSubstance=true or insufficientDevelopmentMaterial=true: do not invent maker/availability/eval filler for body — system may DEFER.",
      "Write factual editorial sentences from SUPPORTED facets only. Do not invent evaluation relations unless allowedRelationFamilies includes EVALUATION.",
      "Same claimId may supply different facets to lead vs body; never restate the same facet.",
      "Allowed inference: direct_paraphrase and safe_composition only.",
      "Never copy competitor article wording (patterns are abstract strategies only).",
    ],
  };
}
