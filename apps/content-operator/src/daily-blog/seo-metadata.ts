/**
 * Deterministic SEO / AI-search metadata — no keyword dictionary, no LLM meta rewrite.
 */

export interface SeoMetadataInput {
  title: string;
  lead: string;
  performerNames?: string[];
  makerName?: string | null;
  seriesName?: string | null;
  articleKind?: "PRODUCT" | "RANKING";
  rankingPeriodLabel?: string | null;
  publishedAtIso?: string | null;
  modifiedAtIso?: string | null;
  canonicalUrl?: string | null;
  imageUrls?: string[];
  siteName?: string;
}

export interface ArticleJsonLd {
  "@context": "https://schema.org";
  "@type": "BlogPosting";
  headline: string;
  description: string;
  datePublished?: string;
  dateModified?: string;
  image?: string[];
  mainEntityOfPage?: { "@type": "WebPage"; "@id": string };
  author?: { "@type": "Organization"; name: string };
  publisher?: { "@type": "Organization"; name: string };
}

/** Meta description from lead — truncate naturally, no stuffing. */
export function metaDescriptionFromLead(lead: string, maxLen = 120): string {
  const t = lead.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trim()}…`;
}

export function buildSeoLabels(input: SeoMetadataInput): string[] {
  const labels: string[] = [];
  if (input.articleKind === "RANKING") labels.push("ranking");
  else labels.push("product");
  for (const p of input.performerNames ?? []) {
    const n = p.trim();
    if (n && !labels.includes(n)) labels.push(n);
  }
  if (input.makerName?.trim()) labels.push(input.makerName.trim());
  if (input.seriesName?.trim()) labels.push(input.seriesName.trim());
  return labels.slice(0, 12);
}

/**
 * Article/BlogPosting JSON-LD only — never invent Product offers/ratings.
 * Caller must skip if theme already injects equivalent markup.
 */
export function buildBlogPostingJsonLd(input: SeoMetadataInput): ArticleJsonLd {
  const description = metaDescriptionFromLead(input.lead);
  const site = input.siteName?.trim() || "Blog";
  const ld: ArticleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.title.trim(),
    description,
    author: { "@type": "Organization", name: site },
    publisher: { "@type": "Organization", name: site },
  };
  if (input.publishedAtIso) ld.datePublished = input.publishedAtIso;
  if (input.modifiedAtIso || input.publishedAtIso) {
    ld.dateModified = input.modifiedAtIso ?? input.publishedAtIso!;
  }
  if (input.imageUrls?.length) ld.image = input.imageUrls.slice(0, 11);
  if (input.canonicalUrl) {
    ld.mainEntityOfPage = { "@type": "WebPage", "@id": input.canonicalUrl };
  }
  return ld;
}

export function renderJsonLdScript(ld: ArticleJsonLd): string {
  return `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
}

export function appendJsonLdIfEnabled(
  html: string,
  ld: ArticleJsonLd | null,
  enabled: boolean,
): string {
  if (!enabled || !ld) return html;
  // Avoid duplicate BlogPosting if already present
  if (/application\/ld\+json/i.test(html) && /BlogPosting|Article/i.test(html)) {
    return html;
  }
  return `${html}\n${renderJsonLdScript(ld)}`;
}
