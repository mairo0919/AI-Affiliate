/**
 * Canonical URL for Article Pattern learning dedupe.
 * Does not persist bodies; URL-only normalization.
 */

const TRACKING_QUERY_RE =
  /^(utm_.*|gclid|fbclid|msclkid|mc_eid|mc_cid|yclid|igshid|vero_id|_hsenc|_hsmi|ref|ref_src|spm)$/i;

export function canonicalizeArticlePatternUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  // Drop default ports
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  // Remove tracking query params; keep meaningful ones
  const kept = new URLSearchParams();
  const keys = [...url.searchParams.keys()].sort();
  for (const key of keys) {
    if (TRACKING_QUERY_RE.test(key)) continue;
    for (const value of url.searchParams.getAll(key)) {
      kept.append(key, value);
    }
  }
  const qs = kept.toString();
  url.search = qs ? `?${qs}` : "";

  // Normalize trailing slash on pathname (keep root "/")
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}
