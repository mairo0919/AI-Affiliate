import { isDmmFanzaHost } from "./page-classification.js";

const TRACKING_PARAMS = new Set([
  "i3_ref",
  "i3_ord",
  "i3_pst",
  "dmmref",
  "via",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "af_id",
  "ch",
  "ch_id",
]);

/**
 * Canonicalize research source URLs.
 * Keeps product identity query (`id` / `cid`) and drops tracking params.
 */
export function canonicalizeResearchUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (isDmmFanzaHost(url.hostname)) {
    const contentId = url.searchParams.get("id");
    if (/\/av\/content\/?/i.test(url.pathname) && contentId) {
      const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
      // Prefer stable video.dmm.co.jp content URL when host is already video.* or redirected there.
      const host = url.hostname.toLowerCase().includes("video.")
        ? url.hostname
        : url.hostname;
      return `https://${host}${path}?id=${encodeURIComponent(contentId)}`;
    }

    // Classic detail URLs: keep cid path, drop query tracking
    if (/\/detail\//i.test(url.pathname) && /cid=/i.test(url.pathname)) {
      url.search = "";
      url.hash = "";
      return url.toString();
    }
  }

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  return url.toString();
}
