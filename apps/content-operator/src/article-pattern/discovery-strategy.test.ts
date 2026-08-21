import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import type { ArticleStructureObservation } from "@ai-affiliate/database";
import {
  classifyNewReleaseSingleHit,
  classifyAndPartitionHits,
} from "./discovery-classify.js";
import { extractIndividualArticleLinksFromSeedHtml } from "./discovery-seed-links.js";
import {
  rankDiscoveryHits,
  scoreNewReleaseSingleHit,
} from "./discovery-hit-scoring.js";
import {
  listNewReleaseSingleQueries,
  NEW_RELEASE_SINGLE_QUERY_STRATEGY,
} from "./discovery-query-strategy.js";
import { ArticlePatternSourceDiscoveryService, collectEligibleAForDiscoveryGoal } from "./source-discovery.js";
import { MockArticlePatternSearchAdapter } from "./source-search.js";
import type { ArticlePatternService } from "./article-pattern-service.js";
import { canonicalizeArticlePatternUrl } from "./canonical-url.js";
import { ARTICLE_SCOPE_VERSION } from "./article-content-scope.js";
import { INFORMATION_DENSITY_VERSION } from "./information-density.js";

function makeObs(input: {
  id: string;
  url: string;
  domain: string;
  classification?: "A" | "B" | "C";
  contentHash?: string;
  observedAt?: Date;
  /** When false, omit analysisVersions (outdated). Default true = current SSOT. */
  currentAnalysis?: boolean;
  densityVersion?: string;
}): ArticleStructureObservation {
  const classification = input.classification ?? "A";
  const currentAnalysis = input.currentAnalysis !== false;
  const densityVersion = input.densityVersion ?? INFORMATION_DENSITY_VERSION;
  const metadata: Record<string, unknown> = {
    sourceKind: "live_url",
    learningSuitability: {
      classification,
      score: classification === "A" ? 0.7 : 0.4,
      reasons: ["fixture"],
      targetFormatKey: "NEW_RELEASE_SINGLE",
    },
  };
  if (currentAnalysis) {
    metadata.articleScope = {
      selectorKind: "article",
      scopeVersion: ARTICLE_SCOPE_VERSION,
      fallbackUsed: false,
      confidence: 0.9,
    };
    metadata.analysisVersions = {
      articleScope: ARTICLE_SCOPE_VERSION,
      structure: "structure_v1",
      writing: "writing_v1",
      informationDensity: densityVersion,
    };
    metadata.densityDiagnostics = {
      version: densityVersion,
      densityScore: 1.5,
      bucket: "medium",
    };
  }
  return {
    id: input.id,
    sourceUrl: input.url,
    sourceDomain: input.domain,
    contentHash: input.contentHash ?? `hash-${input.id}`,
    articleTypeHint: "single_review",
    features: {
      estimatedProductCount: 1,
      writingFeatures: {
        benefitFramingUsed: true,
        audienceFramingUsed: true,
        descriptionRecommendationRatio: 0.5,
        informationDensityBucket: "medium",
        introPurpose: "selection_frame",
        productDifferentiationStyle: "criteria_based",
        sectionPurposeSequence: ["intro_hook", "selection_criteria", "cta"],
        introHookType: "direct_recommendation",
        catalogStyleLevel: "balanced",
        repetitionRateBucket: "low",
        factOpinionRatio: 0.4,
      },
    },
    confidence: 0.8,
    observedAt: input.observedAt ?? new Date("2026-08-01T00:00:00Z"),
    createdAt: input.observedAt ?? new Date("2026-08-01T00:00:00Z"),
    sourceDocumentId: null,
    metadata,
  } as unknown as ArticleStructureObservation;
}

const makeAObs = makeObs;

function fakePatterns(observeImpl?: (url: string) => Promise<ArticleStructureObservation>) {
  return {
    listLiveObservations: vi.fn(async () => [] as ArticleStructureObservation[]),
    observeFromUrl: vi.fn(async (input: { sourceUrl: string; title?: string | null }) => {
      if (observeImpl) return observeImpl(input.sourceUrl);
      const domain = new URL(input.sourceUrl).hostname;
      return makeAObs({
        id: `obs-${input.sourceUrl}`,
        url: input.sourceUrl,
        domain,
      });
    }),
    aggregate: vi.fn(),
    approve: vi.fn(),
    activate: vi.fn(),
  } as unknown as ArticlePatternService;
}

describe("NEW_RELEASE_SINGLE query strategy", () => {
  it("exposes adaptive rounds without service-review FANZA TV intent as primary", () => {
    expect(NEW_RELEASE_SINGLE_QUERY_STRATEGY.length).toBeGreaterThanOrEqual(3);
    const flat = listNewReleaseSingleQueries().flatQueries.join(" ");
    expect(flat).toMatch(/作品/);
    expect(flat).toMatch(/レビュー|感想/);
    expect(flat).toMatch(/-"FANZA TV"|-月額|-料金/);
    expect(flat).toContain("-site:note.com");
    expect(flat.split(/\s+/).includes("site:note.com")).toBe(false);
    expect(flat).toMatch(/品番|一本|見どころ/);
  });

  it("respects maxQueries / maxRounds", () => {
    const limited = listNewReleaseSingleQueries({ maxRounds: 1, maxQueries: 2 });
    expect(limited.rounds).toHaveLength(1);
    expect(limited.flatQueries.length).toBeLessThanOrEqual(2);
  });
});

describe("hit scoring (NEW_RELEASE_SINGLE)", () => {
  it("hard-rejects FANZA TV / pricing service articles", () => {
    const tv = scoreNewReleaseSingleHit({
      url: "https://blog.example.test/guides/fanza-tv",
      title: "FANZA TV の月額料金と登録方法",
    });
    expect(tv.hardRejected).toBe(true);
    expect(tv.rejectReason).toBe("service_intent_hard_reject");
  });

  it("legacy scorer still hard-rejects portal root (observe path uses classify)", () => {
    const root = scoreNewReleaseSingleHit({
      url: "https://av-review-navi.com/",
      title: "AVレビューサイト おすすめ",
    });
    expect(root.hardRejected).toBe(true);
    expect(root.rejectReason).toBe("root_or_shallow_path");
  });

  it("F: category/tag/ranking listing rejected", () => {
    const tag = scoreNewReleaseSingleHit({
      url: "https://list.example.test/tag/av",
      title: "AV タグ一覧",
    });
    expect(tag.hardRejected).toBe(true);
    expect(tag.rejectReason).toBe("listing_or_ranking_path");
  });

  it("G/H: deep article URL with product code is kept and scored high", () => {
    const single = scoreNewReleaseSingleHit({
      url: "https://note.com/user/n/abc123",
      title: "SSIS-001 作品レビュー 見どころと感想",
    });
    expect(single.hardRejected).toBe(false);
    expect(single.positives).toEqual(
      expect.arrayContaining(["product_code_like", "article_slug", "review_or_impression"]),
    );
    expect(single.score).toBeGreaterThan(30);
  });

  it("rejects offtopic hosts (wikipedia/bookmeter/fujisan/xvideos)", () => {
    for (const url of [
      "https://ja.wikipedia.org/wiki/FANZA",
      "https://bookmeter.com/books/123",
      "https://www.fujisan.co.jp/product/205/",
      "https://www.xvideos.com/video/123",
    ]) {
      const s = scoreNewReleaseSingleHit({ url, title: "AV 作品レビュー 感想" });
      expect(s.hardRejected).toBe(true);
      expect(["offtopic_host", "sns_or_video_host"]).toContain(s.rejectReason);
    }
  });

  it("ranks single AV review above portal root", () => {
    const { ranked, hardRejected } = rankDiscoveryHits([
      {
        url: "https://avreview24.com/",
        title: "AVレビュー",
      },
      {
        url: "https://review.example.test/entry-123",
        title: "AV 作品レビュー 感想 見どころ MIDV-100",
      },
      {
        url: "https://list.example.test/tag/av",
        title: "AV タグ一覧",
      },
    ]);
    expect(hardRejected.some((h) => h.rejectReason === "root_or_shallow_path")).toBe(true);
    expect(hardRejected.some((h) => h.rejectReason === "listing_or_ranking_path")).toBe(true);
    expect(ranked[0]?.url).toContain("review.example.test");
  });

  it("deprioritizes domains that already have A", () => {
    const withNote = scoreNewReleaseSingleHit({
      url: "https://note.com/x/n/1",
      title: "AV 作品レビュー 感想",
      domainsWithA: new Set(["note.com"]),
    });
    const other = scoreNewReleaseSingleHit({
      url: "https://ameblo.jp/x/entry-1.html",
      title: "AV 作品レビュー 感想",
      domainsWithA: new Set(["note.com"]),
    });
    expect(other.score).toBeGreaterThan(withNote.score);
  });
});

describe("Hub / Seed classification", () => {
  it("review site root → DISCOVERY_SEED", () => {
    const c = classifyNewReleaseSingleHit({
      url: "https://av-review-navi.example.test/",
      title: "AVレビュー 作品レビュー一覧",
    });
    expect(c.kind).toBe("DISCOVERY_SEED");
    expect(c.seedScore).toBeGreaterThanOrEqual(12);
  });

  it("Wikipedia root → REJECT", () => {
    const c = classifyNewReleaseSingleHit({
      url: "https://ja.wikipedia.org/",
      title: "Wikipedia",
    });
    expect(c.kind).toBe("REJECT");
    expect(c.rejectReason).toBe("offtopic_host");
  });

  it("EC root → REJECT", () => {
    const c = classifyNewReleaseSingleHit({
      url: "https://www.amazon.co.jp/",
      title: "Amazon",
    });
    expect(c.kind).toBe("REJECT");
    expect(c.rejectReason).toBe("offtopic_host");
  });

  it("individual review article → ARTICLE_CANDIDATE", () => {
    const c = classifyNewReleaseSingleHit({
      url: "https://blog.example.test/review/ssis-001",
      title: "SSIS-001 作品レビュー 感想",
    });
    expect(c.kind).toBe("ARTICLE_CANDIDATE");
  });

  it("partitions SERP into articles / seeds / rejected", () => {
    const { articles, seeds, rejected } = classifyAndPartitionHits([
      { url: "https://wiki.wikipedia.org/wiki/x", title: "wiki" },
      { url: "https://hub.avreview.example.test/", title: "AVレビューサイト" },
      {
        url: "https://hub.avreview.example.test/review/midv-100",
        title: "MIDV-100 作品レビュー",
      },
    ]);
    expect(rejected.some((r) => r.rejectReason === "offtopic_host")).toBe(true);
    expect(seeds.some((s) => s.kind === "DISCOVERY_SEED")).toBe(true);
    expect(articles.some((a) => a.url.includes("/review/"))).toBe(true);
  });
});

describe("seed link extraction", () => {
  const seedUrl = "https://hub.avreview.example.test/";
  const html = `
    <html><body>
      <a href="/review/ssis-001-感想">SSIS</a>
      <a href="/reviews/midv-100">MIDV</a>
      <a href="/category/av">cat</a>
      <a href="/tag/actress">tag</a>
      <a href="/archive/2024">archive</a>
      <a href="https://other.example.test/review/x">external</a>
      <a href="/">root</a>
      <a href="/about">about</a>
      <a href="/entry-42">entry</a>
    </body></html>
  `;

  it("extracts same-domain individual review URLs only", () => {
    const links = extractIndividualArticleLinksFromSeedHtml({
      html,
      seedUrl,
      limit: 10,
    });
    const urls = links.map((l) => l.url);
    expect(urls.some((u) => u.includes("/review/ssis-001"))).toBe(true);
    expect(urls.some((u) => u.includes("/reviews/midv-100"))).toBe(true);
    expect(urls.some((u) => u.includes("entry-42"))).toBe(true);
    expect(urls.every((u) => u.includes("hub.avreview.example.test"))).toBe(true);
    expect(urls.some((u) => u.includes("other.example.test"))).toBe(false);
    expect(urls.some((u) => u.includes("/category/"))).toBe(false);
    expect(urls.some((u) => u.includes("/tag/"))).toBe(false);
    expect(urls.some((u) => u.includes("/archive/"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/") && new URL(u).pathname === "/")).toBe(false);
  });
});

describe("pre-observe canonical URL dedupe", () => {
  it("A/B: existing B/C and A URLs are not fetched/LLM/observed again", async () => {
    const existing = [
      makeObs({
        id: "ex-a",
        url: "https://note.com/u/n/aaa",
        domain: "note.com",
        classification: "A",
      }),
      makeObs({
        id: "ex-b",
        url: "https://hub.example.test/articles/old-b",
        domain: "hub.example.test",
        classification: "B",
        contentHash: "hash-old-b",
      }),
    ];
    const search = new MockArticlePatternSearchAdapter();
    search.setHits("q", [
      { url: "https://note.com/u/n/aaa?utm_source=x", title: "AV 作品レビュー 感想 SSIS-001" },
      {
        url: "https://hub.example.test/articles/old-b#frag",
        title: "AV 作品レビュー 感想 MIDV-100",
      },
      {
        url: "https://fresh.example.test/entry-999",
        title: "AV 作品レビュー 感想 見どころ STARS-10",
      },
    ]);
    const patterns = fakePatterns(async (url) =>
      makeAObs({ id: "new", url, domain: new URL(url).hostname }),
    );
    const discovery = new ArticlePatternSourceDiscoveryService(patterns, search);
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternDiscoveryMaxSearchRequests: 3,
      articlePatternDiscoveryMaxSearchRounds: 1,
      articlePatternDiscoveryMaxQueries: 1,
    };
    const result = await discovery.discoverForNewReleaseSingle({
      config,
      confirmExternal: true,
      targetA: 5,
      minDomains: 3,
      queries: ["q"],
      existingObservations: existing,
      mockHtmlByUrl: new Map([
        ["https://fresh.example.test/entry-999", "<article><p>x</p></article>"],
      ]),
    });

    expect(result.pipeline.existingObservationUrlSkipped).toBeGreaterThanOrEqual(2);
    expect(result.candidates.filter((c) => c.reason === "existing_observation_url").length).toBe(2);
    expect(patterns.observeFromUrl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(patterns.observeFromUrl).mock.calls[0]![0].sourceUrl).toContain(
      "fresh.example.test",
    );
  });

  it("C: unknown URLs can still be observed", async () => {
    const search = new MockArticlePatternSearchAdapter();
    search.setHits("q", [
      {
        url: "https://newblog.example.test/entry-42",
        title: "AV 作品レビュー 感想 SSIS-200",
      },
    ]);
    const patterns = fakePatterns();
    const discovery = new ArticlePatternSourceDiscoveryService(patterns, search);
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternDiscoveryMaxSearchRequests: 2,
      articlePatternDiscoveryMaxQueries: 1,
      articlePatternDiscoveryMaxSearchRounds: 1,
    };
    const result = await discovery.discoverForNewReleaseSingle({
      config,
      confirmExternal: true,
      queries: ["q"],
      existingObservations: [],
      targetA: 5,
      minDomains: 3,
    });
    expect(result.pipeline.observedCount).toBe(1);
    expect(patterns.observeFromUrl).toHaveBeenCalled();
  });

  it("D: unknown URL with same contentHash as existing is contentHash-deduped after observe", async () => {
    const existing = [
      makeObs({
        id: "ex1",
        url: "https://a.example.test/entry-1",
        domain: "a.example.test",
        classification: "B",
        contentHash: "shared-hash-xyz",
      }),
    ];
    const search = new MockArticlePatternSearchAdapter();
    search.setHits("q", [
      {
        url: "https://b.example.test/entry-2",
        title: "AV 作品レビュー 感想 MIDV-9",
      },
    ]);
    const patterns = fakePatterns(async (url) =>
      makeObs({
        id: "dup-new",
        url,
        domain: new URL(url).hostname,
        classification: "C",
        contentHash: "shared-hash-xyz",
      }),
    );
    const discovery = new ArticlePatternSourceDiscoveryService(patterns, search);
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternDiscoveryMaxSearchRequests: 2,
      articlePatternDiscoveryMaxQueries: 1,
      articlePatternDiscoveryMaxSearchRounds: 1,
    };
    const result = await discovery.discoverForNewReleaseSingle({
      config,
      confirmExternal: true,
      queries: ["q"],
      existingObservations: existing,
      targetA: 5,
      minDomains: 3,
    });
    expect(patterns.observeFromUrl).toHaveBeenCalledTimes(1);
    expect(result.pipeline.duplicateContentHashSkipped).toBe(1);
    expect(result.candidates.some((c) => c.reason === "duplicate_content_hash")).toBe(true);
    expect(result.pipeline.observedCount).toBe(0);
  });
});

describe("site drill-down (hub → individual article)", () => {
  it("seed is not Observation / Writing LLM; individual articles are observed", async () => {
    const search = new MockArticlePatternSearchAdapter();
    search.setHits("q", [
      {
        url: "https://avhub.example.test/",
        title: "AVレビュー 作品レビュー一覧",
      },
    ]);
    const patterns = fakePatterns(async (url) =>
      makeAObs({ id: `obs-${url}`, url, domain: new URL(url).hostname }),
    );
    const discovery = new ArticlePatternSourceDiscoveryService(patterns, search);
    const seedHtml = `
      <a href="/review/ssis-001">a</a>
      <a href="/review/midv-100">b</a>
      <a href="/category/av">skip</a>
      <a href="https://evil.example.test/review/x">ext</a>
    `;
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternDiscoveryMaxSearchRequests: 2,
      articlePatternDiscoveryMaxQueries: 1,
      articlePatternDiscoveryMaxSearchRounds: 1,
      articlePatternDiscoveryMaxSeeds: 5,
      articlePatternDiscoveryMaxLinksPerSeed: 10,
      articlePatternDiscoveryMaxDrilldownFetches: 15,
    };
    const result = await discovery.discoverForNewReleaseSingle({
      config,
      confirmExternal: true,
      queries: ["q"],
      existingObservations: [],
      targetA: 5,
      minDomains: 3,
      mockHtmlByUrl: new Map([
        ["https://avhub.example.test/", seedHtml],
        ["https://avhub.example.test/review/ssis-001", "<article>a</article>"],
        ["https://avhub.example.test/review/midv-100", "<article>b</article>"],
      ]),
    });

    expect(result.candidates.some((c) => c.reason === "discovery_seed")).toBe(true);
    expect(result.pipeline.seedAcceptedCount).toBeGreaterThanOrEqual(1);
    expect(result.pipeline.seedFetchCount).toBe(1);
    expect(result.pipeline.drilldownCandidateCount).toBeGreaterThanOrEqual(2);
    expect(result.pipeline.drilldownFetchCount).toBeGreaterThanOrEqual(2);
    expect(result.pipeline.individualArticleObservedCount).toBeGreaterThanOrEqual(2);
    expect(result.pipeline.searchRequestCount).toBe(1);
    expect(result.pipeline.estimatedSearchCostYen).toBe(
      Number(((1 / 1000) * (config.articlePatternDiscoveryYenPer1kSearches ?? 750)).toFixed(4)),
    );
    // Seed URL itself never observed
    const observedUrls = vi.mocked(patterns.observeFromUrl).mock.calls.map((c) => c[0].sourceUrl);
    expect(observedUrls.every((u) => !u.endsWith("avhub.example.test/") && u !== "https://avhub.example.test")).toBe(
      true,
    );
    expect(observedUrls.some((u) => u.includes("/review/"))).toBe(true);
    expect(patterns.aggregate).not.toHaveBeenCalled();
    expect(patterns.approve).not.toHaveBeenCalled();
    expect(patterns.activate).not.toHaveBeenCalled();
  });

  it("existing Observation URL from drilldown is skipped without observe", async () => {
    const existing = [
      makeObs({
        id: "known",
        url: "https://avhub.example.test/review/ssis-001",
        domain: "avhub.example.test",
        classification: "B",
      }),
    ];
    const search = new MockArticlePatternSearchAdapter();
    search.setHits("q", [
      { url: "https://avhub.example.test/", title: "AVレビュー 作品レビュー" },
    ]);
    const patterns = fakePatterns();
    const discovery = new ArticlePatternSourceDiscoveryService(patterns, search);
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternDiscoveryMaxSearchRequests: 2,
      articlePatternDiscoveryMaxQueries: 1,
      articlePatternDiscoveryMaxSearchRounds: 1,
    };
    const result = await discovery.discoverForNewReleaseSingle({
      config,
      confirmExternal: true,
      queries: ["q"],
      existingObservations: existing,
      targetA: 5,
      minDomains: 3,
      mockHtmlByUrl: new Map([
        [
          "https://avhub.example.test/",
          `<a href="/review/ssis-001">a</a><a href="/review/new-only">b</a>`,
        ],
        ["https://avhub.example.test/review/new-only", "<article>n</article>"],
      ]),
    });
    expect(result.pipeline.existingObservationUrlSkipped).toBeGreaterThanOrEqual(1);
    expect(patterns.observeFromUrl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(patterns.observeFromUrl).mock.calls[0]![0].sourceUrl).toContain("new-only");
  });

  it("respects maxSeeds / maxLinksPerSeed / maxDrilldownFetches", async () => {
    const search = new MockArticlePatternSearchAdapter();
    search.setHits("q", [
      { url: "https://hub1.example.test/", title: "AVレビュー 作品レビュー" },
      { url: "https://hub2.example.test/", title: "AVレビュー 作品レビュー" },
      { url: "https://hub3.example.test/", title: "AVレビュー 作品レビュー" },
    ]);
    const patterns = fakePatterns();
    const discovery = new ArticlePatternSourceDiscoveryService(patterns, search);
    const manyLinks = Array.from({ length: 20 }, (_, i) =>
      `<a href="/review/item-${i}">r${i}</a>`,
    ).join("\n");
    const mockHtmlByUrl = new Map<string, string>([
      ["https://hub1.example.test/", manyLinks],
      ["https://hub2.example.test/", manyLinks],
      ["https://hub3.example.test/", manyLinks],
    ]);
    for (let i = 0; i < 20; i++) {
      mockHtmlByUrl.set(`https://hub1.example.test/review/item-${i}`, `<article>${i}</article>`);
      mockHtmlByUrl.set(`https://hub2.example.test/review/item-${i}`, `<article>${i}</article>`);
      mockHtmlByUrl.set(`https://hub3.example.test/review/item-${i}`, `<article>${i}</article>`);
    }
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternDiscoveryMaxSearchRequests: 2,
      articlePatternDiscoveryMaxQueries: 1,
      articlePatternDiscoveryMaxSearchRounds: 1,
      articlePatternDiscoveryMaxSeeds: 2,
      articlePatternDiscoveryMaxLinksPerSeed: 3,
      articlePatternDiscoveryMaxDrilldownFetches: 4,
    };
    const result = await discovery.discoverForNewReleaseSingle({
      config,
      confirmExternal: true,
      queries: ["q"],
      existingObservations: [],
      targetA: 50,
      minDomains: 20,
      mockHtmlByUrl,
    });
    expect(result.pipeline.seedFetchCount).toBeLessThanOrEqual(2);
    expect(result.pipeline.drilldownFetchCount).toBeLessThanOrEqual(4);
    expect(result.pipeline.maxSeeds).toBe(2);
    expect(result.pipeline.maxLinksPerSeed).toBe(3);
    expect(result.pipeline.maxDrilldownFetches).toBe(4);
    expect(result.pipeline.stopReason).toBe("max_drilldown_fetches");
  });

  it("stops on goalMet during drilldown; depth stays 1 (no recursive seed observe)", async () => {
    const existing = [
      makeAObs({ id: "ex1", url: "https://a.example.test/entry-1", domain: "a.example.test" }),
      makeAObs({ id: "ex2", url: "https://b.example.test/entry-1", domain: "b.example.test" }),
    ];
    const search = new MockArticlePatternSearchAdapter();
    search.setHits("q", [
      { url: "https://thirdhub.example.test/", title: "AVレビュー 作品レビュー" },
    ]);
    const patterns = fakePatterns(async (url) =>
      makeAObs({ id: `new-${url}`, url, domain: new URL(url).hostname }),
    );
    const discovery = new ArticlePatternSourceDiscoveryService(patterns, search);
    // Nested hub link must not be followed as another seed recurse
    const seedHtml = `
      <a href="/review/work-1">w1</a>
      <a href="/">nested-root</a>
      <a href="/category/review">nested-hub</a>
    `;
    const result = await discovery.discoverForNewReleaseSingle({
      config: {
        ...loadConfig({ requireDatabaseUrl: false }),
        articlePatternDiscoveryMaxSearchRequests: 2,
        articlePatternDiscoveryMaxQueries: 1,
        articlePatternDiscoveryMaxSearchRounds: 1,
      },
      confirmExternal: true,
      queries: ["q"],
      existingObservations: existing,
      targetA: 3,
      minDomains: 3,
      mockHtmlByUrl: new Map([
        ["https://thirdhub.example.test/", seedHtml],
        ["https://thirdhub.example.test/review/work-1", "<article>w</article>"],
      ]),
    });
    expect(result.goalMet).toBe(true);
    expect(result.totalEligibleADomains.length).toBeGreaterThanOrEqual(3);
    expect(result.pipeline.individualArticleObservedCount).toBe(1);
    // Only the individual article — never nested hubs as observe targets
    const observed = vi.mocked(patterns.observeFromUrl).mock.calls.map((c) => c[0].sourceUrl);
    expect(observed).toEqual(["https://thirdhub.example.test/review/work-1"]);
    expect(patterns.aggregate).not.toHaveBeenCalled();
  });
});

describe("adaptive discovery guards (unchanged limits)", () => {
  it("stops when maxSearchRequests is hit", async () => {
    const search = new MockArticlePatternSearchAdapter();
    const patterns = fakePatterns();
    const discovery = new ArticlePatternSourceDiscoveryService(patterns, search);
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternDiscoveryMaxSearchRequests: 2,
      articlePatternDiscoveryMaxSearchRounds: 4,
      articlePatternDiscoveryMaxQueries: 12,
      articlePatternDiscoveryMaxObservedUrls: 30,
    };
    const result = await discovery.discoverForNewReleaseSingle({
      config,
      confirmExternal: true,
      targetA: 5,
      minDomains: 3,
      existingObservations: [],
    });
    expect(result.pipeline.searchRequestCount).toBe(2);
    expect(result.pipeline.stopReason).toBe("max_search_requests");
    expect(patterns.aggregate).not.toHaveBeenCalled();
  });

  it("goalMet uses existing A + newly discovered A after canonical dedupe", async () => {
    const existing = [
      makeAObs({ id: "ex1", url: "https://a.example.test/entry-1", domain: "a.example.test" }),
      makeAObs({ id: "ex2", url: "https://b.example.test/entry-1", domain: "b.example.test" }),
    ];
    const search = new MockArticlePatternSearchAdapter();
    search.setHits("q", [
      {
        url: "https://c.example.test/entry-1",
        title: "AV 作品レビュー 感想 見どころ SSIS-1",
      },
    ]);
    const patterns = fakePatterns(async (url) =>
      makeAObs({ id: "new1", url, domain: new URL(url).hostname }),
    );
    const discovery = new ArticlePatternSourceDiscoveryService(patterns, search);
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternDiscoveryMaxSearchRequests: 3,
      articlePatternDiscoveryMaxSearchRounds: 1,
      articlePatternDiscoveryMaxQueries: 1,
      articlePatternDiscoveryMaxObservedUrls: 5,
    };
    const result = await discovery.discoverForNewReleaseSingle({
      config,
      confirmExternal: true,
      targetA: 3,
      minDomains: 3,
      queries: ["q"],
      existingObservations: existing,
      mockHtmlByUrl: new Map([
        ["https://c.example.test/entry-1", "<article><p>x</p></article>"],
      ]),
    });
    expect(result.newACount).toBe(1);
    expect(result.totalEligibleACount).toBe(3);
    expect(result.goalMet).toBe(true);
    expect(canonicalizeArticlePatternUrl("https://a.example.test/entry-1/")).toBe(
      "https://a.example.test/entry-1",
    );
  });
});

describe("Discovery eligible A = Aggregate current analysis SSOT", () => {
  it("adultgod7: old A / latest current B → not counted; domain excluded", () => {
    const eligible = collectEligibleAForDiscoveryGoal([
      makeObs({
        id: "old-a",
        url: "https://adultgod7.com/maria18-takahashi",
        domain: "adultgod7.com",
        classification: "A",
        observedAt: new Date("2026-08-01T00:00:00Z"),
      }),
      makeObs({
        id: "latest-b",
        url: "https://adultgod7.com/maria18-takahashi",
        domain: "adultgod7.com",
        classification: "B",
        observedAt: new Date("2026-08-15T00:00:00Z"),
      }),
    ]);
    expect(eligible).toHaveLength(0);
    expect(eligible.map((e) => e.domain)).not.toContain("adultgod7.com");
  });

  it("old A / latest current C → excluded", () => {
    const eligible = collectEligibleAForDiscoveryGoal([
      makeObs({
        id: "old-a",
        url: "https://adultgod7.com/av-review",
        domain: "adultgod7.com",
        classification: "A",
        observedAt: new Date("2026-08-01T00:00:00Z"),
      }),
      makeObs({
        id: "latest-c",
        url: "https://adultgod7.com/av-review",
        domain: "adultgod7.com",
        classification: "C",
        observedAt: new Date("2026-08-15T00:00:00Z"),
      }),
    ]);
    expect(eligible).toHaveLength(0);
  });

  it("latest current A → kept", () => {
    const eligible = collectEligibleAForDiscoveryGoal([
      makeObs({
        id: "current-a",
        url: "https://note.com/x/n/abc",
        domain: "note.com",
        classification: "A",
      }),
    ]);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]!.domain).toBe("note.com");
  });

  it("latest A with outdated analysis version → excluded", () => {
    const eligible = collectEligibleAForDiscoveryGoal([
      makeObs({
        id: "old-dens-a",
        url: "https://old.example.test/a",
        domain: "old.example.test",
        classification: "A",
        densityVersion: "information_density_v1",
      }),
      makeObs({
        id: "unset-a",
        url: "https://unset.example.test/a",
        domain: "unset.example.test",
        classification: "A",
        currentAnalysis: false,
      }),
    ]);
    expect(eligible).toHaveLength(0);
  });

  it("goalMet false when current A>=5 but domains=2; search starts (not goal_met)", async () => {
    const existing = [
      makeObs({ id: "n1", url: "https://note.com/a/1", domain: "note.com", classification: "A" }),
      makeObs({ id: "n2", url: "https://note.com/a/2", domain: "note.com", classification: "A" }),
      makeObs({ id: "n3", url: "https://note.com/a/3", domain: "note.com", classification: "A" }),
      makeObs({
        id: "s1",
        url: "https://sadist-avreview.com/a/1",
        domain: "sadist-avreview.com",
        classification: "A",
      }),
      makeObs({
        id: "s2",
        url: "https://sadist-avreview.com/a/2",
        domain: "sadist-avreview.com",
        classification: "A",
      }),
      makeObs({
        id: "s3",
        url: "https://sadist-avreview.com/a/3",
        domain: "sadist-avreview.com",
        classification: "A",
      }),
      makeObs({
        id: "ag-old",
        url: "https://adultgod7.com/maria18-takahashi",
        domain: "adultgod7.com",
        classification: "A",
        observedAt: new Date("2026-08-01T00:00:00Z"),
      }),
      makeObs({
        id: "ag-latest",
        url: "https://adultgod7.com/maria18-takahashi",
        domain: "adultgod7.com",
        classification: "B",
        observedAt: new Date("2026-08-15T00:00:00Z"),
      }),
    ];
    const search = new MockArticlePatternSearchAdapter();
    search.setHits("need-domain", []);
    const patterns = fakePatterns();
    const discovery = new ArticlePatternSourceDiscoveryService(patterns, search);
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternDiscoveryMaxSearchRequests: 2,
      articlePatternDiscoveryMaxSearchRounds: 1,
      articlePatternDiscoveryMaxQueries: 1,
      articlePatternDiscoveryMaxObservedUrls: 5,
    };
    const result = await discovery.discoverForNewReleaseSingle({
      config,
      confirmExternal: true,
      targetA: 5,
      minDomains: 3,
      queries: ["need-domain"],
      existingObservations: existing,
    });
    expect(result.existingCurrentAnalysisEligibleACount).toBe(6);
    expect(result.existingCurrentAnalysisEligibleADomains).toEqual([
      "note.com",
      "sadist-avreview.com",
    ]);
    expect(result.totalEligibleACount).toBe(6);
    expect(result.totalEligibleADomains).toHaveLength(2);
    expect(result.goalMet).toBe(false);
    expect(result.pipeline.searchRequestCount).toBeGreaterThan(0);
    expect(result.pipeline.stopReason).not.toBe("goal_met");
  });

  it("goalMet true only with current analysis A domains (ignores stale adultgod7 A)", async () => {
    const existing = [
      makeObs({ id: "n1", url: "https://note.com/a/1", domain: "note.com", classification: "A" }),
      makeObs({ id: "n2", url: "https://note.com/a/2", domain: "note.com", classification: "A" }),
      makeObs({ id: "n3", url: "https://note.com/a/3", domain: "note.com", classification: "A" }),
      makeObs({
        id: "s1",
        url: "https://sadist-avreview.com/a/1",
        domain: "sadist-avreview.com",
        classification: "A",
      }),
      makeObs({
        id: "s2",
        url: "https://sadist-avreview.com/a/2",
        domain: "sadist-avreview.com",
        classification: "A",
      }),
      makeObs({
        id: "s3",
        url: "https://sadist-avreview.com/a/3",
        domain: "sadist-avreview.com",
        classification: "A",
      }),
      makeObs({
        id: "ag-old",
        url: "https://adultgod7.com/maria18-takahashi",
        domain: "adultgod7.com",
        classification: "A",
        observedAt: new Date("2026-08-01T00:00:00Z"),
      }),
      makeObs({
        id: "ag-latest",
        url: "https://adultgod7.com/maria18-takahashi",
        domain: "adultgod7.com",
        classification: "B",
        observedAt: new Date("2026-08-15T00:00:00Z"),
      }),
    ];
    const search = new MockArticlePatternSearchAdapter();
    search.setHits("need-more", [
      {
        url: "https://extra.example.test/entry-1",
        title: "AV 作品レビュー 感想 見どころ",
      },
    ]);
    const patterns = fakePatterns(async (url) =>
      makeAObs({ id: "new1", url, domain: new URL(url).hostname }),
    );
    const discovery = new ArticlePatternSourceDiscoveryService(patterns, search);
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternDiscoveryMaxSearchRequests: 3,
      articlePatternDiscoveryMaxSearchRounds: 1,
      articlePatternDiscoveryMaxQueries: 1,
      articlePatternDiscoveryMaxObservedUrls: 5,
    };
    const result = await discovery.discoverForNewReleaseSingle({
      config,
      confirmExternal: true,
      targetA: 5,
      minDomains: 3,
      queries: ["need-more"],
      existingObservations: existing,
      mockHtmlByUrl: new Map([
        ["https://extra.example.test/entry-1", "<article><p>x</p></article>"],
      ]),
    });
    expect(result.pipeline.searchRequestCount).toBeGreaterThan(0);
    expect(result.goalMet).toBe(true);
    expect(result.totalEligibleADomains).toContain("extra.example.test");
    expect(result.totalEligibleADomains).not.toContain("adultgod7.com");
    expect(result.currentAnalysisEligibleACount).toBe(result.totalEligibleACount);
  });
});
