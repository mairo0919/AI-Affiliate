import { canonicalizeArticlePatternUrl } from "./canonical-url.js";

export type DiscoveryHitKind = "ARTICLE_CANDIDATE" | "DISCOVERY_SEED" | "REJECT";

export type ClassifiedDiscoveryHit = {
  url: string;
  title?: string;
  domain: string;
  canonicalUrl: string;
  kind: DiscoveryHitKind;
  /** Article observe priority (higher first). Seeds use seedScore. */
  score: number;
  seedScore: number;
  rejectReason?: string;
  penalties: string[];
  positives: string[];
};

const OFFTOPIC_HOST_RE =
  /(^|\.)(wikipedia\.org|wikimedia\.org|bookmeter\.com|fujisan\.co\.jp|amazon\.co\.jp|amazon\.com|rakuten\.co\.jp|xvideos\.com|xhamster\.com|pornhub\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com|youtube\.com|youtu\.be|reddit\.com|nicovideo\.jp|togetter\.com|mechacomic\.jp|dmm\.co\.jp|video\.dmm\.co\.jp|faleno\.jp|s1\.co\.jp|moodyz\.com|prestige-av\.com|sod\.co\.jp)\.?$/i;

const SNS_HOST_RE =
  /(^|\.)(twitter|x|facebook|instagram|tiktok|youtube|youtu\.be|reddit)\./i;

const SERVICE_INTENT_RE =
  /FANZA\s*TV|ファンザ\s*TV|月額|料金プラン|登録方法|解約|クーポン|使い方ガイド|動画配信サービス|サブスク|subscription|サービス比較|おすすめサイト|比較サイト|サイト比較/i;

const SEED_POSITIVE_RE =
  /AV\s*レビュー|作品レビュー|FANZA\s*作品|女優レビュー|アダルト.*レビュー|レビューサイト|感想|見どころ|review/i;

const SEED_NEGATIVE_RE =
  /shop|wiki|news|新聞|サービス比較|subscription|月額|料金|EC|通販|forum|掲示板|SNS|登録方法|解約/i;

const LISTING_PATH_RE =
  /\/(tag|tags|category|categories|search|hashtag|ranking|archive|archives|index|list|lists|best-?\d+|page\/\d+)(\/|$)/i;

const PRODUCT_CODE_RE =
  /\b[a-z]{2,6}-?\d{2,4}\b|\bh_\d{3,}[a-z0-9]+|\bssis[-_]?\d+|\bmidv[-_]?\d+|\bsoe[-_]?\d+|\bstars[-_]?\d+/i;

const ARTICLE_SLUG_RE =
  /entry[-_]?\d+|\/n\/[a-z0-9]+|\/(article|articles|post|posts|review|reviews|blog)\/|\/\d{4}\/\d{2}\/|\/media\/\d+/i;

const HUB_PATH_RE =
  /\/(review|reviews|av-review|fanza|actress|archive|archives|category\/.*review)(\/|$)/i;

/**
 * Classify a Brave/search hit for NEW_RELEASE_SINGLE:
 * ARTICLE_CANDIDATE | DISCOVERY_SEED | REJECT
 */
export function classifyNewReleaseSingleHit(input: {
  url: string;
  title?: string | null;
  domainsWithA?: Set<string>;
  domainObserveCounts?: Map<string, number>;
}): ClassifiedDiscoveryHit {
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
    return base(input.url, title, "unknown", input.url, "REJECT", -100, 0, "invalid_url");
  }

  if (SNS_HOST_RE.test(domain)) {
    return base(input.url, title, domain, canonicalUrl, "REJECT", -60, 0, "sns_or_video_host");
  }
  if (OFFTOPIC_HOST_RE.test(domain)) {
    return base(input.url, title, domain, canonicalUrl, "REJECT", -80, 0, "offtopic_host");
  }
  if (SERVICE_INTENT_RE.test(title) || SERVICE_INTENT_RE.test(input.url)) {
    return base(input.url, title, domain, canonicalUrl, "REJECT", -50, 0, "service_intent_hard_reject");
  }

  const pathDepth = pathname.split("/").filter(Boolean).length;
  const isRoot = pathname === "/" || pathname === "";
  const seedQuality = scoreSeedQuality({ title, url: input.url, domain, pathname, isRoot });

  // Individual article signals
  const articlePositives: string[] = [];
  let articleScore = 0;
  if (/レビュー|感想/.test(title)) {
    articleScore += 14;
    articlePositives.push("review_or_impression");
  }
  if (/作品|単品|一本|新作/.test(title)) {
    articleScore += 12;
    articlePositives.push("work_level_word");
  }
  if (/見どころ|出演/.test(title)) {
    articleScore += 10;
    articlePositives.push("highlight_or_cast");
  }
  if (/女優/.test(title) && /作品|レビュー|感想/.test(title)) {
    articleScore += 8;
    articlePositives.push("actress_work_review");
  }
  if (PRODUCT_CODE_RE.test(blob)) {
    articleScore += 18;
    articlePositives.push("product_code_like");
  }
  if (ARTICLE_SLUG_RE.test(pathname)) {
    articleScore += 14;
    articlePositives.push("article_slug");
  }
  if (pathDepth >= 2) {
    articleScore += 8;
    articlePositives.push("article_like_path");
  }
  if (pathDepth >= 3) {
    articleScore += 4;
    articlePositives.push("deep_article_path");
  }

  const looksLikeArticle =
    articlePositives.includes("article_slug") ||
    articlePositives.includes("product_code_like") ||
    (pathDepth >= 2 &&
      (articlePositives.includes("review_or_impression") ||
        articlePositives.includes("work_level_word")));

  if (looksLikeArticle && !isRoot) {
    if (input.domainsWithA?.has(domain)) articleScore -= 20;
    const obs = input.domainObserveCounts?.get(domain) ?? 0;
    if (obs > 0) articleScore -= obs * 8;
    return {
      url: input.url,
      title: title || undefined,
      domain,
      canonicalUrl,
      kind: "ARTICLE_CANDIDATE",
      score: articleScore,
      seedScore: 0,
      positives: articlePositives,
      penalties: [],
    };
  }

  // Hub / seed paths (including root) when review-site quality is high enough
  const isHubPath =
    isRoot ||
    HUB_PATH_RE.test(pathname) ||
    (LISTING_PATH_RE.test(pathname) && SEED_POSITIVE_RE.test(blob));

  if (isHubPath && seedQuality.score >= 12) {
    return {
      url: input.url,
      title: title || undefined,
      domain,
      canonicalUrl,
      kind: "DISCOVERY_SEED",
      score: 0,
      seedScore: seedQuality.score,
      positives: seedQuality.positives,
      penalties: seedQuality.penalties,
    };
  }

  if (isRoot || pathDepth < 2) {
    return base(
      input.url,
      title,
      domain,
      canonicalUrl,
      "REJECT",
      -70,
      seedQuality.score,
      "root_or_shallow_path",
      ["site_root"],
    );
  }

  if (LISTING_PATH_RE.test(pathname)) {
    return base(
      input.url,
      title,
      domain,
      canonicalUrl,
      "REJECT",
      -40,
      seedQuality.score,
      "listing_or_ranking_path",
      ["listing_path"],
    );
  }

  // Fallback weak article candidate
  if (articleScore >= 10) {
    return {
      url: input.url,
      title: title || undefined,
      domain,
      canonicalUrl,
      kind: "ARTICLE_CANDIDATE",
      score: articleScore,
      seedScore: 0,
      positives: articlePositives,
      penalties: [],
    };
  }

  return base(input.url, title, domain, canonicalUrl, "REJECT", -20, 0, "low_article_signal");
}

export function scoreSeedQuality(input: {
  title: string;
  url: string;
  domain: string;
  pathname: string;
  isRoot: boolean;
}): { score: number; positives: string[]; penalties: string[] } {
  const positives: string[] = [];
  const penalties: string[] = [];
  let score = 0;
  const blob = `${input.title} ${input.url} ${input.domain}`;

  if (SEED_POSITIVE_RE.test(blob)) {
    score += 16;
    positives.push("review_site_language");
  }
  if (/レビュー/.test(input.domain) || /review/.test(input.domain)) {
    score += 10;
    positives.push("review_domain");
  }
  if (/av[-_]?|adult|ero|fanza/i.test(input.domain)) {
    score += 6;
    positives.push("adult_domain_hint");
  }
  if (HUB_PATH_RE.test(input.pathname)) {
    score += 8;
    positives.push("hub_path");
  }
  if (input.isRoot && SEED_POSITIVE_RE.test(input.title)) {
    score += 6;
    positives.push("review_root_title");
  }

  if (SEED_NEGATIVE_RE.test(blob)) {
    score -= 20;
    penalties.push("seed_negative_language");
  }
  if (/wiki|amazon|bookmeter|fujisan/i.test(blob)) {
    score -= 30;
    penalties.push("offtopic_seed_language");
  }

  return { score, positives, penalties };
}

function base(
  url: string,
  title: string,
  domain: string,
  canonicalUrl: string,
  kind: DiscoveryHitKind,
  score: number,
  seedScore: number,
  rejectReason?: string,
  penalties: string[] = [],
): ClassifiedDiscoveryHit {
  return {
    url,
    title: title || undefined,
    domain,
    canonicalUrl,
    kind,
    score,
    seedScore,
    rejectReason,
    penalties,
    positives: [],
  };
}

export function classifyAndPartitionHits(
  hits: Array<{ url: string; title?: string }>,
  options?: {
    domainsWithA?: Set<string>;
    domainObserveCounts?: Map<string, number>;
  },
): {
  articles: ClassifiedDiscoveryHit[];
  seeds: ClassifiedDiscoveryHit[];
  rejected: ClassifiedDiscoveryHit[];
} {
  const articles: ClassifiedDiscoveryHit[] = [];
  const seeds: ClassifiedDiscoveryHit[] = [];
  const rejected: ClassifiedDiscoveryHit[] = [];
  for (const h of hits) {
    const c = classifyNewReleaseSingleHit({
      url: h.url,
      title: h.title,
      domainsWithA: options?.domainsWithA,
      domainObserveCounts: options?.domainObserveCounts,
    });
    if (c.kind === "ARTICLE_CANDIDATE") articles.push(c);
    else if (c.kind === "DISCOVERY_SEED") seeds.push(c);
    else rejected.push(c);
  }
  articles.sort((a, b) => b.score - a.score);
  seeds.sort((a, b) => b.seedScore - a.seedScore);
  return { articles, seeds, rejected };
}

export function tallyClassifiedRejects(rejected: ClassifiedDiscoveryHit[]): {
  rootOrShallowPathRejected: number;
  offTopicHostRejected: number;
  listingOrRankingRejected: number;
  otherHardRejected: number;
  seedRejectedCount: number;
} {
  let rootOrShallowPathRejected = 0;
  let offTopicHostRejected = 0;
  let listingOrRankingRejected = 0;
  let otherHardRejected = 0;
  for (const h of rejected) {
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
    seedRejectedCount: rejected.length,
  };
}
