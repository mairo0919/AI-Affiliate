import { createHash } from "node:crypto";

/**
 * WordPress SEO / taxonomy attach payload — does NOT rewrite article body or Writer output.
 * Never invents ratings, prices, reviews, or adult OG images.
 */

export const OTONASELECT_PRODUCTION_ORIGIN = "https://otonaselect.net";

export const WP_SEO_META_KEYS = {
  seoTitle: "otonaselect_seo_title",
  seoDescription: "otonaselect_seo_description",
  productCid: "otonaselect_product_cid",
  safeOgImage: "otonaselect_safe_og_image",
  /** PUBLIC URL-reference card image (may be trusted DMM CDN; not used for OG). */
  cardImage: "otonaselect_card_image",
  seriesName: "otonaselect_series_name",
} as const;

export type WordPressSeoPerformer = {
  name: string;
  /** Optional ASCII hint for stable pretty slug (e.g. okuda-saki). */
  ascii?: string | null;
};

export type WordPressSeoAttachInput = {
  title: string;
  seoTitle?: string | null;
  metaDescription?: string | null;
  summary?: string | null;
  lead?: string | null;
  performers?: WordPressSeoPerformer[] | string[] | null;
  /** Primary / first series (compat). Prefer seriesNames when multiple. */
  seriesName?: string | null;
  seriesAscii?: string | null;
  /** Multiple series (official + semantic groupings). */
  seriesNames?: string[] | null;
  categories?: string[] | null;
  tags?: string[] | null;
  /**
   * Provider-agnostic product key (AffiliateProduct / Research external id).
   * Accepts plain ids or `provider:id` forms.
   */
  productCanonicalId?: string | null;
  /** Only pass when confirmed X_SOCIAL_SAFE / site-owned. Never FANZA sample CDN. */
  safeOgImageUrl?: string | null;
  /**
   * Card/list thumbnail URL — trusted DMM CDN allowed (URL reference only).
   * Not used for Open Graph.
   */
  cardImageUrl?: string | null;
  siteOrigin?: string | null;
};

export type WordPressSeoAttach = {
  siteOrigin: string;
  excerpt: string;
  meta: Record<string, string>;
  performers: Array<{ name: string; ascii: string | null; stableSlug: string }>;
  /** @deprecated Prefer seriesList — first series for meta/backward compat. */
  series: { name: string; ascii: string | null; stableSlug: string } | null;
  seriesList: Array<{ name: string; ascii: string | null; stableSlug: string }>;
  categories: string[];
  tags: string[];
  productCanonicalId: string | null;
  notes: string[];
};

const BLOCKED_OG_HOSTS = new Set([
  "pics.dmm.co.jp",
  "awsimgsrc.dmm.co.jp",
  "pics.dmm.com",
]);

export function stableTermSlug(
  displayName: string,
  prefix: "p" | "s" | "t",
  preferredAscii?: string | null,
): string {
  const ascii = (preferredAscii ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length >= 2 && ascii.length <= 48) {
    return `${prefix}-${ascii}`;
  }
  const normalized = displayName.trim().replace(/\s+/g, "").toLowerCase();
  const hash = simpleHashHex(normalized).slice(0, 12);
  return `${prefix}-${hash}`;
}

/** Deterministic SHA-256 hex for stable term slugs. */
function simpleHashHex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function truncateMetaDescription(text: string, maxLen = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trim()}…`;
}

export function isSafeOgImageUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (BLOCKED_OG_HOSTS.has(host)) return false;
    for (const blocked of BLOCKED_OG_HOSTS) {
      if (host.endsWith(`.${blocked}`)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function normalizePerformers(
  input: WordPressSeoAttachInput["performers"],
): WordPressSeoPerformer[] {
  if (!input?.length) return [];
  const out: WordPressSeoPerformer[] = [];
  const seen = new Set<string>();
  for (const row of input) {
    const name = typeof row === "string" ? row.trim() : row.name?.trim() ?? "";
    if (!name) continue;
    const key = name.replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const ascii = typeof row === "string" ? null : row.ascii?.trim() || null;
    out.push({ name, ascii });
  }
  return out;
}

/** Provider-agnostic product key normalization for meta / identity. */
export function normalizeProductCanonicalId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let t = raw.trim().toLowerCase();
  if (!t) return null;
  t = t.replace(/^[a-z][a-z0-9_-]{0,32}:/, ""); // strip provider: prefix
  t = t.replace(/^cid=/i, "");
  if (t.includes("/")) {
    t = t.split("/").filter(Boolean).pop() ?? t;
  }
  // Opaque UUID-like — keep full key
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return t;
  }
  const head = t.split("-")[0] ?? t;
  if (/^[a-z0-9]{3,64}$/i.test(head) && /\d/.test(head)) {
    return head;
  }
  if (/^[a-z0-9][a-z0-9._-]{2,127}$/i.test(t)) return t;
  return null;
}

/**
 * Build SEO attach payload from already-generated article fields + evidence labels.
 */
export function buildWordPressSeoAttach(input: WordPressSeoAttachInput): WordPressSeoAttach {
  const notes: string[] = [];
  const siteOrigin = (input.siteOrigin?.trim() || OTONASELECT_PRODUCTION_ORIGIN).replace(
    /\/$/,
    "",
  );
  if (/mixh\.jp/i.test(siteOrigin)) {
    notes.push("rejected_legacy_site_origin_using_production");
  }
  const origin = /mixh\.jp/i.test(siteOrigin) ? OTONASELECT_PRODUCTION_ORIGIN : siteOrigin;

  const seoTitle = (input.seoTitle?.trim() || input.title.trim()).slice(0, 120);
  const descSource =
    input.metaDescription?.trim() ||
    input.summary?.trim() ||
    input.lead?.trim() ||
    input.title.trim();
  const excerpt = truncateMetaDescription(descSource, 120);

  const performers = normalizePerformers(input.performers).map((p) => ({
    name: p.name,
    ascii: p.ascii ?? null,
    stableSlug: stableTermSlug(p.name, "p", p.ascii),
  }));

  const seriesNameSet: string[] = [];
  for (const n of [
    ...(input.seriesNames ?? []),
    ...(input.seriesName?.trim() ? [input.seriesName.trim()] : []),
  ]) {
    const t = n.trim();
    if (t) seriesNameSet.push(t);
  }
  const uniqueSeriesNames: string[] = [];
  const seenSeries = new Set<string>();
  for (const n of seriesNameSet) {
    const key = n.replace(/\s+/g, "").toLowerCase();
    if (seenSeries.has(key)) continue;
    seenSeries.add(key);
    uniqueSeriesNames.push(n);
  }

  const seriesList = uniqueSeriesNames.map((name, idx) => ({
    name,
    ascii: idx === 0 ? input.seriesAscii?.trim() || null : null,
    stableSlug: stableTermSlug(name, "s", idx === 0 ? input.seriesAscii : null),
  }));
  const series = seriesList[0] ?? null;

  const categories = [...new Set((input.categories ?? []).map((c) => c.trim()).filter(Boolean))];
  const tags = [...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))];

  const productCanonicalId = normalizeProductCanonicalId(input.productCanonicalId);
  if (input.productCanonicalId?.trim() && !productCanonicalId) {
    notes.push("productCanonicalId_rejected_invalid");
  }

  const meta: Record<string, string> = {
    [WP_SEO_META_KEYS.seoTitle]: seoTitle,
    [WP_SEO_META_KEYS.seoDescription]: excerpt,
  };
  if (productCanonicalId) meta[WP_SEO_META_KEYS.productCid] = productCanonicalId;
  if (seriesList[0]) meta[WP_SEO_META_KEYS.seriesName] = seriesList[0].name;
  if (seriesList.length > 1) {
    meta.otonaselect_series_names = seriesList.map((s) => s.name).join("|");
  }

  const og = input.safeOgImageUrl?.trim() ?? "";
  if (og && isSafeOgImageUrl(og)) {
    meta[WP_SEO_META_KEYS.safeOgImage] = og;
  } else if (og) {
    notes.push("safeOgImageUrl_rejected_adult_or_invalid_host");
  }

  const card = input.cardImageUrl?.trim() ?? "";
  if (card) {
    try {
      const host = new URL(card).hostname.toLowerCase();
      const trusted =
        host === "pics.dmm.co.jp" ||
        host === "awsimgsrc.dmm.co.jp" ||
        host.endsWith(".dmm.co.jp") ||
        host === "otonaselect.net" ||
        host.endsWith(".otonaselect.net");
      if (trusted) {
        meta[WP_SEO_META_KEYS.cardImage] = card;
      } else {
        notes.push("cardImageUrl_rejected_untrusted_host");
      }
    } catch {
      notes.push("cardImageUrl_rejected_invalid");
    }
  }

  return {
    siteOrigin: origin,
    excerpt,
    meta,
    performers,
    series,
    seriesList,
    categories,
    tags,
    productCanonicalId,
    notes,
  };
}

/**
 * Shape for WordPress REST post create/update body (meta + term names for later resolution).
 */
export function toWordPressRestSeoFields(attach: WordPressSeoAttach): {
  excerpt: string;
  meta: Record<string, string>;
  seoTaxonomyHints: {
    performers: WordPressSeoAttach["performers"];
    series: WordPressSeoAttach["series"];
    seriesList: WordPressSeoAttach["seriesList"];
    categories: string[];
    tags: string[];
  };
} {
  return {
    excerpt: attach.excerpt,
    meta: attach.meta,
    seoTaxonomyHints: {
      performers: attach.performers,
      series: attach.series,
      seriesList: attach.seriesList,
      categories: attach.categories,
      tags: attach.tags,
    },
  };
}
