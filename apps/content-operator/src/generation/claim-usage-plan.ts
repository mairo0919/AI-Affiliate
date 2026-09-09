/**
 * Deterministic Claim Usage Plan + Claim Budget.
 *
 * System decides *which* SUPPORTED claims go to which narrative role.
 * LLM writes natural Japanese within that allocation — no cross-role restatement.
 *
 * Never hardcodes product/performer/series names.
 */

import type { StructurePattern } from "../article-pattern/structure-pattern.js";
import type { EditorialPattern } from "../article-pattern/editorial-pattern.js";
import type { ClaimKind } from "./select-claims-for-structure-pattern.js";

export type NarrativeClaimRole = "hook" | "interest_development" | "cta_bridge";

export type ClaimReusePolicy = "no_restatement";

export type ClaimUsageAssignment = {
  claimId: string;
  kind: ClaimKind;
  assignedRole: NarrativeClaimRole | "unused";
  reusePolicy: ClaimReusePolicy;
};

export type GroundedInferencePolicy = {
  allowed: Array<"direct_paraphrase" | "safe_composition" | "editorial_interpretation">;
  forbidden: Array<
    | "interpretive_inference"
    | "evaluative_inference"
    | "social_proof"
    | "name_derived_setting"
    | "external_world_claim"
  >;
  notes: string[];
};

export type ClaimBudget = {
  selectedCount: number;
  assignedCount: number;
  targetMaxCharsApprox: number;
  targetMaxParagraphs: number;
  allowPadding: false;
  preferShortArticle: boolean;
};

export type ClaimUsagePlan = {
  assignments: ClaimUsageAssignment[];
  hookClaimIds: string[];
  developmentClaimIds: string[];
  ctaClaimIds: string[];
  omitCtaBridge: boolean;
  omitInterestDevelopment: boolean;
  effectiveMaxArticleSections: number;
  effectiveMinArticleSections: number;
  claimBudget: ClaimBudget;
  groundedInference: GroundedInferencePolicy;
};

export type SelectedClaimForPlan = {
  id: string;
  statement: string;
  kind: ClaimKind;
};

const DEFAULT_INFERENCE: GroundedInferencePolicy = {
  allowed: ["direct_paraphrase", "safe_composition", "editorial_interpretation"],
  forbidden: ["social_proof", "name_derived_setting", "external_world_claim"],
  notes: [
    "direct_paraphrase: restate a SUPPORTED fact in natural Japanese without adding relations.",
    "safe_composition: join already-assigned SUPPORTED facts for the same role only.",
    "editorial_interpretation: allowed — relate planned facts and judge volume/theme/who-it-suits without inventing external-world claims.",
    "social_proof: forbidden — popularity/fame/'known as' without SUPPORTED claim.",
    "external_world_claim: forbidden — 売上No.1 / 大人気 / ファンから高評価 / 最高傑作 without Evidence.",
    "name_derived_setting: forbidden — do not infer stage/location/plot from a series or title name alone.",
  ],
};

/**
 * Allocate selected claims to narrative roles without overlap.
 * Hook takes opening budget first; remaining go to interest_development; CTA gets none.
 */
export function buildClaimUsagePlan(input: {
  selectedClaims: SelectedClaimForPlan[];
  openingClaimIds: string[];
  structurePattern?: StructurePattern | null;
  editorial?: EditorialPattern | null;
}): ClaimUsagePlan {
  // structurePattern informs section budget via block count (used below)
  const structureMaxSections = Math.max(
    1,
    (input.structurePattern?.blocks ?? []).filter((b) => b.role !== "hook").length || 1,
  );
  const selected = input.selectedClaims;
  const maxOpening = Math.max(1, input.editorial?.opening.maxOpeningClaims ?? 2);
  const byId = new Map(selected.map((c) => [c.id, c]));
  const catalogKinds = new Set(["availability", "maker", "temporal_sale"]);
  const concreteSelected = selected.filter((c) => !catalogKinds.has(c.kind));
  // Reserve ≥1 concrete claim for development when possible (lead≠whole article).
  const openingWanted = Math.min(
    maxOpening,
    Math.max(1, concreteSelected.length <= 1 ? 1 : Math.min(2, concreteSelected.length - 1)),
  );

  const hookIds: string[] = [];

  for (const id of input.openingClaimIds) {
    if (hookIds.length >= openingWanted) break;
    if (byId.has(id) && !hookIds.includes(id)) hookIds.push(id);
  }
  for (const c of selected) {
    if (hookIds.length >= openingWanted) break;
    if (catalogKinds.has(c.kind)) continue;
    if (!hookIds.includes(c.id)) hookIds.push(c.id);
  }

  const hookSet = new Set(hookIds);
  const omitLow = new Set(
    input.editorial?.informationSelection.omitWhenLowValue ?? [
      "availability",
      "maker",
      "temporal_sale",
    ],
  );

  const devIds: string[] = [];
  for (const c of selected) {
    if (hookSet.has(c.id)) continue;
    if (omitLow.has(c.kind) && c.kind !== "series") continue;
    // series: allow at most one in development if no other remaining traits/performers
    if (c.kind === "series" && omitLow.has("series")) {
      // mid-fact placement often avoids series in opening; one series in development OK
      // only if we still have no development claims yet
      if (devIds.length > 0) continue;
    }
    if (c.kind === "maker" || c.kind === "availability" || c.kind === "temporal_sale") continue;
    devIds.push(c.id);
  }

  // If nothing left for development, allow a single performer/series leftover (not in hook)
  if (devIds.length === 0) {
    const leftover = selected.find(
      (c) => !hookSet.has(c.id) && (c.kind === "performer" || c.kind === "series"),
    );
    if (leftover) devIds.push(leftover.id);
  }

  // Facet-expandable hook (long title/trait): body may use unused facets even without
  // a separate development claimId — do not force omitInterestDevelopment.
  const hookHasExpandableFacets = hookIds.some((id) => {
    const c = byId.get(id);
    if (!c) return false;
    if (c.kind === "maker" || c.kind === "availability" || c.kind === "temporal_sale") {
      return false;
    }
    // Rough facet richness: long concrete statements carry multiple details
    return c.statement.replace(/\s+/g, "").length >= 40;
  });

  const omitInterestDevelopment = devIds.length === 0 && !hookHasExpandableFacets;
  // CTA bridge is NOT a global fixed policy — omit when no new editorial value.
  const omitCtaBridge = omitInterestDevelopment || assignedCountWouldBeScarce(hookIds, devIds);

  const assignedIds = new Set([...hookIds, ...devIds]);
  const assignments: ClaimUsageAssignment[] = selected.map((c) => ({
    claimId: c.id,
    kind: c.kind,
    assignedRole: hookIds.includes(c.id)
      ? "hook"
      : devIds.includes(c.id)
        ? "interest_development"
        : "unused",
    reusePolicy: "no_restatement",
  }));

  const assignedCount = assignedIds.size;
  const preferShort = assignedCount <= 3;
  const targetMaxParagraphs = Math.max(
    2,
    Math.min(4, (hookIds.length > 0 ? 1 : 0) + (omitInterestDevelopment ? 0 : Math.min(2, Math.max(1, devIds.length)))),
  );
  // Soft guidance only — not a quality hard-fail SSOT (Decision 2).
  const targetMaxCharsApprox = Math.max(160, Math.min(480, 80 + assignedCount * 85));

  const effectiveMaxArticleSections = omitCtaBridge
    ? 1
    : Math.min(2, Math.max(1, structureMaxSections));
  const effectiveMinArticleSections = 1;

  return {
    assignments,
    hookClaimIds: hookIds,
    developmentClaimIds: devIds,
    ctaClaimIds: [],
    omitCtaBridge,
    omitInterestDevelopment,
    effectiveMaxArticleSections,
    effectiveMinArticleSections,
    claimBudget: {
      selectedCount: selected.length,
      assignedCount,
      targetMaxCharsApprox,
      targetMaxParagraphs,
      allowPadding: false,
      preferShortArticle: preferShort,
    },
    groundedInference: DEFAULT_INFERENCE,
  };
}

function assignedCountWouldBeScarce(hookIds: string[], devIds: string[]): boolean {
  return hookIds.length + devIds.length <= 2;
}

/** Prompt-safe contract slice */
export function toClaimUsagePlanPromptContract(plan: ClaimUsagePlan): Record<string, unknown> {
  return {
    hookClaimIds: plan.hookClaimIds,
    developmentClaimIds: plan.developmentClaimIds,
    ctaClaimIds: plan.ctaClaimIds,
    omitCtaBridge: plan.omitCtaBridge,
    omitInterestDevelopment: plan.omitInterestDevelopment,
    effectiveMaxArticleSections: plan.effectiveMaxArticleSections,
    effectiveMinArticleSections: plan.effectiveMinArticleSections,
    assignments: plan.assignments,
    claimBudget: plan.claimBudget,
    groundedInference: plan.groundedInference,
    rules: [
      "Each claimId may be used in at most ONE narrative role (hook XOR interest_development).",
      "reusePolicy=no_restatement: do not paraphrase the same claimId (or its facets) across paragraphs or roles.",
      "omitCtaBridge=true → do NOT emit a CTA prose section; use cta widget only.",
      "If developmentClaimIds is non-empty: write interest_development using ONLY those claimIds — concrete SUPPORTED facts that advance beyond the lead, never maker/availability catalog filler.",
      "If omitInterestDevelopment=false and developmentClaimIds is empty: advance body using unused SUPPORTED facets from the hook claim (facet split) — still no maker/eval padding.",
      "If omitInterestDevelopment=true: put substance in lead; sections[0] must be a single short non-evaluative line without new claims (schema needs ≥1 section) — never pad.",
      "claimBudget targets are soft guidance / observability only — never fail solely for being longer when information gain is high.",
      "Shorter dense articles are SUCCESS when claims are few — do not target fixed long length.",
      "groundedInference: direct_paraphrase + safe_composition + editorial_interpretation (volume/theme/who-it-suits from planned facts). Forbidden: social_proof / external_world_claim / name_derived_setting (売上No.1, 大人気, stage inferred from series name alone).",
      "summary: list/search snippet from central assigned claims — not 「〜を紹介します」 meta.",
    ],
  };
}
