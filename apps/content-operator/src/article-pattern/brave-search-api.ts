import type { AppConfig } from "@ai-affiliate/config";
import { assertSafeOutboundUrl } from "@ai-affiliate/shared";
import type {
  ArticlePatternSearchAdapter,
  ArticlePatternSearchDiagnostic,
  ArticlePatternSearchHit,
} from "./source-search.js";

const BRAVE_WEB_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

export type BraveSearchApiAdapterOptions = {
  apiKey: string;
  timeoutMs?: number;
  /** Japan-focused defaults for NEW_RELEASE_SINGLE discovery */
  country?: string;
  searchLang?: string;
  /** off = do not strip adult/FANZA-related results */
  safesearch?: "off" | "moderate" | "strict";
  /** Test-only fetch injection */
  fetchImpl?: typeof fetch;
};

/**
 * Official Brave Search Web API adapter.
 * Returns URL/title only — never persists snippets to Observation/DB.
 */
export class BraveSearchApiAdapter implements ArticlePatternSearchAdapter {
  readonly providerKey = "brave-search-api";

  constructor(private readonly options: BraveSearchApiAdapterOptions) {}

  async search(input: { query: string; limit: number }): Promise<ArticlePatternSearchHit[]> {
    const { hits } = await this.searchWithDiagnostics(input);
    return hits;
  }

  async searchWithDiagnostics(input: {
    query: string;
    limit: number;
  }): Promise<{ hits: ArticlePatternSearchHit[]; diagnostic: ArticlePatternSearchDiagnostic }> {
    const apiKey = this.options.apiKey?.trim();
    if (!apiKey) {
      return {
        hits: [],
        diagnostic: baseDiagnostic(input.query, this.providerKey, {
          fetched: false,
          errorCode: "missing_api_key",
          errorMessage: "ARTICLE_PATTERN_SEARCH_API_KEY is required for brave provider",
        }),
      };
    }

    const count = Math.max(1, Math.min(20, input.limit));
    const params = new URLSearchParams({
      q: input.query,
      count: String(count),
      country: this.options.country ?? "JP",
      search_lang: this.options.searchLang ?? "ja",
      safesearch: this.options.safesearch ?? "off",
      spellcheck: "1",
    });
    const url = `${BRAVE_WEB_SEARCH_URL}?${params.toString()}`;
    assertSafeOutboundUrl(url);

    const timeoutMs = this.options.timeoutMs ?? 15_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const fetchImpl = this.options.fetchImpl ?? fetch;

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
        signal: controller.signal,
        redirect: "manual",
      });

      const bytesHeader = response.headers.get("content-length");
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0] ?? null;

      if (response.status === 401 || response.status === 403) {
        return {
          hits: [],
          diagnostic: baseDiagnostic(input.query, this.providerKey, {
            fetched: true,
            status: response.status,
            finalUrl: url,
            contentType,
            bytes: bytesHeader ? Number(bytesHeader) : null,
            errorCode: response.status === 401 ? "unauthorized" : "forbidden",
            errorMessage: `Brave Search API returned ${response.status}`,
          }),
        };
      }
      if (response.status === 429) {
        return {
          hits: [],
          diagnostic: baseDiagnostic(input.query, this.providerKey, {
            fetched: true,
            status: 429,
            finalUrl: url,
            contentType,
            bytes: bytesHeader ? Number(bytesHeader) : null,
            errorCode: "rate_limited",
            errorMessage: "Brave Search API rate limited (429)",
          }),
        };
      }
      if (response.status >= 500) {
        return {
          hits: [],
          diagnostic: baseDiagnostic(input.query, this.providerKey, {
            fetched: true,
            status: response.status,
            finalUrl: url,
            contentType,
            bytes: bytesHeader ? Number(bytesHeader) : null,
            errorCode: "upstream_5xx",
            errorMessage: `Brave Search API returned ${response.status}`,
          }),
        };
      }
      if (!response.ok) {
        return {
          hits: [],
          diagnostic: baseDiagnostic(input.query, this.providerKey, {
            fetched: true,
            status: response.status,
            finalUrl: url,
            contentType,
            bytes: bytesHeader ? Number(bytesHeader) : null,
            errorCode: "http_error",
            errorMessage: `Brave Search API returned ${response.status}`,
          }),
        };
      }

      const rawText = await response.text();
      const bytes = Buffer.byteLength(rawText, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText) as unknown;
      } catch {
        return {
          hits: [],
          diagnostic: baseDiagnostic(input.query, this.providerKey, {
            fetched: true,
            status: response.status,
            finalUrl: url,
            contentType,
            bytes,
            errorCode: "malformed_json",
            errorMessage: "Brave Search API returned non-JSON body",
          }),
        };
      }

      const hits = parseBraveWebSearchHits(parsed).slice(0, count);
      return {
        hits,
        diagnostic: baseDiagnostic(input.query, this.providerKey, {
          fetched: true,
          status: response.status,
          finalUrl: url,
          contentType,
          bytes,
          parsedHitCount: hits.length,
          errorCode: hits.length === 0 ? "empty_results" : null,
          errorMessage: hits.length === 0 ? "Brave Search API returned zero web results" : null,
        }),
      };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        hits: [],
        diagnostic: baseDiagnostic(input.query, this.providerKey, {
          fetched: false,
          errorCode: aborted ? "timeout" : "fetch_failed",
          errorMessage: error instanceof Error ? error.message.slice(0, 200) : "fetch failed",
        }),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function parseBraveWebSearchHits(payload: unknown): ArticlePatternSearchHit[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const web = (payload as { web?: unknown }).web;
  if (!web || typeof web !== "object" || Array.isArray(web)) return [];
  const results = (web as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const hits: ArticlePatternSearchHit[] = [];
  const seen = new Set<string>();
  for (const row of results) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const url = typeof (row as { url?: unknown }).url === "string" ? (row as { url: string }).url : "";
    if (!/^https?:\/\//i.test(url)) continue;
    const normalized = url.split("#")[0] ?? url;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const title =
      typeof (row as { title?: unknown }).title === "string"
        ? (row as { title: string }).title.slice(0, 200)
        : undefined;
    // Intentionally ignore description/extra_snippets — never persist to Observation.
    hits.push({ url: normalized, title });
  }
  return hits;
}

function baseDiagnostic(
  query: string,
  provider: string,
  partial: Partial<ArticlePatternSearchDiagnostic>,
): ArticlePatternSearchDiagnostic {
  return {
    query,
    provider,
    fetched: false,
    status: null,
    finalUrl: null,
    contentType: null,
    bytes: null,
    parsedHitCount: 0,
    challengeDetected: false,
    challengeKind: null,
    errorCode: null,
    errorMessage: null,
    ...partial,
  };
}

export function createBraveSearchApiAdapterFromConfig(
  config: AppConfig,
  overrides?: { fetchImpl?: typeof fetch },
): BraveSearchApiAdapter {
  return new BraveSearchApiAdapter({
    apiKey: config.articlePatternSearchApiKey ?? "",
    timeoutMs: config.articlePatternSearchTimeoutMs,
    country: "JP",
    searchLang: "ja",
    safesearch: "off",
    fetchImpl: overrides?.fetchImpl,
  });
}
