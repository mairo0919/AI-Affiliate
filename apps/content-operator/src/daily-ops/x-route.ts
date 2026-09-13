/**
 * X post routing — DIRECT_AFFILIATE vs BLOG_TRAFFIC vs COMBINED.
 *
 * DIRECT_AFFILIATE only when affiliate approval/URL is ready.
 * Without affiliate readiness, prefer WordPress/blog URL; never invent affiliate links.
 * COMBINED = thread can carry WP + FANZA without making article generation skippable.
 *
 * publishedBlogUrl must already be publicly reachable (caller gates future/draft).
 */

export type XPostRoute = "DIRECT_AFFILIATE" | "BLOG_TRAFFIC" | "COMBINED";

export interface XRouteDecision {
  route: XPostRoute;
  /** Primary destination (WP for BLOG/COMBINED, FANZA for DIRECT). */
  destinationUrl: string;
  /** Secondary FANZA URL when route=COMBINED. */
  secondaryUrl?: string | null;
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
  /** Prefer COMBINED when both WP + affiliate are ready. */
  preferCombinedHint?: boolean;
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

  if (input.preferredRoute === "COMBINED") {
    if (hasBlog && affiliateReady) {
      return {
        route: "COMBINED",
        destinationUrl: input.publishedBlogUrl!.trim(),
        secondaryUrl: input.affiliateUrl.trim(),
        reason: "preferred_combined",
        affiliateLinkReady: true,
      };
    }
    if (hasBlog) {
      return {
        route: "BLOG_TRAFFIC",
        destinationUrl: input.publishedBlogUrl!.trim(),
        secondaryUrl: null,
        reason: "preferred_combined_affiliate_pending_use_blog",
        affiliateLinkReady: false,
      };
    }
    return {
      route: "DIRECT_AFFILIATE",
      destinationUrl: affiliateOrCanonical,
      secondaryUrl: null,
      reason: "preferred_combined_missing_blog_use_direct",
      affiliateLinkReady: affiliateReady,
    };
  }

  if (input.preferredRoute === "DIRECT_AFFILIATE") {
    if (!affiliateReady) {
      if (hasBlog) {
        return {
          route: "BLOG_TRAFFIC",
          destinationUrl: input.publishedBlogUrl!.trim(),
          secondaryUrl: null,
          reason: "preferred_direct_but_affiliate_pending_use_blog",
          affiliateLinkReady: false,
        };
      }
      return {
        route: "DIRECT_AFFILIATE",
        destinationUrl: affiliateOrCanonical,
        secondaryUrl: null,
        reason: "preferred_direct_affiliate_pending_canonical_only",
        affiliateLinkReady: false,
      };
    }
    return {
      route: "DIRECT_AFFILIATE",
      destinationUrl: input.affiliateUrl,
      secondaryUrl: null,
      reason: "preferred_direct",
      affiliateLinkReady: true,
    };
  }
  if (input.preferredRoute === "BLOG_TRAFFIC") {
    if (!hasBlog) {
      return {
        route: "DIRECT_AFFILIATE",
        destinationUrl: affiliateOrCanonical,
        secondaryUrl: null,
        reason: "preferred_blog_but_missing_url_fallback_product",
        affiliateLinkReady: affiliateReady,
      };
    }
    return {
      route: "BLOG_TRAFFIC",
      destinationUrl: input.publishedBlogUrl!.trim(),
      secondaryUrl: null,
      reason: "preferred_blog_traffic",
      affiliateLinkReady: false,
    };
  }

  const recent = input.recentRoutes ?? [];
  const directShare =
    recent.filter((r) => r === "DIRECT_AFFILIATE").length / Math.max(1, recent.length);
  const blogShare =
    recent.filter((r) => r === "BLOG_TRAFFIC" || r === "COMBINED").length /
    Math.max(1, recent.length);

  if (affiliateReady && hasBlog && input.preferCombinedHint) {
    return {
      route: "COMBINED",
      destinationUrl: input.publishedBlogUrl!.trim(),
      secondaryUrl: input.affiliateUrl.trim(),
      reason: "combined_hint",
      affiliateLinkReady: true,
    };
  }

  if ((!affiliateReady && hasBlog) || (input.preferBlogTrafficHint && hasBlog)) {
    return {
      route: "BLOG_TRAFFIC",
      destinationUrl: input.publishedBlogUrl!.trim(),
      secondaryUrl: null,
      reason: !affiliateReady
        ? "affiliate_pending_prefer_blog_traffic"
        : "longform_or_ranking_hint",
      affiliateLinkReady: false,
    };
  }

  // Soft balance when both possible (affiliate ready + blog)
  if (affiliateReady && hasBlog) {
    if (blogShare + 0.15 < directShare) {
      return {
        route: "COMBINED",
        destinationUrl: input.publishedBlogUrl!.trim(),
        secondaryUrl: input.affiliateUrl.trim(),
        reason: "balance_toward_blog_combined",
        affiliateLinkReady: true,
      };
    }
    if (directShare + 0.15 < blogShare) {
      return {
        route: "DIRECT_AFFILIATE",
        destinationUrl: input.affiliateUrl.trim(),
        secondaryUrl: null,
        reason: "balance_toward_direct",
        affiliateLinkReady: true,
      };
    }
    return {
      route: "COMBINED",
      destinationUrl: input.publishedBlogUrl!.trim(),
      secondaryUrl: input.affiliateUrl.trim(),
      reason: "both_ready_combined_default",
      affiliateLinkReady: true,
    };
  }
  if (!hasBlog || !affiliateReady) {
    return {
      route: "DIRECT_AFFILIATE",
      destinationUrl: affiliateOrCanonical,
      secondaryUrl: null,
      reason: !affiliateReady
        ? "affiliate_pending_canonical_or_default"
        : "no_blog_url_use_direct",
      affiliateLinkReady: affiliateReady,
    };
  }
  return {
    route: "DIRECT_AFFILIATE",
    destinationUrl: affiliateOrCanonical,
    secondaryUrl: null,
    reason: "default_direct",
    affiliateLinkReady: affiliateReady,
  };
}

/** Map legacy daily-ops route names onto social adaptation link modes. */
export function xPostRouteToLinkMode(
  route: XPostRoute,
): "WP_TRAFFIC" | "DIRECT_AFFILIATE" | "COMBINED" {
  if (route === "BLOG_TRAFFIC") return "WP_TRAFFIC";
  if (route === "COMBINED") return "COMBINED";
  return "DIRECT_AFFILIATE";
}
