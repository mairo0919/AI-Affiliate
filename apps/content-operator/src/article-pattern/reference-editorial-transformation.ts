/**
 * ReferenceEditorialTransformationBlueprint — Evidence → editorial prose operations.
 * NEVER stores competitor prose, quotes, or reusable sentence templates.
 * Derived deterministically from paragraph/evidence signals (and optional ephemeral HTML).
 */

import type {
  BlueprintEvidenceType,
  ReferenceEditorialBlueprint,
  ReferenceBlueprintSegment,
} from "./reference-editorial-blueprint.js";

export type FactLexicalization =
  | "direct_statement"
  | "scene_first"
  | "performer_first"
  | "quantity_first"
  | "situation_first"
  | "contrastive"
  | "contextualized_fact"
  | "progressive_detail";

export type ClausePackaging =
  | "PRIMARY_ONLY"
  | "PRIMARY_THEN_SUPPORT"
  | "CONTEXT_THEN_PRIMARY"
  | "PRIMARY_THEN_CONTEXT";

export type TitleTransformation =
  | "extract_fact"
  | "defer_title_identity"
  | "split_composite_title"
  | "quote_only_named_series"
  | "do_not_restate_full_title";

export type CutOffStrategy =
  | "stop_when_mapped_evidence_exhausted"
  | "stop_after_last_new_concrete_family"
  | "never_pad_with_generic_closing";

export type CatalogAvoidanceOp =
  | "no_maker_only_paragraph"
  | "no_availability_in_development"
  | "no_performer_existence_only_paragraph"
  | "no_title_restatement_as_development"
  | "no_generic_evaluative_closing";

export type TransitionStrategy =
  | "change_evidence_family"
  | "deepen_same_family_with_new_facet"
  | "shift_to_performer_context"
  | "shift_to_scene"
  | "shift_to_quantity"
  | "end_without_padding";

export type TransformationReadiness =
  | "TRANSFORM_READY"
  | "TRANSFORM_PARTIAL"
  | "REOBSERVE_REQUIRED"
  | "REJECT_REFERENCE";

export type SegmentTransformationOp = {
  segmentIndex: number;
  role: ReferenceBlueprintSegment["role"];
  factLexicalization: FactLexicalization;
  clausePackaging: ClausePackaging;
  paragraphProgression: string;
  transitionStrategy: TransitionStrategy;
  cutOffRule: CutOffStrategy;
  catalogAvoidance: CatalogAvoidanceOp[];
};

export type ReferenceEditorialTransformationBlueprint = {
  schemaVersion: 1;
  referenceId: string | null;
  readiness: TransformationReadiness;
  titleTransformation: TitleTransformation;
  cutOffStrategy: CutOffStrategy;
  catalogAvoidance: CatalogAvoidanceOp[];
  segmentOps: SegmentTransformationOp[];
  /** Abstract progression of new evidence families — no prose */
  paragraphProgression: string[];
  extractedAt: string;
  extractionMode: "from_paragraph_blueprint" | "partial_from_features" | "unavailable";
};

function lexicalizationFor(type: BlueprintEvidenceType, role: string): FactLexicalization {
  if (type === "scene_or_act") return role === "lead" ? "scene_first" : "progressive_detail";
  if (type === "performer_identity") return "performer_first";
  if (type === "quantity_or_runtime") return "quantity_first";
  if (type === "setting_or_situation") return "situation_first";
  if (type === "series_or_event") return "contextualized_fact";
  if (type === "body_trait") return role === "lead" ? "direct_statement" : "progressive_detail";
  return "direct_statement";
}

function packagingFor(seg: ReferenceBlueprintSegment): ClausePackaging {
  if (seg.specificityLevel === "high" && seg.evidenceTypeUsed.length >= 2) {
    return "PRIMARY_THEN_SUPPORT";
  }
  if (seg.role === "lead" && seg.primaryEvidenceType === "audience_framing") {
    return "CONTEXT_THEN_PRIMARY";
  }
  if (seg.approximateInformationDensity === "high") return "PRIMARY_THEN_CONTEXT";
  return "PRIMARY_ONLY";
}

function transitionFor(seg: ReferenceBlueprintSegment): TransitionStrategy {
  const t = seg.transitionFunction;
  if (/shift_to_scene|scene_or_act/.test(t)) return "shift_to_scene";
  if (/shift_to_performer|performer/.test(t)) return "shift_to_performer_context";
  if (/quantity|runtime/.test(t)) return "shift_to_quantity";
  if (/cta|end/.test(seg.role)) return "end_without_padding";
  if (/deepen|same/.test(t)) return "deepen_same_family_with_new_facet";
  return "change_evidence_family";
}

const DEFAULT_AVOID: CatalogAvoidanceOp[] = [
  "no_maker_only_paragraph",
  "no_availability_in_development",
  "no_performer_existence_only_paragraph",
  "no_title_restatement_as_development",
  "no_generic_evaluative_closing",
];

/**
 * Build transformation blueprint from an existing ReferenceEditorialBlueprint (no prose).
 */
export function extractTransformationFromEditorialBlueprint(
  blueprint: ReferenceEditorialBlueprint,
): ReferenceEditorialTransformationBlueprint {
  const concrete = blueprint.segments.filter(
    (s) =>
      (s.role === "lead" || s.role === "development") &&
      !["transition_only", "evaluative_framing", "availability_or_catalog"].includes(
        s.primaryEvidenceType,
      ),
  );
  const readiness: TransformationReadiness =
    blueprint.extractionMode !== "paragraph_functions"
      ? "TRANSFORM_PARTIAL"
      : concrete.length >= 2
        ? "TRANSFORM_READY"
        : concrete.length === 1
          ? "TRANSFORM_PARTIAL"
          : "REOBSERVE_REQUIRED";

  const hasSeries = blueprint.evidenceTypesAdopted.includes("series_or_event");
  const titleTransformation: TitleTransformation = hasSeries
    ? "quote_only_named_series"
    : blueprint.materialDepth === "rich"
      ? "split_composite_title"
      : "extract_fact";

  const segmentOps: SegmentTransformationOp[] = blueprint.segments.map((seg) => ({
    segmentIndex: seg.index,
    role: seg.role,
    factLexicalization: lexicalizationFor(seg.primaryEvidenceType, seg.role),
    clausePackaging: packagingFor(seg),
    paragraphProgression: `${seg.role}:${seg.editorialFunction}:${seg.primaryEvidenceType}`,
    transitionStrategy: transitionFor(seg),
    cutOffRule: "never_pad_with_generic_closing",
    catalogAvoidance: DEFAULT_AVOID,
  }));

  return {
    schemaVersion: 1,
    referenceId: blueprint.referenceId,
    readiness,
    titleTransformation,
    cutOffStrategy: "stop_when_mapped_evidence_exhausted",
    catalogAvoidance: DEFAULT_AVOID,
    segmentOps,
    paragraphProgression: segmentOps.map((s) => s.paragraphProgression),
    extractedAt: new Date().toISOString(),
    extractionMode:
      readiness === "TRANSFORM_READY"
        ? "from_paragraph_blueprint"
        : readiness === "TRANSFORM_PARTIAL"
          ? "partial_from_features"
          : "unavailable",
  };
}

export function isReferenceEditorialTransformationBlueprint(
  value: unknown,
): value is ReferenceEditorialTransformationBlueprint {
  if (!value || typeof value !== "object") return false;
  const v = value as ReferenceEditorialTransformationBlueprint;
  return (
    v.schemaVersion === 1 &&
    Array.isArray(v.segmentOps) &&
    Array.isArray(v.paragraphProgression) &&
    typeof v.readiness === "string"
  );
}

/** Compact prompt projection — operations only, never prose. */
export function toTransformationPromptContract(
  t: ReferenceEditorialTransformationBlueprint | null | undefined,
): Record<string, unknown> | null {
  if (!t || t.readiness === "REJECT_REFERENCE" || t.extractionMode === "unavailable") {
    return null;
  }
  return {
    readiness: t.readiness,
    titleTransformation: t.titleTransformation,
    cutOffStrategy: t.cutOffStrategy,
    catalogAvoidance: t.catalogAvoidance,
    segmentOps: t.segmentOps.map((s) => ({
      segmentIndex: s.segmentIndex,
      role: s.role,
      factLexicalization: s.factLexicalization,
      clausePackaging: s.clausePackaging,
      paragraphProgression: s.paragraphProgression,
      transitionStrategy: s.transitionStrategy,
      cutOffRule: s.cutOffRule,
    })),
    paragraphProgression: t.paragraphProgression,
  };
}
