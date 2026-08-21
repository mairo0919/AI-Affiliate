/**
 * X material / generation contract — Claims → editorial post, not ad copy.
 * Facet-level hook/support allocation (long title ≠ whole-claim consume).
 */

import type { CoreEditorialPlan } from "../core/types.js";
import type { XChannelPlanSpecifics } from "../channels/x/adapter.js";
import { allocateXFacetContributions } from "./contribution-compliance.js";

export type XMaterialAssessment = {
  sufficient: boolean;
  reason: string | null;
  hookClaimIds: string[];
  supportClaimIds: string[];
  concreteClaimCount: number;
  hookFacets: string[];
  supportFacets: string[];
};

const META_CLAIM_RE = /メーカー|レーベル|配信状態|AVAILABLE|公開ページ上で確認できる。$/;

const CONCRETE_SCENE_RE =
  /感度|巨乳|潮吹|ピストン|シーン|ナンパ|清楚|絶頂|ハメ|水着|ベロキス|舐め|痴女|わからせ|洗脳|姉妹|バスツアー|乱交|生ハメ|顔面|潮|ベスト|収録|\d+名|\d+時間|\d+作品|\d+泊/;

function isMetaCatalogClaim(statement: string): boolean {
  const s = statement.trim();
  if (CONCRETE_SCENE_RE.test(s)) return false;
  if (s.length > 70) return false;
  return (
    META_CLAIM_RE.test(s) ||
    /メーカー／レーベル|販売／配信状態|シリーズ情報として|出演者／クリエイターとして/.test(s)
  );
}

export function assessXEditorialMaterial(input: {
  corePlan: CoreEditorialPlan;
  claimStatements: Array<{ id: string; statement: string }>;
  specifics: XChannelPlanSpecifics;
}): XMaterialAssessment {
  const concrete = input.claimStatements.filter((c) => !isMetaCatalogClaim(c.statement));
  const hookClaimIds = input.specifics.hookClaimIds.filter((id) =>
    concrete.some((c) => c.id === id),
  );
  const supportClaimIds = input.specifics.supportClaimIds.filter((id) =>
    concrete.some((c) => c.id === id),
  );

  const resolvedHook = hookClaimIds.length
    ? hookClaimIds
    : concrete.length
      ? [concrete[0]!.id]
      : [];
  const resolvedSupport = supportClaimIds.length
    ? supportClaimIds
    : concrete.slice(1, 3).map((c) => c.id);

  const facets = allocateXFacetContributions({
    claimStatements: input.claimStatements,
    hookClaimIds: resolvedHook,
    supportClaimIds: resolvedSupport,
  });

  if (concrete.length === 0 || !facets.sufficient) {
    return {
      sufficient: false,
      reason: facets.reason ?? "no_concrete_supported_claims",
      hookClaimIds: [],
      supportClaimIds: [],
      concreteClaimCount: concrete.length,
      hookFacets: [],
      supportFacets: [],
    };
  }

  return {
    sufficient: true,
    reason: null,
    hookClaimIds: resolvedHook,
    supportClaimIds: resolvedSupport,
    concreteClaimCount: concrete.length,
    hookFacets: facets.hookContributions.map((c) => c.facet),
    supportFacets: facets.supportContributions.map((c) => c.facet),
  };
}

export function buildXGenerationPromptContract(input: {
  productTitle: string;
  productUrl?: string | null;
  bloggerUrl?: string | null;
  corePlan: CoreEditorialPlan;
  specifics: XChannelPlanSpecifics;
  claimStatements: Array<{ id: string; statement: string }>;
  material: XMaterialAssessment;
}): Record<string, unknown> {
  const byId = new Map(input.claimStatements.map((c) => [c.id, c.statement]));
  const facets = allocateXFacetContributions({
    claimStatements: input.claimStatements,
    hookClaimIds: input.material.hookClaimIds,
    supportClaimIds: input.material.supportClaimIds,
  });

  return {
    objective: "editorial_post_from_supported_claims_not_ad_copy",
    productTitle: input.productTitle,
    requiresBlogBody: false,
    postMode: input.specifics.postMode,
    characterBudget: input.specifics.characterBudget,
    editorialAngle: input.specifics.editorialAngle,
    hookContribution: {
      claimIds: input.material.hookClaimIds,
      facets: facets.hookContributions.map((c) => ({
        claimId: c.claimId,
        facet: c.facet,
        statement: byId.get(c.claimId) ?? "",
      })),
    },
    supportContribution: {
      claimIds: input.material.supportClaimIds,
      facets: facets.supportContributions.map((c) => ({
        claimId: c.claimId,
        facet: c.facet,
        statement: byId.get(c.claimId) ?? "",
      })),
    },
    ctaRole: {
      mayIncludeUrl: Boolean(input.bloggerUrl || input.productUrl),
      url: input.bloggerUrl || input.productUrl || null,
      mustNotAddEvaluation: true,
    },
    rules: [
      "Hook = select the most concrete facet(s) from hookContribution — never paste the full product/source title.",
      "Support = a different facet than the hook (from supportContribution or leftover title facets).",
      "Do not create interest via evaluation relations unless a SUPPORTED evaluative claim exists.",
      "CTA may append URL only.",
      "If material compresses only to a product name, caller will defer — do not invent.",
    ],
    scarcityMode: input.corePlan.scarcityMode,
  };
}
