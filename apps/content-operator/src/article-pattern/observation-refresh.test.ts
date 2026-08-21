import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  ArticlePatternRepository,
  LifecycleRepository,
  P5Repository,
  P6Repository,
  cleanupLifecycleTablesForTests,
  createDatabaseClient,
  type ArticleStructureObservation,
} from "@ai-affiliate/database";
import { ARTICLE_SCOPE_VERSION } from "./article-content-scope.js";
import { INFORMATION_DENSITY_VERSION } from "./information-density.js";
import { ArticlePatternService } from "./article-pattern-service.js";
import { canonicalizeArticlePatternUrl } from "./canonical-url.js";
import {
  ArticlePatternObservationRefreshService,
  readArticleScopeVersion,
  readInformationDensityVersion,
  selectObservationsForScopeRefresh,
} from "./observation-refresh.js";
import { ArticlePatternSourceDiscoveryService } from "./source-discovery.js";
import { MockArticlePatternSearchAdapter } from "./source-search.js";
import { readLearningSuitability } from "./learning-suitability.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

function makeLegacyObs(input: {
  id: string;
  url: string;
  domain: string;
  classification?: "A" | "B" | "C";
  productCount?: number;
  rankingUsed?: boolean;
  scopeVersion?: string | null;
  densityVersion?: string | null;
  densityBucket?: string;
  observedAt?: Date;
}): ArticleStructureObservation {
  const classification = input.classification ?? "B";
  const metadata: Record<string, unknown> = {
    sourceKind: "live_url",
    storesFullBody: false,
    learningSuitability: {
      classification,
      score: classification === "A" ? 0.9 : 0.76,
      reasons: ["fixture"],
      targetFormatKey: "NEW_RELEASE_SINGLE",
    },
  };
  if (input.scopeVersion) {
    metadata.articleScope = {
      selectorKind: "article",
      scopeVersion: input.scopeVersion,
      fallbackUsed: false,
      confidence: 0.9,
    };
  }
  if (input.densityVersion) {
    metadata.analysisVersions = {
      articleScope: input.scopeVersion ?? ARTICLE_SCOPE_VERSION,
      structure: "structure_v1",
      writing: "writing_v1",
      informationDensity: input.densityVersion,
    };
    metadata.densityDiagnostics = {
      version: input.densityVersion,
      densityScore: input.densityBucket === "high" ? 3 : input.densityBucket === "medium" ? 1.5 : 0.4,
      bucket: input.densityBucket ?? "low",
    };
  }
  return {
    id: input.id,
    sourceUrl: input.url,
    sourceDomain: input.domain,
    contentHash: `hash-${input.id}`,
    articleTypeHint: "ranking_or_collection",
    features: {
      estimatedProductCount: input.productCount ?? 6,
      rankingUsed: input.rankingUsed ?? true,
      comparisonTableUsed: false,
      headingCount: 14,
      imageCount: 10,
      ctaCount: 1,
      totalLength: 2000,
      writingFeatures: {
        benefitFramingUsed: true,
        audienceFramingUsed: true,
        scenarioFramingUsed: true,
        descriptionRecommendationRatio: 0.5,
        informationDensityBucket: input.densityBucket ?? "medium",
        introPurpose: "selection_frame",
        productDifferentiationStyle: "criteria_based",
        sectionPurposeSequence: ["intro_hook", "selection_criteria", "editorial_angle", "cta"],
        introHookType: "audience_framing",
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

describe("selectObservationsForScopeRefresh (analysis versions)", () => {
  it("selects latest without article_scope_v1", () => {
    const rows = [
      makeLegacyObs({
        id: "old",
        url: "https://sadist-avreview.com/a",
        domain: "sadist-avreview.com",
        observedAt: new Date("2026-07-01T00:00:00Z"),
      }),
      makeLegacyObs({
        id: "newer-still-legacy",
        url: "https://sadist-avreview.com/a?utm_source=1",
        domain: "sadist-avreview.com",
        observedAt: new Date("2026-08-01T00:00:00Z"),
      }),
    ];
    const selected = selectObservationsForScopeRefresh(rows, {
      domain: "sadist-avreview.com",
      limit: 20,
    });
    expect(selected.candidates).toHaveLength(1);
    expect(selected.candidates[0]!.observation.id).toBe("newer-still-legacy");
    expect(selected.candidates[0]!.refreshReason).toBe("analysis_upgrade");
    expect(selected.skippedCurrentAnalysis).toHaveLength(0);
  });

  it("Case1: scope=v1 / density unset → refresh candidate (density_upgrade)", () => {
    const rows = [
      makeLegacyObs({
        id: "scope-only",
        url: "https://sadist-avreview.com/b",
        domain: "sadist-avreview.com",
        scopeVersion: ARTICLE_SCOPE_VERSION,
        productCount: 1,
        densityBucket: "low",
      }),
    ];
    const selected = selectObservationsForScopeRefresh(rows, {
      domain: "sadist-avreview.com",
      limit: 20,
    });
    expect(selected.candidates).toHaveLength(1);
    expect(selected.candidates[0]!.densityOutdated).toBe(true);
    expect(selected.candidates[0]!.scopeOutdated).toBe(false);
    expect(selected.candidates[0]!.refreshReason).toBe("density_upgrade");
    expect(selected.skippedCurrentAnalysis).toHaveLength(0);
  });

  it("Case2: scope=v1 / density old → refresh candidate", () => {
    const selected = selectObservationsForScopeRefresh(
      [
        makeLegacyObs({
          id: "old-dens",
          url: "https://sadist-avreview.com/old-dens",
          domain: "sadist-avreview.com",
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: "information_density_v1",
          densityBucket: "low",
          productCount: 1,
        }),
      ],
      { domain: "sadist-avreview.com", limit: 10 },
    );
    expect(selected.candidates).toHaveLength(1);
    expect(selected.candidates[0]!.refreshReason).toBe("density_upgrade");
  });

  it("Case3: scope=v1 / density current → skip", () => {
    const selected = selectObservationsForScopeRefresh(
      [
        makeLegacyObs({
          id: "current",
          url: "https://sadist-avreview.com/done",
          domain: "sadist-avreview.com",
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: INFORMATION_DENSITY_VERSION,
          densityBucket: "medium",
          productCount: 1,
          classification: "A",
        }),
      ],
      { domain: "sadist-avreview.com", limit: 10 },
    );
    expect(selected.candidates).toHaveLength(0);
    expect(selected.skippedCurrentAnalysis).toHaveLength(1);
  });

  it("Case4: scope old / density current → refresh (scope_upgrade)", () => {
    const selected = selectObservationsForScopeRefresh(
      [
        makeLegacyObs({
          id: "scope-old",
          url: "https://sadist-avreview.com/scope-old",
          domain: "sadist-avreview.com",
          densityVersion: INFORMATION_DENSITY_VERSION,
          densityBucket: "medium",
        }),
      ],
      { limit: 10 },
    );
    expect(selected.candidates).toHaveLength(1);
    expect(selected.candidates[0]!.refreshReason).toBe("scope_upgrade");
  });

  it("keeps only latest among multiple revisions of same canonical", () => {
    const rows = [
      makeLegacyObs({
        id: "r1",
        url: "https://blog.example.test/post",
        domain: "blog.example.test",
        observedAt: new Date("2026-01-01T00:00:00Z"),
      }),
      makeLegacyObs({
        id: "r2",
        url: "https://blog.example.test/post/",
        domain: "blog.example.test",
        observedAt: new Date("2026-02-01T00:00:00Z"),
      }),
      makeLegacyObs({
        id: "r3",
        url: "https://blog.example.test/post#x",
        domain: "blog.example.test",
        observedAt: new Date("2026-03-01T00:00:00Z"),
      }),
    ];
    const selected = selectObservationsForScopeRefresh(rows, { limit: 10 });
    expect(selected.candidates).toHaveLength(1);
    expect(selected.candidates[0]!.observation.id).toBe("r3");
  });

  it("filters by classification B", () => {
    const rows = [
      makeLegacyObs({
        id: "b1",
        url: "https://sadist-avreview.com/1",
        domain: "sadist-avreview.com",
        classification: "B",
      }),
      makeLegacyObs({
        id: "a1",
        url: "https://sadist-avreview.com/2",
        domain: "sadist-avreview.com",
        classification: "A",
        productCount: 1,
      }),
    ];
    const selected = selectObservationsForScopeRefresh(rows, {
      domain: "sadist-avreview.com",
      classification: "B",
      limit: 10,
    });
    expect(selected.candidates.map((c) => c.observation.id)).toEqual(["b1"]);
  });
});

describe("Observation scope refresh (mock HTML — no network / no Brave)", () => {
  const database = createDatabaseClient();
  const lifecycleRepo = new LifecycleRepository(database.prisma);
  const p5 = new P5Repository(database.prisma);
  const p6 = new P6Repository(database.prisma);
  const patterns = new ArticlePatternRepository(database.prisma);

  beforeAll(async () => {
    loadConfig({ requireDatabaseUrl: false });
    await database.connect();
  });
  afterAll(async () => {
    await database.disconnect();
  });
  beforeEach(async () => {
    await cleanupLifecycleTablesForTests(database.prisma);
  });

  function service() {
    return new ArticlePatternService(patterns, lifecycleRepo, p5, p6, {
      minimumSampleCount: 3,
      minimumDomainDiversity: 3,
    });
  }

  it("refreshes legacy scope into new Observation revision; keeps old row", async () => {
    const svc = service();
    const legacy = await patterns.createObservation({
      sourceUrl: "https://sadist-avreview.com/2026/08/15/sample-review",
      sourceDomain: "sadist-avreview.com",
      contentHash: "legacy-hash-pc6",
      articleTypeHint: "ranking_or_collection",
      features: {
        estimatedProductCount: 6,
        rankingUsed: true,
        comparisonTableUsed: false,
        headingCount: 14,
        headingPatterns: ["h1", "h5", "h5", "h5", "h5", "h5", "h5", "h5", "h5", "h5", "h5"],
        imageCount: 20,
        ctaCount: 1,
        totalLength: 4000,
        introLength: 100,
        averageProductSectionLength: 600,
        imagePositions: [],
        imageRoles: [],
        ctaPositions: [],
        ctaStyle: "single",
        prosConsUsed: false,
        summaryUsed: false,
        faqUsed: false,
        disclosurePosition: null,
        ageNoticePosition: null,
        internalLinkCount: 200,
        externalProductLinkCount: 1,
        tone: "review-leaning",
        reviewVsCatalogRatio: 0.6,
        seoTitlePattern: "descriptive",
        keywordPlacement: ["title"],
        sectionOrder: ["intro", "product_sections", "cta"],
        writingFeatures: {
          benefitFramingUsed: true,
          audienceFramingUsed: true,
          scenarioFramingUsed: true,
          descriptionRecommendationRatio: 0.55,
          informationDensityBucket: "medium",
          introPurpose: "selection_frame",
          productDifferentiationStyle: "criteria_based",
          sectionPurposeSequence: [
            "intro_hook",
            "selection_criteria",
            "editorial_angle",
            "cta",
          ],
          introHookType: "audience_framing",
          catalogStyleLevel: "balanced",
          repetitionRateBucket: "low",
          factOpinionRatio: 0.4,
          recommendationPlacement: "mid",
          reviewStyle: "editorial_non_experiential",
        },
      },
      confidence: 0.7,
      observedAt: new Date("2026-08-10T00:00:00Z"),
      metadata: {
        sourceKind: "live_url",
        storesFullBody: false,
        // intentionally no articleScope (pre-v1)
        learningSuitability: {
          classification: "B",
          score: 0.76,
          reasons: ["multi_product_count_6", "multi_or_comparison_style_reference_only"],
          targetFormatKey: "NEW_RELEASE_SINGLE",
        },
      },
    });

    const refresh = new ArticlePatternObservationRefreshService(svc);
    const config = {
      ...loadConfig({ requireDatabaseUrl: false }),
      articlePatternRefreshMaxUrls: 20,
    };
    const html = loadFixture("scope-single-with-sidebar.html");
    const result = await refresh.refreshLiveObservations({
      config,
      confirmExternal: true,
      domain: "sadist-avreview.com",
      existingObservations: [legacy],
      mockHtmlByUrl: new Map([
        [
          canonicalizeArticlePatternUrl(legacy.sourceUrl) ?? legacy.sourceUrl,
          html,
        ],
      ]),
    });

    expect(result.searchUsed).toBe(false);
    expect(result.aggregated).toBe(false);
    expect(result.refreshed).toBe(1);
    expect(result.failed).toBe(0);
    const item = result.items.find((i) => i.status === "refreshed");
    expect(item?.previousObservationId).toBe(legacy.id);
    expect(item?.previous.estimatedProductCount).toBe(6);
    expect(item?.previous.classification).toBe("B");
    expect(item?.current?.estimatedProductCount).toBe(1);
    expect(item?.newScopeVersion).toBe(ARTICLE_SCOPE_VERSION);

    const oldRow = await database.prisma.articleStructureObservation.findUnique({
      where: { id: legacy.id },
    });
    expect(oldRow).toBeTruthy();
    expect(oldRow!.id).toBe(legacy.id);

    const newRow = await database.prisma.articleStructureObservation.findUnique({
      where: { id: item!.newObservationId! },
    });
    expect(newRow).toBeTruthy();
    expect(newRow!.id).not.toBe(legacy.id);
    expect(readArticleScopeVersion(newRow!.metadata)).toBe(ARTICLE_SCOPE_VERSION);
    const refreshMeta = (newRow!.metadata as { refresh?: Record<string, unknown> }).refresh;
    expect(refreshMeta?.previousObservationId).toBe(legacy.id);
    expect(refreshMeta?.reason).toBe("analysis_upgrade");
    expect(refreshMeta?.currentScopeVersion).toBe(ARTICLE_SCOPE_VERSION);
    expect(refreshMeta?.currentInformationDensityVersion).toBe(INFORMATION_DENSITY_VERSION);

    const source = await database.prisma.sourceDocument.findUnique({
      where: { id: newRow!.sourceDocumentId! },
    });
    expect(source?.normalizedText).toBeNull();
    expect((source?.metadata as { storesFullBody?: boolean })?.storesFullBody).toBe(false);

    // Natural suitability only — may become A when structure is corrected
    const suit = readLearningSuitability(newRow!.metadata);
    expect(["A", "B"]).toContain(suit?.classification);
    if (suit?.classification === "A") {
      expect(item?.current?.estimatedProductCount).toBe(1);
    }
  });

  it("skips already_current_scope_and_analysis without calling observe", async () => {
    const svc = service();
    const observeSpy = vi.spyOn(svc, "observeFromUrl");
    const current = makeLegacyObs({
      id: "already",
      url: "https://sadist-avreview.com/done",
      domain: "sadist-avreview.com",
      scopeVersion: ARTICLE_SCOPE_VERSION,
      densityVersion: INFORMATION_DENSITY_VERSION,
      densityBucket: "medium",
      productCount: 1,
      classification: "A",
    });
    const refresh = new ArticlePatternObservationRefreshService(svc);
    const result = await refresh.refreshLiveObservations({
      config: loadConfig({ requireDatabaseUrl: false }),
      confirmExternal: true,
      domain: "sadist-avreview.com",
      existingObservations: [current],
    });
    expect(result.skippedCurrentAnalysis).toBe(1);
    expect(result.refreshed).toBe(0);
    expect(result.items[0]?.reason).toBe("already_current_scope_and_analysis");
    expect(observeSpy).not.toHaveBeenCalled();
    observeSpy.mockRestore();
  });

  it("Case5–7: density_upgrade keeps old Observation and stores density version on new", async () => {
    const svc = service();
    const legacy = await patterns.createObservation({
      sourceUrl: "https://sadist-avreview.com/2026/08/15/density-upgrade-case",
      sourceDomain: "sadist-avreview.com",
      contentHash: "legacy-dens-low",
      articleTypeHint: "single_review",
      features: {
        estimatedProductCount: 1,
        rankingUsed: false,
        comparisonTableUsed: false,
        headingCount: 1,
        headingPatterns: ["h1"],
        imageCount: 1,
        ctaCount: 1,
        totalLength: 1500,
        introLength: 40,
        averageProductSectionLength: 1500,
        imagePositions: [],
        imageRoles: [],
        ctaPositions: [],
        ctaStyle: "single",
        prosConsUsed: false,
        summaryUsed: false,
        faqUsed: false,
        disclosurePosition: null,
        ageNoticePosition: null,
        internalLinkCount: 0,
        externalProductLinkCount: 1,
        tone: "review-leaning",
        reviewVsCatalogRatio: 0.7,
        seoTitlePattern: "descriptive",
        keywordPlacement: ["title"],
        sectionOrder: ["intro", "product_sections", "cta"],
        writingFeatures: {
          benefitFramingUsed: true,
          audienceFramingUsed: true,
          scenarioFramingUsed: true,
          descriptionRecommendationRatio: 0.6,
          informationDensityBucket: "low",
          introPurpose: "selection_frame",
          productDifferentiationStyle: "criteria_based",
          sectionPurposeSequence: ["intro_hook", "editorial_angle", "cta"],
          introHookType: "audience_framing",
          catalogStyleLevel: "balanced",
          repetitionRateBucket: "low",
          factOpinionRatio: 0.3,
          recommendationPlacement: "mid",
          reviewStyle: "editorial_non_experiential",
        },
      },
      confidence: 0.9,
      observedAt: new Date("2026-08-14T00:00:00Z"),
      metadata: {
        sourceKind: "live_url",
        storesFullBody: false,
        articleScope: {
          selectorKind: "article",
          scopeVersion: ARTICLE_SCOPE_VERSION,
          fallbackUsed: false,
          confidence: 0.92,
        },
        // density version intentionally missing (pre-v2)
        learningSuitability: {
          classification: "B",
          score: 0.99,
          reasons: ["editorial_signals_2", "density_low", "editorial_but_not_single_format_ready"],
          targetFormatKey: "NEW_RELEASE_SINGLE",
        },
      },
    });

    const refresh = new ArticlePatternObservationRefreshService(svc);
    const html = loadFixture("dens-descriptive-single.html");
    const result = await refresh.refreshLiveObservations({
      config: {
        ...loadConfig({ requireDatabaseUrl: false }),
        articlePatternRefreshMaxUrls: 20,
      },
      confirmExternal: true,
      domain: "sadist-avreview.com",
      existingObservations: [legacy],
      mockHtmlByUrl: new Map([
        [canonicalizeArticlePatternUrl(legacy.sourceUrl) ?? legacy.sourceUrl, html],
      ]),
    });

    expect(result.searchUsed).toBe(false);
    expect(result.refreshed).toBe(1);
    expect(result.densityUpgraded).toBe(1);
    const item = result.items.find((i) => i.status === "refreshed");
    expect(item?.refreshReason).toBe("density_upgrade");
    expect(item?.reason).toBe("density_upgrade");
    expect(item?.previous.densityBucket).toBe("low");
    expect(item?.previous.classification).toBe("B");
    expect(["medium", "high"]).toContain(item?.current?.densityBucket);
    expect(item?.currentInformationDensityVersion).toBe(INFORMATION_DENSITY_VERSION);

    const oldRow = await database.prisma.articleStructureObservation.findUnique({
      where: { id: legacy.id },
    });
    expect(oldRow).toBeTruthy();

    const newRow = await database.prisma.articleStructureObservation.findUnique({
      where: { id: item!.newObservationId! },
    });
    expect(newRow).toBeTruthy();
    expect(newRow!.id).not.toBe(legacy.id);
    expect(readInformationDensityVersion(newRow!.metadata)).toBe(INFORMATION_DENSITY_VERSION);
    const analysis = (newRow!.metadata as { analysisVersions?: { informationDensity?: string } })
      .analysisVersions;
    expect(analysis?.informationDensity).toBe(INFORMATION_DENSITY_VERSION);
    const refreshMeta = (newRow!.metadata as { refresh?: Record<string, unknown> }).refresh;
    expect(refreshMeta?.reason).toBe("density_upgrade");
    expect(refreshMeta?.previousInformationDensityVersion).toBeNull();
    expect(refreshMeta?.currentInformationDensityVersion).toBe(INFORMATION_DENSITY_VERSION);

    const source = await database.prisma.sourceDocument.findUnique({
      where: { id: newRow!.sourceDocumentId! },
    });
    expect(source?.normalizedText).toBeNull();
    expect((source?.metadata as { storesFullBody?: boolean })?.storesFullBody).toBe(false);

    // Case8: may promote B→A under unchanged suitability rules when dens becomes medium+
    const suit = readLearningSuitability(newRow!.metadata);
    expect(["A", "B"]).toContain(suit?.classification);
    if (item?.previous.densityBucket === "low" && ["medium", "high"].includes(item.current?.densityBucket ?? "")) {
      // promotion allowed; not required if other gates fail
      expect(suit?.classification === "A" || suit?.classification === "B").toBe(true);
    }
  });

  it("Case9: short note dens high→low is allowed (count preservation not a goal)", async () => {
    const svc = service();
    const legacy = await patterns.createObservation({
      sourceUrl: "https://note.example.test/n/short-note",
      sourceDomain: "note.example.test",
      contentHash: "note-short-high",
      articleTypeHint: "single_review",
      features: {
        estimatedProductCount: 1,
        rankingUsed: false,
        comparisonTableUsed: false,
        headingCount: 1,
        headingPatterns: ["h1"],
        imageCount: 0,
        ctaCount: 0,
        totalLength: 161,
        introLength: 80,
        averageProductSectionLength: 161,
        imagePositions: [],
        imageRoles: [],
        ctaPositions: [],
        ctaStyle: "none",
        prosConsUsed: false,
        summaryUsed: false,
        faqUsed: false,
        disclosurePosition: null,
        ageNoticePosition: null,
        internalLinkCount: 0,
        externalProductLinkCount: 0,
        tone: "review-leaning",
        reviewVsCatalogRatio: 0.6,
        seoTitlePattern: "short",
        keywordPlacement: ["title"],
        sectionOrder: ["intro"],
        writingFeatures: {
          benefitFramingUsed: true,
          audienceFramingUsed: true,
          scenarioFramingUsed: false,
          descriptionRecommendationRatio: 0.8,
          informationDensityBucket: "high",
          introPurpose: "selection_frame",
          productDifferentiationStyle: "criteria_based",
          sectionPurposeSequence: ["intro_hook", "editorial_angle"],
          introHookType: "direct_recommendation",
          catalogStyleLevel: "balanced",
          repetitionRateBucket: "low",
          factOpinionRatio: 0.2,
          recommendationPlacement: "mid",
          reviewStyle: "editorial_non_experiential",
        },
      },
      confidence: 0.8,
      metadata: {
        sourceKind: "live_url",
        storesFullBody: false,
        articleScope: {
          selectorKind: "article",
          scopeVersion: ARTICLE_SCOPE_VERSION,
          fallbackUsed: false,
          confidence: 0.9,
        },
        learningSuitability: {
          classification: "A",
          score: 1,
          reasons: ["single_editorial_suitable_for_new_release_single"],
          targetFormatKey: "NEW_RELEASE_SINGLE",
        },
      },
    });

    const refresh = new ArticlePatternObservationRefreshService(svc);
    const result = await refresh.refreshLiveObservations({
      config: loadConfig({ requireDatabaseUrl: false }),
      confirmExternal: true,
      domain: "note.example.test",
      existingObservations: [legacy],
      mockHtmlByUrl: new Map([
        [
          canonicalizeArticlePatternUrl(legacy.sourceUrl) ?? legacy.sourceUrl,
          loadFixture("dens-note-short.html"),
        ],
      ]),
    });
    expect(result.refreshed).toBe(1);
    const item = result.items.find((i) => i.status === "refreshed");
    expect(item?.previous.densityBucket).toBe("high");
    expect(item?.current?.densityBucket).not.toBe("high");
    expect(item?.refreshReason).toBe("density_upgrade");
  });

  it("Case10: Brave/search adapter is not used (searchUsed=false)", async () => {
    const svc = service();
    const refresh = new ArticlePatternObservationRefreshService(svc);
    const result = await refresh.refreshLiveObservations({
      config: loadConfig({ requireDatabaseUrl: false }),
      confirmExternal: true,
      domain: "sadist-avreview.com",
      existingObservations: [
        makeLegacyObs({
          id: "x",
          url: "https://sadist-avreview.com/x",
          domain: "sadist-avreview.com",
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: INFORMATION_DENSITY_VERSION,
        }),
      ],
    });
    expect(result.searchUsed).toBe(false);
    expect(result.aggregated).toBe(false);
  });

  it("continues after one fetch failure", async () => {
    const svc = service();
    vi.spyOn(svc, "observeFromUrl").mockImplementation(async (input) => {
      if (input.sourceUrl.includes("fail")) {
        throw new Error("fetch_failed");
      }
      return makeLegacyObs({
        id: "new-ok",
        url: input.sourceUrl,
        domain: "sadist-avreview.com",
        scopeVersion: ARTICLE_SCOPE_VERSION,
        productCount: 1,
        classification: "A",
      }) as unknown as ArticleStructureObservation;
    });
    const refresh = new ArticlePatternObservationRefreshService(svc);
    const result = await refresh.refreshLiveObservations({
      config: loadConfig({ requireDatabaseUrl: false }),
      confirmExternal: true,
      domain: "sadist-avreview.com",
      existingObservations: [
        makeLegacyObs({
          id: "f1",
          url: "https://sadist-avreview.com/fail-1",
          domain: "sadist-avreview.com",
        }),
        makeLegacyObs({
          id: "ok1",
          url: "https://sadist-avreview.com/ok-1",
          domain: "sadist-avreview.com",
        }),
      ],
      mockHtmlByUrl: new Map([
        ["https://sadist-avreview.com/fail-1", "<article><p>x</p></article>"],
        ["https://sadist-avreview.com/ok-1", loadFixture("scope-single-with-sidebar.html")],
      ]),
    });
    expect(result.failed).toBe(1);
    expect(result.refreshed).toBe(1);
    vi.restoreAllMocks();
  });

  it("Discovery still skips existing canonical URLs (refresh is separate)", async () => {
    const svc = service();
    const existingUrl = "https://sadist-avreview.com/known-post";
    await svc.observeFromHtml({
      sourceUrl: existingUrl,
      html: loadFixture("scope-single-with-sidebar.html"),
      sourceKind: "live_url",
    });
    const search = new MockArticlePatternSearchAdapter();
    search.setHits("q", [
      {
        url: existingUrl,
        title: "AV 作品レビュー 感想 SSIS-001",
      },
    ]);
    const discovery = new ArticlePatternSourceDiscoveryService(svc, search);
    const observeSpy = vi.spyOn(svc, "observeFromUrl");
    const result = await discovery.discoverForNewReleaseSingle({
      config: {
        ...loadConfig({ requireDatabaseUrl: false }),
        articlePatternDiscoveryMaxSearchRequests: 2,
        articlePatternDiscoveryMaxQueries: 1,
        articlePatternDiscoveryMaxSearchRounds: 1,
      },
      confirmExternal: true,
      queries: ["q"],
      existingObservations: await svc.listLiveObservations(50),
    });
    expect(result.pipeline.existingObservationUrlSkipped).toBeGreaterThanOrEqual(1);
    expect(
      result.candidates.some((c) => c.reason === "existing_observation_url"),
    ).toBe(true);
    expect(observeSpy).not.toHaveBeenCalled();
    observeSpy.mockRestore();
  });
});
