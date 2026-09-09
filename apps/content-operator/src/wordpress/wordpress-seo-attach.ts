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
  seriesName?: string | null;
  seriesAscii?: string | null;
  categories?: string[] | null;
  tags?: string[] | null;
  productCanonicalId?: string | null;
  /** Only pass when confirmed X_SOCIAL_SAFE / site-owned. Never FANZA sample CDN. */
  safeOgImageUrl?: string | null;
  siteOrigin?: string | null;
};

export type WordPressSeoAttach = {
  siteOrigin: string;
  excerpt: string;
  meta: Record<string, string>;
  performers: Array<{ name: string; ascii: string | null; stableSlug: string }>;
  series: { name: string; ascii: string | null; stableSlug: string } | null;
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
  prefix: "p" | "s",
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

  const seriesName = input.seriesName?.trim() || null;
  const series = seriesName
    ? {
        name: seriesName,
        ascii: input.seriesAscii?.trim() || null,
        stableSlug: stableTermSlug(seriesName, "s", input.seriesAscii),
      }
    : null;

  const categories = [...new Set((input.categories ?? []).map((c) => c.trim()).filter(Boolean))];
  const tags = [...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))];

  let productCanonicalId: string | null = null;
  const cid = input.productCanonicalId?.trim().toLowerCase() ?? "";
  if (/^[a-z][a-z0-9]{2,31}$/.test(cid) && !cid.includes("-")) {
    productCanonicalId = cid;
  } else if (cid) {
    notes.push("productCanonicalId_rejected_not_fanza_like");
  }

  const meta: Record<string, string> = {
    [WP_SEO_META_KEYS.seoTitle]: seoTitle,
    [WP_SEO_META_KEYS.seoDescription]: excerpt,
  };
  if (productCanonicalId) meta[WP_SEO_META_KEYS.productCid] = productCanonicalId;
  if (seriesName) meta[WP_SEO_META_KEYS.seriesName] = seriesName;

  const og = input.safeOgImageUrl?.trim() ?? "";
  if (og && isSafeOgImageUrl(og)) {
    meta[WP_SEO_META_KEYS.safeOgImage] = og;
  } else if (og) {
    notes.push("safeOgImageUrl_rejected_adult_or_invalid_host");
  }

  return {
    siteOrigin: origin,
    excerpt,
    meta,
    performers,
    series,
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
      categories: attach.categories,
      tags: attach.tags,
    },
  };
}
