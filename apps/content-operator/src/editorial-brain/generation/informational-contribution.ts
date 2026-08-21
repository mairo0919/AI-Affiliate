/**
 * Informational contribution model — facet-level allocation beyond claimId alone.
 * Reuses assertion-extract facets; no product-specific rules.
 */

import { extractTextFacets } from "../shadow/assertion-extract.js";
import type { ClaimStatementRef } from "./generation-input-contract.js";

export type InformationalContribution = {
  /** Stable id: claimId + facet */
  id: string;
  claimId: string;
  facet: string;
  /** Role this contribution was assigned to at plan time (optional). */
  assignedRole?: "title" | "lead" | "development" | "summary" | "cta";
};

/** Quantity / duration atomics used for plan-time normalization. */
const QTY_ATOMIC_RE = /\d+(?:名|時間|作品|分|人|泊|日)/g;

/**
 * Normalize extracted facets into atomic informational units.
 * Compound quantity strings like「10作品8時間」split into「10作品」「8時間」.
 * Duration compounds「1泊2日」are kept intact.
 * Prefer atomics over compounds that are mere concatenations of those atomics.
 */
export function normalizeAtomicFacets(facets: string[]): string[] {
  const atomics = new Set<string>();
  const compounds: string[] = [];

  for (const raw of facets) {
    const f = raw.trim();
    if (f.length < 2) continue;
    // Keep overnight duration compounds as a single unit
    if (/^\d+泊\d+日$/.test(f)) {
      atomics.add(f);
      continue;
    }
    const stayDurations = f.match(/\d+泊\d+日/g) ?? [];
    if (stayDurations.length > 0) {
      for (const d of stayDurations) atomics.add(d);
      const withoutDur = f.replace(/\d+泊\d+日/g, "");
      const qtyParts = withoutDur.match(QTY_ATOMIC_RE) ?? [];
      for (const p of qtyParts) atomics.add(p);
      const rest = withoutDur.replace(QTY_ATOMIC_RE, "").replace(/ベスト版?/g, "ベスト").trim();
      if (rest.length >= 2 && !/^[とやのへをにがはも]$/.test(rest)) {
        atomics.add(rest === "ベスト" ? "ベスト" : rest);
      }
      continue;
    }
    const qtyParts = f.match(QTY_ATOMIC_RE) ?? [];
    if (qtyParts.length >= 2) {
      for (const p of qtyParts) atomics.add(p);
      const rest = f.replace(QTY_ATOMIC_RE, "").replace(/ベスト版?/g, "ベスト").trim();
      if (rest.length >= 2 && !/^[とやのへをにがはも]$/.test(rest)) {
        atomics.add(rest === "ベスト" ? "ベスト" : rest);
      }
      continue;
    }
    if (qtyParts.length === 1 && f === qtyParts[0]) {
      atomics.add(f);
      continue;
    }
    // Single quantity embedded in longer token — keep quantity atomic + remainder if useful
    if (qtyParts.length === 1 && f.length > qtyParts[0]!.length) {
      atomics.add(qtyParts[0]!);
      compounds.push(f);
      continue;
    }
    compounds.push(f);
  }

  for (const c of compounds) {
    const qtyParts = c.match(QTY_ATOMIC_RE) ?? [];
    // Drop compound if every quantity piece already present as atomic
    if (qtyParts.length >= 2 && qtyParts.every((p) => atomics.has(p))) {
      continue;
    }
    // Prefer scene stems inside qty+scene compounds (2日大乱交ツアー → 大乱交)
    const sceneStem =
      c.match(/大?乱交/)?.[0] ??
      c.match(/発掘|育成/)?.[0] ??
      c.match(/ベロキス|生ハメ|潮吹[きき]?|ピストン/)?.[0] ??
      null;
    if (sceneStem && sceneStem.length >= 2) {
      atomics.add(sceneStem);
      const rest = c
        .replace(QTY_ATOMIC_RE, "")
        .replace(sceneStem, "")
        .replace(/ツアー/g, "")
        .trim();
      if (rest.length < 2) continue;
    }
    // Drop compound that is exact concatenation of two known atomics
    const asConcat = [...atomics].some((a) =>
      [...atomics].some((b) => a !== b && a + b === c),
    );
    if (asConcat) continue;
    atomics.add(c);
  }

  return [...atomics];
}

export type RoleContributionBoundary = {
  role: "title" | "lead" | "development" | "summary" | "cta";
  contributions: InformationalContribution[];
  /** Claim-scoped view for prompts */
  allowedClaims: Array<{
    claimId: string;
    statement: string;
    supportedFacts: string[];
  }>;
};

export type ContributionPlan = {
  byRole: {
    title: InformationalContribution[];
    lead: InformationalContribution[];
    development: InformationalContribution[];
    summary: InformationalContribution[];
    cta: InformationalContribution[];
  };
  /** Facets not yet assigned to lead/title — available for body expansion */
  unusedForDevelopment: InformationalContribution[];
  /** All contribution ids in the plan */
  allIds: string[];
};

export function contributionId(claimId: string, facet: string): string {
  return `${claimId}::${facet}`;
}

export function contributionsFromClaim(claim: ClaimStatementRef): InformationalContribution[] {
  const facets = normalizeAtomicFacets(extractTextFacets(claim.statement));
  return facets.map((facet) => ({
    id: contributionId(claim.id, facet),
    claimId: claim.id,
    facet,
  }));
}

/** Facet text identity for cross-claim duplicate detection. */
export function facetKey(facet: string): string {
  return facet.replace(/\s+/g, "").toLowerCase();
}

/**
 * Allocate facets across roles:
 * - opening claims: first up to 2 distinctive facets → lead/title
 * - remaining facets from opening + all development claim facets → development
 * - summary: recap of lead facets only (not a license for new body restatement)
 *
 * Same claim / different facets can split lead vs body.
 * Same facet text must not be assigned to both lead and development.
 */
export function buildContributionPlan(input: {
  claims: ClaimStatementRef[];
  openingClaimIds: string[];
  developmentClaimIds: string[];
}): ContributionPlan {
  const byId = new Map(input.claims.map((c) => [c.id, c]));
  const openingIds = input.openingClaimIds.filter((id) => byId.has(id));
  const devIds = input.developmentClaimIds.filter((id) => byId.has(id));

  const lead: InformationalContribution[] = [];
  const usedFacetKeys = new Set<string>();

  const takeForLead = (claimId: string, max: number) => {
    const claim = byId.get(claimId);
    if (!claim) return;
    for (const c of contributionsFromClaim(claim)) {
      if (lead.length >= max) break;
      const key = facetKey(c.facet);
      if (usedFacetKeys.has(key)) continue;
      if (c.facet.length < 2) continue;
      lead.push(c);
      usedFacetKeys.add(key);
    }
  };

  // Prefer opening drivers first
  for (const id of openingIds) {
    takeForLead(id, 2);
    if (lead.length >= 2) break;
  }
  if (lead.length === 0 && openingIds[0]) takeForLead(openingIds[0]!, 2);

  const development: InformationalContribution[] = [];
  const pushDev = (claimId: string) => {
    const claim = byId.get(claimId);
    if (!claim) return;
    for (const c of contributionsFromClaim(claim)) {
      const key = facetKey(c.facet);
      if (usedFacetKeys.has(key)) continue; // already in lead → not for body restatement
      development.push(c);
      usedFacetKeys.add(key);
    }
  };

  // Unused facets from opening claims become development expansion (new facets only)
  for (const id of openingIds) pushDev(id);
  for (const id of devIds) pushDev(id);

  const unusedForDevelopment = [...development];

  const title = lead.slice(0, Math.min(2, lead.length));
  const summary = lead.slice(0, Math.min(3, lead.length)); // recap only

  return {
    byRole: {
      title,
      lead,
      development,
      summary,
      cta: [],
    },
    unusedForDevelopment,
    allIds: [...title, ...lead, ...development].map((c) => c.id),
  };
}

export function toRoleContributionBoundaries(
  plan: ContributionPlan,
  claims: ClaimStatementRef[],
): Record<"title" | "lead" | "development" | "summary", RoleContributionBoundary> {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const build = (
    role: RoleContributionBoundary["role"],
    contribs: InformationalContribution[],
  ): RoleContributionBoundary => {
    const byClaim = new Map<string, string[]>();
    for (const c of contribs) {
      const list = byClaim.get(c.claimId) ?? [];
      list.push(c.facet);
      byClaim.set(c.claimId, list);
    }
    return {
      role,
      contributions: contribs,
      allowedClaims: [...byClaim.entries()].map(([claimId, supportedFacts]) => ({
        claimId,
        statement: byId.get(claimId)?.statement ?? "",
        supportedFacts: [...new Set(supportedFacts)],
      })),
    };
  };
  return {
    title: build("title", plan.byRole.title),
    lead: build("lead", plan.byRole.lead),
    development: build("development", plan.byRole.development),
    summary: build("summary", plan.byRole.summary),
  };
}

/** Facets present in text (informational contributions observed). */
export function observeFacetsInText(text: string): string[] {
  // Keep raw extraction for review/overlap metrics; plan-time allocation
  // normalizes via contributionsFromClaim / normalizeAtomicFacets separately.
  return extractTextFacets(text);
}

/**
 * Consumed contribution facet-keys from non-target segments (for repetition repair).
 *
 * When a ContributionPlan is provided, lead consumption is plan-assigned keys only
 * (exact atomic units). Lead prose that illegally restates body-assigned atomics
 * must NOT mark those body contributions as consumed.
 */
export function consumedFacetKeysOutsideTarget(input: {
  article: {
    title: string;
    summary: string;
    lead: string;
    sections: Array<{ paragraphs: string[] }>;
  };
  targetSegmentId: string;
  /** Optional plan — enables role-aware lead consumption */
  plan?: ContributionPlan;
}): Set<string> {
  const keys = new Set<string>();
  const leadAssigned = input.plan
    ? new Set(input.plan.byRole.lead.map((c) => facetKey(c.facet)))
    : null;

  const addObserved = (text: string, segmentId: string) => {
    if (segmentId === input.targetSegmentId) return;
    // Title/summary are allowed soft-recap
    if (segmentId === "title" || segmentId === "summary") return;
    if (segmentId === "lead" && leadAssigned) {
      for (const k of leadAssigned) keys.add(k);
      return;
    }
    for (const f of observeFacetsInText(text)) keys.add(facetKey(f));
  };
  addObserved(input.article.lead, "lead");
  input.article.sections.forEach((sec, si) => {
    sec.paragraphs.forEach((p, pi) => addObserved(p, `section:${si}:p${pi}`));
  });
  return keys;
}

/**
 * Body-planned contributions still available for REPLACE.
 *
 * Plan-assigned lead facets are consumed (exact keys).
 * Lead prose that over-mentions body atomics does NOT exhaust those body contributions.
 * Other body paragraphs outside a future target may still hold a facet — callers
 * further filter via consumedFacetKeysOutsideTarget(plan).
 */
export function unusedContributionsForRepair(input: {
  plan: ContributionPlan;
  article: {
    title: string;
    summary: string;
    lead: string;
    sections: Array<{ paragraphs: string[] }>;
  };
}): InformationalContribution[] {
  const leadKeys = new Set(input.plan.byRole.lead.map((c) => facetKey(c.facet)));
  // Body-planned pool: anything assigned to development that lead did not take
  return input.plan.unusedForDevelopment.filter((c) => !leadKeys.has(facetKey(c.facet)));
}

/** Overlap between text facets and a consumed set (material restatement signal). */
export function countConsumedOverlap(text: string, consumed: Set<string>): number {
  return observeFacetsInText(text).filter((f) => consumed.has(facetKey(f))).length;
}
