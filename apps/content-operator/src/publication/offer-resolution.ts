/**
 * Publication offer resolution — Article generation ≠ Affiliate approval.
 *
 * ContentVersion may be generated with only a canonical product URL (interim CTA).
 * Real affiliate URLs come from provider/API SSOT when approved — never synthesized,
 * never silently swapped inside historical ContentVersion bodies.
 */

import { validateFanzaAffiliateUrl } from "../daily-blog/affiliate-url.js";
import { FANZA_PROVIDER_KEY } from "./provider-registry-meta.js";
import { buildFanzaCanonicalProductUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";

export type PublicationOfferKind = "AFFILIATE" | "CANONICAL_PRODUCT" | "NONE";

export type MonetizationLinkStatus = "MONETIZED" | "PENDING_AFFILIATE" | "UNMONETIZED";

export type PublicationOfferResolution = {
  url: string | null;
  kind: PublicationOfferKind;
  monetizationStatus: MonetizationLinkStatus;
  /** True only when URL is a verified affiliate link (partner params / affiliate host). */
  affiliateLinkReady: boolean;
  providerKey: string;
  productId: string | null;
  failureCode: string | null;
};

/**
 * Resolve the URL to inject at publication time (WordPress CTA / X destination).
 * Does not mutate ContentVersion history.
 */
export function resolvePublicationOffer(input: {
  providerKey?: string | null;
  productId?: string | null;
  /** API-provided affiliate URL only — never invent. */
  affiliateUrl?: string | null;
  /** Official product page when affiliate pending. */
  canonicalProductUrl?: string | null;
}): PublicationOfferResolution {
  const providerKey = (input.providerKey ?? FANZA_PROVIDER_KEY).trim() || FANZA_PROVIDER_KEY;
  const productId = input.productId?.trim() || null;

  const affiliateCheck = validateProviderOfferUrl(providerKey, input.affiliateUrl);
  if (affiliateCheck.ok && affiliateCheck.url && affiliateCheck.hasAffiliateIdHint) {
    return {
      url: affiliateCheck.url,
      kind: "AFFILIATE",
      monetizationStatus: "MONETIZED",
      affiliateLinkReady: true,
      providerKey,
      productId,
      failureCode: null,
    };
  }

  const canonical =
    input.canonicalProductUrl?.trim() ||
    (providerKey === FANZA_PROVIDER_KEY && productId
      ? buildFanzaCanonicalProductUrl(productId)
      : null);
  const canonicalCheck = validateProviderOfferUrl(providerKey, canonical);
  if (canonicalCheck.ok && canonicalCheck.url) {
    return {
      url: canonicalCheck.url,
      kind: "CANONICAL_PRODUCT",
      monetizationStatus: "PENDING_AFFILIATE",
      affiliateLinkReady: false,
      providerKey,
      productId,
      failureCode: null,
    };
  }

  // Affiliate URL present but without partner hint → still treat as interim product link if host ok
  if (affiliateCheck.ok && affiliateCheck.url) {
    return {
      url: affiliateCheck.url,
      kind: "CANONICAL_PRODUCT",
      monetizationStatus: "PENDING_AFFILIATE",
      affiliateLinkReady: false,
      providerKey,
      productId,
      failureCode: null,
    };
  }

  return {
    url: null,
    kind: "NONE",
    monetizationStatus: "UNMONETIZED",
    affiliateLinkReady: false,
    providerKey,
    productId,
    failureCode: affiliateCheck.failureCode ?? canonicalCheck.failureCode ?? "OFFER_URL_MISSING",
  };
}

function validateProviderOfferUrl(
  providerKey: string,
  url: string | null | undefined,
): ReturnType<typeof validateFanzaAffiliateUrl> {
  // Today only FANZA host policy is implemented; future ASPs add their validators here.
  if (providerKey === FANZA_PROVIDER_KEY || providerKey === "dmm" || providerKey === "dmm-fanza") {
    return validateFanzaAffiliateUrl(url);
  }
  if (!url?.trim()) {
    return { ok: false, url: null, failureCode: "AFFILIATE_URL_MISSING", hasAffiliateIdHint: false };
  }
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:") {
      return {
        ok: false,
        url: url.trim(),
        failureCode: "AFFILIATE_URL_NOT_HTTPS",
        hasAffiliateIdHint: false,
      };
    }
    return { ok: true, url: url.trim(), failureCode: null, hasAffiliateIdHint: false };
  } catch {
    return { ok: false, url: url.trim(), failureCode: "AFFILIATE_URL_INVALID", hasAffiliateIdHint: false };
  }
}
