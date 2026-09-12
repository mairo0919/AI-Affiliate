/**
 * FANZA as one AffiliateProvider among many.
 *
 * - Never synthesizes affiliate URLs before approval.
 * - API credentials absent → API_UNAVAILABLE (page SOURCE path still available).
 * - Affiliate id absent → AFFILIATE_PENDING; canonical product URL only.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type {
  AffiliateProductNormalized,
  AffiliateProvider,
  AffiliateProviderCapabilities,
  AffiliateProviderRuntimeSnapshot,
} from "../types.js";
import { FANZA_PROVIDER_KEY } from "../../publication/provider-registry-meta.js";
import { buildRuntimeSnapshot, dmmApiCredentialsPresent } from "./provider-status.js";

const FANZA_CAPABILITIES: AffiliateProviderCapabilities = {
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
};

export function buildFanzaCanonicalProductUrl(contentId: string): string {
  const cid = contentId.trim().toLowerCase();
  return `https://video.dmm.co.jp/av/content/?id=${encodeURIComponent(cid)}`;
}

/**
 * Extract FANZA content_id from canonical, detail, or affiliate wrapper URLs.
 * Affiliate links encode the product URL inside `lurl` — plain `id=` regex misses those.
 */
export function extractFanzaContentIdFromUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const raw = url.trim();
  const fromQuery =
    raw.match(/[?&]id=([a-zA-Z0-9_-]+)/i)?.[1] ||
    raw.match(/\/(?:cid|content_id)=([a-zA-Z0-9_-]+)/i)?.[1] ||
    raw.match(/[=/]cid=([a-zA-Z0-9_-]+)/i)?.[1];
  if (fromQuery) return fromQuery.toLowerCase();
  try {
    const u = new URL(raw);
    for (const key of ["id", "cid", "content_id"]) {
      const v = u.searchParams.get(key);
      if (v?.trim()) return v.trim().toLowerCase();
    }
    const lurl = u.searchParams.get("lurl");
    if (lurl) {
      return extractFanzaContentIdFromUrl(decodeURIComponent(lurl));
    }
  } catch {
    /* ignore */
  }
  return null;
}

export class FanzaAffiliateProvider implements AffiliateProvider {
  readonly providerKey = FANZA_PROVIDER_KEY;
  readonly capabilities = FANZA_CAPABILITIES;

  constructor(
    private readonly opts: {
      config: Pick<AppConfig, "dmmApiId" | "dmmAffiliateId">;
      /** Only pass when API already returned a real affiliate URL — never invent. */
      knownAffiliateUrlByProductId?: Record<string, string>;
    },
  ) {}

  getRuntimeStatus(): AffiliateProviderRuntimeSnapshot {
    const apiAvailable = dmmApiCredentialsPresent(this.opts.config);
    const hasKnownAffiliate = Object.values(this.opts.knownAffiliateUrlByProductId ?? {}).some(
      (u) => typeof u === "string" && u.trim().length > 0,
    );
    const reasons: string[] = [];
    if (!apiAvailable) {
      reasons.push("DMM_API_ID/DMM_AFFILIATE_ID not configured — FANZA ItemList API unavailable");
    }
    if (!hasKnownAffiliate) {
      reasons.push("No API-provided affiliate URL on hand — AFFILIATE_PENDING (do not synthesize)");
    }
    reasons.push("Official product page / JSON-LD / catalog SOURCE remains usable for article generation");
    return buildRuntimeSnapshot({
      providerKey: this.providerKey,
      apiAvailable,
      affiliateLinkReady: hasKnownAffiliate,
      sourceAcquisitionAvailable: true,
      reasons,
    });
  }

  async searchProducts(): Promise<AffiliateProductNormalized[]> {
    // API discovery is ResearchProvider (FanzaResearchProvider) responsibility.
    // Without credentials we return [] so callers can continue with other providers.
    if (!dmmApiCredentialsPresent(this.opts.config)) {
      return [];
    }
    return [];
  }

  async fetchProduct(externalProductId: string): Promise<AffiliateProductNormalized | null> {
    const id = externalProductId.trim();
    if (!id) return null;
    const known = this.opts.knownAffiliateUrlByProductId?.[id]?.trim() || null;
    const canonical = buildFanzaCanonicalProductUrl(id);
    const status = this.getRuntimeStatus();
    return {
      externalProductId: id,
      title: id,
      url: canonical,
      affiliateUrl: known, // null unless API-provided — never synthesized
      locale: "ja-JP",
      currency: "JPY",
      adultFlag: true,
      availability: "UNKNOWN",
      normalized: {
        title: id,
        provider: FANZA_PROVIDER_KEY,
        canonicalProductUrl: canonical,
      },
      metadata: {
        source: "fanza-affiliate-provider",
        apiStatus: status.apiAvailable ? "API_AVAILABLE" : "API_UNAVAILABLE",
        affiliateStatus: known ? "AFFILIATE_READY" : "AFFILIATE_PENDING",
        runtimeStatus: status.status,
      },
    };
  }

  normalizeProduct(raw: Record<string, unknown>): AffiliateProductNormalized {
    const externalProductId = String(raw.externalProductId ?? raw.contentId ?? raw.id ?? "").trim();
      const title = String(raw.title ?? (externalProductId || "FANZA product"));
    const affiliateUrl =
      typeof raw.affiliateUrl === "string" && raw.affiliateUrl.trim()
        ? raw.affiliateUrl.trim()
        : typeof raw.affiliateURL === "string" && raw.affiliateURL.trim()
          ? raw.affiliateURL.trim()
          : null;
    const url =
      typeof raw.url === "string" && raw.url.trim()
        ? raw.url.trim()
        : externalProductId
          ? buildFanzaCanonicalProductUrl(externalProductId)
          : null;
    return {
      externalProductId: externalProductId || "unknown",
      title,
      url,
      affiliateUrl,
      locale: "ja-JP",
      currency: "JPY",
      adultFlag: raw.adultFlag !== false,
      availability: typeof raw.availability === "string" ? raw.availability : "UNKNOWN",
      normalized: {
        title,
        ...(typeof raw.normalized === "object" && raw.normalized !== null
          ? (raw.normalized as Record<string, unknown>)
          : {}),
      },
      metadata: {
        source: "fanza-affiliate-provider",
        affiliateStatus: affiliateUrl ? "AFFILIATE_READY" : "AFFILIATE_PENDING",
        ...(typeof raw.metadata === "object" && raw.metadata !== null
          ? (raw.metadata as Record<string, unknown>)
          : {}),
      },
    };
  }
}

/** Stub for future ASPs — no credentials invented. */
export class UnconfiguredAffiliateProvider implements AffiliateProvider {
  readonly capabilities: AffiliateProviderCapabilities = {
    apiSearch: false,
    apiProductFetch: false,
    productFeed: false,
    manualImport: true,
    htmlFetch: false,
    affiliateLinkGeneration: false,
    conversionReport: false,
    supportsProductApi: false,
    supportsAffiliateLink: false,
  };

  constructor(readonly providerKey: string) {}

  getRuntimeStatus(): AffiliateProviderRuntimeSnapshot {
    return buildRuntimeSnapshot({
      providerKey: this.providerKey,
      apiAvailable: false,
      affiliateLinkReady: false,
      sourceAcquisitionAvailable: false,
      reasons: [
        `Provider "${this.providerKey}" is registered as a slot only — implement adapter before use`,
      ],
    });
  }

  async searchProducts(): Promise<AffiliateProductNormalized[]> {
    return [];
  }

  async fetchProduct(): Promise<AffiliateProductNormalized | null> {
    return null;
  }

  normalizeProduct(raw: Record<string, unknown>): AffiliateProductNormalized {
    const externalProductId = String(raw.externalProductId ?? raw.id ?? "unknown");
    return {
      externalProductId,
      title: String(raw.title ?? externalProductId),
      url: typeof raw.url === "string" ? raw.url : null,
      affiliateUrl: null,
      locale: "ja-JP",
      adultFlag: true,
      availability: "UNKNOWN",
      normalized: { title: String(raw.title ?? externalProductId) },
      metadata: { source: this.providerKey, affiliateStatus: "AFFILIATE_PENDING" },
    };
  }
}
