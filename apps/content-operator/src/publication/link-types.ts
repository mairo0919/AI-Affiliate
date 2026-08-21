/**
 * Link selection for Publication Planner / Link Resolver.
 *
 * Priority (lower replacePriority = higher preference):
 * 1. preferredAffiliateProvider affiliate URL
 * 2. preferredAffiliateProvider product URL
 * 3. future ASP affiliate URL
 * 4. future ASP product URL
 * 5. official URL
 * 6. other trusted product URL
 * 7. no link
 */

export const PRODUCT_LINK_TYPES = [
  "PROVIDER_PRODUCT",
  "AFFILIATE",
  "OFFICIAL",
  "TRUSTED_PRODUCT",
  "OTHER",
] as const;

export type ProductLinkTypeKey = (typeof PRODUCT_LINK_TYPES)[number];

export const AFFILIATE_REPLACEMENT_STATUSES = [
  "NOT_APPLICABLE",
  "AWAITING_PROVIDER",
  "AWAITING_MATCH",
  "CANDIDATE_FOUND",
  "AWAITING_APPROVAL",
  "APPROVED",
  "REPLACED",
  "REJECTED",
  "INVALID",
] as const;

export type AffiliateReplacementStatusKey =
  (typeof AFFILIATE_REPLACEMENT_STATUSES)[number];

/** Lower number = higher selection priority. */
export const LINK_REPLACE_PRIORITY = {
  PREFERRED_AFFILIATE: 1,
  PREFERRED_PRODUCT: 2,
  FUTURE_ASP_AFFILIATE: 3,
  FUTURE_ASP_PRODUCT: 4,
  OFFICIAL: 5,
  TRUSTED_PRODUCT: 6,
  NONE: 7,
} as const;

export type LinkReplacePriority =
  (typeof LINK_REPLACE_PRIORITY)[keyof typeof LINK_REPLACE_PRIORITY];

export interface LinkPolicyConfig {
  /** Default provider key: fanza (FANZA adult catalog under DMM family). */
  preferredAffiliateProvider: string;
  futureAspProviders: string[];
}

export interface AffiliateReplacementState {
  replacementStatus: AffiliateReplacementStatusKey;
  candidateAffiliateUrl?: string | null;
  candidateAffiliateProductId?: string | null;
  matchedProvider?: string | null;
  matchConfidence?: number | null;
  matchReason?: string | null;
  detectedAt?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  replacedAt?: string | null;
  rejectionReason?: string | null;
}

export interface ProductLinkCandidate {
  url: string | null;
  preferredAffiliateProvider: string;
  currentLinkProvider: string;
  currentLinkType: ProductLinkTypeKey;
  replacePriority: number;
  availability: string;
  productMatchKey: string;
  replacement: AffiliateReplacementState;
  metadata?: Record<string, unknown>;
}

export interface ResolvedProductLink extends ProductLinkCandidate {
  selected: boolean;
  selectionReason: string;
}

export interface ProviderLinkOffer {
  providerKey: string;
  productUrl?: string | null;
  affiliateUrl?: string | null;
  availability?: string | null;
  externalProductId?: string | null;
  /** Must equal resolver productMatchKey or candidate is excluded. */
  productMatchKey?: string | null;
}

export interface LinkCandidateInput {
  /** Canonical same-product key. Offers with a different key are excluded. */
  productMatchKey: string;
  offers: ProviderLinkOffer[];
  officialUrls?: Array<{ provider: string; url: string; availability?: string }>;
  trustedUrls?: Array<{ provider: string; url: string; availability?: string }>;
}

export const DEFAULT_LINK_POLICY: LinkPolicyConfig = {
  preferredAffiliateProvider: "fanza",
  futureAspProviders: [],
};

/** Availability values treated as unusable for CTA selection. */
export const UNAVAILABLE_LINK_STATES = new Set([
  "DISCONTINUED",
  "UNAVAILABLE",
  "ENDED",
  "SOLD_OUT",
  "INVALID",
]);
