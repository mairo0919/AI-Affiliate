/**
 * Prefer WordPress canonical/permalink over internal ?p= query URLs for X.
 * Does not change publication routing — URL surface hygiene for WP_TRAFFIC copy only.
 */

export function isWordPressQueryPermalink(url: string | null | undefined): boolean {
  const raw = (url ?? "").trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.searchParams.has("p") || u.searchParams.has("page_id");
  } catch {
    return /[?&](?:p|page_id)=\d+/i.test(raw);
  }
}

function deriveSiteBase(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function decodeSlug(slug: string): string {
  const trimmed = slug.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

/**
 * Resolve the URL X should cite for WP traffic.
 * Prefer pretty permalink / slug-based canonical; avoid ?p= when a slug exists.
 */
export function resolveWordPressCanonicalUrl(input: {
  publicLink?: string | null;
  slug?: string | null;
  siteBaseUrl?: string | null;
  fallbackUrl?: string | null;
}): string | null {
  const link = input.publicLink?.trim() || null;
  if (link && !isWordPressQueryPermalink(link)) {
    return link.endsWith("/") ? link : `${link}/`;
  }

  const base = (
    input.siteBaseUrl?.replace(/\/$/, "") ||
    deriveSiteBase(link) ||
    deriveSiteBase(input.fallbackUrl) ||
    ""
  ).replace(/\/$/, "");
  const slug = decodeSlug(input.slug ?? "");
  if (base && slug) {
    return `${base}/${slug}/`;
  }

  const fallback = input.fallbackUrl?.trim() || null;
  if (fallback && !isWordPressQueryPermalink(fallback)) {
    return fallback.endsWith("/") ? fallback : `${fallback}/`;
  }

  // Last resort (preview / legacy): keep query form rather than inventing a path.
  return link || fallback;
}
