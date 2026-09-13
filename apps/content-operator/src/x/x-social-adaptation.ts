/**
 * Canonical ContentVersion / Evidence → X social adaptation.
 *
 * SSOT: ARTICLE_PLAN facts + Claims + canonical title (same product understanding).
 * Taxonomy/genre tags are auxiliary only. Never scrapes WordPress body.
 */

import { detectXAdultExpressions } from "./x-social-content-policy.js";
import { isWordPressPublicForXTraffic } from "./x-eligibility.js";
import {
  composeXSocialPosts,
  selectXSocialFacts,
  type XSocialFact,
  type XThreadShape,
} from "./x-social-facts.js";

export type XLinkMode = "WP_TRAFFIC" | "DIRECT_AFFILIATE" | "COMBINED";

export type { XThreadShape };

export type XAdaptedPost = {
  sequence: number;
  role: "ROOT" | "REPLY" | "CTA";
  body: string;
  linkKind: "none" | "wp" | "fanza";
};

export type XSocialAdaptationInput = {
  canonicalTitle: string;
  wordpressTitle?: string | null;
  productTitle?: string | null;
  cid: string;
  performerNames?: string[];
  seriesName?: string | null;
  claimStatements?: Array<{ id?: string; statement: string }>;
  /** @deprecated use taxonomyTags */
  safeFacets?: string[];
  taxonomyTags?: string[];
  articlePlanFacts?: XSocialFact[];
  publishedBlogUrl?: string | null;
  wpStatus?: string | null;
  affiliateUrl?: string | null;
  affiliateLinkReady?: boolean;
  preferredLinkMode?: XLinkMode | null;
  disclosure?: string | null;
  preferWpTraffic?: boolean;
};

export type XSocialAdaptationResult = {
  threadShape: XThreadShape;
  threadReason: string;
  linkMode: XLinkMode;
  posts: XAdaptedPost[];
  canonicalTitleUsed: string;
  wpTitleUsedAsSoleInput: false;
  titleDivergence: boolean;
  /** @deprecated use selectedFacts */
  hooks: string[];
  selectedFacts: XSocialFact[];
  discardedTaxonomy: string[];
  wpUrl: string | null;
  fanzaUrl: string | null;
  mediaMode: "TEXT_ONLY";
  warnings: string[];
  tracking: {
    format: "x-social-adaptation-v2";
    cid: string;
    linkMode: XLinkMode;
    threadShape: XThreadShape;
    hookCount: number;
    factSources: string[];
  };
};

const GENERIC_BANNED_RE =
  /この設定、.{0,12}一言では括れない|気になる作品を紹介|好きならチェック|注目ポイントをチェック|スレッドで紹介|まとめてチェックしたい人向け|見逃せない|注目作品|結局[、,]?○○が一番/u;

export function chooseXLinkMode(input: {
  publishedBlogUrl?: string | null;
  wpStatus?: string | null;
  affiliateUrl?: string | null;
  affiliateLinkReady?: boolean;
  preferredLinkMode?: XLinkMode | null;
  preferWpTraffic?: boolean;
}): {
  mode: XLinkMode;
  wpUrl: string | null;
  fanzaUrl: string | null;
  reason: string;
} {
  const wpPublic = isWordPressPublicForXTraffic(input.wpStatus);
  const wpUrl =
    wpPublic && input.publishedBlogUrl?.trim() ? input.publishedBlogUrl.trim() : null;
  const fanzaReady = input.affiliateLinkReady === true && Boolean(input.affiliateUrl?.trim());
  const fanzaUrl = fanzaReady ? input.affiliateUrl!.trim() : null;

  if (input.preferredLinkMode === "WP_TRAFFIC") {
    if (wpUrl) return { mode: "WP_TRAFFIC", wpUrl, fanzaUrl, reason: "preferred_wp" };
    if (fanzaUrl) {
      return {
        mode: "DIRECT_AFFILIATE",
        wpUrl: null,
        fanzaUrl,
        reason: "preferred_wp_but_not_public_use_fanza",
      };
    }
  }
  if (input.preferredLinkMode === "DIRECT_AFFILIATE") {
    if (fanzaUrl) return { mode: "DIRECT_AFFILIATE", wpUrl, fanzaUrl, reason: "preferred_fanza" };
    if (wpUrl) {
      return {
        mode: "WP_TRAFFIC",
        wpUrl,
        fanzaUrl: null,
        reason: "preferred_fanza_missing_use_wp",
      };
    }
  }
  if (input.preferredLinkMode === "COMBINED") {
    if (wpUrl && fanzaUrl) {
      return { mode: "COMBINED", wpUrl, fanzaUrl, reason: "preferred_combined" };
    }
    if (wpUrl) {
      return { mode: "WP_TRAFFIC", wpUrl, fanzaUrl: null, reason: "combined_missing_fanza" };
    }
    if (fanzaUrl) {
      return {
        mode: "DIRECT_AFFILIATE",
        wpUrl: null,
        fanzaUrl,
        reason: "combined_wp_not_public",
      };
    }
  }

  if (wpUrl && fanzaUrl) {
    return {
      mode: "COMBINED",
      wpUrl,
      fanzaUrl,
      reason: input.preferWpTraffic ? "both_available_prefer_combined" : "both_available_combined",
    };
  }
  if (wpUrl) return { mode: "WP_TRAFFIC", wpUrl, fanzaUrl: null, reason: "wp_only" };
  if (fanzaUrl) return { mode: "DIRECT_AFFILIATE", wpUrl: null, fanzaUrl, reason: "fanza_only" };
  return {
    mode: "DIRECT_AFFILIATE",
    wpUrl: null,
    fanzaUrl: input.affiliateUrl?.trim() || null,
    reason: "fallback_any_product_url",
  };
}

/** @deprecated Prefer selectXSocialFacts — kept for tests that call extractXSocialHooks. */
export function extractXSocialHooks(input: {
  canonicalTitle: string;
  productTitle?: string | null;
  performerNames?: string[];
  seriesName?: string | null;
  claimStatements?: Array<{ id?: string; statement: string }>;
  safeFacets?: string[];
  articlePlanFacts?: XSocialFact[];
}): string[] {
  const selected = selectXSocialFacts({
    canonicalTitle: input.canonicalTitle,
    productTitle: input.productTitle,
    articlePlanFacts: input.articlePlanFacts,
    claimStatements: input.claimStatements,
    performerNames: input.performerNames,
    seriesName: input.seriesName,
    taxonomyTags: input.safeFacets,
  });
  return selected.selected.map((f) => f.text);
}

export function chooseXThreadShape(hooks: string[]): XThreadShape {
  const n = hooks.filter((h) => h.trim().length > 0).length;
  if (n <= 1) return "SINGLE";
  if (n === 2) return "SHORT_THREAD";
  return "RICH_THREAD";
}

export function adaptCanonicalToXSocial(
  input: XSocialAdaptationInput,
): XSocialAdaptationResult {
  const warnings: string[] = [];
  const canonicalTitle = input.canonicalTitle.trim();
  const wpTitle = input.wordpressTitle?.trim() || null;
  const titleDivergence = Boolean(wpTitle && wpTitle !== canonicalTitle);
  if (titleDivergence) warnings.push("wp_title_diverges_from_canonical_using_canonical");
  if (!canonicalTitle) warnings.push("canonical_title_missing");

  const taxonomyTags = input.taxonomyTags ?? input.safeFacets ?? [];
  const selection = selectXSocialFacts({
    canonicalTitle: canonicalTitle || input.productTitle || input.cid,
    productTitle: input.productTitle,
    articlePlanFacts: input.articlePlanFacts,
    claimStatements: input.claimStatements,
    performerNames: input.performerNames,
    seriesName: input.seriesName,
    taxonomyTags,
  });

  if (selection.selected.length === 0) warnings.push("insufficient_evidence_hooks");
  if (
    selection.selected.every((f) => f.kind === "taxonomy_aux" || f.kind === "performer") &&
    !selection.selected.some((f) =>
      ["work_theme", "situation", "relationship", "feature"].includes(f.kind),
    )
  ) {
    warnings.push("work_specific_facts_thin");
  }

  const link = chooseXLinkMode({
    publishedBlogUrl: input.publishedBlogUrl,
    wpStatus: input.wpStatus,
    affiliateUrl: input.affiliateUrl,
    affiliateLinkReady: input.affiliateLinkReady,
    preferredLinkMode: input.preferredLinkMode,
    preferWpTraffic: input.preferWpTraffic,
  });
  if (!isWordPressPublicForXTraffic(input.wpStatus) && input.publishedBlogUrl) {
    warnings.push("wp_not_public_skip_wp_traffic");
  }
  if (!link.fanzaUrl && input.affiliateUrl && input.affiliateLinkReady !== true) {
    warnings.push("affiliate_not_ready");
  }

  const disclosure = input.disclosure ?? "#PR";
  const posts = composeXSocialPosts({
    facts: selection.selected,
    threadShape: selection.threadShape,
    linkMode: link.mode,
    wpUrl: link.wpUrl,
    fanzaUrl: link.fanzaUrl,
    disclosure,
    performers: input.performerNames,
  });

  for (const p of posts) {
    if (GENERIC_BANNED_RE.test(p.body)) warnings.push(`generic_copy_detected_seq_${p.sequence}`);
    if (detectXAdultExpressions(p.body).hit) warnings.push(`adult_expression_seq_${p.sequence}`);
  }

  const hooks = selection.selected.map((f) => f.text);

  return {
    threadShape: selection.threadShape,
    threadReason: selection.threadReason,
    linkMode: link.mode,
    posts,
    canonicalTitleUsed: canonicalTitle,
    wpTitleUsedAsSoleInput: false,
    titleDivergence,
    hooks,
    selectedFacts: selection.selected,
    discardedTaxonomy: selection.discardedTaxonomy,
    wpUrl: link.wpUrl,
    fanzaUrl: link.fanzaUrl,
    mediaMode: "TEXT_ONLY",
    warnings,
    tracking: {
      format: "x-social-adaptation-v2",
      cid: input.cid,
      linkMode: link.mode,
      threadShape: selection.threadShape,
      hookCount: hooks.length,
      factSources: [...new Set(selection.selected.map((f) => f.source))],
    },
  };
}

export function adaptationPostsToGeneratedBodies(posts: XAdaptedPost[]): {
  body: string;
  replies: string[];
} {
  const root = posts.find((p) => p.sequence === 1)?.body ?? "";
  const replies = posts.filter((p) => p.sequence > 1).map((p) => p.body);
  return { body: root, replies };
}
