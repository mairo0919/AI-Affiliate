/**
 * Normalize public HTML into research fields.
 * Never invent missing fields — omit / null only.
 * Caller must NOT persist the raw HTML permanently.
 */

export type PublicPageType =
  | "product"
  | "official"
  | "article"
  | "ranking"
  | "unknown";

export interface NormalizedPublicPage {
  title: string | null;
  productOrTopicName: string | null;
  sourceUrl: string;
  canonicalUrl: string | null;
  sourceDomain: string;
  pageType: PublicPageType;
  publicDescriptionSummary: string | null;
  performerOrCreator: string | null;
  makerOrPublisher: string | null;
  series: string | null;
  genre: string[] | null;
  releaseInformation: string | null;
  publiclyConfirmedPrice: string | null;
  availability: string | null;
  imageReferences: string[];
  observedAt: string;
  /** Short normalized text for SourceDocument (not full HTML) */
  normalizedText: string;
  /** Candidate related public URLs discovered on-page (bounded) */
  relatedPublicUrls: string[];
}

const MAX_RELATED = 5;
const MAX_SUMMARY = 600;
const MAX_NORMALIZED = 4_000;

export function normalizePublicHtml(input: {
  html: string;
  sourceUrl: string;
  finalUrl?: string;
  observedAt?: Date;
}): NormalizedPublicPage {
  const sourceUrl = input.finalUrl ?? input.sourceUrl;
  let domain = "unknown";
  try {
    domain = new URL(sourceUrl).hostname;
  } catch {
    /* keep unknown */
  }

  const title = extractTag(input.html, "title") ?? extractOg(input.html, "og:title");
  const description =
    extractMetaName(input.html, "description") ?? extractOg(input.html, "og:description");
  const canonical = extractCanonical(input.html, sourceUrl);
  const text = stripHtml(input.html);
  const summary = description
    ? truncate(description, MAX_SUMMARY)
    : truncate(text.replace(/\s+/g, " ").trim(), MAX_SUMMARY) || null;

  const productOrTopicName = title ? cleanTitle(title) : null;
  const pageType = inferPageType(sourceUrl, title, text);
  const maker = extractLabeled(text, ["メーカー", "レーベル", "publisher", "maker"]);
  const series = extractLabeled(text, ["シリーズ", "series"]);
  const performer = extractLabeled(text, ["出演者", "キャスト", "performer", "creator"]);
  const release = extractLabeled(text, ["配信開始日", "発売日", "release", "公開日"]);
  const price = extractPrice(text);
  const availability = extractAvailability(text);
  const genre = extractGenres(text);
  const images = extractImages(input.html, sourceUrl).slice(0, 8);
  const related = extractRelatedUrls(input.html, sourceUrl).slice(0, MAX_RELATED);

  const normalizedLines = [
    productOrTopicName ? `name: ${productOrTopicName}` : null,
    summary ? `summary: ${summary}` : null,
    maker ? `maker: ${maker}` : null,
    series ? `series: ${series}` : null,
    performer ? `performer: ${performer}` : null,
    release ? `release: ${release}` : null,
    price ? `price: ${price}` : null,
    availability ? `availability: ${availability}` : null,
    genre?.length ? `genre: ${genre.join(", ")}` : null,
    `source: ${sourceUrl}`,
    canonical ? `canonical: ${canonical}` : null,
    `domain: ${domain}`,
    `pageType: ${pageType}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title,
    productOrTopicName,
    sourceUrl,
    canonicalUrl: canonical,
    sourceDomain: domain,
    pageType,
    publicDescriptionSummary: summary,
    performerOrCreator: performer,
    makerOrPublisher: maker,
    series,
    genre,
    releaseInformation: release,
    publiclyConfirmedPrice: price,
    availability,
    imageReferences: images,
    observedAt: (input.observedAt ?? new Date()).toISOString(),
    normalizedText: truncate(normalizedLines, MAX_NORMALIZED),
    relatedPublicUrls: related,
  };
}

/** Build SUPPORTED claim statements only from observed fields (no invention). */
export function claimsFromNormalizedPage(page: NormalizedPublicPage): Array<{
  statement: string;
  status: "SUPPORTED";
  field: string;
}> {
  const out: Array<{ statement: string; status: "SUPPORTED"; field: string }> = [];
  if (page.productOrTopicName) {
    out.push({
      field: "name",
      status: "SUPPORTED",
      statement: `${page.productOrTopicName} は公開ページ上で確認できる。`,
    });
  }
  if (page.makerOrPublisher) {
    out.push({
      field: "maker",
      status: "SUPPORTED",
      statement: `メーカー／レーベルとして「${page.makerOrPublisher}」が公開されている。`,
    });
  }
  if (page.series) {
    out.push({
      field: "series",
      status: "SUPPORTED",
      statement: `シリーズ情報として「${page.series}」が公開されている。`,
    });
  }
  if (page.releaseInformation) {
    out.push({
      field: "release",
      status: "SUPPORTED",
      statement: `公開されている発売／配信情報: ${page.releaseInformation}`,
    });
  }
  if (page.publiclyConfirmedPrice) {
    out.push({
      field: "price",
      status: "SUPPORTED",
      statement: `公開価格として ${page.publiclyConfirmedPrice} が確認できる。`,
    });
  }
  if (page.availability) {
    out.push({
      field: "availability",
      status: "SUPPORTED",
      statement: `販売／配信状態として「${page.availability}」が公開されている。`,
    });
  }
  if (page.performerOrCreator) {
    out.push({
      field: "performer",
      status: "SUPPORTED",
      statement: `出演者／クリエイターとして「${page.performerOrCreator}」が記載されている。`,
    });
  }
  return out;
}

function extractTag(html: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i").exec(html);
  return m?.[1] ? decodeEntities(m[1].trim()) : null;
}

function extractOg(html: string, prop: string): string | null {
  const m = new RegExp(
    `<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    "i",
  ).exec(html);
  if (m?.[1]) return decodeEntities(m[1].trim());
  const m2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`,
    "i",
  ).exec(html);
  return m2?.[1] ? decodeEntities(m2[1].trim()) : null;
}

function extractMetaName(html: string, name: string): string | null {
  const m = new RegExp(
    `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,
    "i",
  ).exec(html);
  return m?.[1] ? decodeEntities(m[1].trim()) : null;
}

function extractCanonical(html: string, base: string): string | null {
  const m = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html);
  if (!m?.[1]) return null;
  try {
    return new URL(m[1], base).toString();
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(title: string): string {
  return title.replace(/\s*[|\-–].*$/, "").trim() || title.trim();
}

function inferPageType(url: string, title: string | null, text: string): PublicPageType {
  const u = url.toLowerCase();
  if (/cid=|\/product|\/detail|fanza|dmm\.co\.jp/.test(u)) return "product";
  if (/ranking|rank/.test(u) || /ランキング/.test(text)) return "ranking";
  if (/official|maker|label/.test(u)) return "official";
  if (title && /レビュー|まとめ|解説/.test(title)) return "article";
  return "unknown";
}

function extractLabeled(text: string, labels: string[]): string | null {
  const stop = "メーカー|レーベル|シリーズ|出演者|キャスト|ジャンル|価格|配信開始日|発売日|販売|配信|publisher|maker|series|performer|genre|price|release";
  for (const label of labels) {
    const m = new RegExp(
      `${label}\\s*[:：]\\s*([\\w\\u3040-\\u30ff\\u3400-\\u9fff][\\w\\u3040-\\u30ff\\u3400-\\u9fff\\s\\-]{0,60}?)(?=\\s*(?:${stop})\\s*[:：]|\\s*$|[|])`,
      "i",
    ).exec(text);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractPrice(text: string): string | null {
  const m = /(?:価格|price)\s*[:：]?\s*((?:¥|円)?\s*[\d,]+(?:\s*円)?)/i.exec(text);
  return m?.[1]?.trim() ?? null;
}

function extractAvailability(text: string): string | null {
  if (/販売中|配信中|available/i.test(text)) return "AVAILABLE";
  if (/販売終了|配信終了|unavailable/i.test(text)) return "UNAVAILABLE";
  return null;
}

function extractGenres(text: string): string[] | null {
  const m = /(?:ジャンル|genre)\s*[:：]\s*([^\n]{2,120})/i.exec(text);
  if (!m?.[1]) return null;
  const parts = m[1]
    .split(/[,、/|]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 40)
    .slice(0, 12);
  return parts.length > 0 ? parts : null;
}

function extractImages(html: string, base: string): string[] {
  const urls: string[] = [];
  const og = extractOg(html, "og:image");
  if (og) {
    try {
      urls.push(new URL(og, base).toString());
    } catch {
      /* skip */
    }
  }
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1]!, base);
      if (u.protocol === "http:" || u.protocol === "https:") urls.push(u.toString());
    } catch {
      /* skip */
    }
    if (urls.length >= 8) break;
  }
  return [...new Set(urls)];
}

function extractRelatedUrls(html: string, base: string): string[] {
  const out: string[] = [];
  let baseHost = "";
  try {
    baseHost = new URL(base).hostname;
  } catch {
    return [];
  }
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1]!, base);
      if (u.hostname !== baseHost) continue;
      if (!/^https?:$/.test(u.protocol)) continue;
      if (u.toString() === base) continue;
      out.push(u.toString());
    } catch {
      /* skip */
    }
    if (out.length >= MAX_RELATED) break;
  }
  return [...new Set(out)];
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
