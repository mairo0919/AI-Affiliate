import { safeFetchText, SafeFetchError, SsrfBlockedError } from "@ai-affiliate/shared";
import type { AppConfig } from "@ai-affiliate/config";

export type ArticlePatternSearchHit = {
  url: string;
  title?: string;
};

/** Per-query search diagnostics — never includes HTML body or snippets. */
export type ArticlePatternSearchDiagnostic = {
  query: string;
  provider: string;
  fetched: boolean;
  status: number | null;
  finalUrl: string | null;
  contentType: string | null;
  bytes: number | null;
  parsedHitCount: number;
  challengeDetected: boolean;
  challengeKind: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export interface ArticlePatternSearchAdapter {
  readonly providerKey: string;
  search(input: { query: string; limit: number }): Promise<ArticlePatternSearchHit[]>;
  /** Optional detailed search with diagnostics (no body stored). */
  searchWithDiagnostics?(input: {
    query: string;
    limit: number;
  }): Promise<{ hits: ArticlePatternSearchHit[]; diagnostic: ArticlePatternSearchDiagnostic }>;
}

/** Test/ops: inject candidate URLs without live search. */
export class MockArticlePatternSearchAdapter implements ArticlePatternSearchAdapter {
  readonly providerKey = "mock-article-pattern-search";
  constructor(private readonly hitsByQuery: Map<string, ArticlePatternSearchHit[]> = new Map()) {}

  setHits(query: string, hits: ArticlePatternSearchHit[]): void {
    this.hitsByQuery.set(query, hits);
  }

  async search(input: { query: string; limit: number }): Promise<ArticlePatternSearchHit[]> {
    const hits = this.hitsByQuery.get(input.query) ?? [...this.hitsByQuery.values()].flat();
    return hits.slice(0, input.limit);
  }

  async searchWithDiagnostics(input: {
    query: string;
    limit: number;
  }): Promise<{ hits: ArticlePatternSearchHit[]; diagnostic: ArticlePatternSearchDiagnostic }> {
    const hits = await this.search(input);
    return {
      hits,
      diagnostic: {
        query: input.query,
        provider: this.providerKey,
        fetched: true,
        status: 200,
        finalUrl: null,
        contentType: "text/html",
        bytes: null,
        parsedHitCount: hits.length,
        challengeDetected: false,
        challengeKind: null,
        errorCode: null,
        errorMessage: null,
      },
    };
  }
}

/**
 * DuckDuckGo HTML search via safeFetchText (no API key).
 * @deprecated Production Source Discovery must use Brave Search API.
 * Kept for development/debug only — bot/anomaly challenges return zero hits.
 * Challenge bypass / scraping continuation is intentionally NOT implemented.
 */
export class DuckDuckGoHtmlSearchAdapter implements ArticlePatternSearchAdapter {
  readonly providerKey = "duckduckgo-html-deprecated";

  constructor(
    private readonly config: AppConfig,
    private readonly options?: { confirmExternal: boolean },
  ) {}

  async search(input: { query: string; limit: number }): Promise<ArticlePatternSearchHit[]> {
    const { hits } = await this.searchWithDiagnostics(input);
    return hits;
  }

  async searchWithDiagnostics(input: {
    query: string;
    limit: number;
  }): Promise<{ hits: ArticlePatternSearchHit[]; diagnostic: ArticlePatternSearchDiagnostic }> {
    if (!this.options?.confirmExternal || !this.config.researchAllowExternalRequests) {
      return {
        hits: [],
        diagnostic: {
          query: input.query,
          provider: this.providerKey,
          fetched: false,
          status: null,
          finalUrl: null,
          contentType: null,
          bytes: null,
          parsedHitCount: 0,
          challengeDetected: false,
          challengeKind: null,
          errorCode: "external_fetch_denied",
          errorMessage:
            "RESEARCH_ALLOW_EXTERNAL_REQUESTS=true and confirm-external required",
        },
      };
    }
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;
    try {
      const fetched = await safeFetchText(url, {
        timeoutMs: this.config.researchFetchTimeoutMs ?? 15_000,
        maxBytes: Math.min(256_000, this.config.researchFetchMaxBytes ?? 512_000),
      });
      const challenge = detectDuckDuckGoChallenge(fetched.text);
      const hits = challenge.detected
        ? []
        : parseDuckDuckGoHtmlResults(fetched.text).slice(0, input.limit);
      return {
        hits,
        diagnostic: {
          query: input.query,
          provider: this.providerKey,
          fetched: true,
          status: fetched.status ?? 200,
          finalUrl: fetched.finalUrl,
          contentType: fetched.contentType,
          bytes: fetched.bytes,
          parsedHitCount: hits.length,
          challengeDetected: challenge.detected,
          challengeKind: challenge.kind,
          errorCode: challenge.detected ? "search_challenge" : null,
          errorMessage: challenge.detected
            ? "DuckDuckGo returned bot/anomaly challenge page (no SERP links)"
            : null,
        },
      };
    } catch (error) {
      const code =
        error instanceof SafeFetchError
          ? error.code
          : error instanceof SsrfBlockedError
            ? "ssrf_blocked"
            : "fetch_failed";
      return {
        hits: [],
        diagnostic: {
          query: input.query,
          provider: this.providerKey,
          fetched: false,
          status: null,
          finalUrl: null,
          contentType: null,
          bytes: null,
          parsedHitCount: 0,
          challengeDetected: false,
          challengeKind: null,
          errorCode: code,
          errorMessage: error instanceof Error ? error.message.slice(0, 200) : "fetch failed",
        },
      };
    }
  }
}

/** Structural detection only — does not return or store page body. */
export function detectDuckDuckGoChallenge(html: string): {
  detected: boolean;
  kind: string | null;
} {
  if (/anomaly-modal|challenge-form|js-anomaly-modal/i.test(html)) {
    return { detected: true, kind: "anomaly_modal" };
  }
  if (/bots use duckduckgo|complete the following challenge/i.test(html)) {
    return { detected: true, kind: "bot_challenge_copy" };
  }
  return { detected: false, kind: null };
}

export function parseDuckDuckGoHtmlResults(html: string): ArticlePatternSearchHit[] {
  const hits: ArticlePatternSearchHit[] = [];
  const seen = new Set<string>();
  // uddg= encoded destination is the common DDG HTML result shape
  for (const m of html.matchAll(/uddg=([^&"]+)/gi)) {
    try {
      const dest = decodeURIComponent(m[1] ?? "");
      if (!/^https?:\/\//i.test(dest)) continue;
      const normalized = dest.split("#")[0] ?? dest;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      hits.push({ url: normalized });
    } catch {
      /* ignore bad encoding */
    }
  }
  // Fallback: result__a href
  if (hits.length === 0) {
    for (const m of html.matchAll(/class="result__a"[^>]*href="([^"]+)"/gi)) {
      const href = m[1] ?? "";
      if (!/^https?:\/\//i.test(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      hits.push({ url: href });
    }
  }
  return hits;
}

const BLOCKED_HOST_RE =
  /(^|\.)(twitter|x|facebook|instagram|tiktok|youtube|youtu\.be|reddit)\./i;
const BLOCKED_PATH_RE =
  /\/(tag|tags|category|categories|search|hashtag)(\/|$)|[?&](s|q|query)=/i;
const PRODUCT_SALES_HOST_RE =
  /(^|\.)(video\.dmm\.co\.jp|www\.dmm\.co\.jp|amazon\.|rakuten\.)/i;

/** URL-only prequalification — no body. */
export function qualifyCandidateUrl(
  rawUrl: string,
  options?: { allowedDomains?: string[]; excludedDomains?: string[] },
): { ok: boolean; reason?: string; domain?: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "non_http" };
  }
  const domain = url.hostname.toLowerCase();
  if (BLOCKED_HOST_RE.test(domain)) return { ok: false, reason: "sns_or_video_host", domain };
  if (PRODUCT_SALES_HOST_RE.test(domain)) return { ok: false, reason: "product_sales_page", domain };
  if (BLOCKED_PATH_RE.test(url.pathname + url.search)) {
    return { ok: false, reason: "listing_or_search_path", domain };
  }
  if (options?.excludedDomains?.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return { ok: false, reason: "excluded_domain", domain };
  }
  if (
    options?.allowedDomains?.length &&
    !options.allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`))
  ) {
    return { ok: false, reason: "domain_not_allowed", domain };
  }
  // Soft avoid obvious ranking URL paths (still may observe if forced)
  if (/best-?\d+|ranking|top-?\d+/i.test(url.pathname)) {
    return { ok: false, reason: "ranking_path", domain };
  }
  return { ok: true, domain };
}

export const DEFAULT_SINGLE_DISCOVERY_QUERIES = [
  'AV 作品 レビュー 感想 品番 -ランキング -比較 -"FANZA TV" -月額 -料金 -サイト',
  'AV 新作 一本 レビュー 感想 -ランキング -ベスト -月額 -サービス -まとめ',
  'アダルトビデオ 作品名 レビュー 感想 -比較 -料金 -登録 -ポータル',
  'AV 見どころ レビュー 感想 作品 -ランキング -月額 -"FANZA TV" -まとめ',
];
