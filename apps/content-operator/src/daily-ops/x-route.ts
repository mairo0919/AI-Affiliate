/**
 * X post routing — DIRECT_AFFILIATE vs BLOG_TRAFFIC.
 *
 * DIRECT_AFFILIATE only when affiliate approval/URL is ready.
 * Without affiliate readiness, prefer WordPress/blog URL; never invent affiliate links.
 */

export type XPostRoute = "DIRECT_AFFILIATE" | "BLOG_TRAFFIC";

export interface XRouteDecision {
  route: XPostRoute;
  destinationUrl: string;
  reason: string;
  /** False when destination is canonical product / blog only (not monetized affiliate). */
  affiliateLinkReady: boolean;
}

export function chooseXPostRoute(input: {
  affiliateUrl: string;
  publishedBlogUrl?: string | null;
  preferredRoute?: XPostRoute | null;
  /** True when article kind is ranking / long-form better as blog traffic. */
  preferBlogTrafficHint?: boolean;
  /** Recent X routes for soft balance (not a hard rotation). */
  recentRoutes?: XPostRoute[];
  /**
   * True only when `affiliateUrl` is an approved provider affiliate link.
   * Default false — safe when FANZA/ASP approval is pending.
   */
  affiliateLinkReady?: boolean;
  /** Official product page when affiliate pending and no blog URL. */
  canonicalProductUrl?: string | null;
}): XRouteDecision {
  const affiliateReady = input.affiliateLinkReady === true;
  const hasBlog = Boolean(input.publishedBlogUrl?.trim());
  const affiliateOrCanonical =
    (affiliateReady ? input.affiliateUrl.trim() : "") ||
    input.canonicalProductUrl?.trim() ||
    input.affiliateUrl.trim();

  if (input.preferredRoute === "DIRECT_AFFILIATE") {
    if (!affiliateReady) {
      if (hasBlog) {
        return {
          route: "BLOG_TRAFFIC",
          destinationUrl: input.publishedBlogUrl!.trim(),
          reason: "preferred_direct_but_affiliate_pending_use_blog",
          affiliateLinkReady: false,
        };
      }
      return {
        route: "DIRECT_AFFILIATE",
        destinationUrl: affiliateOrCanonical,
        reason: "preferred_direct_affiliate_pending_canonical_only",
        affiliateLinkReady: false,
      };
    }
    return {
      route: "DIRECT_AFFILIATE",
      destinationUrl: input.affiliateUrl,
      reason: "preferred_direct",
      affiliateLinkReady: true,
    };
  }
  if (input.preferredRoute === "BLOG_TRAFFIC") {
    if (!hasBlog) {
      return {
        route: "DIRECT_AFFILIATE",
        destinationUrl: affiliateOrCanonical,
        reason: "preferred_blog_but_missing_url_fallback_product",
        affiliateLinkReady: affiliateReady,
      };
    }
    return {
      route: "BLOG_TRAFFIC",
      destinationUrl: input.publishedBlogUrl!.trim(),
      reason: "preferred_blog_traffic",
      affiliateLinkReady: false,
    };
  }

  const recent = input.recentRoutes ?? [];
  const directShare =
    recent.filter((r) => r === "DIRECT_AFFILIATE").length / Math.max(1, recent.length);
  const blogShare =
    recent.filter((r) => r === "BLOG_TRAFFIC").length / Math.max(1, recent.length);

  if ((!affiliateReady && hasBlog) || (input.preferBlogTrafficHint && hasBlog)) {
    return {
      route: "BLOG_TRAFFIC",
      destinationUrl: input.publishedBlogUrl!.trim(),
      reason: !affiliateReady
        ? "affiliate_pending_prefer_blog_traffic"
        : "longform_or_ranking_hint",
      affiliateLinkReady: false,
    };
  }

  // Soft balance when both possible (affiliate ready + blog)
  if (affiliateReady && hasBlog && blogShare + 0.15 < directShare) {
    return {
      route: "BLOG_TRAFFIC",
      destinationUrl: input.publishedBlogUrl!.trim(),
      reason: "balance_toward_blog_traffic",
      affiliateLinkReady: false,
    };
  }
  if (!hasBlog || !affiliateReady || directShare <= blogShare) {
    return {
      route: "DIRECT_AFFILIATE",
      destinationUrl: affiliateOrCanonical,
      reason: !affiliateReady
        ? "affiliate_pending_canonical_or_default"
        : hasBlog
          ? "balance_toward_direct_or_default"
          : "no_blog_url_use_direct",
      affiliateLinkReady: affiliateReady,
    };
  }
  return {
    route: "DIRECT_AFFILIATE",
    destinationUrl: affiliateOrCanonical,
    reason: "default_direct",
    affiliateLinkReady: affiliateReady,
  };
}
