/**
 * Deterministic FANZA CTA URL validation — never synthesize, never LLM rewrite.
 *
 * Affiliate (af_id) preferred when present. Plain official FANZA/DMM product URLs
 * are allowed as interim CTA until DMM_AFFILIATE_ID is configured (R61).
 */

export interface AffiliateUrlCheck {
  ok: boolean;
  url: string | null;
  failureCode: string | null;
  hasAffiliateIdHint: boolean;
}

const AFFILIATE_HOST_RE =
  /(^|\.)dmm\.co\.jp$|(^|\.)dmm\.com$|(^|\.)fanza\.co\.jp$|(^|\.)affiliate\.dmm\.com$/i;

/** Official CTA must be absolute https on known FANZA/DMM hosts. */
export function validateFanzaAffiliateUrl(url: string | null | undefined): AffiliateUrlCheck {
  if (!url || !url.trim()) {
    return { ok: false, url: null, failureCode: "AFFILIATE_URL_MISSING", hasAffiliateIdHint: false };
  }
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, url: trimmed, failureCode: "AFFILIATE_URL_INVALID", hasAffiliateIdHint: false };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, url: trimmed, failureCode: "AFFILIATE_URL_NOT_HTTPS", hasAffiliateIdHint: false };
  }
  if (!AFFILIATE_HOST_RE.test(parsed.hostname)) {
    return { ok: false, url: trimmed, failureCode: "AFFILIATE_URL_HOST_UNEXPECTED", hasAffiliateIdHint: false };
  }
  const q = parsed.searchParams;
  const hasAffiliateIdHint =
    Boolean(q.get("affiliate_id") || q.get("af_id") || q.get("aid") || q.get("af")) ||
    /affiliate|\/al\.|click\./i.test(parsed.hostname + parsed.pathname) ||
    parsed.hostname.startsWith("al.");
  // R61: product page without partner params is allowed until affiliate id is available.
  return { ok: true, url: trimmed, failureCode: null, hasAffiliateIdHint };
}

/**
 * WordPress CTA with the affiliate ID. A plain product URL (page-evidence items, the canonical
 * fallback) linked 52 posts with no affiliate ID after DMM_AFFILIATE_ID was set (2026-11-14); it is
 * wrapped the way the DMM API wraps its own affiliateURL. X keeps its own URL rules and never uses this.
 */
export function withWordPressAffiliateId(url: string, affiliateId: string | null | undefined): string {
  const id = affiliateId?.trim();
  const check = validateFanzaAffiliateUrl(url);
  if (!id || !check.ok || check.hasAffiliateIdHint) return url;
  const wrapped = new URL("https://al.fanza.co.jp/");
  wrapped.searchParams.set("lurl", url.trim());
  wrapped.searchParams.set("af_id", id);
  wrapped.searchParams.set("ch", "api");
  return wrapped.toString();
}
