/**
 * X post routing — DIRECT_AFFILIATE vs BLOG_TRAFFIC.
 * Existence of a blog post does not force BLOG_TRAFFIC.
 */

export type XPostRoute = "DIRECT_AFFILIATE" | "BLOG_TRAFFIC";

export interface XRouteDecision {
  route: XPostRoute;
  destinationUrl: string;
  reason: string;
}

export function chooseXPostRoute(input: {
  affiliateUrl: string;
  publishedBlogUrl?: string | null;
  preferredRoute?: XPostRoute | null;
  /** True when article kind is ranking / long-form better as blog traffic. */
  preferBlogTrafficHint?: boolean;
  /** Recent X routes for soft balance (not a hard rotation). */
  recentRoutes?: XPostRoute[];
}): XRouteDecision {
  const hasBlog = Boolean(input.publishedBlogUrl?.trim());
  if (input.preferredRoute === "DIRECT_AFFILIATE") {
    return {
      route: "DIRECT_AFFILIATE",
      destinationUrl: input.affiliateUrl,
      reason: "preferred_direct",
    };
  }
  if (input.preferredRoute === "BLOG_TRAFFIC") {
    if (!hasBlog) {
      return {
        route: "DIRECT_AFFILIATE",
        destinationUrl: input.affiliateUrl,
        reason: "preferred_blog_but_missing_url_fallback_direct",
      };
    }
    return {
      route: "BLOG_TRAFFIC",
      destinationUrl: input.publishedBlogUrl!.trim(),
      reason: "preferred_blog_traffic",
    };
  }

  const recent = input.recentRoutes ?? [];
  const directShare = recent.filter((r) => r === "DIRECT_AFFILIATE").length / Math.max(1, recent.length);
  const blogShare = recent.filter((r) => r === "BLOG_TRAFFIC").length / Math.max(1, recent.length);

  if (input.preferBlogTrafficHint && hasBlog) {
    return {
      route: "BLOG_TRAFFIC",
      destinationUrl: input.publishedBlogUrl!.trim(),
      reason: "longform_or_ranking_hint",
    };
  }

  // Soft balance when both possible
  if (hasBlog && blogShare + 0.15 < directShare) {
    return {
      route: "BLOG_TRAFFIC",
      destinationUrl: input.publishedBlogUrl!.trim(),
      reason: "balance_toward_blog_traffic",
    };
  }
  if (!hasBlog || directShare <= blogShare) {
    return {
      route: "DIRECT_AFFILIATE",
      destinationUrl: input.affiliateUrl,
      reason: hasBlog ? "balance_toward_direct_or_default" : "no_blog_url_use_direct",
    };
  }
  return {
    route: "DIRECT_AFFILIATE",
    destinationUrl: input.affiliateUrl,
    reason: "default_direct",
  };
}
