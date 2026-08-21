import type { AppConfig } from "@ai-affiliate/config";
import { BraveSearchApiAdapter, createBraveSearchApiAdapterFromConfig } from "./brave-search-api.js";
import {
  DuckDuckGoHtmlSearchAdapter,
  MockArticlePatternSearchAdapter,
  type ArticlePatternSearchAdapter,
} from "./source-search.js";

/**
 * Resolve production Search adapter for Article Pattern Source Discovery.
 * Default: Brave official API. DDG HTML is deprecated debug-only (no challenge bypass).
 */
export function createArticlePatternSearchAdapter(
  config: AppConfig,
  options?: {
    confirmExternal?: boolean;
    fetchImpl?: typeof fetch;
    forceMock?: boolean;
  },
): ArticlePatternSearchAdapter {
  if (options?.forceMock || config.articlePatternSearchProvider === "mock") {
    return new MockArticlePatternSearchAdapter();
  }

  if (config.articlePatternSearchProvider === "duckduckgo_html_deprecated") {
    // Deprecated: bot/anomaly challenges make this unsuitable for production Discovery.
    // No challenge bypass / scraping continuation is implemented.
    return new DuckDuckGoHtmlSearchAdapter(config, {
      confirmExternal: options?.confirmExternal === true,
    });
  }

  // Default + "brave"
  return createBraveSearchApiAdapterFromConfig(config, { fetchImpl: options?.fetchImpl });
}

export type { BraveSearchApiAdapter };
