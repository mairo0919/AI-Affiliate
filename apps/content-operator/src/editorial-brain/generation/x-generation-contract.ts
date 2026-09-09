/**
 * X material / generation contract — X_SOCIAL_CONTENT from Evidence, not article body.
 * Timeline-safe acquisition copy; never summarize WordPress ARTICLE_CONTENT.
 */

import type { CoreEditorialPlan } from "../core/types.js";
import type { XChannelPlanSpecifics } from "../channels/x/adapter.js";
import { allocateXFacetContributions } from "./contribution-compliance.js";
import {
  filterClaimsForXSocialContent,
  isXSocialSafeClaimStatement,
} from "../../x/x-social-content-policy.js";
import { CONTENT_POLICY_SURFACE } from "../../x/content-policy-surfaces.js";

export type XMaterialAssessment = {
  sufficient: boolean;
  reason: string | null;
  hookClaimIds: string[];
  supportClaimIds: string[];
  concreteClaimCount: number;
  hookFacets: string[];
  supportFacets: string[];
};

/** Catalog / identity signals suitable for X social hooks (non-sexual). */
const X_SOCIAL_CONCRETE_RE =
  /ベスト|総集編|収録|\d+名|\d+時間|\d+作品|\d+タイトル|最新\d+|Vol\.?\s*\d+|第\d+弾|シリーズ|発売|配信|出演/;

function isMetaCatalogClaim(statement: string): boolean {
  const s = statement.trim();
  if (!isXSocialSafeClaimStatement(s)) return true;
  if (X_SOCIAL_CONCRETE_RE.test(s)) return false;
  if (s.length <= 24 && !/メーカー|レーベル|配信状態|AVAILABLE/.test(s)) return false;
  return (
    /メーカー|レーベル|配信状態|AVAILABLE|公開ページ上で確認できる。$/.test(s) ||
    /メーカー／レーベル|販売／配信状態|シリーズ情報として|出演者／クリエイターとして/.test(s)
  );
}

export function assessXEditorialMaterial(input: {
  corePlan: CoreEditorialPlan;
  claimStatements: Array<{ id: string; statement: string }>;
  specifics: XChannelPlanSpecifics;
}): XMaterialAssessment {
  const socialSafe = filterClaimsForXSocialContent(input.claimStatements);
  const concrete = socialSafe.filter((c) => !isMetaCatalogClaim(c.statement));
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
    claimStatements: socialSafe,
    hookClaimIds: resolvedHook,
    supportClaimIds: resolvedSupport,
  });

  const safeHookFacets = facets.hookContributions
    .map((c) => c.facet)
    .filter((f) => isXSocialSafeClaimStatement(f));
  const safeSupportFacets = facets.supportContributions
    .map((c) => c.facet)
    .filter((f) => isXSocialSafeClaimStatement(f));

  if (concrete.length === 0) {
    return {
      sufficient: false,
      reason:
        socialSafe.length === 0
          ? "no_x_social_safe_claims"
          : (facets.reason ?? "no_concrete_supported_claims"),
      hookClaimIds: [],
      supportClaimIds: [],
      concreteClaimCount: concrete.length,
      hookFacets: [],
      supportFacets: [],
    };
  }

  if (safeHookFacets.length === 0) {
    return {
      sufficient: true,
      reason: null,
      hookClaimIds: resolvedHook,
      supportClaimIds: resolvedSupport,
      concreteClaimCount: concrete.length,
      hookFacets: concrete.slice(0, 2).map((c) => c.statement),
      supportFacets: concrete.slice(2, 3).map((c) => c.statement),
    };
  }

  return {
    sufficient: true,
    reason: null,
    hookClaimIds: resolvedHook,
    supportClaimIds: resolvedSupport,
    concreteClaimCount: concrete.length,
    hookFacets: safeHookFacets,
    supportFacets: safeSupportFacets,
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
  const socialSafe = filterClaimsForXSocialContent(input.claimStatements);
  const byId = new Map(socialSafe.map((c) => [c.id, c.statement]));
  const facets = allocateXFacetContributions({
    claimStatements: socialSafe,
    hookClaimIds: input.material.hookClaimIds,
    supportClaimIds: input.material.supportClaimIds,
  });

  return {
    contentPolicySurface: CONTENT_POLICY_SURFACE.X_SOCIAL_CONTENT,
    objective: "x_social_acquisition_from_evidence_not_article_summary",
    productTitle: input.productTitle,
    requiresBlogBody: false,
    mustNotSummarizeArticleBody: true,
    postMode: input.specifics.postMode,
    characterBudget: input.specifics.characterBudget,
    editorialAngle: input.specifics.editorialAngle,
    hookContribution: {
      claimIds: input.material.hookClaimIds,
      facets: facets.hookContributions
        .filter(
          (c) =>
            isXSocialSafeClaimStatement(c.facet) ||
            isXSocialSafeClaimStatement(byId.get(c.claimId) ?? ""),
        )
        .map((c) => ({
          claimId: c.claimId,
          facet: c.facet,
          statement: byId.get(c.claimId) ?? "",
        })),
    },
    supportContribution: {
      claimIds: input.material.supportClaimIds,
      facets: facets.supportContributions
        .filter(
          (c) =>
            isXSocialSafeClaimStatement(c.facet) ||
            isXSocialSafeClaimStatement(byId.get(c.claimId) ?? ""),
        )
        .map((c) => ({
          claimId: c.claimId,
          facet: c.facet,
          statement: byId.get(c.claimId) ?? "",
        })),
    },
    ctaRole: {
      mayIncludeUrl: Boolean(input.bloggerUrl || input.productUrl),
      url: input.bloggerUrl || input.productUrl || null,
      mustNotAddEvaluation: true,
      preferredSoftCta: ["まとめてチェック", "最新作を確認", "シリーズをチェック"],
    },
    rules: [
      "This is X_SOCIAL_CONTENT — do NOT summarize, compress, or excerpt the WordPress article body.",
      "Write from Evidence facets only (actress name, runtime, title count, best/compilation, release).",
      "Forbidden: sexual acts, genitals/fluids, explicit body focus, adult hype, or leading with 'adult AV' framing.",
      "Hook = concrete catalog facet (e.g. 最新12タイトル / 8時間ベスト) — never paste the full product title as the post.",
      "Support = a different catalog facet; CTA = soft article invite + URL when provided.",
      "Do not invent popularity, ranking, reviews, or evaluations.",
      "If material is only a product name, caller will defer — do not invent.",
    ],
    scarcityMode: input.corePlan.scarcityMode,
  };
}
