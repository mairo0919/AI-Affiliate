import { createHash } from "node:crypto";

export interface ProductKeyInput {
  provider?: string | null;
  providerProductId?: string | null;
  contentId?: string | null;
  affiliateUrl?: string | null;
  researchItemId?: string | null;
  externalId?: string | null;
}

/**
 * Stable product identity. Never uses product title alone.
 * Priority: provider+providerProductId → provider+contentId → affiliateUrl hash → researchItemId/externalId
 */
export function buildProductKey(input: ProductKeyInput): string {
  const provider = (input.provider ?? "unknown").trim().toLowerCase() || "unknown";
  if (input.providerProductId && input.providerProductId.trim()) {
    return `${provider}:pid:${input.providerProductId.trim()}`;
  }
  if (input.contentId && input.contentId.trim()) {
    return `${provider}:cid:${input.contentId.trim()}`;
  }
  if (input.affiliateUrl && input.affiliateUrl.trim()) {
    const normalized = normalizeAffiliateUrl(input.affiliateUrl);
    const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 24);
    return `${provider}:url:${hash}`;
  }
  if (input.externalId && input.externalId.trim()) {
    return `${provider}:ext:${input.externalId.trim()}`;
  }
  if (input.researchItemId && input.researchItemId.trim()) {
    return `${provider}:rid:${input.researchItemId.trim()}`;
  }
  throw new Error("unable to build productKey from available identifiers");
}

export function normalizeAffiliateUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    // Drop volatile tracking params
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString().toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export function extractProviderProductId(input: {
  externalId?: string | null;
  affiliateUrl?: string | null;
  rawSnapshot?: Record<string, unknown> | null;
}): string | null {
  if (input.externalId?.trim()) return input.externalId.trim();
  const fromSnap = input.rawSnapshot?.id ?? input.rawSnapshot?.content_id;
  if (typeof fromSnap === "string" && fromSnap.trim()) return fromSnap.trim();
  if (input.affiliateUrl) {
    try {
      const u = new URL(input.affiliateUrl);
      const lurl = u.searchParams.get("lurl") ?? u.searchParams.get("cid");
      if (lurl?.trim()) return lurl.trim();
    } catch {
      // ignore
    }
  }
  return null;
}
