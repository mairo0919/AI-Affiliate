/**
 * Canonical ContentVersion / Evidence → X social adaptation.
 *
 * Production copy route (single):
 * Claims / title / identity (+ grounded ARTICLE_PLAN atoms)
 * → Social Planner → Social Writer → Social Review → compose posts.
 *
 * Never scrapes WordPress body. Never shortens WP article into X copy.
 */

import { detectXAdultExpressions } from "./x-social-content-policy.js";
import { isWordPressPublicForXTraffic } from "./x-eligibility.js";
import type { ArticleImage } from "../generation/article-images.js";
import type { LLMProvider } from "../adapters/types.js";
import {
  groundedPlanFactTexts,
  type XSocialFact,
  type XThreadShape,
} from "./x-social-facts.js";
import {
  composeXThreadPublication,
  resolveXPublicationStrategy,
  type XPublicationIntent,
  type XRelatedNavCandidate,
} from "./x-thread-publication.js";
import { selectXMediaFromArticleImages } from "./x-article-media.js";
import { resolveWordPressCanonicalUrl } from "./x-wordpress-url.js";
import { runXSocialPipeline, type SocialPipelineSkip } from "./social-pipeline.js";
import type { XSocialPlan } from "./social-plan.js";
import {
  reviewXSocialPublicationUnit,
  type SocialReviewFinding,
  type SocialReviewResult,
} from "./social-review.js";

export type XLinkMode = "WP_TRAFFIC" | "DIRECT_AFFILIATE" | "COMBINED";

export type { XThreadShape };

export type SocialThinSkip = {
  reason: "SOCIAL_CONTENT_TOO_THIN" | "SOCIAL_REVIEW_FAILED" | "WP_NOT_PUBLIC";
  detail: string;
  /** Existing pipeline classification — no new classifier layer. */
  failureClass?: "SOURCE_INSUFFICIENT" | "GENERATION_FAILURE" | "QUALITY_FAILURE";
};

export type XAdaptedPost = {
  sequence: number;
  role: "ROOT" | "REPLY" | "CTA";
  body: string;
  linkKind: "none" | "wp" | "fanza" | "related_x";
  /** Semantic thread role when thread replies are used. */
  threadRole?: "PARENT" | "AFFILIATE_REPLY" | "WP_REPLY" | "RELATED_REPLY";
  replyToSequence?: number;
  relatedPublicationId?: string;
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
  officialDescription?: string | null;
  articleImages?: ArticleImage[] | unknown | null;
  publishedBlogUrl?: string | null;
  wordpressPermalink?: string | null;
  wordpressSlug?: string | null;
  siteBaseUrl?: string | null;
  wpStatus?: string | null;
  affiliateUrl?: string | null;
  affiliateLinkReady?: boolean;
  preferredLinkMode?: XLinkMode | null;
  disclosure?: string | null;
  preferWpTraffic?: boolean;
  allowDirectAffiliate?: boolean;
  allowCombined?: boolean;
  /**
   * When true, compose AFFILIATE_THREAD (parent → FANZA reply → WP reply).
   * Default / omitted = false → CURRENT WP_TRAFFIC_EMBED (parent + optional replies).
   */
  affiliateThreadMode?: boolean;
  /** When set, X posts use this FANZA direct URL and never a WordPress URL. */
  fanzaDirectUrl?: string | null;
  /** Optional related published X post for navigation reply. */
  relatedXPost?: XRelatedNavCandidate | null;
  /** Override Planner publication intent (tests / publication recompose). */
  publicationIntentOverride?: XPublicationIntent | null;
  /** Production Writer uses LLM (GENERATION_X_SOCIAL). Tests may omit (synthesize). */
  llm?: LLMProvider | null;
  llmModel?: string;
};

export type XSocialAdaptationResult = {
  threadShape: XThreadShape;
  threadReason: string;
  linkMode: XLinkMode;
  /** CURRENT WP_TRAFFIC_EMBED vs future AFFILIATE_THREAD */
  publicationStrategy: "WP_TRAFFIC_EMBED" | "AFFILIATE_THREAD" | "FANZA_DIRECT";
  publicationStrategyReason: string;
  posts: XAdaptedPost[];
  /** Writer parent body only (no URLs) — Publication may recompose replies. */
  parentBody: string | null;
  publicationIntent: XPublicationIntent | null;
  canonicalTitleUsed: string;
  wpTitleUsedAsSoleInput: false;
  titleDivergence: boolean;
  hooks: string[];
  selectedFacts: XSocialFact[];
  discardedTaxonomy: string[];
  realizedLines: string[];
  productNameCopyRate: number;
  skip: SocialThinSkip | null;
  socialPlan: XSocialPlan | null;
  reviewFindings: SocialReviewFinding[];
  review: SocialReviewResult | null;
  writerMode: "llm" | "editorial_synthesize" | null;
  wpUrl: string | null;
  fanzaUrl: string | null;
  relatedXPost: XRelatedNavCandidate | null;
  mediaMode: "SAFE_IMAGE" | "TEXT_ONLY";
  mediaUrl: string | null;
  mediaReason: string;
  mediaRole: "hero" | "auxiliary" | null;
  warnings: string[];
  tracking: {
    format: "x-social-adaptation-v7";
    cid: string;
    linkMode: XLinkMode;
    threadShape: XThreadShape;
    publicationStrategy: "WP_TRAFFIC_EMBED" | "AFFILIATE_THREAD" | "FANZA_DIRECT";
    replyOrder: string | null;
    hookCount: number;
    factSources: string[];
    skipped: boolean;
    mediaMode: "SAFE_IMAGE" | "TEXT_ONLY";
    writerMode: "llm" | "editorial_synthesize" | null;
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
  /** When false, never fall back to DIRECT_AFFILIATE (auto default). */
  allowDirectAffiliate?: boolean;
  /** When false, never select COMBINED (auto default). */
  allowCombined?: boolean;
}): {
  mode: XLinkMode;
  wpUrl: string | null;
  fanzaUrl: string | null;
  reason: string;
} {
  const allowDirect = input.allowDirectAffiliate === true;
  const allowCombined = input.allowCombined === true;
  const preferWp = input.preferWpTraffic === true || !allowDirect;
  const wpPublic = isWordPressPublicForXTraffic(input.wpStatus);
  const wpUrl =
    wpPublic && input.publishedBlogUrl?.trim() ? input.publishedBlogUrl.trim() : null;
  const fanzaReady = input.affiliateLinkReady === true && Boolean(input.affiliateUrl?.trim());
  const fanzaUrl = fanzaReady ? input.affiliateUrl!.trim() : null;

  if (input.preferredLinkMode === "WP_TRAFFIC" || (preferWp && !input.preferredLinkMode)) {
    if (wpUrl) {
      return {
        mode: "WP_TRAFFIC",
        wpUrl,
        fanzaUrl: allowDirect ? fanzaUrl : null,
        reason: input.preferredLinkMode === "WP_TRAFFIC" ? "preferred_wp" : "auto_wp_traffic",
      };
    }
    if (input.preferredLinkMode === "WP_TRAFFIC" || preferWp) {
      return {
        mode: "WP_TRAFFIC",
        wpUrl: null,
        fanzaUrl: null,
        reason: "wp_required_not_public",
      };
    }
  }

  if (input.preferredLinkMode === "DIRECT_AFFILIATE") {
    if (!allowDirect) {
      if (wpUrl) {
        return { mode: "WP_TRAFFIC", wpUrl, fanzaUrl: null, reason: "direct_disabled_use_wp" };
      }
      return {
        mode: "WP_TRAFFIC",
        wpUrl: null,
        fanzaUrl: null,
        reason: "direct_disabled_wp_missing",
      };
    }
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
    if (allowCombined && wpUrl && fanzaUrl) {
      return { mode: "COMBINED", wpUrl, fanzaUrl, reason: "preferred_combined" };
    }
    if (wpUrl) {
      return {
        mode: "WP_TRAFFIC",
        wpUrl,
        fanzaUrl: null,
        reason: allowCombined ? "combined_missing_fanza" : "combined_disabled_use_wp",
      };
    }
    if (allowDirect && fanzaUrl) {
      return {
        mode: "DIRECT_AFFILIATE",
        wpUrl: null,
        fanzaUrl,
        reason: "combined_wp_not_public",
      };
    }
    return {
      mode: "WP_TRAFFIC",
      wpUrl: null,
      fanzaUrl: null,
      reason: "combined_unavailable_hold",
    };
  }

  if (wpUrl && fanzaUrl && allowCombined) {
    return {
      mode: "COMBINED",
      wpUrl,
      fanzaUrl,
      reason: "both_available_combined",
    };
  }
  if (wpUrl) return { mode: "WP_TRAFFIC", wpUrl, fanzaUrl: null, reason: "wp_only" };
  if (allowDirect && fanzaUrl) {
    return { mode: "DIRECT_AFFILIATE", wpUrl: null, fanzaUrl, reason: "fanza_only" };
  }
  if (allowDirect) {
    return {
      mode: "DIRECT_AFFILIATE",
      wpUrl: null,
      fanzaUrl: input.affiliateUrl?.trim() || null,
      reason: "fallback_any_product_url",
    };
  }
  return {
    mode: "WP_TRAFFIC",
    wpUrl: null,
    fanzaUrl: null,
    reason: "no_public_wp_direct_disabled",
  };
}

/** @deprecated Prefer Social Planner — retained for narrow callers. */
export async function extractXSocialHooks(input: {
  canonicalTitle: string;
  productTitle?: string | null;
  performerNames?: string[];
  seriesName?: string | null;
  claimStatements?: Array<{ id?: string; statement: string }>;
  safeFacets?: string[];
  articlePlanFacts?: XSocialFact[];
  llm?: LLMProvider | null;
}): Promise<string[]> {
  const pipeline = await runXSocialPipeline({
    canonicalTitle: input.canonicalTitle,
    productTitle: input.productTitle,
    performerNames: input.performerNames,
    seriesName: input.seriesName,
    claimStatements: input.claimStatements,
    groundedPlanFacts: groundedPlanFactTexts(input.articlePlanFacts),
    llm: input.llm,
  });
  if (!pipeline.ok) return [];
  return pipeline.plan.allowedClaims;
}

export function chooseXThreadShape(hooks: string[]): XThreadShape {
  const n = hooks.filter((h) => h.trim().length > 0).length;
  if (n <= 1) return "SINGLE";
  if (n === 2) return "SHORT_THREAD";
  return "RICH_THREAD";
}

function emptyResult(base: {
  warnings: string[];
  canonicalTitle: string;
  titleDivergence: boolean;
  link: ReturnType<typeof chooseXLinkMode>;
  mediaPick: ReturnType<typeof selectXMediaFromArticleImages>;
  cid: string;
  skip: SocialThinSkip;
  socialPlan: XSocialPlan | null;
  reviewFindings: SocialReviewFinding[];
  review: SocialReviewResult | null;
  discardedTaxonomy: string[];
}): XSocialAdaptationResult {
  return {
    threadShape: "SINGLE",
    threadReason: base.skip.reason,
    linkMode: base.link.mode,
    publicationStrategy: "WP_TRAFFIC_EMBED",
    publicationStrategyReason: "skipped",
    posts: [],
    parentBody: null,
    publicationIntent: null,
    canonicalTitleUsed: base.canonicalTitle,
    wpTitleUsedAsSoleInput: false,
    titleDivergence: base.titleDivergence,
    hooks: [],
    selectedFacts: [],
    discardedTaxonomy: base.discardedTaxonomy,
    realizedLines: [],
    productNameCopyRate: 0,
    skip: base.skip,
    socialPlan: base.socialPlan,
    reviewFindings: base.reviewFindings,
    review: base.review,
    writerMode: null,
    wpUrl: base.link.wpUrl,
    fanzaUrl: base.link.fanzaUrl,
    relatedXPost: null,
    mediaMode: base.mediaPick.decision,
    mediaUrl: base.mediaPick.selectedUrl,
    mediaReason: base.mediaPick.reason,
    mediaRole: base.mediaPick.selectedRole,
    warnings: base.warnings,
    tracking: {
      format: "x-social-adaptation-v7",
      cid: base.cid,
      linkMode: base.link.mode,
      threadShape: "SINGLE",
      publicationStrategy: "WP_TRAFFIC_EMBED",
      replyOrder: null,
      hookCount: 0,
      factSources: [],
      skipped: true,
      mediaMode: base.mediaPick.decision,
      writerMode: null,
    },
  };
}

/**
 * Production X adaptation. Prefer passing `llm` in live ops (GENERATION_X_SOCIAL).
 */
export async function adaptCanonicalToXSocial(
  input: XSocialAdaptationInput,
): Promise<XSocialAdaptationResult> {
  const warnings: string[] = [];
  const canonicalTitle = input.canonicalTitle.trim();
  const wpTitle = input.wordpressTitle?.trim() || null;
  const titleDivergence = Boolean(wpTitle && wpTitle !== canonicalTitle);
  if (titleDivergence) warnings.push("wp_title_diverges_from_canonical_using_canonical");
  if (!canonicalTitle) warnings.push("canonical_title_missing");

  const taxonomyTags = input.taxonomyTags ?? input.safeFacets ?? [];
  const discardedTaxonomy = taxonomyTags.filter((t) => t.trim().length > 0);

  const disclosure = (input.disclosure ?? "").trim();
  const mediaPick = selectXMediaFromArticleImages({
    articleImages: input.articleImages,
  });
  if (mediaPick.decision === "TEXT_ONLY") {
    warnings.push(`x_media_text_only:${mediaPick.reason}`);
  }

  const resolvedWpUrl = resolveWordPressCanonicalUrl({
    publicLink: input.wordpressPermalink ?? input.publishedBlogUrl,
    slug: input.wordpressSlug,
    siteBaseUrl: input.siteBaseUrl,
    fallbackUrl: input.publishedBlogUrl,
  });
  if (
    input.publishedBlogUrl &&
    resolvedWpUrl &&
    resolvedWpUrl !== input.publishedBlogUrl.trim()
  ) {
    warnings.push("wp_url_prefer_canonical_permalink");
  }

  const link = chooseXLinkMode({
    publishedBlogUrl: resolvedWpUrl,
    wpStatus: input.wpStatus,
    affiliateUrl: input.affiliateUrl,
    affiliateLinkReady: input.affiliateLinkReady,
    preferredLinkMode: input.preferredLinkMode,
    preferWpTraffic: input.preferWpTraffic,
    allowDirectAffiliate: input.allowDirectAffiliate,
    allowCombined: input.allowCombined,
  });
  if (!isWordPressPublicForXTraffic(input.wpStatus) && (resolvedWpUrl || input.publishedBlogUrl)) {
    warnings.push("wp_not_public_skip_wp_traffic");
  }
  if (!link.fanzaUrl && input.affiliateUrl && input.affiliateLinkReady !== true) {
    warnings.push("affiliate_not_ready");
  }

  if (!input.fanzaDirectUrl?.trim() && link.mode === "WP_TRAFFIC" && !link.wpUrl) {
    warnings.push("wp_not_public_hold_x");
    return emptyResult({
      warnings,
      canonicalTitle,
      titleDivergence,
      link,
      mediaPick,
      cid: input.cid,
      skip: {
        reason: "WP_NOT_PUBLIC",
        detail: link.reason || "wordpress_article_not_published",
      },
      socialPlan: null,
      reviewFindings: [],
      review: null,
      discardedTaxonomy,
    });
  }

  const pipeline = await runXSocialPipeline({
    canonicalTitle: canonicalTitle || input.productTitle || input.cid,
    productTitle: input.productTitle,
    performerNames: input.performerNames,
    seriesName: input.seriesName,
    claimStatements: input.claimStatements,
    groundedPlanFacts: groundedPlanFactTexts(input.articlePlanFacts),
    officialDescription: input.officialDescription,
    llm: input.llm,
    model: input.llmModel,
  });

  if (!pipeline.ok) {
    const skip = pipeline.skip as SocialPipelineSkip;
    warnings.push(skip.reason);
    warnings.push(`thin_detail:${skip.detail}`);
    return emptyResult({
      warnings,
      canonicalTitle,
      titleDivergence,
      link,
      mediaPick,
      cid: input.cid,
      skip: {
        reason:
          skip.reason === "SOCIAL_REVIEW_FAILED"
            ? "SOCIAL_REVIEW_FAILED"
            : "SOCIAL_CONTENT_TOO_THIN",
        detail: skip.detail,
        failureClass:
          "failureClass" in skip ? skip.failureClass : "SOURCE_INSUFFICIENT",
      },
      socialPlan: pipeline.plan,
      reviewFindings: pipeline.reviewFindings,
      review: pipeline.review,
      discardedTaxonomy,
    });
  }

  const plan = pipeline.plan;
  const body = pipeline.finalBody;
  const pubStrategy = resolveXPublicationStrategy({
    affiliateThreadMode: input.affiliateThreadMode === true,
    wpUrl: link.wpUrl,
    // Use CID-bound affiliate URL from input (not link.fanzaUrl which WP_TRAFFIC clears).
    fanzaUrl: input.affiliateUrl,
    affiliateLinkReady:
      input.affiliateLinkReady === true && Boolean(input.affiliateUrl?.trim()),
  });

  const publicationIntent: XPublicationIntent =
    input.publicationIntentOverride ??
    plan.publicationIntent ?? {
      needsArticleReply: Boolean(pubStrategy.wpUrl),
      relatedPostUseful: Boolean(input.relatedXPost),
      preferredReplyOrder: null,
    };

  const relatedXPost = input.relatedXPost ?? null;

  // Writer body only — link placement is publication strategy (not Writer).
  const parentBody = body
    .split(/。/u)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/[！？]$/u.test(s) ? s : `${s}。`))
    .join("") || body;

  const realizedLines = parentBody
    .split(/。/u)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/[！？]$/u.test(s) ? s : `${s}。`));

  const selectedFacts: XSocialFact[] = plan.allowedClaims.map((text, i) => ({
    text,
    kind: i === 0 ? "situation" : "feature",
    source: "claim",
    score: 10 + i,
  }));

  const fanzaDirectUrl = input.fanzaDirectUrl?.trim() || null;
  const composed = composeXThreadPublication({
    strategy: fanzaDirectUrl ? "FANZA_DIRECT" : pubStrategy.strategy,
    parentBody,
    wpUrl: fanzaDirectUrl ? null : pubStrategy.wpUrl,
    fanzaUrl: fanzaDirectUrl ?? pubStrategy.fanzaUrl,
    disclosure,
    intent: publicationIntent,
    related: relatedXPost,
    navSeed: input.cid,
  });
  const posts: XAdaptedPost[] = composed.map((p) => ({
    sequence: p.sequence,
    role: p.role,
    body: p.body,
    linkKind: p.linkKind,
    threadRole: p.threadRole,
    replyToSequence: p.replyToSequence,
    relatedPublicationId: p.relatedPublicationId,
  }));

  const unitReview = reviewXSocialPublicationUnit({
    plan,
    parentBody,
    posts,
    relatedReasons: relatedXPost?.reasons,
  });
  if (!unitReview.ok) {
    const blockingCodes = unitReview.findings
      .filter((f) => f.severity === "BLOCKING")
      .map((f) => f.code);
    // Parent-only rewrite path already ran; structural unit failures → skip.
    warnings.push("SOCIAL_PUBLICATION_UNIT_FAILED");
    warnings.push(`unit_detail:${blockingCodes.join(",") || "unit_failed"}`);
    return emptyResult({
      warnings,
      canonicalTitle,
      titleDivergence,
      link,
      mediaPick,
      cid: input.cid,
      skip: {
        reason: "SOCIAL_REVIEW_FAILED",
        detail: blockingCodes.join(",") || "publication_unit_failed",
        failureClass: "QUALITY_FAILURE",
      },
      socialPlan: plan,
      reviewFindings: unitReview.findings,
      review: unitReview,
      discardedTaxonomy,
    });
  }

  const threadShape: XThreadShape =
    posts.length >= 3 ? "RICH_THREAD" : posts.length === 2 ? "SHORT_THREAD" : "SINGLE";
  const replyOrder =
    posts.length <= 1
      ? "parent_only"
      : posts
          .filter((p) => p.sequence > 1)
          .map((p) => p.threadRole)
          .join("→");
  const threadReason = pipeline.rewritten
    ? "x_pipeline_rewritten_once"
    : pipeline.writerMode === "llm"
      ? "x_pipeline_llm"
      : "x_pipeline_editorial_synthesize";

  // Safety: CURRENT mode must not leak FANZA affiliate into WP_TRAFFIC.
  for (const p of posts) {
    if (GENERIC_BANNED_RE.test(p.body)) warnings.push(`generic_copy_detected_seq_${p.sequence}`);
    if (detectXAdultExpressions(p.body).hit) warnings.push(`adult_expression_seq_${p.sequence}`);
    if (
      pubStrategy.strategy === "WP_TRAFFIC_EMBED" &&
      /al\.fanza\.co\.jp|af_id=/i.test(p.body)
    ) {
      warnings.push(`affiliate_url_leak_wp_traffic_seq_${p.sequence}`);
    }
  }

  const hooks = plan.allowedClaims;

  return {
    threadShape,
    threadReason,
    linkMode: fanzaDirectUrl ? "DIRECT_AFFILIATE" : link.mode,
    publicationStrategy: fanzaDirectUrl ? "FANZA_DIRECT" : pubStrategy.strategy,
    publicationStrategyReason: fanzaDirectUrl ? "fanza_direct" : pubStrategy.reason,
    posts,
    parentBody,
    publicationIntent,
    canonicalTitleUsed: canonicalTitle,
    wpTitleUsedAsSoleInput: false,
    titleDivergence,
    hooks,
    selectedFacts,
    discardedTaxonomy,
    realizedLines,
    productNameCopyRate: 0,
    skip: null,
    socialPlan: plan,
    reviewFindings: unitReview.findings,
    review: unitReview,
    writerMode: pipeline.writerMode,
    wpUrl: fanzaDirectUrl ? null : (pubStrategy.wpUrl ?? link.wpUrl),
    fanzaUrl: fanzaDirectUrl
      ? fanzaDirectUrl
      : pubStrategy.strategy === "AFFILIATE_THREAD"
        ? pubStrategy.fanzaUrl
        : null,
    relatedXPost,
    mediaMode: mediaPick.decision,
    mediaUrl: mediaPick.selectedUrl,
    mediaReason: mediaPick.reason,
    mediaRole: mediaPick.selectedRole,
    warnings,
    tracking: {
      format: "x-social-adaptation-v7",
      cid: input.cid,
      linkMode: link.mode,
      threadShape,
      publicationStrategy: pubStrategy.strategy,
      replyOrder,
      hookCount: hooks.length,
      factSources: ["x_social_plan"],
      skipped: false,
      mediaMode: mediaPick.decision,
      writerMode: pipeline.writerMode,
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
