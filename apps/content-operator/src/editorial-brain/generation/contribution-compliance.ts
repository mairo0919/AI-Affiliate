/**
 * Segment-level contribution contracts + deterministic compliance.
 * Extends informational-contribution — no new architecture layer.
 */

import type { EditorialFailureCode } from "../core/failure-taxonomy.js";
import { hasEvaluativeRelation } from "../shadow/predicate-families.js";
import {
  buildContributionPlan,
  facetKey,
  normalizeAtomicFacets,
  observeFacetsInText,
  type ContributionPlan,
  type InformationalContribution,
} from "./informational-contribution.js";
import { extractTextFacets } from "../shadow/assertion-extract.js";
import type { ClaimStatementRef } from "./generation-input-contract.js";
import {
  contributionFamilyKey,
  countIndependentFamilies,
  isSettingFamilyKey,
} from "./contribution-family.js";

const CATALOG_FACET_RE =
  /メーカー|レーベル|配信中|AVAILABLE|公開ページ|販売|配給|制作|MOODYZ|ファン感謝祭/;

/** Valuable body facets (non-catalog editorial differentiators). */
const VALUABLE_BODY_RE =
  /\d+(?:名|時間|作品|分|人|泊|日)|ベロキス|舐め|痴女|わからせ|洗脳|姉妹|バスツアー|乱交|生ハメ|顔面|潮|ピストン|ナンパ|巨乳|感度|水着|収録|独占|メスガキ|シナリオ|シチュ/;

export type SegmentContributionContract = {
  role: "title" | "lead" | "development" | "summary";
  allowedContributions: InformationalContribution[];
  requiredContributions: InformationalContribution[];
  /** Development contributions reserved for later — lead must not assert these */
  reservedForLaterContributions: InformationalContribution[];
  forbiddenConsumedContributions: InformationalContribution[];
  /** Relation families allowed without a matching SUPPORTED evaluative claim */
  allowedRelationFamilies: Array<"FACTUAL" | "EVALUATION">;
};

export type SegmentContributionAllocation = {
  plan: ContributionPlan;
  titleContribution: InformationalContribution | null;
  leadContributions: InformationalContribution[];
  bodyContributions: InformationalContribution[];
  summaryContributions: InformationalContribution[];
  segmentContracts: Record<"title" | "lead" | "development" | "summary", SegmentContributionContract>;
  /** True when body has no concrete (non-catalog) facets left to assign */
  insufficientDevelopmentMaterial: boolean;
  insufficientReason: string | null;
};

function isCatalogContribution(c: InformationalContribution, claim?: ClaimStatementRef): boolean {
  if (CATALOG_FACET_RE.test(c.facet)) return true;
  const kind = (claim?.kind ?? "").toLowerCase();
  if (["maker", "availability", "temporal_sale", "label"].includes(kind)) return true;
  // Maker/brand Latin tokens are not development substance
  if (/^[A-Z0-9]{2,12}$/.test(c.facet)) return true;
  const s = claim?.statement ?? "";
  if (
    s.length <= 70 &&
    /メーカー／レーベル|販売／配信状態|シリーズ情報として|出演者／クリエイターとして/.test(s) &&
    !/\d+名|\d+時間|\d+作品|乱交|バスツアー|ベロキス|痴女|洗脳/.test(s)
  ) {
    // Short catalog rows — series name alone is weak development if that's all body gets
    if (/シリーズ情報として/.test(s) && c.facet.length < 20) return true;
    if (/メーカー|配信状態|出演者／/.test(s)) return true;
  }
  // Generic page-existence tokens
  if (/^(ページ|公開|情報|確認)$/.test(c.facet)) return true;
  return false;
}

/** Weak/generic tokens that must not become body required contributions. */
const WEAK_BODY_FACET_RE =
  /^(ページ|公開|情報|確認|作品|内容|タイトル|シリーズ|反応|展開|連続|差分|候補|判断|メモ|出演者|クレジット|クリエイター|ベスト|ベスト版)$/;

function isWeakBodyFacet(facet: string): boolean {
  const f = facet.trim();
  if (f.length < 3) return true;
  return WEAK_BODY_FACET_RE.test(f);
}

/**
 * Performer / cast identity glue — grammatically inevitable in lead, not a
 * trackable development contribution (must not be RESERVED_FOR_LATER).
 */
export function isIdentityGlueContribution(
  c: InformationalContribution,
  claim?: ClaimStatementRef,
): boolean {
  const kind = (claim?.kind ?? "").toLowerCase();
  if (kind === "performer" || kind === "cast" || kind === "credit") return true;
  if (/出演者|クレジット|クリエイター/.test(c.facet)) return true;
  // Bare Japanese personal-name-like tokens without scene/qty markers
  const f = c.facet.replace(/\s+/g, "");
  if (
    /^[\u4e00-\u9fff]{2,5}$/.test(f) &&
    !VALUABLE_BODY_RE.test(f) &&
    !/\d|乱交|キス|潮|ピストン|ナンパ|痴女|洗脳|姉妹|バス|ツアー|発掘|育成|わからせ|メスガキ|性感|玩具/.test(
      f,
    )
  ) {
    return true;
  }
  return false;
}

function isValuableBodyContribution(c: InformationalContribution, claim?: ClaimStatementRef): boolean {
  if (isCatalogContribution(c, claim)) return false;
  if (isWeakBodyFacet(c.facet)) return false;
  if (isIdentityGlueContribution(c, claim)) return false;
  if (VALUABLE_BODY_RE.test(c.facet)) return true;
  // Non-catalog atomics (≥3) are editorial differentiators for body viability
  if (c.facet.length >= 3) return true;
  return false;
}

function isCatalogClaimRef(claim?: ClaimStatementRef): boolean {
  if (!claim) return true;
  const kind = (claim.kind ?? "").toLowerCase();
  if (["maker", "availability", "temporal_sale", "label"].includes(kind)) return true;
  return false;
}

function concretenessScore(c: InformationalContribution): number {
  let score = c.facet.length;
  if (/^\d+泊\d+日$/.test(c.facet)) score += 55;
  if (/\d+(名|時間|作品|泊|日|人)/.test(c.facet)) score += 40;
  // Prefer full duration compounds over bare day/night fragments
  if (/^\d+日$/.test(c.facet) || /^\d+泊$/.test(c.facet)) score -= 25;
  if (
    /ベロキス|舐め|痴女|わからせ|洗脳|姉妹|バスツアー|乱交|生ハメ|顔面|潮|ピストン|ナンパ|巨乳|感度|水着|ベスト|収録|メスガキ/.test(
      c.facet,
    )
  ) {
    score += 30;
  }
  if (CATALOG_FACET_RE.test(c.facet)) score -= 50;
  // Prefer atomic quantity units over leftover noise
  if (/^\d+(?:名|時間|作品|分|人)$/.test(c.facet)) score += 15;
  return score;
}

function facetsFromClaimStatement(claimId: string, statement: string): InformationalContribution[] {
  return normalizeAtomicFacets(extractTextFacets(statement))
    .filter((f) => f.length >= 2)
    .map((facet) => ({ id: `${claimId}::${facet}`, claimId, facet }));
}

/**
 * Build segment allocation: lead consumes few strongest *atomic* facets;
 * remaining concrete facets go to body (same claimId OK, same facet text forbidden).
 *
 * Plan-time SSOT: compound strings are normalized to atomics before assignment.
 */
export function buildSegmentContributionAllocation(input: {
  claims: ClaimStatementRef[];
  openingClaimIds: string[];
  developmentClaimIds: string[];
  claimsAllowEvaluation?: boolean;
}): SegmentContributionAllocation {
  const byId = new Map(input.claims.map((c) => [c.id, c]));
  // Prefer richer opening claims first so long titles decompose into lead+body
  const openingSorted = [...input.openingClaimIds].sort((a, b) => {
    const ca = byId.get(a);
    const cb = byId.get(b);
    return (cb?.statement.length ?? 0) - (ca?.statement.length ?? 0);
  });

  const base = buildContributionPlan({
    claims: input.claims,
    openingClaimIds: openingSorted,
    developmentClaimIds: input.developmentClaimIds,
  });

  // Opening vs development pools stay separate so development facets never steal lead slots.
  const openingPool: InformationalContribution[] = [];
  const developmentPool: InformationalContribution[] = [];
  const openingSeen = new Set<string>();
  const developmentSeen = new Set<string>();
  const pushPool = (
    pool: InformationalContribution[],
    seen: Set<string>,
    c: InformationalContribution,
  ) => {
    const k = facetKey(c.facet);
    if (seen.has(k) || c.facet.length < 2) return;
    seen.add(k);
    pool.push(c);
  };

  for (const id of openingSorted) {
    const claim = byId.get(id);
    if (!claim) continue;
    for (const c of base.byRole.lead.concat(base.byRole.development).filter((x) => x.claimId === id)) {
      pushPool(openingPool, openingSeen, c);
    }
    for (const c of facetsFromClaimStatement(id, claim.statement)) {
      pushPool(openingPool, openingSeen, c);
    }
  }
  for (const id of input.developmentClaimIds) {
    if (openingSorted.includes(id)) continue;
    const claim = byId.get(id);
    if (!claim) continue;
    for (const c of facetsFromClaimStatement(id, claim.statement)) {
      // Skip facets already claimed by opening (same atomic key)
      if (openingSeen.has(facetKey(c.facet))) continue;
      pushPool(developmentPool, developmentSeen, c);
    }
  }

  const rankedOpening = [...openingPool].sort((a, b) => concretenessScore(b) - concretenessScore(a));
  const valuableOpening = rankedOpening.filter(
    (c) =>
      !isCatalogContribution(c, byId.get(c.claimId)) &&
      isValuableBodyContribution(c, byId.get(c.claimId)),
  );

  // Lead budget: 1 primary family (+ optional setting companion). Never consume all families.
  const leadContributions: InformationalContribution[] = [];
  const used = new Set<string>();
  const primary = valuableOpening[0] ?? rankedOpening[0];
  if (primary) {
    leadContributions.push({ ...primary, assignedRole: "lead" });
    used.add(facetKey(primary.facet));
    const primaryFamily = contributionFamilyKey(primary.facet);
    if (isSettingFamilyKey(primaryFamily)) {
      for (const c of valuableOpening) {
        if (used.has(facetKey(c.facet))) continue;
        const fk = contributionFamilyKey(c.facet);
        if (isSettingFamilyKey(fk) && fk !== primaryFamily) {
          leadContributions.push({ ...c, assignedRole: "lead" });
          used.add(facetKey(c.facet));
          break;
        }
      }
    }
  }
  if (leadContributions.length === 0 && rankedOpening[0]) {
    leadContributions.push({ ...rankedOpening[0]!, assignedRole: "lead" });
    used.add(facetKey(rankedOpening[0]!.facet));
  }

  // Body: leftover opening atomics first, then development-claim atomics
  const bodyContributions: InformationalContribution[] = [];
  const bodyCandidates = [
    ...rankedOpening.filter((c) => !used.has(facetKey(c.facet))),
    ...[...developmentPool].sort((a, b) => concretenessScore(b) - concretenessScore(a)),
  ];
  for (const c of bodyCandidates) {
    const k = facetKey(c.facet);
    if (used.has(k)) continue;
    if (isCatalogContribution(c, byId.get(c.claimId))) continue;
    if (isWeakBodyFacet(c.facet)) continue;
    if (isIdentityGlueContribution(c, byId.get(c.claimId))) continue;
    bodyContributions.push({ ...c, assignedRole: "development" });
    used.add(k);
  }

  // Body viability: valuable/non-weak atomics only
  let concreteBody = bodyContributions.filter((c) =>
    isValuableBodyContribution(c, byId.get(c.claimId)),
  );

  // Development reserve feasibility: ≥1 independent body family when material allows
  const allValuableFacets = valuableOpening.map((c) => c.facet);
  const totalFamilies = countIndependentFamilies(allValuableFacets);
  let bodyFamilies = countIndependentFamilies(concreteBody.map((c) => c.facet));

  // Shrink lead to free a development family when possible
  while (
    bodyFamilies < 1 &&
    totalFamilies >= 2 &&
    leadContributions.length > 1
  ) {
    const moved = leadContributions.pop()!;
    if (!isWeakBodyFacet(moved.facet) && !isCatalogContribution(moved, byId.get(moved.claimId))) {
      bodyContributions.unshift({ ...moved, assignedRole: "development" });
    }
    concreteBody = bodyContributions.filter((c) =>
      isValuableBodyContribution(c, byId.get(c.claimId)),
    );
    bodyFamilies = countIndependentFamilies(concreteBody.map((c) => c.facet));
  }

  if (concreteBody.length === 0 && leadContributions.length >= 2) {
    const moved = leadContributions.splice(1);
    for (const m of moved) {
      if (isWeakBodyFacet(m.facet) || isCatalogContribution(m, byId.get(m.claimId))) continue;
      bodyContributions.unshift({ ...m, assignedRole: "development" });
    }
    concreteBody = bodyContributions.filter((c) =>
      isValuableBodyContribution(c, byId.get(c.claimId)),
    );
    bodyFamilies = countIndependentFamilies(concreteBody.map((c) => c.facet));
  }

  const leadHasSubstance = leadContributions.some(
    (c) =>
      isValuableBodyContribution(c, byId.get(c.claimId)) ||
      !isCatalogContribution(c, byId.get(c.claimId)),
  );
  const developmentIds = input.developmentClaimIds.filter((id) => !openingSorted.includes(id));
  const catalogOnlyDevelopment =
    developmentIds.length > 0 && developmentIds.every((id) => isCatalogClaimRef(byId.get(id)));

  // INSUFFICIENT when no independent development family can be reserved
  const insufficientDevelopmentMaterial =
    (concreteBody.length === 0 && (catalogOnlyDevelopment || !leadHasSubstance)) ||
    (totalFamilies >= 1 && bodyFamilies < 1 && concreteBody.length === 0) ||
    (totalFamilies <= 1 && concreteBody.length === 0 && leadHasSubstance && catalogOnlyDevelopment);

  // Stricter: material exists as one family only in lead → no development progression possible
  const noDevelopmentReserve =
    bodyFamilies < 1 &&
    (concreteBody.length === 0 ||
      concreteBody.every((c) => isCatalogContribution(c, byId.get(c.claimId))));
  const deferInsufficient = insufficientDevelopmentMaterial || noDevelopmentReserve;

  const bodyForPlan = deferInsufficient || concreteBody.length === 0 ? [] : concreteBody.slice(0, 6);

  const titleContribution = leadContributions[0]
    ? { ...leadContributions[0], assignedRole: "title" as const }
    : null;
  const summaryContributions = leadContributions
    .slice(0, Math.min(3, leadContributions.length))
    .map((c) => ({ ...c, assignedRole: "summary" as const }));

  const plan: ContributionPlan = {
    byRole: {
      title: titleContribution ? [titleContribution] : [],
      lead: leadContributions,
      development: bodyForPlan,
      summary: summaryContributions,
      cta: [],
    },
    unusedForDevelopment: bodyForPlan,
    allIds: [
      ...(titleContribution ? [titleContribution] : []),
      ...leadContributions,
      ...bodyForPlan,
    ].map((c) => c.id),
  };

  const allowEval = Boolean(input.claimsAllowEvaluation);
  const forbiddenForBody = leadContributions;
  // RESERVED_FOR_LATER: body contributions are hard-forbidden as lead informational assertions
  const reservedForLater = bodyForPlan;
  const forbiddenForLead = reservedForLater;

  const emptyReserved: InformationalContribution[] = [];
  const segmentContracts: SegmentContributionAllocation["segmentContracts"] = {
    title: {
      role: "title",
      allowedContributions: plan.byRole.title,
      requiredContributions: plan.byRole.title.slice(0, 1),
      reservedForLaterContributions: emptyReserved,
      forbiddenConsumedContributions: [],
      allowedRelationFamilies: allowEval ? ["FACTUAL", "EVALUATION"] : ["FACTUAL"],
    },
    lead: {
      role: "lead",
      allowedContributions: leadContributions,
      requiredContributions: leadContributions.slice(0, Math.min(2, leadContributions.length)),
      reservedForLaterContributions: reservedForLater,
      forbiddenConsumedContributions: forbiddenForLead,
      allowedRelationFamilies: allowEval ? ["FACTUAL", "EVALUATION"] : ["FACTUAL"],
    },
    development: {
      role: "development",
      allowedContributions: bodyForPlan,
      requiredContributions: bodyForPlan.slice(0, Math.min(3, bodyForPlan.length)),
      reservedForLaterContributions: emptyReserved,
      forbiddenConsumedContributions: forbiddenForBody,
      allowedRelationFamilies: allowEval ? ["FACTUAL", "EVALUATION"] : ["FACTUAL"],
    },
    summary: {
      role: "summary",
      allowedContributions: summaryContributions,
      requiredContributions: [],
      reservedForLaterContributions: emptyReserved,
      forbiddenConsumedContributions: [],
      allowedRelationFamilies: allowEval ? ["FACTUAL", "EVALUATION"] : ["FACTUAL"],
    },
  };

  return {
    plan,
    titleContribution,
    leadContributions,
    bodyContributions: bodyForPlan,
    summaryContributions,
    segmentContracts,
    insufficientDevelopmentMaterial: deferInsufficient,
    insufficientReason: deferInsufficient
      ? bodyFamilies < 1
        ? "no_independent_development_family_reserved"
        : "body_contributions_catalog_only_or_empty"
      : null,
  };
}

export type ContributionComplianceFinding = {
  code: EditorialFailureCode;
  message: string;
  role: string;
  evidence?: Record<string, unknown>;
};

export type ContributionComplianceResult = {
  ok: boolean;
  findings: ContributionComplianceFinding[];
};

function facetHit(text: string, facet: string): boolean {
  const t = text.replace(/\s+/g, "");
  const f = facet.replace(/\s+/g, "");
  if (f.length < 2) return false;
  if (t.includes(f)) return true;
  // Long compound facets: satisfy if a concrete token (≥2 kanji / quantity) appears
  if (f.length >= 5) {
    const parts =
      f.match(/\d+[\u4e00-\u9fff]+|[\u30a0-\u30ff]{3,}|[\u4e00-\u9fff]{2,4}/g) ?? [];
    let hits = 0;
    for (const part of parts) {
      if (part.length >= 2 && t.includes(part)) hits += 1;
    }
    if (hits >= Math.min(2, parts.length) || (parts.length === 1 && hits === 1)) return true;
  }
  return false;
}

/** Shared facet presence — used by RAW plan gate and post-gen contribution compliance. */
export function contributionFacetPresent(text: string, facet: string): boolean {
  return facetHit(text, facet);
}

/**
 * Deterministic post-generation compliance against segment contribution contracts.
 */
export function validateContributionCompliance(input: {
  article: {
    title: string;
    summary: string;
    lead: string;
    sections: Array<{ paragraphs: string[] }>;
  };
  allocation: SegmentContributionAllocation;
  claimsAllowEvaluation?: boolean;
}): ContributionComplianceResult {
  const findings: ContributionComplianceFinding[] = [];
  const bodyText = input.article.sections.flatMap((s) => s.paragraphs).join("");
  const allowEval = Boolean(input.claimsAllowEvaluation);

  const checkRequired = (
    role: string,
    text: string,
    required: InformationalContribution[],
  ) => {
    if (required.length === 0) return;
    const missing = required.filter((c) => !facetHit(text, c.facet));
    // Pass if at least half of required (or 1) appear — avoid brittle overfit
    const need = Math.min(1, required.length);
    const hit = required.length - missing.length;
    if (hit < need) {
      findings.push({
        code: "GENERATION_PLAN_UNDERUSE",
        message: `${role} missing required contributions`,
        role,
        evidence: {
          missing: missing.map((m) => m.facet).slice(0, 6),
          required: required.map((r) => r.facet),
        },
      });
    }
  };

  const checkForbidden = (
    role: string,
    text: string,
    forbidden: InformationalContribution[],
  ) => {
    if (!text || forbidden.length === 0) return;
    const reused = forbidden.filter((c) => facetHit(text, c.facet));
    // Body repeating lead-consumed facets is blocking.
    // One primary lead facet fully reused counts; with multiple, require ≥2 overlaps.
    const reuseThreshold = Math.min(2, Math.max(1, forbidden.length));
    if (role === "development" && reused.length >= reuseThreshold) {
      findings.push({
        code: "REPETITION",
        message: `PLAN_REUSE: ${role} restates lead-consumed contributions`,
        role,
        evidence: { reused: reused.map((r) => r.facet).slice(0, 6) },
      });
    }
  };

  if (!input.allocation.insufficientDevelopmentMaterial) {
    checkRequired("lead", input.article.lead, input.allocation.segmentContracts.lead.requiredContributions);
    checkRequired(
      "development",
      bodyText,
      input.allocation.segmentContracts.development.requiredContributions,
    );
    checkForbidden(
      "development",
      bodyText,
      input.allocation.segmentContracts.development.forbiddenConsumedContributions,
    );
  }

  if (!allowEval) {
    const blobs = [input.article.title, input.article.lead, bodyText, input.article.summary];
    for (const [i, blob] of blobs.entries()) {
      if (hasEvaluativeRelation(blob)) {
        findings.push({
          code: "EVALUATIVE_INFERENCE",
          message: "Unsupported evaluation relation without SUPPORTED evaluative claim",
          role: ["title", "lead", "development", "summary"][i]!,
        });
        break;
      }
    }
  }

  // Empty body when plan required development
  if (
    !input.allocation.insufficientDevelopmentMaterial &&
    input.allocation.bodyContributions.length > 0 &&
    bodyText.replace(/\s+/g, "").length < 4
  ) {
    findings.push({
      code: "GENERATION_PLAN_UNDERUSE",
      message: "empty body despite assigned body contributions",
      role: "development",
    });
  }

  return { ok: findings.length === 0, findings };
}

/**
 * X: detect near-verbatim source-title restatement via contribution sequence overlap.
 * Selection/compression of few concrete facets from a long title is NOT a hit.
 */
export function detectSourceTitleRestatement(input: {
  body: string;
  sourceStatements: string[];
}): { hit: boolean; evidence: Record<string, unknown> } {
  const body = input.body.trim();
  if (body.length < 12) return { hit: false, evidence: {} };

  const sources = input.sourceStatements
    .map((s) => s.trim())
    .filter((s) => s.length >= 24)
    .sort((a, b) => b.length - a.length);
  if (sources.length === 0) return { hit: false, evidence: {} };

  const source = sources[0]!;
  const sourceFacets = observeFacetsInText(source).filter((f) => f.length >= 2);
  const bodyFacets = observeFacetsInText(body).filter((f) => f.length >= 2);
  if (sourceFacets.length < 4) return { hit: false, evidence: { reason: "source_too_few_facets" } };

  const sourceKeys = new Set(sourceFacets.map(facetKey));
  const matched = bodyFacets.filter((f) => sourceKeys.has(facetKey(f)));
  const matchedUnique = [...new Set(matched.map(facetKey))];
  const coverage = matchedUnique.length / sourceFacets.length;

  // Contiguous overlap (normalized)
  const norm = (t: string) => t.replace(/\s+/g, "").replace(/[「」【】]/g, "");
  const sn = norm(source);
  const bn = norm(body);
  let longest = 0;
  for (let i = 0; i < sn.length; i++) {
    for (let j = i + 12; j <= sn.length; j++) {
      const sub = sn.slice(i, j);
      if (bn.includes(sub)) longest = Math.max(longest, sub.length);
    }
  }
  // Cap scan cost: use rolling window of length 20–40
  longest = 0;
  const window = 24;
  for (let i = 0; i + window <= sn.length; i += 4) {
    if (bn.includes(sn.slice(i, i + window))) longest = Math.max(longest, window);
  }
  for (let i = 0; i + 40 <= sn.length; i += 8) {
    if (bn.includes(sn.slice(i, i + 40))) longest = Math.max(longest, 40);
  }

  const novelBody = bodyFacets.filter((f) => !sourceKeys.has(facetKey(f)));
  // Restatement: high facet coverage OR long contiguous copy, and no novel support facet
  const highCoverage = matchedUnique.length >= 4 && coverage >= 0.55;
  const longCopy = longest >= 24 && matchedUnique.length >= 3;
  const noNovel = novelBody.length === 0;

  // Compression/selection: few matched facets relative to rich source → OK
  const selective =
    matchedUnique.length <= 3 && coverage < 0.45 && longest < 24;

  if (selective) {
    return {
      hit: false,
      evidence: { selective: true, matched: matchedUnique.length, coverage, longest },
    };
  }

  const hit = noNovel && (highCoverage || longCopy);
  return {
    hit,
    evidence: {
      matched: matchedUnique.length,
      sourceFacets: sourceFacets.length,
      coverage,
      longestContiguous: longest,
      novelBody: novelBody.slice(0, 4),
    },
  };
}

/**
 * Allocate X hook/support contributions at facet level (not whole title claim).
 */
export function allocateXFacetContributions(input: {
  claimStatements: Array<{ id: string; statement: string }>;
  hookClaimIds: string[];
  supportClaimIds: string[];
}): {
  sufficient: boolean;
  reason: string | null;
  hookContributions: InformationalContribution[];
  supportContributions: InformationalContribution[];
} {
  const byId = new Map(input.claimStatements.map((c) => [c.id, c]));
  const pickConcrete = (ids: string[]): InformationalContribution[] => {
    const out: InformationalContribution[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const claim = byId.get(id);
      if (!claim) continue;
      const contribs = observeFacetsInText(claim.statement)
        .filter((f) => f.length >= 2 && !CATALOG_FACET_RE.test(f))
        .map((facet) => ({ id: `${id}::${facet}`, claimId: id, facet }))
        .sort((a, b) => concretenessScore(b) - concretenessScore(a));
      for (const c of contribs) {
        const k = facetKey(c.facet);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(c);
      }
    }
    return out;
  };

  const fromHookClaims = pickConcrete(
    input.hookClaimIds.length ? input.hookClaimIds : input.claimStatements.map((c) => c.id),
  );
  const hookContributions = fromHookClaims.slice(0, 2);
  const hookKeys = new Set(hookContributions.map((c) => facetKey(c.facet)));
  const supportPool = pickConcrete(
    input.supportClaimIds.length
      ? input.supportClaimIds
      : input.claimStatements.map((c) => c.id),
  ).filter((c) => !hookKeys.has(facetKey(c.facet)));
  // Prefer leftover facets from same long title as support when support claims are thin
  const leftoverFromHook = fromHookClaims
    .slice(2)
    .filter((c) => !hookKeys.has(facetKey(c.facet)));
  const supportContributions = (supportPool.length ? supportPool : leftoverFromHook).slice(0, 2);

  if (hookContributions.length === 0) {
    return {
      sufficient: false,
      reason: "no_concrete_hook_facet",
      hookContributions: [],
      supportContributions: [],
    };
  }

  // If only identity-like short facets, defer
  const onlyShortIdentity =
    hookContributions.every((c) => c.facet.length <= 4) && supportContributions.length === 0;
  if (onlyShortIdentity) {
    return {
      sufficient: false,
      reason: "compresses_to_product_name_only",
      hookContributions,
      supportContributions: [],
    };
  }

  return {
    sufficient: true,
    reason: null,
    hookContributions,
    supportContributions,
  };
}
