/**
 * Product material profile SSOT (r17) — unique semantic families, not raw claim counts.
 * materialDepth ≠ sceneRich.
 */

import type { ResearchEvidence } from "./research-evidence.js";
import type { ReferenceEditorialBlueprint } from "./reference-editorial-blueprint.js";
import type { EvidencePack, EvidencePackItem } from "./evidence-pack.js";
import { performerEntityKey } from "./performer-identity.js";
import type { PerformerRepresentation } from "./performer-representation.js";
import { buildPerformerRepresentation } from "./performer-representation.js";
import {
  classifySemanticEvidence,
  isDevelopmentFamily,
  type SemanticEvidenceClass,
} from "./semantic-evidence.js";

/** Reference / product kind label (editorial shape). */
export type ProductMaterialKind =
  | "scarce_material"
  | "standard_single_performer"
  | "multi_performer"
  | "trait_rich"
  | "scene_rich"
  | "identity_heavy_best_collection"
  | "long_title_event_or_multi_performer";

/**
 * @deprecated Use ProductMaterialKind. Kept as alias for transitional imports.
 */
export type ProductMaterialProfileLabel = ProductMaterialKind;

/** Rich capability profile — SSOT for reference matching & skeleton feasibility. */
export type ProductMaterialProfile = {
  performerCount: number;
  sceneFamilies: string[];
  characterTraitFamilies: string[];
  bodyTraitFamilies: string[];
  quantityFamilies: string[];
  durationFamilies: string[];
  eventFamilies: string[];
  relationshipFamilies: string[];
  contextFamilies: string[];
  productFormFamilies: string[];
  uniqueConcreteFamilyCount: number;
  independentDevelopmentFamilyCount: number;
  materialDepth: "scarce" | "standard" | "rich";
  /** Derived kind for logging / soft ranking only — hard match uses requirements */
  kind: ProductMaterialKind;
  /** R145 — semantic representation (mode changes behavior for dual_host only). */
  performerRepresentation: PerformerRepresentation;
};

export type ReferenceMaterialRequirements = {
  kind: ProductMaterialKind;
  minSceneFamilies: number;
  minCharacterOrBodyTraits: number;
  minPerformerOrCharacter: number;
  minQuantityOrDurationOrForm: number;
  minIndependentDevelopmentFamilies: number;
  minUniqueConcreteFamilies: number;
};

function pushUnique(arr: string[], id: string) {
  if (!arr.includes(id)) arr.push(id);
}

function emptyProfile(kind: ProductMaterialKind = "scarce_material"): ProductMaterialProfile {
  return {
    performerCount: 0,
    sceneFamilies: [],
    characterTraitFamilies: [],
    bodyTraitFamilies: [],
    quantityFamilies: [],
    durationFamilies: [],
    eventFamilies: [],
    relationshipFamilies: [],
    contextFamilies: [],
    productFormFamilies: [],
    uniqueConcreteFamilyCount: 0,
    independentDevelopmentFamilyCount: 0,
    materialDepth: "scarce",
    kind,
    performerRepresentation: buildPerformerRepresentation({ entities: [] }),
  };
}

function ingestFact(
  profile: ProductMaterialProfile,
  fact: string,
  opts?: { kind?: string | null; sourceType?: string | null; titleIdentityToken?: boolean },
  seenFamilies?: Set<string>,
) {
  const seen = seenFamilies ?? new Set<string>();
  const c = classifySemanticEvidence(fact, opts);
  if (c.primary === "CATALOG" || c.primary === "EVALUATIVE") return;
  if (seen.has(c.familyId)) return;
  seen.add(c.familyId);

  switch (c.primary) {
    case "SCENE_ACTION":
      pushUnique(profile.sceneFamilies, c.familyId);
      break;
    case "CHARACTER_TRAIT":
    case "PERFORMER_TRAIT":
      pushUnique(profile.characterTraitFamilies, c.familyId);
      break;
    case "BODY_TRAIT":
      pushUnique(profile.bodyTraitFamilies, c.familyId);
      break;
    case "QUANTITY":
      pushUnique(profile.quantityFamilies, c.familyId);
      break;
    case "DURATION":
      pushUnique(profile.durationFamilies, c.familyId);
      break;
    case "EVENT":
      pushUnique(profile.eventFamilies, c.familyId);
      break;
    case "RELATIONSHIP":
      pushUnique(profile.relationshipFamilies, c.familyId);
      break;
    case "TITLE_LABEL":
    case "SERIES_CONCEPT":
    case "PRODUCT_PERSONA":
    case "SERIES_CONTEXT":
      pushUnique(profile.contextFamilies, c.familyId);
      break;
    case "PRODUCT_FORM":
      pushUnique(profile.productFormFamilies, c.familyId);
      break;
    case "PERFORMER_IDENTITY":
      pushUnique(profile.contextFamilies, c.familyId);
      break;
    case "UNKNOWN_CONCRETE":
      pushUnique(profile.contextFamilies, c.familyId);
      break;
    case "PERFORMER_REPUTATION":
      // Reputation without separate supported trait — do not fuel characterTraitFamilies
      break;
    default:
      break;
  }

  // Composite: register secondary concrete families present on the same fact
  for (const cls of c.classes) {
    if (cls === c.primary) continue;
    if (cls === "QUANTITY") {
      const m = fact.match(/(\d+)\s*(作品|本|名|人)/);
      if (m) pushUnique(profile.quantityFamilies, `COUNT_${m[1]}`);
    } else if (cls === "DURATION") {
      const m = fact.match(/(\d+)\s*(時間|分)/);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n >= 0) {
          const minutes = m[2] === "時間" ? n * 60 : n;
          pushUnique(profile.durationFamilies, `DURATION_${minutes}MIN`);
        }
      }
    } else if (cls === "CHARACTER_TRAIT" || cls === "PERFORMER_TRAIT") {
      const stem = fact.match(/メスガキ|清楚|ギャル|お姉さん|妹|女王様|ドS|ドM/)?.[0];
      if (stem) pushUnique(profile.characterTraitFamilies, `CHARACTER_${stem.toUpperCase()}`);
    } else if (
      cls === "TITLE_LABEL" ||
      cls === "SERIES_CONCEPT" ||
      cls === "PRODUCT_PERSONA"
    ) {
      pushUnique(profile.contextFamilies, c.familyId);
    } else if (cls === "BODY_TRAIT") {
      const stem = fact.match(/巨乳|美乳|敏感|感度|Hカップ|細身|長身|美脚/)?.[0];
      if (stem) pushUnique(profile.bodyTraitFamilies, `BODY_${stem.toUpperCase()}`);
    } else if (cls === "PRODUCT_FORM") {
      pushUnique(profile.productFormFamilies, "PRODUCT_FORM_BEST");
    }
  }
}

function finalizeProfile(profile: ProductMaterialProfile): ProductMaterialProfile {
  const all = new Set<string>([
    ...profile.sceneFamilies,
    ...profile.characterTraitFamilies,
    ...profile.bodyTraitFamilies,
    ...profile.quantityFamilies,
    ...profile.durationFamilies,
    ...profile.eventFamilies,
    ...profile.relationshipFamilies,
    ...profile.contextFamilies,
    ...profile.productFormFamilies,
  ]);
  profile.uniqueConcreteFamilyCount = all.size;

  // Independent development: exclude pure catalog; count families usable as progression fuel
  const dev = new Set<string>([
    ...profile.sceneFamilies,
    ...profile.characterTraitFamilies,
    ...profile.bodyTraitFamilies,
    ...profile.quantityFamilies,
    ...profile.durationFamilies,
    ...profile.eventFamilies,
    ...profile.relationshipFamilies,
    ...profile.productFormFamilies,
  ]);
  // performer identity can open but also supports identity_heavy progression
  if (profile.performerCount > 0) {
    for (const id of profile.contextFamilies) {
      if (id.startsWith("PERFORMER_")) dev.add(id);
    }
  }
  profile.independentDevelopmentFamilyCount = dev.size;

  if (profile.uniqueConcreteFamilyCount <= 2) profile.materialDepth = "scarce";
  else if (profile.uniqueConcreteFamilyCount <= 5) profile.materialDepth = "standard";
  else profile.materialDepth = "rich";

  profile.kind = deriveKindFromProfile(profile);
  return profile;
}

export function deriveKindFromProfile(profile: ProductMaterialProfile): ProductMaterialKind {
  const sceneN = profile.sceneFamilies.length;
  const traitN =
    profile.characterTraitFamilies.length + profile.bodyTraitFamilies.length;
  const qtyDurForm =
    profile.quantityFamilies.length +
    profile.durationFamilies.length +
    profile.productFormFamilies.length +
    profile.eventFamilies.length;
  const hasFormOrSeries =
    profile.productFormFamilies.length > 0 || profile.contextFamilies.some((c) => c.startsWith("SERIES_"));

  if (profile.uniqueConcreteFamilyCount <= 2 && sceneN + traitN <= 1) {
    return "scarce_material";
  }
  // Best / collection shape: form or qty+duration with identity
  if (
    (hasFormOrSeries || qtyDurForm >= 2) &&
    (profile.performerCount >= 1 || profile.characterTraitFamilies.length >= 1)
  ) {
    if (hasFormOrSeries || qtyDurForm >= 2) {
      return profile.performerCount >= 1 || profile.characterTraitFamilies.length >= 1
        ? "identity_heavy_best_collection"
        : "long_title_event_or_multi_performer";
    }
  }
  if (hasFormOrSeries || qtyDurForm >= 2) {
    return "long_title_event_or_multi_performer";
  }
  // scene_rich ONLY when unique SCENE families >= 2 (not claim count)
  if (sceneN >= 2) return "scene_rich";
  if (traitN >= 2) return "trait_rich";
  if (profile.performerCount >= 2) return "multi_performer";
  if (profile.performerCount === 1) return "standard_single_performer";
  return profile.uniqueConcreteFamilyCount >= 5 ? "trait_rich" : "standard_single_performer";
}

function countPerformerMetadataEntities(
  facts: Array<{ fact: string; sourceType?: string | null }>,
): number {
  const seen = new Set<string>();
  for (const f of facts) {
    if (f.sourceType !== "performer_metadata") continue;
    const key = performerEntityKey(f.fact);
    if (key) seen.add(key);
  }
  return seen.size;
}

function applyPerformerEntityCount(
  profile: ProductMaterialProfile,
  entityCount: number,
): ProductMaterialProfile {
  if (entityCount <= 0) return profile;
  profile.performerCount = entityCount;
  profile.kind = deriveKindFromProfile(profile);
  return profile;
}

export function buildProductMaterialProfileFromFacts(
  facts: Array<{
    fact: string;
    kind?: string | null;
    sourceType?: string | null;
    titleIdentityToken?: boolean;
  }>,
): ProductMaterialProfile {
  const profile = emptyProfile();
  const seen = new Set<string>();
  for (const f of facts) {
    ingestFact(profile, f.fact, f, seen);
  }
  const finalized = finalizeProfile(profile);
  return applyPerformerEntityCount(
    finalized,
    countPerformerMetadataEntities(facts),
  );
}

export function buildProductMaterialProfileFromEvidence(
  evidence: ResearchEvidence[],
): ProductMaterialProfile {
  return buildProductMaterialProfileFromFacts(
    evidence
      .filter((e) => e.allowedForGeneration)
      .map((e) => ({
        fact: e.observedFact,
        sourceType: e.sourceType,
        titleIdentityToken: e.sourceType === "product_title",
      })),
  );
}

export function buildProductMaterialProfileFromPack(pack: EvidencePack): ProductMaterialProfile {
  const items: EvidencePackItem[] = [
    ...pack.concreteEvidence.filter((e) => e.generationEligible),
  ];
  const profile = buildProductMaterialProfileFromFacts(
    items.map((e) => ({
      fact: e.fact,
      sourceType: e.provenance.sourceType,
      titleIdentityToken:
        e.provenance.sourceType === "product_title" && e.type !== "product_identity",
    })),
  );
  applyPerformerEntityCount(profile, pack.performerItems.length);
  profile.performerRepresentation = buildPerformerRepresentation({
    entities: pack.performerItems,
    productTitle: pack.productIdentity.title,
    descriptionText: pack.sourceOfficialDescription ?? "",
  });
  return profile;
}

/**
 * Kind classifier — family-based (replaces raw scene claim counting).
 * @deprecated Prefer buildProductMaterialProfile* then read `.kind`
 */
export function classifyProductMaterialProfile(
  evidence: ResearchEvidence[],
): ProductMaterialKind {
  return buildProductMaterialProfileFromEvidence(evidence).kind;
}

export function classifyReferenceEditorialType(
  bp: ReferenceEditorialBlueprint,
): ProductMaterialKind {
  const adopted = new Set(bp.evidenceTypesAdopted);
  const primary = bp.segments.map((s) => s.primaryEvidenceType);
  if (bp.materialDepth === "scarce") return "scarce_material";
  if (
    adopted.has("series_or_event") &&
    primary.filter((p) => p === "performer_identity").length >= 2
  ) {
    return "identity_heavy_best_collection";
  }
  if (adopted.has("series_or_event") || primary.includes("quantity_or_runtime")) {
    return "long_title_event_or_multi_performer";
  }
  if (primary.filter((p) => p === "scene_or_act").length >= 2) return "scene_rich";
  if (primary.filter((p) => p === "body_trait").length >= 2) return "trait_rich";
  if (adopted.has("performer_identity") && bp.materialDepth === "standard") {
    return "standard_single_performer";
  }
  return bp.materialDepth === "rich" ? "trait_rich" : "standard_single_performer";
}

export function referenceMaterialRequirements(
  kind: ProductMaterialKind,
): ReferenceMaterialRequirements {
  switch (kind) {
    case "scene_rich":
      return {
        kind,
        minSceneFamilies: 2,
        minCharacterOrBodyTraits: 0,
        minPerformerOrCharacter: 0,
        minQuantityOrDurationOrForm: 0,
        minIndependentDevelopmentFamilies: 3,
        minUniqueConcreteFamilies: 3,
      };
    case "identity_heavy_best_collection":
      return {
        kind,
        minSceneFamilies: 0,
        minCharacterOrBodyTraits: 0,
        minPerformerOrCharacter: 1,
        minQuantityOrDurationOrForm: 1,
        minIndependentDevelopmentFamilies: 2,
        minUniqueConcreteFamilies: 2,
      };
    case "long_title_event_or_multi_performer":
      return {
        kind,
        minSceneFamilies: 0,
        minCharacterOrBodyTraits: 0,
        minPerformerOrCharacter: 0,
        minQuantityOrDurationOrForm: 2,
        minIndependentDevelopmentFamilies: 2,
        minUniqueConcreteFamilies: 2,
      };
    case "trait_rich":
      return {
        kind,
        minSceneFamilies: 0,
        minCharacterOrBodyTraits: 2,
        minPerformerOrCharacter: 0,
        minQuantityOrDurationOrForm: 0,
        minIndependentDevelopmentFamilies: 2,
        minUniqueConcreteFamilies: 2,
      };
    case "standard_single_performer":
      return {
        kind,
        minSceneFamilies: 0,
        minCharacterOrBodyTraits: 0,
        minPerformerOrCharacter: 1,
        minQuantityOrDurationOrForm: 0,
        minIndependentDevelopmentFamilies: 1,
        minUniqueConcreteFamilies: 1,
      };
    case "multi_performer":
      return {
        kind,
        minSceneFamilies: 0,
        minCharacterOrBodyTraits: 0,
        minPerformerOrCharacter: 2,
        minQuantityOrDurationOrForm: 0,
        minIndependentDevelopmentFamilies: 1,
        minUniqueConcreteFamilies: 1,
      };
    case "scarce_material":
    default:
      return {
        kind: "scarce_material",
        minSceneFamilies: 0,
        minCharacterOrBodyTraits: 0,
        minPerformerOrCharacter: 0,
        minQuantityOrDurationOrForm: 0,
        minIndependentDevelopmentFamilies: 1,
        minUniqueConcreteFamilies: 1,
      };
  }
}

/** Hard precondition: product must satisfy reference requirements. */
export function profileSatisfiesReferenceRequirements(
  profile: ProductMaterialProfile,
  refKind: ProductMaterialKind,
): boolean {
  const req = referenceMaterialRequirements(refKind);
  if (profile.sceneFamilies.length < req.minSceneFamilies) return false;
  const traits =
    profile.characterTraitFamilies.length + profile.bodyTraitFamilies.length;
  if (traits < req.minCharacterOrBodyTraits) return false;
  const identity =
    profile.performerCount + profile.characterTraitFamilies.length;
  if (identity < req.minPerformerOrCharacter) return false;
  const qtyDurForm =
    profile.quantityFamilies.length +
    profile.durationFamilies.length +
    profile.productFormFamilies.length +
    profile.eventFamilies.length;
  if (qtyDurForm < req.minQuantityOrDurationOrForm) return false;
  if (profile.independentDevelopmentFamilyCount < req.minIndependentDevelopmentFamilies) {
    return false;
  }
  if (profile.uniqueConcreteFamilyCount < req.minUniqueConcreteFamilies) return false;
  return true;
}

/**
 * Soft relatedness for ranking only — NEVER overrides hard requirements.
 * @deprecated Prefer profileSatisfiesReferenceRequirements for gating.
 */
export function referenceTypeCompatible(
  productProfile: ProductMaterialKind | ProductMaterialProfile,
  referenceType: ProductMaterialKind,
): boolean {
  const kind =
    typeof productProfile === "string" ? productProfile : productProfile.kind;
  if (typeof productProfile !== "string") {
    return profileSatisfiesReferenceRequirements(productProfile, referenceType);
  }
  // Legacy string-only path: still block scene_rich without soft self-match abuse
  if (productProfile === referenceType) return true;
  const soft: Record<ProductMaterialKind, ProductMaterialKind[]> = {
    scarce_material: ["scarce_material"],
    standard_single_performer: ["standard_single_performer", "trait_rich"],
    multi_performer: [
      "multi_performer",
      "long_title_event_or_multi_performer",
      "identity_heavy_best_collection",
    ],
    trait_rich: ["trait_rich", "standard_single_performer"],
    // scene_rich only matches scene_rich (no trait_rich soft — was FIRST_LOSS path)
    scene_rich: ["scene_rich"],
    identity_heavy_best_collection: [
      "identity_heavy_best_collection",
      "long_title_event_or_multi_performer",
    ],
    long_title_event_or_multi_performer: [
      "long_title_event_or_multi_performer",
      "identity_heavy_best_collection",
    ],
  };
  return (soft[kind] ?? []).includes(referenceType);
}

export function developmentFamilyIds(profile: ProductMaterialProfile): string[] {
  return [
    ...profile.sceneFamilies,
    ...profile.characterTraitFamilies,
    ...profile.bodyTraitFamilies,
    ...profile.quantityFamilies,
    ...profile.durationFamilies,
    ...profile.eventFamilies,
    ...profile.relationshipFamilies,
    ...profile.productFormFamilies,
    ...profile.contextFamilies.filter((c) => c.startsWith("PERFORMER_")),
  ];
}

export type { SemanticEvidenceClass };
export { isDevelopmentFamily };
