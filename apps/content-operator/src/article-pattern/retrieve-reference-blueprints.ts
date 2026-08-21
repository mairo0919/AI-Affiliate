/**
 * Retrieve ReferenceEditorialBlueprints for generation.
 * r17: hard ReferenceRequirements × ProductMaterialProfile gate.
 */

import type { ArticleStructureObservation } from "@ai-affiliate/database";
import {
  buildWeakBlueprintFromWritingFeatures,
  isReferenceEditorialBlueprint,
  type ReferenceEditorialBlueprint,
} from "./reference-editorial-blueprint.js";
import { scoreBlueprintForEvidence } from "./reference-evidence-mapping.js";
import type { ResearchEvidence } from "./research-evidence.js";
import {
  buildProductMaterialProfileFromEvidence,
  classifyReferenceEditorialType,
  profileSatisfiesReferenceRequirements,
  type ProductMaterialKind,
  type ProductMaterialProfile,
} from "./reference-type-profile.js";
import {
  extractTransformationFromEditorialBlueprint,
  isReferenceEditorialTransformationBlueprint,
} from "./reference-editorial-transformation.js";

export function blueprintFromObservation(
  obs: ArticleStructureObservation,
): ReferenceEditorialBlueprint | null {
  const meta =
    obs.metadata && typeof obs.metadata === "object"
      ? (obs.metadata as Record<string, unknown>)
      : {};
  if (isReferenceEditorialBlueprint(meta.referenceEditorialBlueprint)) {
    return {
      ...meta.referenceEditorialBlueprint,
      referenceId: meta.referenceEditorialBlueprint.referenceId ?? obs.id,
    };
  }
  const features =
    obs.features && typeof obs.features === "object"
      ? (obs.features as Record<string, unknown>)
      : {};
  const writing =
    features.writingFeatures && typeof features.writingFeatures === "object"
      ? (features.writingFeatures as Record<string, unknown>)
      : {};
  return buildWeakBlueprintFromWritingFeatures({
    sectionPurposeSequence: Array.isArray(writing.sectionPurposeSequence)
      ? (writing.sectionPurposeSequence as string[])
      : null,
    introHookType: typeof writing.introHookType === "string" ? writing.introHookType : null,
    informationDensityBucket:
      typeof writing.informationDensityBucket === "string"
        ? writing.informationDensityBucket
        : null,
    referenceId: obs.id,
    sourceUrlHost: obs.sourceDomain ?? null,
  });
}

export type ReferenceSelectRejection = {
  referenceId: string | null;
  refKind: ProductMaterialKind;
  reason: string;
};

export function selectReferenceBlueprints(input: {
  observations: ArticleStructureObservation[];
  evidence: ResearchEvidence[];
  productMaterialProfile?: ProductMaterialKind | ProductMaterialProfile;
  limit?: number;
}): {
  selected: ReferenceEditorialBlueprint | null;
  candidates: Array<{
    blueprint: ReferenceEditorialBlueprint;
    score: number;
    refKind: ProductMaterialKind;
  }>;
  rejected: ReferenceSelectRejection[];
  profile: ProductMaterialProfile;
} {
  const profile: ProductMaterialProfile =
    input.productMaterialProfile && typeof input.productMaterialProfile === "object"
      ? input.productMaterialProfile
      : buildProductMaterialProfileFromEvidence(input.evidence);

  const scored: Array<{
    blueprint: ReferenceEditorialBlueprint;
    score: number;
    refKind: ProductMaterialKind;
    tier: string;
    transformReady: boolean;
  }> = [];
  const rejected: ReferenceSelectRejection[] = [];

  for (const obs of input.observations) {
    const meta =
      obs.metadata && typeof obs.metadata === "object"
        ? (obs.metadata as Record<string, unknown>)
        : {};
    const tier = String(meta.referenceQualityTier ?? "");
    if (tier === "REJECT_REFERENCE") continue;
    const bp = blueprintFromObservation(obs);
    if (!bp) continue;
    if (bp.extractionMode === "weak_from_writing_features" && tier !== "GOOD_REFERENCE") {
      continue;
    }
    const refKind = classifyReferenceEditorialType(bp);
    if (!profileSatisfiesReferenceRequirements(profile, refKind)) {
      rejected.push({
        referenceId: bp.referenceId ?? obs.id,
        refKind,
        reason: `requirements_unmet:${refKind}`,
      });
      continue;
    }
    let score = scoreBlueprintForEvidence(bp, input.evidence);
    if (tier === "GOOD_REFERENCE") score += 10;
    else if (tier === "WEAK_REFERENCE") score += 1;
    if (bp.extractionMode === "paragraph_functions") score += 5;
    if (refKind === profile.kind) score += 12;
    const transform = isReferenceEditorialTransformationBlueprint(
      meta.referenceEditorialTransformation,
    )
      ? meta.referenceEditorialTransformation
      : extractTransformationFromEditorialBlueprint(bp);
    let transformReady = false;
    if (transform.readiness === "TRANSFORM_READY") {
      score += 15;
      transformReady = true;
    } else if (transform.readiness === "TRANSFORM_PARTIAL") score += 5;
    else if (transform.readiness === "REOBSERVE_REQUIRED") score -= 20;
    scored.push({
      blueprint: { ...bp, referenceId: bp.referenceId ?? obs.id },
      score,
      refKind,
      tier,
      transformReady,
    });
  }

  // Priority: exact-compatible GOOD → TRANSFORM_READY → simpler compatible
  scored.sort((a, b) => {
    const exactA = a.refKind === profile.kind ? 1 : 0;
    const exactB = b.refKind === profile.kind ? 1 : 0;
    if (exactB !== exactA) return exactB - exactA;
    const goodA = a.tier === "GOOD_REFERENCE" ? 1 : 0;
    const goodB = b.tier === "GOOD_REFERENCE" ? 1 : 0;
    if (goodB !== goodA) return goodB - goodA;
    if (Number(b.transformReady) !== Number(a.transformReady)) {
      return Number(b.transformReady) - Number(a.transformReady);
    }
    return b.score - a.score;
  });

  const limit = input.limit ?? 5;
  const candidates = scored.filter((c) => c.score >= 0).slice(0, limit);
  const selected = candidates[0]?.blueprint ?? null;
  return {
    selected,
    candidates: candidates.map((c) => ({
      blueprint: c.blueprint,
      score: c.score,
      refKind: c.refKind,
    })),
    rejected,
    profile,
  };
}
