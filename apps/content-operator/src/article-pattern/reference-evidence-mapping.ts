/**
 * ReferenceEvidenceMappingPlan — Planner assigns Evidence to Blueprint segments.
 * Generator must not choose Evidence.
 */

import type {
  BlueprintEvidenceType,
  ReferenceBlueprintSegment,
  ReferenceEditorialBlueprint,
} from "./reference-editorial-blueprint.js";
import {
  evidenceAllowedForProse,
  type ResearchEvidence,
} from "./research-evidence.js";

export type MappedSegment = {
  segmentIndex: number;
  role: ReferenceBlueprintSegment["role"];
  editorialFunction: string;
  requiredEvidenceType: BlueprintEvidenceType;
  assignedEvidenceIds: string[];
  assignedFacts: string[];
  status: "mapped" | "unmapped" | "optional_skipped";
};

export type ReferenceEvidenceMappingPlan = {
  schemaVersion: 1;
  blueprintReferenceId: string | null;
  blueprintExtractionMode: ReferenceEditorialBlueprint["extractionMode"];
  materialDepth: ReferenceEditorialBlueprint["materialDepth"];
  mappings: MappedSegment[];
  unusedEvidenceIds: string[];
  insufficient: boolean;
  insufficientReason: string | null;
  deferCode: "DEFER_INSUFFICIENT_REFERENCE_MATERIAL" | null;
};

const OPTIONAL_TYPES = new Set<BlueprintEvidenceType>([
  "evaluative_framing",
  "audience_framing",
  "transition_only",
  "availability_or_catalog",
  "maker_or_label",
]);

function typeCompatible(needed: BlueprintEvidenceType, have: BlueprintEvidenceType): boolean {
  if (needed === have) return true;
  if (needed === "unknown_concrete") {
    return ["scene_or_act", "body_trait", "quantity_or_runtime", "setting_or_situation"].includes(
      have,
    );
  }
  if (needed === "scene_or_act" && have === "body_trait") return true;
  if (needed === "body_trait" && have === "scene_or_act") return true;
  if (needed === "setting_or_situation" && have === "series_or_event") return true;
  return false;
}

/**
 * Map blueprint segments to product evidence. Prefer unused concrete evidence.
 * If required lead/development segments cannot be filled → insufficient / DEFER.
 */
export function buildReferenceEvidenceMappingPlan(input: {
  blueprint: ReferenceEditorialBlueprint;
  evidence: ResearchEvidence[];
}): ReferenceEvidenceMappingPlan {
  const usable = input.evidence.filter(evidenceAllowedForProse);
  const used = new Set<string>();
  const mappings: MappedSegment[] = [];

  for (const seg of input.blueprint.segments) {
    if (seg.role === "cta" || seg.role === "summary" || seg.role === "other") {
      mappings.push({
        segmentIndex: seg.index,
        role: seg.role,
        editorialFunction: seg.editorialFunction,
        requiredEvidenceType: seg.primaryEvidenceType,
        assignedEvidenceIds: [],
        assignedFacts: [],
        status: OPTIONAL_TYPES.has(seg.primaryEvidenceType) ? "optional_skipped" : "unmapped",
      });
      continue;
    }

    const needed = seg.primaryEvidenceType;
    // Soft framing on lead/dev is never a hard Evidence requirement — map concrete instead
    const softNeeded = OPTIONAL_TYPES.has(needed);
    if (softNeeded && seg.role !== "lead") {
      mappings.push({
        segmentIndex: seg.index,
        role: seg.role,
        editorialFunction: seg.editorialFunction,
        requiredEvidenceType: needed,
        assignedEvidenceIds: [],
        assignedFacts: [],
        status: "optional_skipped",
      });
      continue;
    }

    const effectiveNeeded = softNeeded ? "unknown_concrete" : needed;

    const candidate = usable.find(
      (e) => !used.has(e.evidenceId) && typeCompatible(effectiveNeeded, e.facetType),
    );
    // Fallback: any unused concrete
    const fallback =
      candidate ??
      usable.find(
        (e) =>
          !used.has(e.evidenceId) &&
          !OPTIONAL_TYPES.has(e.facetType) &&
          e.facetType !== "transition_only",
      );

    if (!fallback) {
      mappings.push({
        segmentIndex: seg.index,
        role: seg.role,
        editorialFunction: seg.editorialFunction,
        requiredEvidenceType: needed,
        assignedEvidenceIds: [],
        assignedFacts: [],
        status: softNeeded ? "optional_skipped" : "unmapped",
      });
      continue;
    }

    used.add(fallback.evidenceId);
    mappings.push({
      segmentIndex: seg.index,
      role: seg.role,
      editorialFunction: seg.editorialFunction,
      requiredEvidenceType: needed,
      assignedEvidenceIds: [fallback.evidenceId],
      assignedFacts: [fallback.observedFact],
      status: "mapped",
    });
  }

  const requiredUnmapped = mappings.filter(
    (m) =>
      (m.role === "lead" || m.role === "development") &&
      m.status === "unmapped" &&
      !OPTIONAL_TYPES.has(m.requiredEvidenceType),
  );
  const mappedDevOrLead = mappings.filter(
    (m) =>
      (m.role === "lead" || m.role === "development") && m.status === "mapped",
  );
  // Soft insufficient: need at least one mapped lead OR development; allow partial unmapped
  const insufficient = mappedDevOrLead.length < 1;

  return {
    schemaVersion: 1,
    blueprintReferenceId: input.blueprint.referenceId,
    blueprintExtractionMode: input.blueprint.extractionMode,
    materialDepth: input.blueprint.materialDepth,
    mappings,
    unusedEvidenceIds: usable.filter((e) => !used.has(e.evidenceId)).map((e) => e.evidenceId),
    insufficient,
    insufficientReason: insufficient
      ? requiredUnmapped.length > 0
        ? `unmapped_required_segments:${requiredUnmapped.map((m) => m.segmentIndex).join(",")}`
        : "no_mapped_lead_or_development"
      : null,
    deferCode: insufficient ? "DEFER_INSUFFICIENT_REFERENCE_MATERIAL" : null,
  };
}

/** Score blueprint fit for retrieval among candidates. */
export function scoreBlueprintForEvidence(
  blueprint: ReferenceEditorialBlueprint,
  evidence: ResearchEvidence[],
): number {
  const plan = buildReferenceEvidenceMappingPlan({ blueprint, evidence });
  if (plan.insufficient) return -1;
  const mapped = plan.mappings.filter((m) => m.status === "mapped").length;
  const modeBonus = blueprint.extractionMode === "paragraph_functions" ? 2 : 0;
  const concrete = evidence.filter(
    (e) =>
      e.allowedForGeneration &&
      !["evaluative_framing", "availability_or_catalog", "maker_or_label", "transition_only"].includes(
        e.facetType,
      ),
  ).length;
  const expectedDepth =
    concrete <= 2 ? "scarce" : concrete >= 5 ? "rich" : "standard";
  const depthBonus = blueprint.materialDepth === expectedDepth ? 3 : 0;
  // Prefer blueprints whose primary types appear in product evidence
  const have = new Set(evidence.map((e) => e.facetType));
  const typeHits = blueprint.segments.filter((s) => have.has(s.primaryEvidenceType)).length;
  return mapped + modeBonus + depthBonus + typeHits;
}
