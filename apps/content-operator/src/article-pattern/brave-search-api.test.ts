import { describe, expect, it, vi } from "vitest";
import {
  BraveSearchApiAdapter,
  parseBraveWebSearchHits,
} from "./brave-search-api.js";
import { createArticlePatternSearchAdapter } from "./search-adapter-factory.js";
import { loadConfig } from "@ai-affiliate/config";
import { ArticlePatternSourceDiscoveryService } from "./source-discovery.js";
import { ArticlePatternService } from "./article-pattern-service.js";
import type { ArticleStructureObservation } from "@ai-affiliate/database";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "content-length": "100" },
  });
}

function bravePayload(results: Array<{ url: string; title?: string; description?: string }>) {
  return {
    web: {
      results: results.map((r) => ({
        url: r.url,
        title: r.title ?? "t",
        description: r.description ?? "long snippet that must never be stored",
      })),
    },
  };
}

describe("BraveSearchApiAdapter (HTTP mock — no real API)", () => {
  it("returns url/title only and ignores description", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        bravePayload([
          {
            url: "https://note.com/example/n/abc",
            title: "単品レビュー",
            description: "SECRET_SNIPPET_SHOULD_NOT_APPEAR",
          },
          { url: "https://note.com/example/n/abc#frag", title: "dup" },
        ]),
      ),
    );
    const adapter = new BraveSearchApiAdapter({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const { hits, diagnostic } = await adapter.searchWithDiagnostics({
      query: "FANZA 単品 レビュー",
      limit: 10,
    });
    expect(hits).toEqual([{ url: "https://note.com/example/n/abc", title: "単品レビュー" }]);
    expect(JSON.stringify(hits)).not.toContain("SECRET_SNIPPET");
    expect(diagnostic.provider).toBe("brave-search-api");
    expect(diagnostic.parsedHitCount).toBe(1);
    expect(diagnostic.errorCode).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("api.search.brave.com/res/v1/web/search");
    expect(String(url)).toContain("safesearch=off");
    expect(String(url)).toContain("country=JP");
    expect(String(url)).toContain("search_lang=ja");
    expect((init as RequestInit).headers).toMatchObject({
      "X-Subscription-Token": "test-key",
    });
  });

  it("missing api key → empty hits + missing_api_key", async () => {
    const fetchImpl = vi.fn();
    const adapter = new BraveSearchApiAdapter({
      apiKey: "",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const { hits, diagnostic } = await adapter.searchWithDiagnostics({
      query: "q",
      limit: 5,
    });
    expect(hits).toEqual([]);
    expect(diagnostic.errorCode).toBe("missing_api_key");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("401 unauthorized", async () => {
    const adapter = new BraveSearchApiAdapter({
      apiKey: "bad",
      fetchImpl: (async () => jsonResponse({ error: "unauthorized" }, 401)) as typeof fetch,
    });
    const { diagnostic } = await adapter.searchWithDiagnostics({ query: "q", limit: 5 });
    expect(diagnostic.errorCode).toBe("unauthorized");
    expect(diagnostic.status).toBe(401);
  });

  it("403 forbidden", async () => {
    const adapter = new BraveSearchApiAdapter({
      apiKey: "bad",
      fetchImpl: (async () => jsonResponse({}, 403)) as typeof fetch,
    });
    const { diagnostic } = await adapter.searchWithDiagnostics({ query: "q", limit: 5 });
    expect(diagnostic.errorCode).toBe("forbidden");
  });

  it("429 rate limited", async () => {
    const adapter = new BraveSearchApiAdapter({
      apiKey: "k",
      fetchImpl: (async () => jsonResponse({}, 429)) as typeof fetch,
    });
    const { diagnostic } = await adapter.searchWithDiagnostics({ query: "q", limit: 5 });
    expect(diagnostic.errorCode).toBe("rate_limited");
  });

  it("5xx upstream", async () => {
    const adapter = new BraveSearchApiAdapter({
      apiKey: "k",
      fetchImpl: (async () => jsonResponse({}, 503)) as typeof fetch,
    });
    const { diagnostic } = await adapter.searchWithDiagnostics({ query: "q", limit: 5 });
    expect(diagnostic.errorCode).toBe("upstream_5xx");
    expect(diagnostic.status).toBe(503);
  });

  it("empty results", async () => {
    const adapter = new BraveSearchApiAdapter({
      apiKey: "k",
      fetchImpl: (async () => jsonResponse(bravePayload([]))) as typeof fetch,
    });
    const { hits, diagnostic } = await adapter.searchWithDiagnostics({ query: "q", limit: 5 });
    expect(hits).toEqual([]);
    expect(diagnostic.errorCode).toBe("empty_results");
  });

  it("malformed json", async () => {
    const adapter = new BraveSearchApiAdapter({
      apiKey: "k",
      fetchImpl: (async () =>
        new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as typeof fetch,
    });
    const { diagnostic } = await adapter.searchWithDiagnostics({ query: "q", limit: 5 });
    expect(diagnostic.errorCode).toBe("malformed_json");
  });

  it("parseBraveWebSearchHits rejects malformed shapes", () => {
    expect(parseBraveWebSearchHits(null)).toEqual([]);
    expect(parseBraveWebSearchHits({})).toEqual([]);
    expect(parseBraveWebSearchHits({ web: { results: "x" } })).toEqual([]);
    expect(parseBraveWebSearchHits({ web: { results: [{ url: "ftp://x" }] } })).toEqual([]);
  });
});

describe("createArticlePatternSearchAdapter", () => {
  it("defaults to Brave adapter", () => {
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternSearchProvider: "brave" as const,
      articlePatternSearchApiKey: "k",
    };
    const adapter = createArticlePatternSearchAdapter(config);
    expect(adapter.providerKey).toBe("brave-search-api");
  });

  it("mock provider", () => {
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternSearchProvider: "mock" as const,
    };
    expect(createArticlePatternSearchAdapter(config).providerKey).toBe(
      "mock-article-pattern-search",
    );
  });

  it("deprecated DDG provider key", () => {
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternSearchProvider: "duckduckgo_html_deprecated" as const,
    };
    expect(createArticlePatternSearchAdapter(config).providerKey).toBe(
      "duckduckgo-html-deprecated",
    );
  });
});

describe("Discovery with Brave mock — no aggregate path", () => {
  it("URL dedupe + no body/snippet persistence via search hits", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        bravePayload([
          { url: "https://a.example.test/articles/1", title: "AV 作品レビュー 感想", description: "BODY_SNIPPET" },
          { url: "https://a.example.test/articles/1", title: "dup" },
          { url: "https://b.example.test/articles/2", title: "AV 作品レビュー 見どころ" },
        ]),
      ),
    );
    const search = new BraveSearchApiAdapter({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const observedUrls: string[] = [];
    const fakePatterns = {
      listLiveObservations: vi.fn(async () => []),
      observeFromUrl: vi.fn(async (input: { sourceUrl: string }) => {
        observedUrls.push(input.sourceUrl);
        const obs = {
          id: `obs-${observedUrls.length}`,
          sourceUrl: input.sourceUrl,
          sourceDomain: new URL(input.sourceUrl).hostname,
          contentHash: `hash-${input.sourceUrl}`,
          metadata: {
            learningSuitability: {
              classification: "A",
              score: 0.9,
              reasons: ["test"],
              signals: {},
            },
          },
        } as unknown as ArticleStructureObservation;
        return obs;
      }),
      aggregate: vi.fn(),
      approve: vi.fn(),
      activate: vi.fn(),
    };

    const discovery = new ArticlePatternSourceDiscoveryService(
      fakePatterns as unknown as ArticlePatternService,
      search,
    );
    const config = loadConfig({ requireDatabaseUrl: false });
    const result = await discovery.discoverForNewReleaseSingle({
      config,
      confirmExternal: true,
      targetA: 2,
      minDomains: 2,
      maxPerDomain: 1,
      queries: ["FANZA 単品"],
      mockHtmlByUrl: new Map([
        ["https://a.example.test/articles/1", "<html><body>a</body></html>"],
        ["https://b.example.test/articles/2", "<html><body>b</body></html>"],
      ]),
      existingObservations: [],
    });

    expect(result.searchDiagnostics[0]?.provider).toBe("brave-search-api");
    expect(result.searchDiagnostics[0]?.parsedHitCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain("BODY_SNIPPET");
    expect(fakePatterns.aggregate).not.toHaveBeenCalled();
    expect(fakePatterns.approve).not.toHaveBeenCalled();
    expect(fakePatterns.activate).not.toHaveBeenCalled();
    expect(result.aggregated).toBe(false);
    expect(result.generated).toBe(false);
  });
});
