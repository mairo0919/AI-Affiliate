/**
 * RAW Editorial Plan Compliance — before strip / Brain repair / persist.
 * Exact contribution IDs + semantic family / composite subsumption.
 */

import { hasEvaluativeRelation } from "../shadow/predicate-families.js";
import { facetKey, observeFacetsInText } from "./informational-contribution.js";
import { contributionFacetPresent } from "./contribution-compliance.js";
import type { BrainGenerationInputContract } from "./generation-input-contract.js";
import {
  bodyFacetIllicitlyRestates,
  expandConsumedFacets,
  facetsSemanticallyEquivalent,
  isSemanticRestatement,
  isTrackableFacet,
  planFailureSignature,
} from "./contribution-family.js";

export type RawPlanComplianceCode =
  | "REQUIRED_CONTRIBUTION_MISSING"
  | "FORBIDDEN_CONTRIBUTION_REUSED"
  | "PREMATURE_CONTRIBUTION_CONSUMPTION"
  | "LEAD_BODY_OVERLAP"
  | "PARAGRAPH_NO_NEW_CONTRIBUTION"
  | "SOURCE_TITLE_RESTATEMENT"
  | "UNSUPPORTED_EVALUATION"
  | "CATALOG_ONLY_PARAGRAPH"
  | "EMPTY_REQUIRED_SEGMENT"
  | "PROVENANCE_MISMATCH"
  | "STRUCTURAL_PROGRESSION_FAILURE"
  | "SEMANTIC_CONTRIBUTION_REUSE"
  | "COMPOSITE_COMPONENT_RESTATEMENT"
  | "PROVENANCE_CONTRADICTION";

export type RawPlanComplianceFinding = {
  code: RawPlanComplianceCode;
  severity: "BLOCKING" | "INFO";
  segment: string;
  message: string;
  contributionIds?: string[];
  facets?: string[];
};

export type RawPlanComplianceResult = {
  ok: boolean;
  planExecutionFailed: boolean;
  findings: RawPlanComplianceFinding[];
  structuralDefect: boolean;
  violatedSegments: string[];
  missingRequiredContributionIds: string[];
  forbiddenReusedContributionIds: string[];
  /** Lead used RESERVED_FOR_LATER / body-required contributions */
  prematurelyConsumedContributionIds: string[];
  /** Semantic facets reused (for regen signature) */
  semanticReusedFacets: string[];
  missingFacets: string[];
  failureSignature: string;
  /** Lead observed + family-closed consumption */
  leadConsumedFacets: string[];
  bodyOnlyRestatesLead: boolean;
};

export type SegmentContributionProvenance = {
  lead?: { requiredContributionIds?: string[]; usedContributionIds?: string[] };
  sections?: Array<{
    requiredContributionIds?: string[];
    usedContributionIds?: string[];
  }>;
};

const CATALOG_ONLY_RE =
  /メーカー|レーベル|配信中|AVAILABLE|公開ページ|販売／配信|クレジットされているだけ/;

function facetPresent(text: string, facet: string): boolean {
  return contributionFacetPresent(text, facet);
}

export function validateRawEditorialPlanCompliance(input: {
  article: {
    title: string;
    summary: string;
    lead: string;
    sections: Array<{ paragraphs: string[]; heading?: string | null }>;
  };
  contract: BrainGenerationInputContract;
  productTitle?: string;
  segmentContributionProvenance?: SegmentContributionProvenance | null;
}): RawPlanComplianceResult {
  const findings: RawPlanComplianceFinding[] = [];
  const missingRequired = new Set<string>();
  const forbiddenReused = new Set<string>();
  const prematureConsumed = new Set<string>();
  const semanticReused = new Set<string>();
  const missingFacets = new Set<string>();
  const violated = new Set<string>();

  const leadReq = input.contract.segmentContracts.lead.requiredContributions;
  const bodyReq = input.contract.segmentContracts.development.requiredContributions;
  const bodyForbidden = input.contract.segmentContracts.development.forbiddenConsumedContributions;
  const reservedForLater =
    input.contract.segmentContracts.lead.reservedForLaterContributions?.length
      ? input.contract.segmentContracts.lead.reservedForLaterContributions
      : bodyReq;
  const planFacets = [
    ...leadReq,
    ...bodyReq,
    ...bodyForbidden,
    ...input.contract.segmentContracts.lead.allowedContributions,
    ...input.contract.segmentContracts.development.allowedContributions,
  ].map((c) => c.facet);

  const leadText = (input.article.lead ?? "").trim();
  if (!leadText) {
    findings.push({
      code: "EMPTY_REQUIRED_SEGMENT",
      severity: "BLOCKING",
      segment: "lead",
      message: "lead is empty",
    });
    violated.add("lead");
  }

  if (leadReq.length > 0 && leadText) {
    const leadHits = leadReq.filter((c) => facetPresent(leadText, c.facet));
    if (leadHits.length < 1) {
      for (const c of leadReq) {
        findings.push({
          code: "REQUIRED_CONTRIBUTION_MISSING",
          severity: "BLOCKING",
          segment: "lead",
          message: `lead missing required facet ${c.facet}`,
          contributionIds: [c.id],
          facets: [c.facet],
        });
        missingRequired.add(c.id);
        missingFacets.add(c.facet);
      }
      violated.add("lead");
    }
  }

  const bodyParas = input.article.sections.flatMap((s, si) =>
    (s.paragraphs ?? [])
      .map((p, pi) => ({ text: (p ?? "").trim(), segment: `section:${si}:p${pi}` }))
      .filter((x) => x.text.length > 0),
  );

  if (bodyReq.length > 0 && bodyParas.length === 0) {
    findings.push({
      code: "EMPTY_REQUIRED_SEGMENT",
      severity: "BLOCKING",
      segment: "development",
      message: "body empty but development required contributions exist",
    });
    violated.add("development");
  }

  // Lead observed → semantic consumed closure (H6 fix) — plan-scoped trackables only
  const leadExpansion = expandConsumedFacets({
    segmentText: leadText,
    planFacets,
  });
  const leadConsumed = leadExpansion.consumed;
  // Contract lead-required / body-forbidden trackables count as consumed (allocation SSOT)
  for (const c of [...leadReq, ...bodyForbidden]) {
    const k = facetKey(c.facet);
    if (isTrackableFacet(k, planFacets) || isTrackableFacet(c.facet, planFacets)) {
      leadConsumed.add(k);
    }
  }

  // Progressive: RESERVED_FOR_LATER / body-required must not be consumed in lead.
  // Identity/cast glue is excluded — grammatically inevitable, not informational budget.
  const IDENTITY_GLUE_RE =
    /出演者|クレジット|クリエイター|^[\u4e00-\u9fff]{2,5}$/;
  for (const c of [...reservedForLater, ...bodyReq]) {
    const facet = c.facet.replace(/\s+/g, "");
    if (
      IDENTITY_GLUE_RE.test(facet) &&
      !/\d|乱交|キス|潮|ピストン|ナンパ|痴女|洗脳|姉妹|バス|ツアー|発掘|育成|わからせ|メスガキ|性感|玩具|ベロ|舐め|イヤラ/.test(
        facet,
      )
    ) {
      continue;
    }
    if (leadText && facetPresent(leadText, c.facet)) {
      findings.push({
        code: "PREMATURE_CONTRIBUTION_CONSUMPTION",
        severity: "BLOCKING",
        segment: "lead",
        message: `lead prematurely consumes reserved/body contribution ${c.facet}`,
        contributionIds: [c.id],
        facets: [c.facet],
      });
      prematureConsumed.add(c.id);
      forbiddenReused.add(c.id);
      semanticReused.add(c.facet);
      violated.add("lead");
    }
  }

  const bodyTextAll = bodyParas.map((p) => p.text).join("\n");
  if (bodyReq.length > 0 && bodyTextAll) {
    const bodyHits = bodyReq.filter((c) => facetPresent(bodyTextAll, c.facet));
    if (bodyHits.length < 1) {
      for (const c of bodyReq) {
        findings.push({
          code: "REQUIRED_CONTRIBUTION_MISSING",
          severity: "BLOCKING",
          segment: "development",
          message: `body missing required facet ${c.facet}`,
          contributionIds: [c.id],
          facets: [c.facet],
        });
        missingRequired.add(c.id);
        missingFacets.add(c.facet);
      }
      violated.add("development");
    }
  }

  // Exact forbidden reuse (contract) — any lead-consumed facet in body (threshold 1 for semantic gate)
  const exactReused = bodyForbidden.filter((c) => facetPresent(bodyTextAll, c.facet));
  if (exactReused.length >= 1) {
    for (const c of exactReused) {
      findings.push({
        code: "FORBIDDEN_CONTRIBUTION_REUSED",
        severity: "BLOCKING",
        segment: "development",
        message: `body reuses lead-consumed facet ${c.facet}`,
        contributionIds: [c.id],
        facets: [c.facet],
      });
      forbiddenReused.add(c.id);
      semanticReused.add(c.facet);
    }
    violated.add("development");
  }

  // Semantic / composite restatement of lead-observed consumption (H1–H5)
  const bodyObserved = observeFacetsInText(bodyTextAll).map(facetKey);
  // Also include plan facets present in body (extractor may miss compound forms)
  for (const p of planFacets) {
    if (facetPresent(bodyTextAll, p)) bodyObserved.push(facetKey(p));
  }
  const bodyObservedUnique = [...new Set(bodyObserved)];
  for (const bf of bodyObservedUnique) {
    if (
      bodyFacetIllicitlyRestates({
        bodyFacet: bf,
        leadConsumed,
        leadLocks: leadExpansion.locks,
        planFacets,
      })
    ) {
      const viaLock = leadExpansion.locks.some((l) =>
        l.lockedKeys.some((k) => facetsSemanticallyEquivalent(k, bf)),
      );
      findings.push({
        code: viaLock ? "COMPOSITE_COMPONENT_RESTATEMENT" : "SEMANTIC_CONTRIBUTION_REUSE",
        severity: "BLOCKING",
        segment: "development",
        message: viaLock
          ? `body restates locked composite component ${bf}`
          : `body semantically reuses lead-consumed contribution ${bf}`,
        facets: [bf],
      });
      semanticReused.add(bf);
      violated.add("development");
    }
  }

  const overlapFacets = leadReq
    .filter((c) => facetPresent(leadText, c.facet) && facetPresent(bodyTextAll, c.facet))
    .map((c) => c.facet);
  // Also semantic overlap against lead required
  for (const c of leadReq) {
    for (const bf of bodyObserved) {
      if (isSemanticRestatement(bf, [c.facet]) && !overlapFacets.includes(c.facet)) {
        overlapFacets.push(c.facet);
      }
    }
  }
  if (overlapFacets.length >= 1) {
    findings.push({
      code: "LEAD_BODY_OVERLAP",
      severity: "BLOCKING",
      segment: "development",
      message: `lead/body share required lead facets: ${overlapFacets.join(",")}`,
      facets: overlapFacets,
    });
    violated.add("development");
  }

  // Progressive paragraph novelty against semantic consumed set
  let consumed = new Set(leadConsumed);
  let parasWithoutNew = 0;
  let parasWithOnlyRestatement = 0;
  for (const para of bodyParas) {
    const catalogOnly =
      CATALOG_ONLY_RE.test(para.text) &&
      !bodyReq.some((c) => facetPresent(para.text, c.facet)) &&
      para.text.replace(/\s+/g, "").length < 60;
    if (catalogOnly) {
      findings.push({
        code: "CATALOG_ONLY_PARAGRAPH",
        severity: "BLOCKING",
        segment: para.segment,
        message: "catalog-only paragraph without required body contribution",
      });
      violated.add(para.segment);
    }
    if (hasEvaluativeRelation(para.text)) {
      const allowEval = input.contract.segmentContracts.development.allowedRelationFamilies.includes(
        "EVALUATION",
      );
      if (!allowEval && /おすすめ|楽しめる|必見|魅力的/.test(para.text)) {
        findings.push({
          code: "UNSUPPORTED_EVALUATION",
          severity: "BLOCKING",
          segment: para.segment,
          message: "unsupported evaluative padding in body paragraph",
        });
        violated.add(para.segment);
      }
    }
    // Novelty only vs trackable plan/qty/duration facets — ignore weak catalog tokens
    const trackable = observeFacetsInText(para.text)
      .map(facetKey)
      .filter((f) => isTrackableFacet(f, planFacets));
    const novel = trackable.filter((f) => !isSemanticRestatement(f, consumed));
    const carriesRequired = bodyReq.some(
      (c) =>
        facetPresent(para.text, c.facet) &&
        !isSemanticRestatement(c.facet, leadConsumed),
    );
    const onlyRestates =
      trackable.length > 0 &&
      trackable.every((f) => isSemanticRestatement(f, leadConsumed)) &&
      !carriesRequired;
    if (onlyRestates) parasWithOnlyRestatement += 1;

    if (trackable.length > 0 && novel.length === 0 && !carriesRequired && para.text.length > 15) {
      parasWithoutNew += 1;
      findings.push({
        code: "PARAGRAPH_NO_NEW_CONTRIBUTION",
        severity: "BLOCKING",
        segment: para.segment,
        message: "paragraph adds no new contribution beyond consumed lead/prior",
      });
      violated.add(para.segment);
    }
    for (const f of trackable) consumed.add(f);
  }

  if (input.productTitle && leadText) {
    const titleCore = input.productTitle.replace(/【[^】]*】/g, "").replace(/\s+/g, "");
    const leadCore = leadText.replace(/\s+/g, "");
    if (
      titleCore.length >= 30 &&
      leadCore.includes(titleCore.slice(0, Math.min(48, titleCore.length)))
    ) {
      findings.push({
        code: "SOURCE_TITLE_RESTATEMENT",
        severity: "INFO",
        segment: "lead",
        message: "lead largely restates productTitle",
      });
    }
  }

  const prov = input.segmentContributionProvenance;
  if (prov?.lead?.usedContributionIds?.length) {
    for (const id of prov.lead.usedContributionIds) {
      if (!id.includes("::")) continue;
      const facet = id.split("::").slice(1).join("::");
      if (facet.length >= 2 && !facetPresent(leadText, facet)) {
        findings.push({
          code: "PROVENANCE_MISMATCH",
          severity: "INFO",
          segment: "lead",
          message: `declared used contribution ${id} not found in lead text`,
          contributionIds: [id],
        });
      }
    }
  }
  // Provenance contradiction: model claims body used a lead-consumed contribution
  if (prov?.sections?.length) {
    for (const [i, sec] of prov.sections.entries()) {
      for (const id of sec.usedContributionIds ?? []) {
        if (!id.includes("::")) continue;
        const facet = id.split("::").slice(1).join("::");
        if (
          facet.length >= 2 &&
          bodyFacetIllicitlyRestates({
            bodyFacet: facet,
            leadConsumed,
            leadLocks: leadExpansion.locks,
            planFacets,
          })
        ) {
          findings.push({
            code: "PROVENANCE_CONTRADICTION",
            severity: "BLOCKING",
            segment: `section:${i}`,
            message: `provenance claims body used lead-consumed contribution ${id}`,
            contributionIds: [id],
            facets: [facet],
          });
          violated.add(`section:${i}`);
          semanticReused.add(facet);
        }
      }
    }
  }

  const bodyHasFreshRequired = bodyReq.some(
    (c) => facetPresent(bodyTextAll, c.facet) && !facetPresent(leadText, c.facet),
  );
  const bodyOnlyRestatesLead =
    bodyParas.length > 0 &&
    !bodyHasFreshRequired &&
    (parasWithOnlyRestatement === bodyParas.length ||
      semanticReused.size >= 1 ||
      overlapFacets.length >= 1);

  const blocking = findings.filter((f) => f.severity === "BLOCKING");
  const structuralDefect =
    blocking.some((f) =>
      [
        "LEAD_BODY_OVERLAP",
        "FORBIDDEN_CONTRIBUTION_REUSED",
        "PREMATURE_CONTRIBUTION_CONSUMPTION",
        "STRUCTURAL_PROGRESSION_FAILURE",
        "EMPTY_REQUIRED_SEGMENT",
        "SEMANTIC_CONTRIBUTION_REUSE",
        "COMPOSITE_COMPONENT_RESTATEMENT",
        "PROVENANCE_CONTRADICTION",
      ].includes(f.code),
    ) ||
    blocking.filter((f) => f.code === "PARAGRAPH_NO_NEW_CONTRIBUTION").length >= 2 ||
    (parasWithoutNew >= 2 && overlapFacets.length >= 1);

  if (structuralDefect && (overlapFacets.length >= 1 || semanticReused.size >= 1) && bodyParas.length >= 1) {
    if (!blocking.some((f) => f.code === "STRUCTURAL_PROGRESSION_FAILURE")) {
      findings.push({
        code: "STRUCTURAL_PROGRESSION_FAILURE",
        severity: "BLOCKING",
        segment: "article",
        message: "article progression fails: body restates lead contributions",
        facets: [...overlapFacets, ...semanticReused].slice(0, 8),
      });
    }
  }

  const planExecutionFailed = findings.some((f) => f.severity === "BLOCKING");
  const codes = findings.filter((f) => f.severity === "BLOCKING").map((f) => f.code);
  return {
    ok: !planExecutionFailed,
    planExecutionFailed,
    findings,
    structuralDefect,
    violatedSegments: [...violated],
    missingRequiredContributionIds: [...missingRequired],
    forbiddenReusedContributionIds: [...forbiddenReused],
    prematurelyConsumedContributionIds: [...prematureConsumed],
    semanticReusedFacets: [...semanticReused],
    missingFacets: [...missingFacets],
    failureSignature: planFailureSignature({
      codes,
      reusedFacets: [...semanticReused, ...overlapFacets],
      missingFacets: [...missingFacets],
    }),
    leadConsumedFacets: [...leadConsumed],
    bodyOnlyRestatesLead,
  };
}

export function isStructuralPlanDefect(result: RawPlanComplianceResult): boolean {
  return result.structuralDefect;
}
