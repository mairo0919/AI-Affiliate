/**
 * DMM / FANZA provider identification lives in AffiliateProviderRegistry + metadata.
 * Core domain does not add FANZA/DMM-specific enums.
 *
 * providerKey `fanza`:
 * - displayName: FANZA (DMM Adult)
 * - family: dmm
 * - site: fanza (adult digital / videoa etc.)
 * - Must not be mixed with general DMM通販 / non-adult retail catalogs.
 */

export const FANZA_PROVIDER_KEY = "fanza";

export const FANZA_PROVIDER_SEED = {
  providerKey: FANZA_PROVIDER_KEY,
  displayName: "FANZA (DMM Adult)",
  capabilities: {
    apiSearch: true,
    apiProductFetch: true,
    productFeed: false,
    manualImport: true,
    htmlFetch: true,
    affiliateLinkGeneration: true,
    conversionReport: false,
    supportsProductApi: true,
    supportsAffiliateLink: true,
    supportsProductImages: true,
    supportsSampleImages: true,
    supportsSearch: true,
    supportsTracking: true,
    supportsPrice: true,
    supportsAvailability: true,
  },
  metadata: {
    family: "dmm",
    site: "fanza",
    brand: "FANZA",
    operator: "DMM.com",
    /** Service/floor domains under FANZA adult catalog (not DMM general retail). */
    serviceDomains: ["digital", "mono", "monthly", "doujin", "videoc"],
    defaultService: "digital",
    defaultFloor: "videoa",
    locale: "ja-JP",
    adultCatalog: true,
    /** Explicitly excluded sibling catalogs to avoid product-domain mixups. */
    excludesSiteKeys: ["dmm-general", "dmm-tsuhan", "dmm-r18-shop-non-fanza"],
    notes:
      "PREFERRED_AFFILIATE_PROVIDER=fanza means FANZA adult product pages. Do not treat DMM通販 or non-adult DMM SKUs as the same product domain. API credentials optional for page-evidence article generation; never synthesize affiliate URLs before approval.",
  },
} as const;

export const DMM_GENERAL_PROVIDER_SEED = {
  providerKey: "dmm-general",
  displayName: "DMM通販 / General (non-FANZA catalog)",
  capabilities: {
    apiSearch: false,
    apiProductFetch: false,
    productFeed: false,
    manualImport: true,
    htmlFetch: false,
    affiliateLinkGeneration: false,
    conversionReport: false,
  },
  metadata: {
    family: "dmm",
    site: "dmm-general",
    brand: "DMM",
    adultCatalog: false,
    notes:
      "Sibling DMM family provider for non-FANZA retail. Never merge productMatchKey with fanza items.",
    relatedButDistinctFrom: [FANZA_PROVIDER_KEY],
  },
  isActive: false,
} as const;
