/**
 * Safe Experience → Planner hints.
 * Never dumps Experience prose into the Generator prompt.
 * Never mutates LearningRules.
 */

import type { ExperienceRetrievalHit, ExperienceRetrievalResult } from "../core/types.js";

export type PlannerFailureTendencyHint = {
  editorialPatternId: string | null;
  failureClass: string;
  sampleCount: number;
  outcome: string | null;
  executionConstraint: string;
};

const PLAN_FAIL_CODES = new Set([
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
]);

const CONSTRAINT_BY_CLASS: Record<string, string> = {
  LEAD_BODY_OVERLAP:
    "Do not restate lead-required facets in any body paragraph; advance with unused development contributions only.",
  FORBIDDEN_CONTRIBUTION_REUSED:
    "Treat lead-consumed contribution ids as hard-forbidden in body — paraphrase of the same facet counts as reuse.",
  STRUCTURAL_PROGRESSION_FAILURE:
    "Enforce progressive consumption: each body paragraph must introduce a new allowed contribution id.",
  REQUIRED_CONTRIBUTION_MISSING:
    "Every requiredContribution id for a segment must appear as that facet in the segment text.",
  PLAN_EXECUTION_FAILED:
    "Execute SEGMENT_CONTRACTS before style; return accurate segmentContributionProvenance.",
  GENERATION_PLAN_UNDERUSE:
    "Prefer assigning distinct development contributions across body paragraphs instead of padding.",
  REPETITION:
    "Avoid repeating the same facet across lead and body; use atomic contribution identity.",
  SEMANTIC_CONTRIBUTION_REUSE:
    "Do not restate semantically equivalent lead contributions (incl. scene stem families) in body.",
  COMPOSITE_COMPONENT_RESTATEMENT:
    "If lead used a duration+scene composite, do not restate either component alone in body.",
  PROVENANCE_CONTRADICTION:
    "segmentContributionProvenance must not claim body used lead-consumed contributions.",
  REPEATED_PLAN_EXECUTION_FAILURE:
    "Same plan-failure signature already occurred — change contribution allocation, do not paraphrase.",
};

/**
 * Collapse retrieval hits into short planner constraints (max a few lines).
 */
export function summarizePlanFailureTendencies(
  result: ExperienceRetrievalResult,
  opts?: { editorialPatternId?: string | null; maxHints?: number },
): PlannerFailureTendencyHint[] {
  const maxHints = opts?.maxHints ?? 4;
  const byClass = new Map<string, { count: number; outcome: string | null }>();

  for (const hit of result.hits) {
    const codes = hit.failureCodes.filter((c) => PLAN_FAIL_CODES.has(c));
    const classes = codes.length ? codes : hit.outcome ? [hit.outcome] : [];
    for (const code of classes) {
      if (!PLAN_FAIL_CODES.has(code)) continue;
      const prev = byClass.get(code) ?? { count: 0, outcome: hit.outcome };
      prev.count += 1;
      byClass.set(code, prev);
    }
  }

  const hints: PlannerFailureTendencyHint[] = [];
  for (const [failureClass, agg] of byClass) {
    if (agg.count < 1) continue;
    hints.push({
      editorialPatternId: opts?.editorialPatternId ?? null,
      failureClass,
      sampleCount: agg.count,
      outcome: agg.outcome,
      executionConstraint:
        CONSTRAINT_BY_CLASS[failureClass] ??
        "Obey SEGMENT_CONTRACTS progressive consumption; do not free-write around the plan.",
    });
  }

  hints.sort((a, b) => b.sampleCount - a.sampleCount);
  return hints.slice(0, maxHints);
}

export function formatTendencyHintsForAuthority(
  hints: PlannerFailureTendencyHint[],
): Record<string, unknown> | null {
  if (!hints.length) return null;
  return {
    note: "Past generation outcomes for similar pattern/failure class — constraints only, not prose to copy.",
    hints: hints.map((h) => ({
      failureClass: h.failureClass,
      sampleCount: h.sampleCount,
      constraint: h.executionConstraint,
    })),
  };
}

export function experienceHitsAreRetrievalOnly(hits: ExperienceRetrievalHit[]): boolean {
  // Guard: we never pass lesson bodies — hits carry ids/codes only.
  return hits.every((h) => typeof h.id === "string" && Array.isArray(h.failureCodes));
}
