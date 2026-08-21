/**
 * WritingSkeleton feasibility + shrink (r17).
 * Never pad slots by reusing semantic families. No any-fallback assignment.
 */

import type { EvidencePack, EvidencePackItem } from "./evidence-pack.js";
import type { WritingSkeleton } from "./writing-skeleton.js";
import { writingSkeletonFallback } from "./writing-skeleton.js";
import type { ProductMaterialProfile } from "./reference-type-profile.js";
import {
  assignEvidenceToWritingSkeleton,
  type SkeletonEvidenceAssignment,
} from "./skeleton-evidence-assignment.js";
import {
  classifySemanticEvidence,
  roleCompatibleClasses,
} from "./semantic-evidence.js";
import { NATURAL_PRODUCT_INTRO_STRUCTURE } from "./natural-product-intro-policy.js";

export type SkeletonFeasibilityResult = {
  ok: boolean;
  deferred: boolean;
  deferCode: "DEFER_INSUFFICIENT_MATERIAL" | null;
  deferReason: string | null;
  skeleton: WritingSkeleton;
  assignment: SkeletonEvidenceAssignment;
  shrunk: boolean;
  shrinkFromBodySlots: number;
  shrinkToBodySlots: number;
  anyFallbackCount: number;
  infeasibleSlots: string[];
};

function itemFamily(item: EvidencePackItem): string {
  return classifySemanticEvidence(item.fact, {
    sourceType: item.provenance.sourceType,
    titleIdentityToken:
      item.provenance.sourceType === "product_title" && item.type !== "product_identity",
  }).familyId;
}

function countFilledBody(assignment: SkeletonEvidenceAssignment): number {
  return assignment.body.filter((b) => b.primary != null).length;
}

function skeletonWithBodyCap(skeleton: WritingSkeleton, maxBody: number): WritingSkeleton {
  const body = skeleton.body.slice(0, Math.max(0, maxBody)).map((b, i) => ({
    ...b,
    order: i + 1,
  }));
  return { ...skeleton, body };
}

/** Prefer roles matching available families for reduced natural-intro skeleton. */
export function skeletonFromMaterialProfile(profile: ProductMaterialProfile): WritingSkeleton {
  const base = writingSkeletonFallback({
    materialDepth: profile.materialDepth === "scarce" ? "scarce" : "standard",
  });
  const body: WritingSkeleton["body"] = [];

  const pushBody = (role: string, purpose: string, supporting: string[]) => {
    // Natural intro: at most 2 body paragraphs; usually 1 content slot
    if (body.length >= Math.min(2, Math.max(0, profile.independentDevelopmentFamilyCount >= 3 ? 2 : 1))) {
      return;
    }
    if (profile.materialDepth === "scarce" && body.length >= 0 && profile.independentDevelopmentFamilyCount < 2) {
      return;
    }
    body.push({
      order: body.length + 1,
      purpose,
      primaryEvidenceRole: role,
      supportingEvidenceRoles: supporting,
      transformation: "natural_compose_multi_fact",
      transitionFromPrevious: "continue_naturally",
      stopCondition: "stop_when_mapped_evidence_exhausted_do_not_pad",
      avoid: [...base.globalAvoid],
    });
  };

  // Opening: clearest product hook
  let openingRole = "performer_identity";
  const openingSupport: string[] = [];
  if (profile.performerCount > 0) {
    openingRole = "performer_identity";
    if (profile.characterTraitFamilies.length > 0 || profile.bodyTraitFamilies.length > 0) {
      openingSupport.push("body_trait");
    }
    if (profile.productFormFamilies.length > 0 || profile.contextFamilies.some((c) => c.startsWith("SERIES_"))) {
      openingSupport.push("series_or_event");
    }
  } else if (profile.quantityFamilies.length > 0 || profile.durationFamilies.length > 0) {
    openingRole = "quantity_or_runtime";
  } else if (profile.characterTraitFamilies.length > 0 || profile.bodyTraitFamilies.length > 0) {
    openingRole = "body_trait";
  } else if (profile.sceneFamilies.length > 0) {
    openingRole = "scene_or_act";
  }

  // Body: one composed content paragraph (qty/duration/scene) — not one-fact-per-slot essays
  if (profile.materialDepth !== "scarce" || profile.independentDevelopmentFamilyCount >= 2) {
    if (profile.quantityFamilies.length > 0 || profile.durationFamilies.length > 0) {
      if (openingRole !== "quantity_or_runtime") {
        pushBody("quantity_or_runtime", NATURAL_PRODUCT_INTRO_STRUCTURE.slots[1]!.purpose, [
          "scene_or_act",
          "body_trait",
          "series_or_event",
        ]);
      } else if (
        profile.sceneFamilies.length > 0 ||
        profile.bodyTraitFamilies.length > 0 ||
        profile.characterTraitFamilies.length > 0
      ) {
        pushBody(
          profile.sceneFamilies.length > 0 ? "scene_or_act" : "body_trait",
          NATURAL_PRODUCT_INTRO_STRUCTURE.slots[1]!.purpose,
          ["quantity_or_runtime", "series_or_event"],
        );
      }
    } else if (profile.sceneFamilies.length > 0) {
      pushBody("scene_or_act", NATURAL_PRODUCT_INTRO_STRUCTURE.slots[1]!.purpose, [
        "body_trait",
        "series_or_event",
      ]);
    } else if (profile.bodyTraitFamilies.length > 0 || profile.characterTraitFamilies.length > 0) {
      pushBody("body_trait", NATURAL_PRODUCT_INTRO_STRUCTURE.slots[1]!.purpose, ["series_or_event"]);
    } else if (profile.productFormFamilies.length > 0) {
      pushBody("series_or_event", NATURAL_PRODUCT_INTRO_STRUCTURE.slots[1]!.purpose, []);
    }
  }

  // Optional second slot only when rich + leftover families for audience fit
  if (profile.materialDepth === "rich" && body.length === 1 && profile.independentDevelopmentFamilyCount >= 4) {
    pushBody("performer_identity", NATURAL_PRODUCT_INTRO_STRUCTURE.slots[2]!.purpose, [
      "series_or_event",
    ]);
  }

  return {
    ...base,
    articleShape: "natural_product_intro",
    referenceType: profile.kind === "scarce_material" ? "scarce_material" : "natural_product_intro",
    referenceId: null,
    title: {
      focus: openingRole,
      transformation: "concise_identity_plus_key_traits",
    },
    opening: {
      purpose: NATURAL_PRODUCT_INTRO_STRUCTURE.slots[0]!.purpose,
      primaryEvidenceRole: openingRole,
      supportingEvidenceRoles: openingSupport,
      packaging: "NATURAL_COMPOSE",
      avoid: [...base.globalAvoid],
    },
    body,
    ending: {
      strategy:
        body.length === 0
          ? "stop_when_opening_done — CTA is channel widget"
          : "optional_product_form_context_then_stop — CTA is channel widget",
    },
  };
}

/**
 * Ensure skeleton is feasible given pack+profile. Shrink body slots; never any-fallback.
 */
export function ensureFeasibleWritingSkeleton(input: {
  skeleton: WritingSkeleton;
  pack: EvidencePack;
  profile: ProductMaterialProfile;
}): SkeletonFeasibilityResult {
  const maxDev = Math.max(0, input.profile.independentDevelopmentFamilyCount);
  // Reserve ~1 family for opening when possible
  const maxBodyByMaterial = Math.max(0, maxDev - (maxDev >= 2 ? 1 : 0));
  let skeleton = input.skeleton;
  const fromSlots = skeleton.body.length;
  let shrunk = false;

  if (skeleton.body.length > maxBodyByMaterial) {
    skeleton = skeletonWithBodyCap(skeleton, maxBodyByMaterial);
    shrunk = true;
  }

  // Assign without any-fallback
  let assignment = assignEvidenceToWritingSkeleton(skeleton, input.pack, {
    allowAnyFallback: false,
  });
  let infeasible: string[] = [];

  const recheck = () => {
    infeasible = [];
    if (!assignment.opening.primary) infeasible.push("opening");
    for (const b of skeleton.body) {
      const filled = assignment.body.find((x) => x.order === b.order);
      if (!filled?.primary) infeasible.push(`body[${b.order}]`);
    }
  };
  recheck();

  // Shrink until feasible or empty body
  while (infeasible.some((s) => s.startsWith("body[")) && skeleton.body.length > 0) {
    skeleton = skeletonWithBodyCap(skeleton, skeleton.body.length - 1);
    shrunk = true;
    assignment = assignEvidenceToWritingSkeleton(skeleton, input.pack, {
      allowAnyFallback: false,
    });
    recheck();
  }

  // Opening missing → try profile-derived skeleton
  if (!assignment.opening.primary) {
    skeleton = skeletonFromMaterialProfile(input.profile);
    if (skeleton.body.length > maxBodyByMaterial) {
      skeleton = skeletonWithBodyCap(skeleton, maxBodyByMaterial);
    }
    assignment = assignEvidenceToWritingSkeleton(skeleton, input.pack, {
      allowAnyFallback: false,
    });
    shrunk = true;
    recheck();
  }

  const bodyFilled = countFilledBody(assignment);
  const openingOk = Boolean(assignment.opening.primary);

  // Meaningful article: opening + at least one body, OR scarce with opening only when materialDepth scarce
  if (!openingOk) {
    return {
      ok: false,
      deferred: true,
      deferCode: "DEFER_INSUFFICIENT_MATERIAL",
      deferReason: "no_compatible_opening_evidence",
      skeleton,
      assignment,
      shrunk,
      shrinkFromBodySlots: fromSlots,
      shrinkToBodySlots: skeleton.body.length,
      anyFallbackCount: 0,
      infeasibleSlots: infeasible,
    };
  }

  if (bodyFilled === 0 && input.profile.materialDepth !== "scarce") {
    // Try one more reduce: profile skeleton with 1 body
    const alt = skeletonFromMaterialProfile(input.profile);
    const altCapped = skeletonWithBodyCap(alt, Math.min(1, maxBodyByMaterial));
    const altAssign = assignEvidenceToWritingSkeleton(altCapped, input.pack, {
      allowAnyFallback: false,
    });
    if (altAssign.opening.primary && countFilledBody(altAssign) >= 1) {
      return {
        ok: true,
        deferred: false,
        deferCode: null,
        deferReason: null,
        skeleton: altCapped,
        assignment: altAssign,
        shrunk: true,
        shrinkFromBodySlots: fromSlots,
        shrinkToBodySlots: altCapped.body.length,
        anyFallbackCount: 0,
        infeasibleSlots: [],
      };
    }
    return {
      ok: false,
      deferred: true,
      deferCode: "DEFER_INSUFFICIENT_MATERIAL",
      deferReason: "no_meaningful_body_after_shrink",
      skeleton,
      assignment,
      shrunk,
      shrinkFromBodySlots: fromSlots,
      shrinkToBodySlots: skeleton.body.length,
      anyFallbackCount: 0,
      infeasibleSlots: infeasible,
    };
  }

  // Detect accidental family reuse across opening+body primaries
  const familySeen = new Set<string>();
  const reuse: string[] = [];
  const mark = (item: EvidencePackItem | null, slot: string) => {
    if (!item) return;
    const fam = itemFamily(item);
    if (familySeen.has(fam)) reuse.push(`${slot}:${fam}`);
    else familySeen.add(fam);
  };
  mark(assignment.opening.primary, "opening");
  for (const b of assignment.body) mark(b.primary, `body${b.order}`);

  if (reuse.length > 0) {
    // Drop trailing body slots until no primary reuse
    while (skeleton.body.length > 0) {
      skeleton = skeletonWithBodyCap(skeleton, skeleton.body.length - 1);
      shrunk = true;
      assignment = assignEvidenceToWritingSkeleton(skeleton, input.pack, {
        allowAnyFallback: false,
      });
      familySeen.clear();
      reuse.length = 0;
      mark(assignment.opening.primary, "opening");
      for (const b of assignment.body) mark(b.primary, `body${b.order}`);
      if (reuse.length === 0) break;
    }
  }

  if (!assignment.opening.primary || (countFilledBody(assignment) === 0 && input.profile.materialDepth !== "scarce")) {
    return {
      ok: false,
      deferred: true,
      deferCode: "DEFER_INSUFFICIENT_MATERIAL",
      deferReason: "family_reuse_collapse",
      skeleton,
      assignment,
      shrunk,
      shrinkFromBodySlots: fromSlots,
      shrinkToBodySlots: skeleton.body.length,
      anyFallbackCount: 0,
      infeasibleSlots: reuse,
    };
  }

  return {
    ok: true,
    deferred: false,
    deferCode: null,
    deferReason: null,
    skeleton,
    assignment,
    shrunk,
    shrinkFromBodySlots: fromSlots,
    shrinkToBodySlots: skeleton.body.length,
    anyFallbackCount: 0,
    infeasibleSlots: [],
  };
}

/** Test helper: can this role be filled uniquely from pack excluding used families? */
export function hasCompatibleUnusedEvidence(
  pack: EvidencePack,
  role: string,
  usedFamilies: Set<string>,
): boolean {
  const allowed = new Set(roleCompatibleClasses(role));
  for (const e of pack.concreteEvidence) {
    if (!e.generationEligible || e.type === "product_identity") continue;
    const sem = classifySemanticEvidence(e.fact, {
      sourceType: e.provenance.sourceType,
      titleIdentityToken: e.provenance.sourceType === "product_title",
    });
    if (!allowed.has(sem.primary)) continue;
    if (usedFamilies.has(sem.familyId)) continue;
    return true;
  }
  return false;
}
