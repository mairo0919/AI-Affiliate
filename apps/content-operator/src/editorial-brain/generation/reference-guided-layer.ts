/**
 * Reference-guided generation layer — Planner SSOT for Evidence Mapping + Transformation.
 * Additive: does not replace Claim SEGMENT_CONTRACTS.
 */

import { ArticlePatternRepository } from "@ai-affiliate/database";
import { buildResearchEvidence, type ResearchEvidence } from "../../article-pattern/research-evidence.js";
import { selectReferenceBlueprints } from "../../article-pattern/retrieve-reference-blueprints.js";
import {
  buildReferenceEvidenceMappingPlan,
  type ReferenceEvidenceMappingPlan,
} from "../../article-pattern/reference-evidence-mapping.js";
import {
  isReferenceEditorialBlueprint,
  type ReferenceEditorialBlueprint,
} from "../../article-pattern/reference-editorial-blueprint.js";
import {
  extractTransformationFromEditorialBlueprint,
  isReferenceEditorialTransformationBlueprint,
  toTransformationPromptContract,
  type ReferenceEditorialTransformationBlueprint,
  type TransformationReadiness,
} from "../../article-pattern/reference-editorial-transformation.js";
import {
  buildProductMaterialProfileFromEvidence,
  classifyReferenceEditorialType,
  profileSatisfiesReferenceRequirements,
  type ProductMaterialKind,
  type ProductMaterialProfile,
} from "../../article-pattern/reference-type-profile.js";
import {
  buildReferenceSegmentExecution,
  type SegmentExecutionRow,
} from "../../article-pattern/reference-segment-execution.js";

export type ReferenceGuidedLayer = {
  enabled: boolean;
  researchEvidence: ResearchEvidence[];
  blueprint: ReferenceEditorialBlueprint | null;
  transformation: ReferenceEditorialTransformationBlueprint | null;
  transformReadiness: TransformationReadiness | "REFERENCE_TRANSFORM_UNAVAILABLE" | null;
  /** Rich capability profile (r17 SSOT) */
  productMaterialProfile: ProductMaterialProfile;
  /** @deprecated kind string — use productMaterialProfile.kind */
  productMaterialKind: ProductMaterialKind;
  referenceType: ProductMaterialKind | null;
  candidateCount: number;
  rejectedReferenceCount: number;
  mappingPlan: ReferenceEvidenceMappingPlan | null;
  segmentExecution: SegmentExecutionRow[];
  defer: boolean;
  deferCode: "DEFER_INSUFFICIENT_REFERENCE_MATERIAL" | null;
  deferReason: string | null;
};

function resolveTransformation(
  obsMeta: Record<string, unknown> | null,
  blueprint: ReferenceEditorialBlueprint,
): ReferenceEditorialTransformationBlueprint {
  if (isReferenceEditorialTransformationBlueprint(obsMeta?.referenceEditorialTransformation)) {
    return obsMeta!.referenceEditorialTransformation as ReferenceEditorialTransformationBlueprint;
  }
  return extractTransformationFromEditorialBlueprint(blueprint);
}

export async function buildReferenceGuidedLayer(input: {
  /** Prisma client instance (from LifecycleRepository) */
  prisma: ConstructorParameters<typeof ArticlePatternRepository>[0];
  productTitle: string;
  claims: Array<{ id: string; statement: string; kind?: string | null; status?: string | null }>;
  targetFormatKey?: string;
  /** Official pageEvidence metadata — concrete atoms only for Generator. */
  pageEvidenceMeta?: import("../../article-pattern/official-page-evidence-atoms.js").PageEvidenceMetaShape | null;
}): Promise<ReferenceGuidedLayer> {
  const evidence = buildResearchEvidence({
    productTitle: input.productTitle,
    claims: input.claims,
    pageEvidenceMeta: input.pageEvidenceMeta,
  });
  const productMaterialProfile = buildProductMaterialProfileFromEvidence(evidence);
  const productMaterialKind = productMaterialProfile.kind;

  const patterns = new ArticlePatternRepository(input.prisma);
  const observations = await patterns.listObservations({
    limit: 200,
  });
  const formatKey = input.targetFormatKey ?? "NEW_RELEASE_SINGLE";
  const filtered = observations.filter((o) => {
    const meta =
      o.metadata && typeof o.metadata === "object" ? (o.metadata as Record<string, unknown>) : {};
    if (String(meta.referenceQualityTier ?? "") === "REJECT_REFERENCE") return false;
    const suitability = meta.learningSuitability as { classification?: string } | undefined;
    if (suitability?.classification === "C" || suitability?.classification === "REJECT") return false;
    const tf = meta.targetFormatKey;
    return !tf || tf === formatKey || tf === "NEW_RELEASE_SINGLE";
  });

  const ranked = [...filtered].sort((a, b) => {
    const ma =
      a.metadata && typeof a.metadata === "object" ? (a.metadata as Record<string, unknown>) : {};
    const mb =
      b.metadata && typeof b.metadata === "object" ? (b.metadata as Record<string, unknown>) : {};
    const score = (m: Record<string, unknown>, obsId: string) => {
      let s = 0;
      if (m.referenceQualityTier === "GOOD_REFERENCE") s += 100;
      else if (m.referenceQualityTier === "WEAK_REFERENCE") s += 10;
      if (isReferenceEditorialBlueprint(m.referenceEditorialBlueprint)) {
        if (m.referenceEditorialBlueprint.extractionMode === "paragraph_functions") s += 20;
        const refType = classifyReferenceEditorialType(m.referenceEditorialBlueprint);
        if (profileSatisfiesReferenceRequirements(productMaterialProfile, refType)) s += 40;
        else s -= 80;
      }
      if (isReferenceEditorialTransformationBlueprint(m.referenceEditorialTransformation)) {
        const r = m.referenceEditorialTransformation.readiness;
        if (r === "TRANSFORM_READY") s += 30;
        else if (r === "TRANSFORM_PARTIAL") s += 10;
        else if (r === "REOBSERVE_REQUIRED" || r === "REJECT_REFERENCE") s -= 50;
      } else if (isReferenceEditorialBlueprint(m.referenceEditorialBlueprint)) {
        s += 8;
      }
      void obsId;
      return s;
    };
    return score(mb, b.id) - score(ma, a.id);
  });

  const { selected, candidates, rejected } = selectReferenceBlueprints({
    observations: ranked.length > 0 ? ranked : observations,
    evidence,
    productMaterialProfile,
    limit: 5,
  });

  if (!selected) {
    return {
      enabled: false,
      researchEvidence: evidence,
      blueprint: null,
      transformation: null,
      transformReadiness: "REFERENCE_TRANSFORM_UNAVAILABLE",
      productMaterialProfile,
      productMaterialKind,
      referenceType: null,
      candidateCount: candidates.length,
      rejectedReferenceCount: rejected.length,
      mappingPlan: null,
      segmentExecution: [],
      defer: false,
      deferCode: null,
      deferReason: null,
    };
  }

  const selectedObs = observations.find((o) => o.id === selected.referenceId);
  const selectedMeta =
    selectedObs?.metadata && typeof selectedObs.metadata === "object"
      ? (selectedObs.metadata as Record<string, unknown>)
      : null;

  const referenceType = classifyReferenceEditorialType(selected);
  const typeOk = profileSatisfiesReferenceRequirements(productMaterialProfile, referenceType);

  if (!typeOk) {
    return {
      enabled: false,
      researchEvidence: evidence,
      blueprint: null,
      transformation: null,
      transformReadiness: "REFERENCE_TRANSFORM_UNAVAILABLE",
      productMaterialProfile,
      productMaterialKind,
      referenceType,
      candidateCount: candidates.length,
      rejectedReferenceCount: rejected.length + 1,
      mappingPlan: null,
      segmentExecution: [],
      defer: false,
      deferCode: null,
      deferReason: null,
    };
  }

  const transformation = resolveTransformation(selectedMeta, selected);
  const transformReadiness: TransformationReadiness | "REFERENCE_TRANSFORM_UNAVAILABLE" =
    transformation.readiness === "REJECT_REFERENCE" ||
    transformation.extractionMode === "unavailable"
      ? "REFERENCE_TRANSFORM_UNAVAILABLE"
      : transformation.readiness;

  const mappingPlan = buildReferenceEvidenceMappingPlan({
    blueprint: selected,
    evidence,
  });

  const segmentExecution =
    transformReadiness === "REFERENCE_TRANSFORM_UNAVAILABLE"
      ? []
      : buildReferenceSegmentExecution({
          blueprint: selected,
          mappingPlan,
          transform: transformation,
        });

  const hardDefer =
    selected.extractionMode === "paragraph_functions" &&
    mappingPlan.insufficient === true &&
    mappingPlan.mappings.filter((m) => m.status === "mapped").length === 0;

  const useTransform =
    transformReadiness === "TRANSFORM_READY" || transformReadiness === "TRANSFORM_PARTIAL";

  return {
    enabled: true,
    researchEvidence: evidence,
    blueprint: selected,
    transformation: useTransform ? transformation : null,
    transformReadiness,
    productMaterialProfile,
    productMaterialKind,
    referenceType,
    candidateCount: candidates.length,
    rejectedReferenceCount: rejected.length,
    mappingPlan,
    segmentExecution,
    defer: hardDefer,
    deferCode: hardDefer ? "DEFER_INSUFFICIENT_REFERENCE_MATERIAL" : null,
    deferReason: hardDefer ? mappingPlan.insufficientReason : null,
  };
}

/** Compact prompt projection — no competitor prose. */
export function toReferenceGuidedPromptContract(
  layer: ReferenceGuidedLayer,
): Record<string, unknown> | null {
  if (!layer.enabled || !layer.blueprint || !layer.mappingPlan) return null;
  const transformPrompt = toTransformationPromptContract(layer.transformation);
  return {
    REFERENCE_BLUEPRINT: {
      referenceId: layer.blueprint.referenceId,
      referenceType: layer.referenceType,
      extractionMode: layer.blueprint.extractionMode,
      materialDepth: layer.blueprint.materialDepth,
      progression: layer.blueprint.progression,
      segments: layer.blueprint.segments.map((s) => ({
        index: s.index,
        role: s.role,
        editorialFunction: s.editorialFunction,
        primaryEvidenceType: s.primaryEvidenceType,
        specificityLevel: s.specificityLevel,
        transitionFunction: s.transitionFunction,
      })),
      avoidPatterns: layer.blueprint.avoidPatterns,
      endingStrategy: layer.blueprint.endingStrategy,
      repetitionStrategy: layer.blueprint.repetitionStrategy,
    },
    EVIDENCE_MAPPING_PLAN: {
      mappings: layer.mappingPlan.mappings
        .filter((m) => m.status === "mapped")
        .map((m) => ({
          segmentIndex: m.segmentIndex,
          role: m.role,
          editorialFunction: m.editorialFunction,
          assignedFacts: m.assignedFacts,
        })),
      unusedEvidenceCount: layer.mappingPlan.unusedEvidenceIds.length,
    },
    REFERENCE_TRANSFORM_BLUEPRINT: transformPrompt,
    transformReadiness: layer.transformReadiness,
    productMaterialProfile: {
      kind: layer.productMaterialKind,
      materialDepth: layer.productMaterialProfile.materialDepth,
      sceneFamilies: layer.productMaterialProfile.sceneFamilies,
      quantityFamilies: layer.productMaterialProfile.quantityFamilies,
      durationFamilies: layer.productMaterialProfile.durationFamilies,
      characterTraitFamilies: layer.productMaterialProfile.characterTraitFamilies,
      independentDevelopmentFamilyCount:
        layer.productMaterialProfile.independentDevelopmentFamilyCount,
      uniqueConcreteFamilyCount: layer.productMaterialProfile.uniqueConcreteFamilyCount,
    },
    segmentExecution: layer.segmentExecution,
    generatorDuty: [
      "Reference is the editorial execution contract for HOW to article-ize mapped facts — not optional flavor.",
      "Rewrite ONLY mapped assignedFacts using the segment's transformationOperation (factLexicalization / clausePackaging).",
      "Do not select other Evidence. Do not invent facts, evaluations, or world-building.",
      "Do not copy reference article wording — blueprint/transform are operations only.",
      "Do not pad unmapped segments with catalog/maker filler or generic が特徴/となっています shells.",
      layer.transformReadiness === "REFERENCE_TRANSFORM_UNAVAILABLE"
        ? "REFERENCE_TRANSFORM_UNAVAILABLE: do not invent a fake transform from an incompatible reference type."
        : "Execute cutOffRule — stop when mapped evidence is exhausted; never pad.",
    ],
  };
}
