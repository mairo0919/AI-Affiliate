import {
  DEFAULT_LINK_POLICY,
  LINK_REPLACE_PRIORITY,
  UNAVAILABLE_LINK_STATES,
  type AffiliateReplacementState,
  type LinkCandidateInput,
  type LinkPolicyConfig,
  type ProductLinkCandidate,
  type ProviderLinkOffer,
  type ResolvedProductLink,
} from "./link-types.js";

function isFutureAsp(providerKey: string, policy: LinkPolicyConfig): boolean {
  if (providerKey === policy.preferredAffiliateProvider) return false;
  if (policy.futureAspProviders.length === 0) {
    // Without an allowlist, non-preferred providers are treated as future ASP band.
    return true;
  }
  return policy.futureAspProviders.includes(providerKey);
}

export function isValidHttpUrl(url: string | null | undefined): boolean {
  if (!url || !url.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isLinkAvailable(availability: string | null | undefined): boolean {
  if (!availability || !availability.trim()) return true;
  return !UNAVAILABLE_LINK_STATES.has(availability.trim().toUpperCase());
}

function sameProduct(
  offerKey: string | null | undefined,
  expected: string,
): boolean {
  if (!offerKey || !offerKey.trim()) return true;
  return offerKey.trim() === expected.trim();
}

function awaitingProviderReplacement(): AffiliateReplacementState {
  return {
    replacementStatus: "AWAITING_PROVIDER",
    matchedProvider: null,
    matchReason: "awaiting-affiliate-api",
  };
}

function notApplicableReplacement(): AffiliateReplacementState {
  return { replacementStatus: "NOT_APPLICABLE" };
}

function pushCandidate(
  out: ProductLinkCandidate[],
  candidate: ProductLinkCandidate,
): void {
  if (!isValidHttpUrl(candidate.url)) return;
  if (!isLinkAvailable(candidate.availability)) return;
  out.push(candidate);
}

/**
 * Build selectable candidates from multi-provider offers for one logical product.
 */
export function buildProductLinkCandidates(
  input: LinkCandidateInput,
  policy: LinkPolicyConfig = DEFAULT_LINK_POLICY,
): ProductLinkCandidate[] {
  const preferred = policy.preferredAffiliateProvider;
  const matchKey = input.productMatchKey.trim();
  const candidates: ProductLinkCandidate[] = [];

  for (const offer of input.offers) {
    if (!sameProduct(offer.productMatchKey, matchKey)) continue;
    const availability = (offer.availability ?? "AVAILABLE").toUpperCase();
    const provider = offer.providerKey;

    if (isValidHttpUrl(offer.affiliateUrl) && isLinkAvailable(availability)) {
      const isPreferred = provider === preferred;
      const future = isFutureAsp(provider, policy);
      if (isPreferred || future) {
        pushCandidate(candidates, {
          url: offer.affiliateUrl!.trim(),
          preferredAffiliateProvider: preferred,
          currentLinkProvider: provider,
          currentLinkType: "AFFILIATE",
          replacePriority: isPreferred
            ? LINK_REPLACE_PRIORITY.PREFERRED_AFFILIATE
            : LINK_REPLACE_PRIORITY.FUTURE_ASP_AFFILIATE,
          availability,
          productMatchKey: matchKey,
          replacement: {
            replacementStatus: "REPLACED",
            candidateAffiliateUrl: offer.affiliateUrl!.trim(),
            candidateAffiliateProductId: offer.externalProductId ?? null,
            matchedProvider: provider,
            matchConfidence: 1,
            matchReason: "affiliate-url-present",
            replacedAt: new Date().toISOString(),
          },
          metadata: { role: "affiliate-url", externalProductId: offer.externalProductId ?? null },
        });
      }
    }

    if (isValidHttpUrl(offer.productUrl) && isLinkAvailable(availability)) {
      const isPreferred = provider === preferred;
      const future = isFutureAsp(provider, policy);
      if (isPreferred || future) {
        pushCandidate(candidates, {
          url: offer.productUrl!.trim(),
          preferredAffiliateProvider: preferred,
          currentLinkProvider: provider,
          currentLinkType: "PROVIDER_PRODUCT",
          replacePriority: isPreferred
            ? LINK_REPLACE_PRIORITY.PREFERRED_PRODUCT
            : LINK_REPLACE_PRIORITY.FUTURE_ASP_PRODUCT,
          availability,
          productMatchKey: matchKey,
          replacement: awaitingProviderReplacement(),
          metadata: { role: "provider-product-page", externalProductId: offer.externalProductId ?? null },
        });
      }
    }
  }

  for (const official of input.officialUrls ?? []) {
    pushCandidate(candidates, {
      url: official.url.trim(),
      preferredAffiliateProvider: preferred,
      currentLinkProvider: official.provider,
      currentLinkType: "OFFICIAL",
      replacePriority: LINK_REPLACE_PRIORITY.OFFICIAL,
      availability: (official.availability ?? "AVAILABLE").toUpperCase(),
      productMatchKey: matchKey,
      replacement: notApplicableReplacement(),
      metadata: { role: "official-site" },
    });
  }

  for (const trusted of input.trustedUrls ?? []) {
    pushCandidate(candidates, {
      url: trusted.url.trim(),
      preferredAffiliateProvider: preferred,
      currentLinkProvider: trusted.provider,
      currentLinkType: "TRUSTED_PRODUCT",
      replacePriority: LINK_REPLACE_PRIORITY.TRUSTED_PRODUCT,
      availability: (trusted.availability ?? "AVAILABLE").toUpperCase(),
      productMatchKey: matchKey,
      replacement: notApplicableReplacement(),
      metadata: { role: "trusted-product-page" },
    });
  }

  return candidates.sort((a, b) => {
    if (a.replacePriority !== b.replacePriority) {
      return a.replacePriority - b.replacePriority;
    }
    return (a.url ?? "").localeCompare(b.url ?? "");
  });
}

export function resolvePrimaryLink(
  candidates: ProductLinkCandidate[],
  preferredAffiliateProvider = DEFAULT_LINK_POLICY.preferredAffiliateProvider,
): ResolvedProductLink {
  const usable = candidates.filter(
    (c) => isValidHttpUrl(c.url) && isLinkAvailable(c.availability),
  );

  if (usable.length === 0) {
    return {
      url: null,
      preferredAffiliateProvider,
      currentLinkProvider: "none",
      currentLinkType: "OTHER",
      replacePriority: LINK_REPLACE_PRIORITY.NONE,
      availability: "NONE",
      productMatchKey: "",
      replacement: notApplicableReplacement(),
      selected: true,
      selectionReason: "no-link-candidates",
      metadata: { role: "none" },
    };
  }

  const primary = usable[0]!;
  return {
    ...primary,
    selected: true,
    selectionReason: `priority-${primary.replacePriority}-${primary.currentLinkType}-${primary.currentLinkProvider}`,
  };
}

/**
 * Attach a found affiliate URL as a replacement candidate (does not mutate published bodies).
 */
export function proposeAffiliateCandidate(
  candidates: ProductLinkCandidate[],
  input: {
    affiliateUrl: string;
    providerKey: string;
    affiliateProductId?: string | null;
    matchConfidence?: number;
    matchReason?: string;
  },
): ProductLinkCandidate[] {
  if (!isValidHttpUrl(input.affiliateUrl)) return candidates;
  const now = new Date().toISOString();

  return candidates.map((c) => {
    if (
      c.currentLinkType === "PROVIDER_PRODUCT" &&
      c.currentLinkProvider === input.providerKey &&
      (c.replacement.replacementStatus === "AWAITING_PROVIDER" ||
        c.replacement.replacementStatus === "AWAITING_MATCH")
    ) {
      return {
        ...c,
        replacement: {
          replacementStatus: "CANDIDATE_FOUND",
          candidateAffiliateUrl: input.affiliateUrl.trim(),
          candidateAffiliateProductId: input.affiliateProductId ?? null,
          matchedProvider: input.providerKey,
          matchConfidence: input.matchConfidence ?? 1,
          matchReason: input.matchReason ?? "affiliate-api-match",
          detectedAt: now,
        },
      };
    }
    return c;
  });
}

/** @deprecated use proposeAffiliateCandidate + approval flow */
export function applyAffiliateReplacement(
  candidates: ProductLinkCandidate[],
  affiliateUrl: string,
  options: { providerKey: string; preferredAffiliateProvider?: string },
): ProductLinkCandidate[] {
  const proposed = proposeAffiliateCandidate(candidates, {
    affiliateUrl,
    providerKey: options.providerKey,
  });
  const preferred =
    options.preferredAffiliateProvider ??
    candidates[0]?.preferredAffiliateProvider ??
    DEFAULT_LINK_POLICY.preferredAffiliateProvider;

  const hasAff = proposed.some(
    (c) =>
      c.currentLinkType === "AFFILIATE" &&
      c.currentLinkProvider === options.providerKey &&
      c.url === affiliateUrl.trim(),
  );
  if (hasAff) return proposed;

  const affiliateCandidate: ProductLinkCandidate = {
    url: affiliateUrl.trim(),
    preferredAffiliateProvider: preferred,
    currentLinkProvider: options.providerKey,
    currentLinkType: "AFFILIATE",
    replacePriority:
      options.providerKey === preferred
        ? LINK_REPLACE_PRIORITY.PREFERRED_AFFILIATE
        : LINK_REPLACE_PRIORITY.FUTURE_ASP_AFFILIATE,
    availability: "AVAILABLE",
    productMatchKey: candidates[0]?.productMatchKey ?? "",
    replacement: {
      replacementStatus: "REPLACED",
      candidateAffiliateUrl: affiliateUrl.trim(),
      matchedProvider: options.providerKey,
      matchConfidence: 1,
      matchReason: "direct-replacement",
      replacedAt: new Date().toISOString(),
    },
    metadata: { role: "affiliate-url", source: "api-replacement" },
  };

  return [affiliateCandidate, ...proposed].sort(
    (a, b) => a.replacePriority - b.replacePriority,
  );
}

export class LinkResolver {
  constructor(private readonly policy: LinkPolicyConfig = DEFAULT_LINK_POLICY) {}

  buildCandidates(input: LinkCandidateInput): ProductLinkCandidate[] {
    return buildProductLinkCandidates(input, this.policy);
  }

  resolve(input: LinkCandidateInput): {
    candidates: ProductLinkCandidate[];
    primary: ResolvedProductLink;
  } {
    const candidates = this.buildCandidates(input);
    return {
      candidates,
      primary: resolvePrimaryLink(candidates, this.policy.preferredAffiliateProvider),
    };
  }

  /** Convenience: single-provider offer. */
  resolveFromProvider(offer: ProviderLinkOffer & {
    productMatchKey: string;
    officialUrls?: LinkCandidateInput["officialUrls"];
    trustedUrls?: LinkCandidateInput["trustedUrls"];
  }): {
    candidates: ProductLinkCandidate[];
    primary: ResolvedProductLink;
  } {
    return this.resolve({
      productMatchKey: offer.productMatchKey,
      offers: [offer],
      officialUrls: offer.officialUrls,
      trustedUrls: offer.trustedUrls,
    });
  }

  replaceWithAffiliate(
    candidates: ProductLinkCandidate[],
    affiliateUrl: string,
    providerKey: string,
  ): {
    candidates: ProductLinkCandidate[];
    primary: ResolvedProductLink;
  } {
    const replaced = applyAffiliateReplacement(candidates, affiliateUrl, {
      providerKey,
      preferredAffiliateProvider: this.policy.preferredAffiliateProvider,
    });
    return {
      candidates: replaced,
      primary: resolvePrimaryLink(replaced, this.policy.preferredAffiliateProvider),
    };
  }
}
