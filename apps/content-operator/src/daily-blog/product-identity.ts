/**
 * Canonical FANZA product identity for duplicate prevention.
 * Prefer cid / content_id; never invent affiliate URLs here.
 */
import { extractProductIdFromUrl } from "../ops/page-diagnose.js";

export interface ProductIdentityInput {
  externalProductId?: string | null;
  externalId?: string | null;
  cid?: string | null;
  /** Alias used by daily selection scores */
  canonicalId?: string | null;
  url?: string | null;
  affiliateUrl?: string | null;
}

export function normalizeCid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  // FANZA content ids are typically alphanumeric (e.g. mizd00320)
  return t.replace(/^cid=/i, "");
}

export function resolveCanonicalProductId(input: ProductIdentityInput): string | null {
  const direct =
    normalizeCid(input.cid) ??
    normalizeCid(input.canonicalId) ??
    normalizeCid(input.externalProductId) ??
    normalizeCid(input.externalId);
  if (direct) return direct;
  for (const u of [input.url, input.affiliateUrl]) {
    if (!u) continue;
    const fromUrl = extractProductIdFromUrl(u);
    const n = normalizeCid(fromUrl);
    if (n) return n;
  }
  return null;
}

export function identityKeys(input: ProductIdentityInput): string[] {
  const keys = new Set<string>();
  const cid = resolveCanonicalProductId(input);
  if (cid) {
    keys.add(`cid:${cid}`);
    keys.add(`external:${cid}`);
  }
  for (const u of [input.url, input.affiliateUrl]) {
    if (!u?.trim()) continue;
    try {
      const parsed = new URL(u.trim());
      keys.add(`url:${parsed.origin}${parsed.pathname}?id=${parsed.searchParams.get("id") ?? ""}`);
    } catch {
      keys.add(`url:${u.trim()}`);
    }
  }
  return [...keys];
}
