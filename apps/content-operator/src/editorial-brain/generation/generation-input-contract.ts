/**
 * Generation role contract — minimal preflight + claim allowlist for OPTION B.
 * ArticlePlan is the plan SSOT (attached on prompt contract by generation service).
 */

import type { ChannelEditorialPlan, CoreEditorialPlan } from "../core/types.js";
import type { ArticlePlan } from "../../article-pattern/article-plan.js";

export type ClaimStatementRef = { id: string; statement: string; kind?: string };

export type RoleClaimAllowlist = {
  titleAllowedClaimIds: string[];
  leadAllowedClaimIds: string[];
  developmentAllowedClaimIds: string[];
  summaryAllowedClaimIds: string[];
  ctaAllowedClaimIds: string[];
  omittedClaimIds: string[];
};

/** Minimal generation contract — no SEGMENT / editorial HOW / informationGain ontology. */
export type BrainGenerationInputContract = {
  roleAllowlist: RoleClaimAllowlist;
  roleClaims: {
    title: ClaimStatementRef[];
    lead: ClaimStatementRef[];
    development: ClaimStatementRef[];
    summary: ClaimStatementRef[];
  };
  scarcityMode: boolean;
  omitDevelopmentSubstance: boolean;
  insufficientDevelopmentMaterial: boolean;
};

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

export function insufficientMaterialFromArticlePlan(plan: ArticlePlan): boolean {
  const bodyFacts = plan.body.flatMap((s) => s.facts);
  if (plan.materialDepth === "scarce") return false;
  return bodyFacts.length === 0;
}

export function omitDevelopmentFromArticlePlan(plan: ArticlePlan): boolean {
  return plan.body.flatMap((s) => s.facts).length === 0;
}

function refsFor(ids: string[], byId: Map<string, ClaimStatementRef>): ClaimStatementRef[] {
  return ids.map((id) => byId.get(id)).filter((c): c is ClaimStatementRef => Boolean(c));
}

export function buildBrainGenerationInputContract(input: {
  corePlan: CoreEditorialPlan;
  channelPlan: ChannelEditorialPlan;
  claims: ClaimStatementRef[];
  articlePlan?: ArticlePlan | null;
}): BrainGenerationInputContract {
  const byId = new Map(input.claims.map((c) => [c.id, c]));
  const roleAllowlist = buildRoleClaimAllowlist(input.corePlan);

  const insufficientDevelopmentMaterial = input.articlePlan
    ? insufficientMaterialFromArticlePlan(input.articlePlan)
    : roleAllowlist.developmentAllowedClaimIds.length === 0 && !input.corePlan.scarcityMode;

  const omitDevelopmentSubstance = input.articlePlan
    ? omitDevelopmentFromArticlePlan(input.articlePlan)
    : roleAllowlist.developmentAllowedClaimIds.length === 0;

  return {
    roleAllowlist,
    roleClaims: {
      title: refsFor(roleAllowlist.titleAllowedClaimIds, byId),
      lead: refsFor(roleAllowlist.leadAllowedClaimIds, byId),
      development: refsFor(roleAllowlist.developmentAllowedClaimIds, byId),
      summary: refsFor(roleAllowlist.summaryAllowedClaimIds, byId),
    },
    scarcityMode: input.corePlan.scarcityMode,
    omitDevelopmentSubstance,
    insufficientDevelopmentMaterial,
  };
}

export function toBrainGenerationPromptContract(
  contract: BrainGenerationInputContract,
): Record<string, unknown> {
  return {
    layers: {
      FACTS: {
        roleClaims: {
          title: contract.roleClaims.title.map((c) => ({
            id: c.id,
            statement: c.statement,
            kind: c.kind,
          })),
          lead: contract.roleClaims.lead.map((c) => ({
            id: c.id,
            statement: c.statement,
            kind: c.kind,
          })),
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
      },
    },
    priority: ["1_ARTICLE_PLAN", "1_FACTUAL_SAFETY", "2_CLAIM_ALLOWLIST"],
    priorityRule: "OPTION B: ARTICLE_PLAN is the plan SSOT. Claim allowlist is provenance only.",
    scarcityMode: contract.scarcityMode,
    omitDevelopmentSubstance: contract.omitDevelopmentSubstance,
    insufficientDevelopmentMaterial: contract.insufficientDevelopmentMaterial,
    roleAllowlist: contract.roleAllowlist,
    rules: [
      "Execute ARTICLE_PLAN slots and facts — ArticlePlan is the plan SSOT.",
      "When omitDevelopmentSubstance=true or insufficientDevelopmentMaterial=true: do not invent body substance — system may DEFER.",
      "Never invent concrete facts absent from ARTICLE_PLAN.",
    ],
  };
}
