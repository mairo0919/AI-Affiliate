import type {
  AffiliateProductNormalized,
  AffiliateProvider,
  AffiliateProviderCapabilities,
} from "../types.js";

const CATALOG: AffiliateProductNormalized[] = [
  {
    externalProductId: "mock-item-a",
    title: "Sample Catalog Item A",
    url: "https://example.invalid/catalog/mock-item-a",
    affiliateUrl: "https://example.invalid/aff/mock-item-a",
    locale: "ja-JP",
    currency: "JPY",
    adultFlag: true,
    availability: "AVAILABLE",
    normalized: {
      title: "Sample Catalog Item A",
      category: "sample-catalog",
      abstractDescription: "Abstract catalog sample for lifecycle tests.",
    },
    metadata: {
      source: "mock-affiliate",
      officialUrls: [{ provider: "maker", url: "https://example.invalid/maker/mock-item-a" }],
      trustedUrls: [{ provider: "shop", url: "https://example.invalid/shop/mock-item-a" }],
    },
  },
  {
    externalProductId: "mock-item-b",
    title: "Sample Catalog Item B",
    url: "https://example.invalid/catalog/mock-item-b",
    affiliateUrl: "https://example.invalid/aff/mock-item-b",
    locale: "ja-JP",
    currency: "JPY",
    adultFlag: true,
    availability: "AVAILABLE",
    normalized: {
      title: "Sample Catalog Item B",
      category: "sample-catalog",
      abstractDescription: "Second abstract catalog sample for lifecycle tests.",
    },
    metadata: {
      source: "mock-affiliate",
      officialUrls: [{ provider: "publisher", url: "https://example.invalid/publisher/mock-item-b" }],
    },
  },
];

export class MockAffiliateProvider implements AffiliateProvider {
  readonly providerKey = "mock-affiliate";
  readonly capabilities: AffiliateProviderCapabilities = {
    apiSearch: true,
    apiProductFetch: true,
    productFeed: false,
    manualImport: true,
    htmlFetch: false,
    affiliateLinkGeneration: true,
    conversionReport: false,
  };

  async searchProducts(query: string, limit = 10): Promise<AffiliateProductNormalized[]> {
    const q = query.trim().toLowerCase();
    const matched = q
      ? CATALOG.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.externalProductId.toLowerCase().includes(q),
        )
      : CATALOG;
    return matched.slice(0, Math.max(1, limit));
  }

  async fetchProduct(externalProductId: string): Promise<AffiliateProductNormalized | null> {
    return CATALOG.find((p) => p.externalProductId === externalProductId) ?? null;
  }

  normalizeProduct(raw: Record<string, unknown>): AffiliateProductNormalized {
    const externalProductId = String(raw.externalProductId ?? raw.id ?? "unknown");
    const title = String(raw.title ?? `Sample Catalog Item ${externalProductId}`);
    return {
      externalProductId,
      title,
      url: typeof raw.url === "string" ? raw.url : null,
      affiliateUrl: typeof raw.affiliateUrl === "string" ? raw.affiliateUrl : null,
      locale: typeof raw.locale === "string" ? raw.locale : "ja-JP",
      currency: typeof raw.currency === "string" ? raw.currency : "JPY",
      adultFlag: raw.adultFlag !== false,
      availability: typeof raw.availability === "string" ? raw.availability : "UNKNOWN",
      normalized: {
        title,
        ...(typeof raw.normalized === "object" && raw.normalized !== null
          ? (raw.normalized as Record<string, unknown>)
          : {}),
      },
      metadata:
        typeof raw.metadata === "object" && raw.metadata !== null
          ? (raw.metadata as Record<string, unknown>)
          : { source: "mock-affiliate" },
    };
  }
}
