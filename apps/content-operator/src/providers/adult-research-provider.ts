/**
 * Adult Research Provider — multi-ASP acquisition boundary.
 * Provider-specific HTML/API stays inside adapters; Analysis+ uses ResearchItem only.
 */

import type { CollectionResult } from "@ai-affiliate/shared";
import type {
  AffiliateProviderRuntimeStatus,
  AffiliateProductNormalized,
} from "../adapters/types.js";

/** Normalized product shared across FANZA / FC2 / MGS / APEX / future ASPs. */
export type AdultNormalizedProduct = {
  providerKey: string;
  externalId: string;
  canonicalUrl: string | null;
  title: string;
  description: string | null;
  performers: string[];
  maker: string | null;
  label: string | null;
  series: string | null;
  categories: string[];
  tags: string[];
  releaseDate: string | null;
  duration: number | null;
  price: { amount: number | null; currency: string | null } | null;
  images: AdultMediaAsset[];
  samples: AdultMediaAsset[];
  affiliateOffers: AdultAffiliateOffer[];
  evidence: Record<string, unknown>;
  fetchedAt: string;
  /** Provider-specific raw — do not consume in Writer/Brain. */
  rawEvidence?: Record<string, unknown> | null;
};

export type AdultAffiliateOffer = {
  providerKey: string;
  externalId: string;
  destinationUrl: string | null;
  trackingUrl: string | null;
  commissionType: "cpa" | "cps" | "fixed" | "unknown" | null;
  commissionValue: number | null;
  currency: string | null;
  approvalState: "approved" | "pending" | "rejected" | "unknown";
  enabled: boolean;
  validFrom: string | null;
  validTo: string | null;
};

export type AdultMediaAsset = {
  source: string;
  providerKey: string;
  type: "package" | "sample" | "thumbnail" | "embed" | "other";
  url: string | null;
  externalEmbedCode: string | null;
  externalEmbedAllowed: boolean;
  affiliateEmbed: boolean;
  usageRights: "ALLOWED" | "REQUIRES_CONFIRMATION" | "UNKNOWN" | "NOT_ALLOWED";
  rightsEvidence: string | null;
  status: "ready" | "pending" | "blocked";
};

export type AdultProviderCapabilities = {
  productList: boolean;
  productFetch: boolean;
  htmlPage: boolean;
  affiliateLink: boolean;
  images: boolean;
  sampleImages: boolean;
  videoEmbed: boolean;
  search: boolean;
};

export type AdultProviderHealth = {
  providerKey: string;
  status: AffiliateProviderRuntimeStatus | "AUTH_REQUIRED" | "RATE_LIMITED";
  ok: boolean;
  reasons: string[];
  checkedAt: string;
};

/**
 * Common interface for adult ASP research adapters.
 * New providers implement this — Analysis/Writer/Review/WP stay unchanged.
 */
export interface AdultResearchProvider {
  readonly providerKey: string;
  readonly displayName: string;
  readonly capabilities: AdultProviderCapabilities;
  collectProducts(options?: { limit?: number }): Promise<{
    items: AdultNormalizedProduct[];
    collection?: CollectionResult;
  }>;
  fetchProduct(externalId: string): Promise<AdultNormalizedProduct | null>;
  normalizeProduct(raw: Record<string, unknown>): AdultNormalizedProduct;
  resolveAffiliateOffer(input: {
    externalId: string;
    product?: AdultNormalizedProduct | null;
  }): Promise<AdultAffiliateOffer | null>;
  resolveMedia(input: {
    externalId: string;
    product?: AdultNormalizedProduct | null;
  }): Promise<AdultMediaAsset[]>;
  healthCheck(): Promise<AdultProviderHealth>;
}

/** Map legacy AffiliateProductNormalized → AdultNormalizedProduct (partial). */
export function adultProductFromAffiliateNormalized(
  providerKey: string,
  p: AffiliateProductNormalized,
): AdultNormalizedProduct {
  return {
    providerKey,
    externalId: p.externalProductId,
    canonicalUrl: p.url ?? null,
    title: p.title,
    description: null,
    performers: [],
    maker: null,
    label: null,
    series: null,
    categories: [],
    tags: [],
    releaseDate: null,
    duration: null,
    price: null,
    images: [],
    samples: [],
    affiliateOffers: p.affiliateUrl
      ? [
          {
            providerKey,
            externalId: p.externalProductId,
            destinationUrl: p.url ?? null,
            trackingUrl: p.affiliateUrl,
            commissionType: "unknown",
            commissionValue: null,
            currency: p.currency ?? null,
            approvalState: "unknown",
            enabled: true,
            validFrom: null,
            validTo: null,
          },
        ]
      : [],
    evidence: {},
    fetchedAt: new Date().toISOString(),
    rawEvidence: p.normalized,
  };
}
