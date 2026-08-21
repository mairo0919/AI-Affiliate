import { canonicalizeArticlePatternUrl } from "./canonical-url.js";

export type ScoredDiscoveryHit = {
  url: string;
  title?: string;
  domain: string;
  canonicalUrl: string;
  score: number;
  hardRejected: boolean;
  rejectReason?: string;
  penalties: string[];
  positives: string[];
};

const HARD_REJECT_TITLE_RE =
  /FANZA\s*TV|ファンザ\s*TV|月額|料金プラン|登録方法|解約|クーポン|使い方ガイド|動画配信サービス|サブスク|subscription|サービス比較|おすすめサイト|比較サイト|サイト比較/i;

const HARD_REJECT_PATH_RE =
  /\/(tag|tags|category|categories|search|hashtag|ranking|archive|archives|index|list|lists|best-?\d+)(\/|$)/i;

/** Hosts that are not editorial single-work review sources for NEW_RELEASE_SINGLE. */
const OFFTOPIC_HOST_RE =
  /(^|\.)(wikipedia\.org|wikimedia\.org|bookmeter\.com|fujisan\.co\.jp|amazon\.co\.jp|amazon\.com|rakuten\.co\.jp|xvideos\.com|xhamster\.com|pornhub\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com|youtube\.com|youtu\.be|reddit\.com|nicovideo\.jp|togetter\.com|mechacomic\.jp|dmm\.co\.jp|video\.dmm\.co\.jp|faleno\.jp|s1\.co\.jp|moodyz\.com|prestige-av\.com|sod\.co\.jp)\.?$/i;

const SOFT_NEGATIVE_RE =
  /サービス|評判|口コミまとめ|料金|登録|解約|比較|ランキング|ベスト\s*\d+|月額|使い方|クーポン|subscription|streaming\s*service|おすすめサイト|ポータル/i;

const PRODUCT_CODE_RE =
  /\b[a-z]{2,6}-?\d{2,4}\b|\bh_\d{3,}[a-z0-9]+|\b\d{6}[-_]?[a-z]{2,}\d+|\bssis[-_]?\d+|\bmidv[-_]?\d+|\bsoe[-_]?\d+|\bstars[-_]?\d+/i;

const ARTICLE_SLUG_RE =
  /entry[-_]?\d+|\/n\/[a-z0-9]+|\/(article|articles|post|posts|blog)\/|\/\d{4}\/\d{2}\/|\/media\/\d+/i;

/**
 * Score a search hit for NEW_RELEASE_SINGLE single-AV-work likelihood.
 * Hard reject = do not observe. Soft penalties lower priority only.
 * NEW_RELEASE_SINGLE-specific — does not change other formats.
 */
export function scoreNewReleaseSingleHit(input: {
  url: string;
  title?: string | null;
  domainsWithA?: Set<string>;
  domainObserveCounts?: Map<string, number>;
}): ScoredDiscoveryHit {
  const title = (input.title ?? "").trim();
  const blob = `${title} ${input.url}`;
  let domain = "unknown";
  let canonicalUrl = input.url;
  let pathname = "/";
  try {
    const u = new URL(input.url);
    domain = u.hostname.toLowerCase();
    pathname = u.pathname || "/";
    canonicalUrl = canonicalizeArticlePatternUrl(input.url) ?? input.url;
  } catch {
    return {
      url: input.url,
      title: title || undefined,
      domain: "unknown",
      canonicalUrl: input.url,
      score: -100,
      hardRejected: true,
      rejectReason: "invalid_url",
      penalties: [],
      positives: [],
    };
  }

  const penalties: string[] = [];
  const positives: string[] = [];
  let score = 0;
  const pathSegments = pathname.split("/").filter(Boolean);
  const pathDepth = pathSegments.length;
  const hasArticlePositive =
    ARTICLE_SLUG_RE.test(pathname) ||
    PRODUCT_CODE_RE.test(blob) ||
    /レビュー|感想|見どころ/.test(title);

  if (HARD_REJECT_TITLE_RE.test(title) || HARD_REJECT_TITLE_RE.test(input.url)) {
    return reject(input.url, title, domain, canonicalUrl, -50, "service_intent_hard_reject", [
      "service_intent",
    ]);
  }

  if (/(^|\.)(twitter|x|facebook|instagram|tiktok|youtube|youtu\.be|reddit)\./i.test(domain)) {
    return reject(input.url, title, domain, canonicalUrl, -60, "sns_or_video_host", ["sns_host"]);
  }

  if (OFFTOPIC_HOST_RE.test(domain)) {
    return reject(input.url, title, domain, canonicalUrl, -80, "offtopic_host", ["offtopic_host"]);
  }

  // Root / empty path: never treat portal home as a single-work review
  if (pathname === "/" || pathname === "") {
    return reject(input.url, title, domain, canonicalUrl, -70, "root_or_shallow_path", [
      "site_root",
    ]);
  }

  const pathAndQuery = pathname + (() => {
    try {
      return new URL(input.url).search;
    } catch {
      return "";
    }
  })();
  if (HARD_REJECT_PATH_RE.test(pathAndQuery)) {
    return reject(input.url, title, domain, canonicalUrl, -40, "listing_or_ranking_path", [
      "listing_path",
    ]);
  }

  // Shallow path without article-like positives → hard reject (avoid portal hubs)
  if (pathDepth < 2 && !hasArticlePositive) {
    return reject(input.url, title, domain, canonicalUrl, -55, "root_or_shallow_path", [
      "shallow_path",
    ]);
  }

  // Soft: shallow even with weak positives
  if (pathDepth < 2) {
    score -= 25;
    penalties.push("shallow_path_penalty");
  } else if (pathDepth === 2 && !hasArticlePositive) {
    score -= 12;
    penalties.push("moderate_shallow_path");
  }

  // Soft negatives
  const softHits = blob.match(new RegExp(SOFT_NEGATIVE_RE.source, "gi")) ?? [];
  if (softHits.length) {
    score -= Math.min(25, softHits.length * 6);
    penalties.push("soft_service_or_list_language");
  }
  if (/FANZA\s*TV/i.test(blob)) {
    score -= 30;
    penalties.push("fanza_tv_mention");
  }
  if (/月額|料金|解約|登録方法/i.test(blob)) {
    score -= 18;
    penalties.push("pricing_or_signup");
  }
  if (/レビューサイト|まとめサイト|おすすめAVサイト/i.test(title)) {
    score -= 20;
    penalties.push("generic_portal_title");
  }

  // Positives — work-level article signals
  if (/レビュー|感想/.test(title)) {
    score += 14;
    positives.push("review_or_impression");
  }
  if (/作品|単品|一本|新作/.test(title)) {
    score += 12;
    positives.push("work_level_word");
  }
  if (/見どころ|出演/.test(title)) {
    score += 10;
    positives.push("highlight_or_cast");
  }
  if (/女優/.test(title) && /作品|レビュー|感想/.test(title)) {
    score += 8;
    positives.push("actress_work_review");
  }
  if (PRODUCT_CODE_RE.test(blob)) {
    score += 18;
    positives.push("product_code_like");
  }
  if (ARTICLE_SLUG_RE.test(pathname)) {
    score += 14;
    positives.push("article_slug");
  }
  if (pathDepth >= 2) {
    score += 8;
    positives.push("article_like_path");
  }
  if (pathDepth >= 3) {
    score += 4;
    positives.push("deep_article_path");
  }

  // Domain diversity: deprioritize domains that already have A
  if (input.domainsWithA?.has(domain)) {
    score -= 20;
    penalties.push("domain_already_has_a");
  }
  const observedOnDomain = input.domainObserveCounts?.get(domain) ?? 0;
  if (observedOnDomain > 0) {
    score -= observedOnDomain * 8;
    penalties.push("domain_already_observed_this_run");
  }

  return {
    url: input.url,
    title: title || undefined,
    domain,
    canonicalUrl,
    score,
    hardRejected: false,
    penalties,
    positives,
  };
}

function reject(
  url: string,
  title: string,
  domain: string,
  canonicalUrl: string,
  score: number,
  rejectReason: string,
  penalties: string[],
): ScoredDiscoveryHit {
  return {
    url,
    title: title || undefined,
    domain,
    canonicalUrl,
    score,
    hardRejected: true,
    rejectReason,
    penalties,
    positives: [],
  };
}

export function rankDiscoveryHits(
  hits: Array<{ url: string; title?: string }>,
  options?: {
    domainsWithA?: Set<string>;
    domainObserveCounts?: Map<string, number>;
    minScoreToObserve?: number;
  },
): { ranked: ScoredDiscoveryHit[]; hardRejected: ScoredDiscoveryHit[] } {
  const scored = hits.map((h) =>
    scoreNewReleaseSingleHit({
      url: h.url,
      title: h.title,
      domainsWithA: options?.domainsWithA,
      domainObserveCounts: options?.domainObserveCounts,
    }),
  );
  const hardRejected = scored.filter((s) => s.hardRejected);
  const minScore = options?.minScoreToObserve ?? 0;
  const ranked = scored
    .filter((s) => !s.hardRejected && s.score >= minScore)
    .sort((a, b) => b.score - a.score);
  return { ranked, hardRejected };
}

/** Count hard-reject reasons for diagnostics (NEW_RELEASE_SINGLE). */
export function tallyRejectReasons(hits: ScoredDiscoveryHit[]): {
  rootOrShallowPathRejected: number;
  offTopicHostRejected: number;
  listingOrRankingRejected: number;
  otherHardRejected: number;
} {
  let rootOrShallowPathRejected = 0;
  let offTopicHostRejected = 0;
  let listingOrRankingRejected = 0;
  let otherHardRejected = 0;
  for (const h of hits) {
    if (!h.hardRejected) continue;
    if (h.rejectReason === "root_or_shallow_path") rootOrShallowPathRejected += 1;
    else if (h.rejectReason === "offtopic_host" || h.rejectReason === "sns_or_video_host") {
      offTopicHostRejected += 1;
    } else if (h.rejectReason === "listing_or_ranking_path") listingOrRankingRejected += 1;
    else otherHardRejected += 1;
  }
  return {
    rootOrShallowPathRejected,
    offTopicHostRejected,
    listingOrRankingRejected,
    otherHardRejected,
  };
}
