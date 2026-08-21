import { canonicalizeArticlePatternUrl } from "./canonical-url.js";
import { classifyNewReleaseSingleHit } from "./discovery-classify.js";

const EXCLUDE_PATH_RE =
  /\/(tag|tags|category|categories|search|hashtag|ranking|archive|archives|index|list|lists|best-?\d+|page\/\d+|profile|contact|about|privacy|login|tou|terms|affiliate|disclosure|feed|rss|sitemap)(\/|$)/i;

const POSITIVE_LINK_RE =
  /\/(review|reviews|entry|article|articles|post|posts|blog)\//i;

const PRODUCT_CODE_RE =
  /\b[a-z]{2,6}-?\d{2,4}\b|\bh_\d{3,}[a-z0-9]+|\bssis[-_]?\d+|\bmidv[-_]?\d+|entry[-_]?\d+/i;

export type ExtractedSeedLink = {
  url: string;
  canonicalUrl: string;
  domain: string;
  score: number;
  positives: string[];
};

/**
 * Extract same-domain individual article candidates from a seed page HTML.
 * Depth-1 only — does not follow links further.
 */
export function extractIndividualArticleLinksFromSeedHtml(input: {
  html: string;
  seedUrl: string;
  limit?: number;
}): ExtractedSeedLink[] {
  let seedHost = "";
  let base: URL;
  try {
    base = new URL(input.seedUrl);
    seedHost = base.hostname.toLowerCase();
  } catch {
    return [];
  }

  const hrefs = new Set<string>();
  for (const m of input.html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const raw = (m[1] ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("javascript:")) continue;
    let abs: URL;
    try {
      abs = new URL(raw, base);
    } catch {
      continue;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    if (abs.hostname.toLowerCase() !== seedHost) continue;
    const canonical = canonicalizeArticlePatternUrl(abs.toString());
    if (!canonical) continue;
    hrefs.add(canonical);
  }

  const scored: ExtractedSeedLink[] = [];
  for (const url of hrefs) {
    let pathname = "/";
    try {
      pathname = new URL(url).pathname || "/";
    } catch {
      continue;
    }
    if (pathname === "/" || pathname === "") continue;
    if (EXCLUDE_PATH_RE.test(pathname)) continue;

    // Must look like an individual article, not another hub
    const classified = classifyNewReleaseSingleHit({
      url,
      title: pathname,
    });
    if (classified.kind === "REJECT" && classified.rejectReason === "listing_or_ranking_path") {
      continue;
    }
    if (classified.kind === "DISCOVERY_SEED") continue; // no recursive hubs

    const positives: string[] = [];
    let score = 0;
    if (POSITIVE_LINK_RE.test(pathname)) {
      score += 12;
      positives.push("review_or_article_path");
    }
    if (PRODUCT_CODE_RE.test(pathname)) {
      score += 16;
      positives.push("product_or_entry_id");
    }
    if (/\/\d{4}\/\d{2}\//.test(pathname)) {
      score += 10;
      positives.push("date_path");
    }
    if (/\/n\/[a-z0-9]+/i.test(pathname)) {
      score += 12;
      positives.push("note_like_slug");
    }
    if (/レビュー|感想|見どころ|review/i.test(pathname)) {
      score += 8;
      positives.push("review_slug_token");
    }
    const depth = pathname.split("/").filter(Boolean).length;
    if (depth >= 2) {
      score += 6;
      positives.push("deep_path");
    }
    if (depth < 2 && positives.length === 0) continue;
    if (score < 8 && classified.kind !== "ARTICLE_CANDIDATE") continue;

    if (classified.kind === "ARTICLE_CANDIDATE") {
      score = Math.max(score, classified.score);
      positives.push(...classified.positives);
    }

    scored.push({
      url,
      canonicalUrl: url,
      domain: seedHost,
      score,
      positives: [...new Set(positives)],
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const limit = Math.max(1, input.limit ?? 10);
  return scored.slice(0, limit);
}
