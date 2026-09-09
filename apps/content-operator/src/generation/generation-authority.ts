/**
 * Generation authority SSOT — OPTION B (primary).
 *
 * r114: Writer-visible SSOT is ARTICLE_PLAN only (Planner-owned WHAT/ORDER/DEPTH/STOP).
 * EvidencePack / WritingSkeleton soft HOW are not Writer-injected.
 * R151: ARTICLE_PLAN_EXECUTION must reach Writer whenever ARTICLE_PLAN exists.
 */

import {
  buildArticlePlanExecutionContract,
  toWriterExecutionContractView,
} from "../article-pattern/plan-execution-contract.js";
import { toWriterVisibleArticlePlan } from "../article-pattern/leadless-article.js";

export const GENERATION_AUTHORITY_PRIORITY = [
  "ARTICLE_PLAN",
  "FACTUAL_SAFETY",
  "BLOG_CHANNEL_REQUIREMENTS",
] as const;

/** @deprecated r15 path — kept for tests/compat; not injected into Generator when OPTION B is active */
export const LEGACY_GENERATION_AUTHORITY_PRIORITY = [
  "FACTUAL_SAFETY",
  "SEGMENT_CONTRACTS",
  "EVIDENCE_MAPPING_PLAN",
  "REFERENCE_TRANSFORM_BLUEPRINT",
  "REFERENCE_BLUEPRINT",
  "EDITORIAL_PLAN",
  "SELECTED_PATTERN_SUMMARY",
  "GENERIC_WRITING_STYLE",
] as const;

export type GenerationAuthorityRank = (typeof GENERATION_AUTHORITY_PRIORITY)[number];

/** Structured regen correction item — Writer-visible on attempt 2+ only. */
export type PlanRegenViolation = {
  code: string;
  slot: "title" | "lead" | "body" | "article";
  fact: string;
  reason: string;
  /** R151 — missing required anchors from execution contract */
  missingAnchors?: string[];
  /** R151 — missing required semantic relations */
  missingRelations?: string[];
  /** R151 — unexpected meaning detected (optional) */
  unexpectedMeaning?: string[];
  /** Exact Writer sentence that triggered BLOCKING (eval/overreach) — delete, do not rewrite Plan */
  unsupportedSentence?: string;
};

export type PlanViolationFeedback = {
  attempt: number;
  violatedSegments: string[];
  missingRequiredContributionIds: string[];
  forbiddenReusedContributionIds: string[];
  prematurelyConsumedContributionIds?: string[];
  codes: string[];
  consumedContributionFacets?: string[];
  semanticReuseFamilies?: string[];
  failureClass?: string;
  failureSignature?: string;
  note: string;
  /** r141 — corrective regen payload derived from Compliance findings + ArticlePlan facts */
  violations?: PlanRegenViolation[];
  instruction?: string;
};

function pickArticlePlan(
  contract: Record<string, unknown>,
): Record<string, unknown> | null {
  const layers =
    typeof contract.layers === "object" && contract.layers
      ? (contract.layers as Record<string, unknown>)
      : {};
  const plan =
    (contract.articlePlan as Record<string, unknown> | undefined) ??
    (contract.ARTICLE_PLAN as Record<string, unknown> | undefined) ??
    (layers.ARTICLE_PLAN as Record<string, unknown> | undefined) ??
    null;
  return plan && typeof plan === "object" ? plan : null;
}

function planLooksExecutable(plan: Record<string, unknown>): boolean {
  const title = plan.title as { facts?: unknown } | undefined;
  const body = plan.body;
  // Leadless: lead may be absent or empty; title + body are required.
  return Array.isArray(title?.facts) && Array.isArray(body);
}

/**
 * R151 reconnect — if CONTRACT forgot ARTICLE_PLAN_EXECUTION, derive from plan.
 * Prevents Writer-facing EXEC drop when only ARTICLE_PLAN was attached.
 */
export function resolveArticlePlanExecution(
  plan: Record<string, unknown>,
  explicit?: unknown[] | null,
): unknown[] {
  if (Array.isArray(explicit) && explicit.length > 0) return explicit;
  if (Array.isArray(plan.execution) && (plan.execution as unknown[]).length > 0) {
    return plan.execution as unknown[];
  }
  if (!planLooksExecutable(plan)) return Array.isArray(explicit) ? explicit : [];
  const lead = (plan.lead as { facts?: string[] } | undefined) ?? { facts: [] };
  return toWriterExecutionContractView(
    buildArticlePlanExecutionContract({
      title: plan.title as { facts: string[] },
      lead: { facts: Array.isArray(lead.facts) ? lead.facts : [] },
      body: plan.body as Array<{ facts: string[] }>,
    }),
  );
}

/**
 * OPTION B Writer authority — ARTICLE_PLAN only (r114).
 */
export function buildOptionBGenerationAuthority(input: {
  articlePlan: Record<string, unknown>;
  planViolationFeedback?: PlanViolationFeedback | null;
  /** R151 — structured per-contribution execution contract */
  articlePlanExecution?: unknown[] | null;
  /** Human-validated writing quality guidance (not factual authority). */
  writingQualityGuidance?: Record<string, unknown> | null;
  channel?: {
    ctaRequired?: boolean;
    disclosureSystemAppended?: boolean;
    language?: string;
  };
}): Record<string, unknown> {
  const writerPlan = toWriterVisibleArticlePlan(input.articlePlan);
  const execution = resolveArticlePlanExecution(
    {
      ...writerPlan,
      // EXEC builder tolerates empty lead; keep shape if absent.
      lead: (writerPlan.lead as { facts: string[] } | undefined) ?? { facts: [] },
      title: writerPlan.title as { facts: string[] },
      body: writerPlan.body as Array<{ facts: string[] }>,
    },
    input.articlePlanExecution,
  );
  return {
    mode: "OPTION_B",
    authorityPriority: [...GENERATION_AUTHORITY_PRIORITY],
    rule: "ARTICLE_PLAN is the sole Writer factual SSOT. Realize slot facts; do not invent concrete facts absent from the plan; do not re-select materials. Within that boundary, write as an editorial article writer (select/order/relate/explain/interpret) — not a fact formatter. ARTICLE_PLAN_EXECUTION defines what each fact must preserve. Leadless: no lead slot — opening materials are in body. WRITING_QUALITY_GUIDANCE (when present) is abstract WHY-it-worked quality advice only — never copy wording and never invent facts.",
    ARTICLE_PLAN: writerPlan,
    ARTICLE_PLAN_EXECUTION: execution.length > 0 ? execution : null,
    WRITING_QUALITY_GUIDANCE: input.writingQualityGuidance ?? null,
    FACTUAL_SAFETY: {
      noInventedFacts: true,
      noFabricatedSocialProof: true,
      noInventedImageUrls: true,
    },
    BLOG_CHANNEL_REQUIREMENTS: {
      language: input.channel?.language ?? "ja",
      ctaAppendedBySystem: true,
      disclosureAppendedBySystem: input.channel?.disclosureSystemAppended !== false,
    },
    planViolationFeedback: input.planViolationFeedback ?? null,
  };
}

/**
 * @deprecated r114 — use buildOptionBGenerationAuthority({ articlePlan }).
 * Kept for transitional call sites that still pass skeleton+pack; builds nothing soft.
 */
export function buildOptionBGenerationAuthorityLegacySkeleton(input: {
  writingSkeleton: Record<string, unknown>;
  evidencePack: Record<string, unknown>;
  planViolationFeedback?: PlanViolationFeedback | null;
  channel?: {
    ctaRequired?: boolean;
    disclosureSystemAppended?: boolean;
    language?: string;
  };
}): Record<string, unknown> {
  void input.writingSkeleton;
  void input.evidencePack;
  return {
    mode: "TRANSITION_MINIMAL",
    authorityPriority: [...GENERATION_AUTHORITY_PRIORITY],
    rule: "ARTICLE_PLAN missing — do not invent. Prefer DEFER.",
    ARTICLE_PLAN: null,
    FACTUAL_SAFETY: {
      noInventedFacts: true,
      noFabricatedSocialProof: true,
      noInventedImageUrls: true,
    },
    BLOG_CHANNEL_REQUIREMENTS: {
      language: "ja",
      ctaAppendedBySystem: true,
      disclosureAppendedBySystem: true,
    },
    planViolationFeedback: input.planViolationFeedback ?? null,
  };
}

export function buildGenerationAuthorityPromptContract(input: {
  brainGenerationContract: Record<string, unknown>;
  editorialPatternSummary?: Record<string, unknown> | null;
  structurePatternSummary?: Record<string, unknown> | null;
  planViolationFeedback?: PlanViolationFeedback | null;
  plannerFailureTendencies?: Record<string, unknown> | null;
  writingQualityGuidance?: Record<string, unknown> | null;
}): Record<string, unknown> {
  void input.editorialPatternSummary;
  void input.structurePatternSummary;
  // Failure tendencies stay out of Writer factual authority (avoid sterile coverage-only pressure).
  void input.plannerFailureTendencies;

  const articlePlan = pickArticlePlan(input.brainGenerationContract);
  if (articlePlan) {
    const layers =
      typeof input.brainGenerationContract.layers === "object" &&
      input.brainGenerationContract.layers
        ? (input.brainGenerationContract.layers as Record<string, unknown>)
        : {};
    const explicit = Array.isArray(articlePlan.execution)
      ? (articlePlan.execution as unknown[])
      : Array.isArray(input.brainGenerationContract.ARTICLE_PLAN_EXECUTION)
        ? (input.brainGenerationContract.ARTICLE_PLAN_EXECUTION as unknown[])
        : Array.isArray(layers.ARTICLE_PLAN_EXECUTION)
          ? (layers.ARTICLE_PLAN_EXECUTION as unknown[])
          : null;
    return buildOptionBGenerationAuthority({
      articlePlan,
      articlePlanExecution: explicit,
      planViolationFeedback: input.planViolationFeedback,
      writingQualityGuidance: input.writingQualityGuidance ?? null,
    });
  }

  return {
    mode: "TRANSITION_MINIMAL",
    authorityPriority: [...GENERATION_AUTHORITY_PRIORITY],
    rule: "ARTICLE_PLAN missing — use FACTUAL_SAFETY only; do not invent. Prefer DEFER over catalog padding.",
    ARTICLE_PLAN: null,
    ARTICLE_PLAN_EXECUTION: null,
    WRITING_QUALITY_GUIDANCE: input.writingQualityGuidance ?? null,
    FACTUAL_SAFETY: {
      noInventedFacts: true,
      noFabricatedSocialProof: true,
      noInventedImageUrls: true,
    },
    BLOG_CHANNEL_REQUIREMENTS: {
      language: "ja",
      ctaAppendedBySystem: true,
      disclosureAppendedBySystem: true,
    },
    planViolationFeedback: input.planViolationFeedback ?? null,
  };
}

/** Slim pattern contracts — strategy headers only (no duplicate instruction walls). */
export function slimEditorialPatternForPrompt(
  full: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!full) return null;
  return {
    patternId: full.patternId,
    label: full.label,
    opening: full.opening,
    development: full.development,
    transition: full.transition,
    avoidCategories: full.avoidCategories,
    title: full.title,
    summaryRole: full.summaryRole,
  };
}

export function slimStructurePatternForPrompt(
  full: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!full) return null;
  return {
    patternId: full.patternId,
    label: full.label,
    blocks: full.blocks,
    articleOutputContract: full.articleOutputContract,
    constraints: full.constraints,
  };
}

export function slimClaimUsagePlanForPrompt(
  full: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!full) return null;
  return {
    hookClaimIds: full.hookClaimIds,
    developmentClaimIds: full.developmentClaimIds,
    omitCtaBridge: full.omitCtaBridge,
    omitInterestDevelopment: full.omitInterestDevelopment,
    claimBudget: full.claimBudget,
    groundedInference: full.groundedInference,
  };
}

/** Approximate JSON size for tests (UTF-8 bytes). */
export function estimateAuthorityJsonBytes(authority: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(authority), "utf8");
}
