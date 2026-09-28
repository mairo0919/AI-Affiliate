/**
 * X post routing — DIRECT_AFFILIATE vs BLOG_TRAFFIC vs COMBINED.
 *
 * Auto ops default (X_ALLOW_DIRECT_AFFILIATE_ROUTE=false / X_ALLOW_COMBINED_ROUTE=false):
 *   WP_TRAFFIC (BLOG_TRAFFIC) only when a public blog URL exists.
 * DIRECT_AFFILIATE and COMBINED remain implemented for future resume via env flags
 * or explicit preferredRoute when those flags are enabled.
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
  /** Prefer COMBINED when both WP + affiliate are ready (requires allowCombined). */
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
  /**
   * When false (auto default), never select DIRECT_AFFILIATE.
   * Explicit preferredRoute=DIRECT_AFFILIATE is ignored unless true.
   */
  allowDirectAffiliate?: boolean;
  /**
   * When false (auto default), never select COMBINED.
   * Explicit preferredRoute=COMBINED falls back to BLOG_TRAFFIC when blog exists.
   */
  allowCombined?: boolean;
}): XRouteDecision {
  const allowDirect = input.allowDirectAffiliate === true;
  const allowCombined = input.allowCombined === true;
  const affiliateReady = input.affiliateLinkReady === true;
  const hasBlog = Boolean(input.publishedBlogUrl?.trim());
  const affiliateOrCanonical =
    (affiliateReady ? input.affiliateUrl.trim() : "") ||
    input.canonicalProductUrl?.trim() ||
    input.affiliateUrl.trim();

  const blogTraffic = (reason: string): XRouteDecision => ({
    route: "BLOG_TRAFFIC",
    destinationUrl: input.publishedBlogUrl!.trim(),
    secondaryUrl: null,
    reason,
    affiliateLinkReady: false,
  });

  const direct = (reason: string, ready = affiliateReady): XRouteDecision => ({
    route: "DIRECT_AFFILIATE",
    destinationUrl: affiliateOrCanonical,
    secondaryUrl: null,
    reason,
    affiliateLinkReady: ready,
  });

  if (input.preferredRoute === "COMBINED") {
    if (allowCombined && hasBlog && affiliateReady) {
      return {
        route: "COMBINED",
        destinationUrl: input.publishedBlogUrl!.trim(),
        secondaryUrl: input.affiliateUrl.trim(),
        reason: "preferred_combined",
        affiliateLinkReady: true,
      };
    }
    if (hasBlog) {
      return blogTraffic(
        allowCombined
          ? "preferred_combined_affiliate_pending_use_blog"
          : "preferred_combined_disabled_use_blog",
      );
    }
    if (allowDirect) {
      return direct("preferred_combined_missing_blog_use_direct");
    }
    return {
      route: "BLOG_TRAFFIC",
      destinationUrl: "",
      secondaryUrl: null,
      reason: "preferred_combined_missing_blog_direct_disabled",
      affiliateLinkReady: false,
    };
  }

  if (input.preferredRoute === "DIRECT_AFFILIATE") {
    if (!allowDirect) {
      if (hasBlog) {
        return blogTraffic("preferred_direct_disabled_use_blog");
      }
      return {
        route: "BLOG_TRAFFIC",
        destinationUrl: "",
        secondaryUrl: null,
        reason: "preferred_direct_disabled_no_blog",
        affiliateLinkReady: false,
      };
    }
    if (!affiliateReady) {
      if (hasBlog) {
        return blogTraffic("preferred_direct_but_affiliate_pending_use_blog");
      }
      return direct("preferred_direct_affiliate_pending_canonical_only", false);
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
      if (allowDirect) {
        return direct("preferred_blog_but_missing_url_fallback_product");
      }
      return {
        route: "BLOG_TRAFFIC",
        destinationUrl: "",
        secondaryUrl: null,
        reason: "preferred_blog_missing_url_direct_disabled",
        affiliateLinkReady: false,
      };
    }
    return blogTraffic("preferred_blog_traffic");
  }

  // Auto default: WP traffic when blog exists — do not prefer DIRECT/COMBINED.
  if (hasBlog) {
    if (allowCombined && affiliateReady && input.preferCombinedHint) {
      return {
        route: "COMBINED",
        destinationUrl: input.publishedBlogUrl!.trim(),
        secondaryUrl: input.affiliateUrl.trim(),
        reason: "combined_hint",
        affiliateLinkReady: true,
      };
    }
    return blogTraffic(
      !affiliateReady
        ? "affiliate_pending_prefer_blog_traffic"
        : input.preferBlogTrafficHint
          ? "longform_or_ranking_hint"
          : "auto_wp_traffic_default",
    );
  }

  // No public blog URL
  if (allowDirect) {
    const recent = input.recentRoutes ?? [];
    const directShare =
      recent.filter((r) => r === "DIRECT_AFFILIATE").length / Math.max(1, recent.length);
    const blogShare =
      recent.filter((r) => r === "BLOG_TRAFFIC" || r === "COMBINED").length /
      Math.max(1, recent.length);
    void directShare;
    void blogShare;
    return direct(
      !affiliateReady
        ? "affiliate_pending_canonical_or_default"
        : "no_blog_url_use_direct",
    );
  }

  return {
    route: "BLOG_TRAFFIC",
    destinationUrl: "",
    secondaryUrl: null,
    reason: "no_blog_url_direct_disabled_hold",
    affiliateLinkReady: false,
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
