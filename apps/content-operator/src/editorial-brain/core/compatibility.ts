/**
 * Pre-Brain ContentVersion compatibility classification (cutover concepts — no DB enum).
 *
 * Policy:
 * - Never implicit-ACCEPTED when brainLifecycle missing
 * - PUBLISHED historical stays valid (do not invalidate past publications)
 * - REVIEWING/DRAFTED pre-brain → require re-review stamp or regeneration
 */

import { readBrainLifecycle } from "./acceptance.js";

export type ContentVersionCompatibilityClass =
  | "PUBLISHED_HISTORICAL"
  | "DRAFTED_PRE_BRAIN"
  | "REVIEWING_PRE_BRAIN"
  | "GENERATED_PRE_BRAIN"
  | "BRAIN_MANAGED";

export type CompatibilityCutoverAction =
  | "none_historical"
  | "requires_re_review_stamp"
  | "requires_regeneration"
  | "brain_managed"
  | "unsafe_ambiguous";

export type CompatibilityAssessment = {
  compatibilityClass: ContentVersionCompatibilityClass;
  cutoverAction: CompatibilityCutoverAction;
  implicitAcceptForbidden: true;
  notes: string;
};

export function classifyContentVersionCompatibility(input: {
  contentVersionId: string;
  status: string;
  structuredContent: unknown;
  /** True if any PublicationTarget reached published / has publishedAt / PUBLISHED record */
  hasPublishedEvidence: boolean;
  /** True if PublicationTarget exists in draft/scheduled/approved but not published */
  hasDraftTarget: boolean;
  /** Artifact+claims enough for Brain read-only stamp */
  stampable?: boolean;
}): CompatibilityAssessment {
  const lifecycle = readBrainLifecycle(input.structuredContent);
  if (lifecycle) {
    return {
      compatibilityClass: "BRAIN_MANAGED",
      cutoverAction: "brain_managed",
      implicitAcceptForbidden: true,
      notes: `state=${lifecycle.state} downstreamAllowed=${lifecycle.downstreamAllowed}`,
    };
  }

  if (input.hasPublishedEvidence) {
    return {
      compatibilityClass: "PUBLISHED_HISTORICAL",
      cutoverAction: "none_historical",
      implicitAcceptForbidden: true,
      notes: "Pre-Brain published — do not invalidate; not ACTIVE accepted",
    };
  }

  if (input.hasDraftTarget) {
    return {
      compatibilityClass: "DRAFTED_PRE_BRAIN",
      cutoverAction:
        input.stampable === false ? "requires_regeneration" : "requires_re_review_stamp",
      implicitAcceptForbidden: true,
      notes: "Draft exists without brainLifecycle — no implicit accept; stamp or regen",
    };
  }

  if (input.status === "REVIEWING" || input.status === "REVISION_REQUIRED") {
    return {
      compatibilityClass: "REVIEWING_PRE_BRAIN",
      cutoverAction:
        input.stampable === false ? "requires_regeneration" : "requires_re_review_stamp",
      implicitAcceptForbidden: true,
      notes: "REVIEWING without brainLifecycle — explicit stamp or regenerate",
    };
  }

  if (input.status === "APPROVED" || input.status === "DRAFT") {
    return {
      compatibilityClass: "GENERATED_PRE_BRAIN",
      cutoverAction: "requires_regeneration",
      implicitAcceptForbidden: true,
      notes: "Approved/draft without Brain lifecycle — regenerate under Brain path",
    };
  }

  return {
    compatibilityClass: "GENERATED_PRE_BRAIN",
    cutoverAction: "unsafe_ambiguous",
    implicitAcceptForbidden: true,
    notes: `status=${input.status} without lifecycle — treat as ambiguous; no implicit accept`,
  };
}

/** Cutover policy summary for docs/tests. */
export function preBrainCutoverPolicy(): {
  implicitAcceptWhenMissingLifecycle: false;
  bulkDbAcceptMigrationForbidden: true;
  publishedHistoricalInvalidationForbidden: true;
  reviewingPath: "stamp_or_regenerate";
  draftedPath: "stamp_or_regenerate_after_safety_check";
} {
  return {
    implicitAcceptWhenMissingLifecycle: false,
    bulkDbAcceptMigrationForbidden: true,
    publishedHistoricalInvalidationForbidden: true,
    reviewingPath: "stamp_or_regenerate",
    draftedPath: "stamp_or_regenerate_after_safety_check",
  };
}
