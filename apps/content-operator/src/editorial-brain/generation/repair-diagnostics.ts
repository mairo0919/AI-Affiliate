/**
 * Read-only repair failure classification A–G (diagnostics only — no new quality rules).
 */

import { extractTextFacets } from "../shadow/assertion-extract.js";
import type { EditorialFailure, EditorialReviewReport } from "../core/types.js";
import { facetKey } from "./informational-contribution.js";
import type { RepairOperation } from "./repair-operation.js";

export type RepairFailureClass =
  | "GENERATION_ROLE_VIOLATION"
  | "CLAIM_RESTATEMENT"
  | "CROSS_SEGMENT_DEPENDENCY"
  | "REPAIR_NON_COMPLIANCE"
  | "REPAIR_NEW_FAILURE"
  | "PLAN_UNDERCONSTRAINED"
  | "REVIEW_EQUIVALENCE_EDGE";

export type SegmentRepairDiag = {
  segmentId: string;
  operation?: RepairOperation | null;
  originalText: string;
  repairedText: string;
  allowedClaimIds: string[];
  originalFacets: string[];
  repairedFacets: string[];
  removedFacets: string[];
  retainedFacets: string[];
  newlyAddedFacets: string[];
  classifications: RepairFailureClass[];
  notes: string[];
};

function codes(f: EditorialFailure[]): string[] {
  return f.map((x) => x.code);
}

/**
 * Classify a repair outcome independently of Reviewer threshold.
 */
export function classifyRepairSegment(input: {
  segmentId: string;
  originalText: string;
  repairedText: string;
  allowedClaimIds: string[];
  operation?: RepairOperation | null;
  initialFailureCodes: string[];
  postFailureCodes: string[];
  leadText?: string;
}): SegmentRepairDiag {
  const originalFacets = extractTextFacets(input.originalText);
  const repairedFacets = extractTextFacets(input.repairedText);
  const origKeys = new Set(originalFacets.map(facetKey));
  const repKeys = new Set(repairedFacets.map(facetKey));
  const removedFacets = originalFacets.filter((f) => !repKeys.has(facetKey(f)));
  const retainedFacets = originalFacets.filter((f) => repKeys.has(facetKey(f)));
  const newlyAddedFacets = repairedFacets.filter((f) => !origKeys.has(facetKey(f)));

  const classifications: RepairFailureClass[] = [];
  const notes: string[] = [];

  const leadFacets = extractTextFacets(input.leadText ?? "");
  const leadKeys = new Set(leadFacets.map(facetKey));
  const restatesLead =
    input.segmentId.startsWith("section") &&
    repairedFacets.filter((f) => leadKeys.has(facetKey(f))).length >= 1 &&
    retainedFacets.filter((f) => leadKeys.has(facetKey(f))).length >= 1;

  if (restatesLead) {
    classifications.push("CLAIM_RESTATEMENT");
    classifications.push("CROSS_SEGMENT_DEPENDENCY");
    notes.push("Repaired body still shares lead facets (restatement)");
  }

  if (
    input.operation === "REWRITE" &&
    input.initialFailureCodes.includes("REPETITION") &&
    restatesLead
  ) {
    classifications.push("REPAIR_NON_COMPLIANCE");
    notes.push("REWRITE used where DELETE/REPLACE was required for repetition");
  }

  if (
    input.operation === "DELETE" &&
    input.repairedText.trim() === "" &&
    !input.postFailureCodes.includes("REPETITION")
  ) {
    notes.push("DELETE cleared material restatement");
  }

  const newCodes = input.postFailureCodes.filter((c) => !input.initialFailureCodes.includes(c));
  if (newCodes.length > 0) {
    classifications.push("REPAIR_NEW_FAILURE");
    notes.push(`New failure codes after repair: ${newCodes.join(",")}`);
  }

  // Fabrication signal: repaired text splits jammed names not in allowed claims
  if (/優梨まいなとましろ杏/.test(input.repairedText)) {
    classifications.push("REPAIR_NEW_FAILURE");
    notes.push("Repair invented cast split not present as supported contribution");
  }

  if (
    input.allowedClaimIds.length <= 1 &&
    input.initialFailureCodes.includes("REPETITION") &&
    restatesLead
  ) {
    classifications.push("PLAN_UNDERCONSTRAINED");
    notes.push("Few allowed claims/facets for body; plan left restatement as only filler");
  }

  // Soft: if facets reduced materially but reviewer still flags same code
  if (
    removedFacets.length >= 2 &&
    retainedFacets.length <= 1 &&
    input.postFailureCodes.includes("REPETITION") &&
    !restatesLead
  ) {
    classifications.push("REVIEW_EQUIVALENCE_EDGE");
    notes.push("Large facet removal but REPETITION retained — possible equivalence edge");
  }

  if (
    input.initialFailureCodes.some((c) =>
      ["NAME_DERIVED_INFERENCE", "EVALUATIVE_INFERENCE", "UNSUPPORTED_INFERENCE"].includes(c),
    ) &&
    newlyAddedFacets.length === 0 &&
    input.segmentId === "lead"
  ) {
    // role may have generated unsupported meaning initially
    classifications.push("GENERATION_ROLE_VIOLATION");
  }

  return {
    segmentId: input.segmentId,
    operation: input.operation ?? null,
    originalText: input.originalText,
    repairedText: input.repairedText,
    allowedClaimIds: input.allowedClaimIds,
    originalFacets,
    repairedFacets,
    removedFacets,
    retainedFacets,
    newlyAddedFacets,
    classifications: [...new Set(classifications)],
    notes,
  };
}

export function classifyRepairRun(input: {
  initialReview: EditorialReviewReport;
  postRepairReview: EditorialReviewReport | null;
  targets: Array<{
    segmentId: string;
    originalText: string;
    repairedText: string;
    allowedClaimIds: string[];
    operation?: RepairOperation | null;
  }>;
  leadText: string;
}): {
  initialFailures: string[];
  postRepairFailures: string[];
  segments: SegmentRepairDiag[];
  dominantClasses: RepairFailureClass[];
} {
  const initialFailures = codes(input.initialReview.failures);
  const postRepairFailures = input.postRepairReview
    ? codes(input.postRepairReview.failures)
    : [];
  const segments = input.targets.map((t) =>
    classifyRepairSegment({
      ...t,
      initialFailureCodes: initialFailures,
      postFailureCodes: postRepairFailures,
      leadText: input.leadText,
    }),
  );
  const dominantClasses = [
    ...new Set(segments.flatMap((s) => s.classifications)),
  ] as RepairFailureClass[];
  return { initialFailures, postRepairFailures, segments, dominantClasses };
}
