/**
 * Assign concrete Evidence Pack items to Writing Skeleton slots (deterministic).
 * r17 OPTION B: no any-fallback; semantic family uniqueness across primaries.
 */

import type { EvidencePack, EvidencePackItem } from "./evidence-pack.js";
import { packItemSemanticFamilyId } from "./evidence-pack.js";
import type { WritingSkeleton } from "./writing-skeleton.js";
import {
  roleCompatibleClasses,
  semanticClassToBlueprintType,
} from "./semantic-evidence.js";

export type SkeletonEvidenceAssignment = {
  title: {
    primary: EvidencePackItem | null;
    supporting: EvidencePackItem[];
    allowReuseInOpening: boolean;
  };
  opening: {
    primary: EvidencePackItem | null;
    supporting: EvidencePackItem[];
  };
  body: Array<{
    order: number;
    primary: EvidencePackItem | null;
    supporting: EvidencePackItem[];
  }>;
  ending: {
    primary: EvidencePackItem | null;
    supporting: EvidencePackItem[];
    allowReuseFromBody: boolean;
  };
  unusedConcreteIds: string[];
  /** Diagnostic: any-fallback picks (must stay 0 on OPTION B) */
  anyFallbackCount: number;
};

export type AssignEvidenceOptions = {
  /** Default false for OPTION B. Legacy tests may set true. */
  allowAnyFallback?: boolean;
};

function roleMatches(item: EvidencePackItem, role: string): boolean {
  const allowed = roleCompatibleClasses(role);
  if (allowed.length === 0) {
    return item.type === role;
  }
  if (item.type === role) return true;
  if (role === "performer_or_concrete_trait" && item.type === "performer_identity") {
    return true;
  }
  // Match via upstream blueprint type — do not reclassify fact text.
  return allowed.some((p) => semanticClassToBlueprintType(p) === item.type);
}

function pick(
  pool: EvidencePackItem[],
  role: string,
  usedIds: Set<string>,
  usedFamilies: Set<string>,
  allowAnyFallback: boolean,
  counters: { anyFallbackCount: number },
): EvidencePackItem | null {
  const hit = pool.find((e) => {
    if (usedIds.has(e.id) || e.type === "product_identity") return false;
    if (!roleMatches(e, role)) return false;
    const fam = packItemSemanticFamilyId(e);
    if (usedFamilies.has(fam)) return false;
    return true;
  });
  if (hit) {
    usedIds.add(hit.id);
    usedFamilies.add(packItemSemanticFamilyId(hit));
    return hit;
  }
  if (!allowAnyFallback) return null;
  const any = pool.find(
    (e) =>
      !usedIds.has(e.id) &&
      e.type !== "product_identity" &&
      !usedFamilies.has(packItemSemanticFamilyId(e)),
  );
  if (any) {
    counters.anyFallbackCount += 1;
    usedIds.add(any.id);
    usedFamilies.add(packItemSemanticFamilyId(any));
    return any;
  }
  return null;
}

export function assignEvidenceToWritingSkeleton(
  skeleton: WritingSkeleton,
  pack: EvidencePack,
  options?: AssignEvidenceOptions,
): SkeletonEvidenceAssignment {
  const allowAnyFallback = options?.allowAnyFallback === true;
  const counters = { anyFallbackCount: 0 };
  const pool = pack.concreteEvidence.filter((e) => e.generationEligible);
  const usedIds = new Set<string>();
  const usedFamilies = new Set<string>();

  const titlePrimary =
    pick(pool, skeleton.title.focus, usedIds, usedFamilies, allowAnyFallback, counters) ??
    (skeleton.title.focus === "product_identity"
      ? pool.find((e) => e.type === "product_identity") ?? null
      : null);
  if (titlePrimary && !usedIds.has(titlePrimary.id)) {
    usedIds.add(titlePrimary.id);
    usedFamilies.add(packItemSemanticFamilyId(titlePrimary));
  }
  const titleFam = titlePrimary ? packItemSemanticFamilyId(titlePrimary) : null;

  // Opening may reuse title family (same fact family OK for title↔lead); body may not.
  const openingUsedFamilies = new Set(usedFamilies);
  if (titleFam) openingUsedFamilies.delete(titleFam);

  const openingPrimary =
    pick(
      pool,
      skeleton.opening.primaryEvidenceRole,
      usedIds,
      openingUsedFamilies,
      allowAnyFallback,
      counters,
    ) ??
    // Natural intro: title + opening may share the same clearest fact (do not force a second atom)
    (skeleton.opening.packaging === "COMPOSE_AS_WORK_CONTENT" &&
    titlePrimary &&
    roleMatches(titlePrimary, skeleton.opening.primaryEvidenceRole)
      ? titlePrimary
      : null);
  // Recompute family locks from assigned ids (title family stays locked for body)
  usedFamilies.clear();
  for (const e of pool) {
    if (usedIds.has(e.id)) usedFamilies.add(packItemSemanticFamilyId(e));
  }
  // If opening reused title primary, keep family locked for body
  if (openingPrimary) {
    usedIds.add(openingPrimary.id);
    usedFamilies.add(packItemSemanticFamilyId(openingPrimary));
  }

  const openingSupporting: EvidencePackItem[] = [];
  for (const role of skeleton.opening.supportingEvidenceRoles) {
    const s = pick(pool, role, usedIds, usedFamilies, false, counters);
    if (s) openingSupporting.push(s);
  }

  const body = skeleton.body.map((slot) => {
    const primary = pick(
      pool,
      slot.primaryEvidenceRole,
      usedIds,
      usedFamilies,
      allowAnyFallback,
      counters,
    );
    const supporting: EvidencePackItem[] = [];
    for (const role of slot.supportingEvidenceRoles) {
      const s = pick(pool, role, usedIds, usedFamilies, false, counters);
      if (s) supporting.push(s);
    }
    return { order: slot.order, primary, supporting };
  });

  // Ending: natural intro audience fit is optional HOW — do not reserve leftover facts as forced fuel
  const skipEndingPrimary =
    /optional_audience|stop_when_opening|CTA is channel/i.test(skeleton.ending.strategy);
  const endingPrimary = skipEndingPrimary
    ? null
    : pool.find((e) => {
        if (usedIds.has(e.id) || e.type === "product_identity") return false;
        const fam = packItemSemanticFamilyId(e);
        return !usedFamilies.has(fam);
      }) ?? null;
  if (endingPrimary) {
    usedIds.add(endingPrimary.id);
    usedFamilies.add(packItemSemanticFamilyId(endingPrimary));
  }

  return {
    title: {
      primary: titlePrimary,
      supporting: [],
      allowReuseInOpening: true,
    },
    opening: { primary: openingPrimary, supporting: openingSupporting },
    body,
    ending: {
      primary: endingPrimary,
      supporting: [],
      allowReuseFromBody: false,
    },
    unusedConcreteIds: pool.filter((e) => !usedIds.has(e.id)).map((e) => e.id),
    anyFallbackCount: counters.anyFallbackCount,
  };
}

