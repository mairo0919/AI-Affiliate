/**
 * Deterministic FANZA affiliate URL validation — never synthesize, never LLM rewrite.
 */

export interface AffiliateUrlCheck {
  ok: boolean;
  url: string | null;
  failureCode: string | null;
  hasAffiliateIdHint: boolean;
}

const AFFILIATE_HOST_RE =
  /(^|\.)dmm\.co\.jp$|(^|\.)dmm\.com$|(^|\.)fanza\.co\.jp$|(^|\.)affiliate\.dmm\.com$/i;

/** Official affiliate URL must be absolute https on known FANZA/DMM hosts with partner signal. */
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
  // Plain product page without affiliate partner params is not acceptable for production CTA.
  if (!hasAffiliateIdHint) {
    return {
      ok: false,
      url: trimmed,
      failureCode: "AFFILIATE_ID_MISSING",
      hasAffiliateIdHint: false,
    };
  }
  return { ok: true, url: trimmed, failureCode: null, hasAffiliateIdHint: true };
}
