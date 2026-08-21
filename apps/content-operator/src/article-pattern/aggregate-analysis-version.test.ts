import { describe, expect, it } from "vitest";
import { ARTICLE_SCOPE_VERSION } from "./article-content-scope.js";
import { INFORMATION_DENSITY_VERSION } from "./information-density.js";
import { prepareObservationsForLearning } from "./observation-dedupe.js";
import { ArticlePatternService } from "./article-pattern-service.js";
import type { ArticleStructureFeatures } from "./types.js";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  ArticlePatternRepository,
  LifecycleRepository,
  P5Repository,
  P6Repository,
  cleanupLifecycleTablesForTests,
  createDatabaseClient,
} from "@ai-affiliate/database";

function baseFeatures(
  overrides: Partial<ArticleStructureFeatures> & {
    writingFeatures?: Partial<ArticleStructureFeatures["writingFeatures"]>;
  } = {},
): ArticleStructureFeatures {
  const { writingFeatures: wOver, ...rest } = overrides;
  return {
    estimatedProductCount: 1,
    headingCount: 2,
    headingPatterns: ["h2", "h2"],
    introLength: 120,
    totalLength: 1200,
    averageProductSectionLength: 1200,
    imageCount: 1,
    imagePositions: ["middle"],
    imageRoles: ["product"],
    ctaCount: 1,
    ctaPositions: ["bottom"],
    ctaStyle: "single",
    rankingUsed: false,
    comparisonTableUsed: false,
    prosConsUsed: false,
    summaryUsed: true,
    faqUsed: false,
    disclosurePosition: "top",
    ageNoticePosition: null,
    internalLinkCount: 0,
    externalProductLinkCount: 1,
    tone: "review-leaning",
    reviewVsCatalogRatio: 0.7,
    seoTitlePattern: "descriptive",
    keywordPlacement: [],
    sectionOrder: ["intro", "product_sections", "cta"],
    writingFeatures: {
      introHookType: "direct_recommendation",
      introPurpose: "selection_frame",
      introLengthBucket: "medium",
      paragraphLengthDistribution: { short: 0.2, medium: 0.6, long: 0.2 },
      sentenceLengthDistribution: { short: 0.2, medium: 0.6, long: 0.2 },
      tone: "editorial",
      pointOfView: "third_person",
      factOpinionRatio: 0.45,
      descriptionRecommendationRatio: 0.55,
      productFactPlacement: "early",
      recommendationPlacement: "late",
      benefitFramingUsed: true,
      audienceFramingUsed: true,
      scenarioFramingUsed: false,
      curiosityGapUsed: false,
      questionHookUsed: false,
      conclusionFirstUsed: false,
      sectionPurposeSequence: ["intro_hook", "selection_criteria", "product_facts", "cta"],
      repetitionRateBucket: "low",
      ctaLeadInType: "bridge_from_editorial",
      ctaContext: "decision_support",
      informationDensityBucket: "medium",
      productDifferentiationStyle: "criteria_based",
      subjectiveLanguageLevel: "moderate",
      reviewStyle: "editorial_non_experiential",
      catalogStyleLevel: "balanced",
      ...wOver,
    },
    ...rest,
  };
}

function makeObs(input: {
  id: string;
  url: string;
  domain?: string;
  hash?: string;
  observedAt: Date;
  classification?: "A" | "B" | "C";
  scopeVersion?: string | null;
  densityVersion?: string | null;
  analysisVersions?: boolean;
}) {
  const metadata: Record<string, unknown> = {
    sourceKind: "live_url",
    learningSuitability: input.classification
      ? {
          classification: input.classification,
          score: input.classification === "A" ? 0.9 : 0.4,
          reasons: ["test"],
          targetFormatKey: "NEW_RELEASE_SINGLE",
        }
      : undefined,
  };
  if (input.scopeVersion) {
    metadata.articleScope = {
      selectorKind: "article",
      scopeVersion: input.scopeVersion,
      fallbackUsed: false,
      confidence: 0.9,
    };
  }
  if (input.analysisVersions !== false && input.scopeVersion && input.densityVersion) {
    metadata.analysisVersions = {
      articleScope: input.scopeVersion,
      structure: "structure_v1",
      writing: "writing_v1",
      informationDensity: input.densityVersion,
    };
  }
  if (input.densityVersion) {
    metadata.densityDiagnostics = {
      version: input.densityVersion,
      densityScore: 1.5,
      bucket: "medium",
    };
  }
  return {
    id: input.id,
    sourceUrl: input.url,
    sourceDomain: input.domain ?? new URL(input.url).hostname,
    contentHash: input.hash ?? `hash-${input.id}`,
    articleTypeHint: "single_review",
    features: baseFeatures(),
    confidence: 0.8,
    observedAt: input.observedAt,
    createdAt: input.observedAt,
    sourceDocumentId: null,
    metadata,
  };
}

describe("prepareObservationsForLearning analysis version guard", () => {
  it("Case1: latest old-density A is excluded when requireCurrentAnalysisVersions", () => {
    const prepared = prepareObservationsForLearning(
      [
        makeObs({
          id: "old-dens-a",
          url: "https://a.example.test/1",
          observedAt: new Date("2026-08-01T00:00:00Z"),
          classification: "A",
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: "information_density_v1",
        }),
      ] as never,
      { suitabilityAOnly: true, requireCurrentAnalysisVersions: true },
    );
    expect(prepared.selected).toHaveLength(0);
    expect(prepared.diagnostics.outdatedAnalysisExcluded).toBe(1);
    expect(prepared.diagnostics.outdatedAnalysisObservationIds).toEqual(["old-dens-a"]);
    expect(prepared.diagnostics.requiredAnalysisVersions).toEqual({
      articleScope: ARTICLE_SCOPE_VERSION,
      informationDensity: INFORMATION_DENSITY_VERSION,
    });
  });

  it("Case2: scope v1 + density v2 A is kept", () => {
    const prepared = prepareObservationsForLearning(
      [
        makeObs({
          id: "current-a",
          url: "https://a.example.test/1",
          observedAt: new Date("2026-08-01T00:00:00Z"),
          classification: "A",
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: INFORMATION_DENSITY_VERSION,
        }),
      ] as never,
      { suitabilityAOnly: true, requireCurrentAnalysisVersions: true },
    );
    expect(prepared.selected.map((o) => o.id)).toEqual(["current-a"]);
    expect(prepared.diagnostics.outdatedAnalysisExcluded).toBe(0);
  });

  it("Case3: old revision A / latest C → old A not selected", () => {
    const prepared = prepareObservationsForLearning(
      [
        makeObs({
          id: "old-a",
          url: "https://a.example.test/1",
          observedAt: new Date("2026-01-01T00:00:00Z"),
          classification: "A",
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: INFORMATION_DENSITY_VERSION,
        }),
        makeObs({
          id: "new-c",
          url: "https://a.example.test/1/",
          observedAt: new Date("2026-08-01T00:00:00Z"),
          classification: "C",
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: INFORMATION_DENSITY_VERSION,
        }),
      ] as never,
      { suitabilityAOnly: true, requireCurrentAnalysisVersions: true },
    );
    expect(prepared.selected.map((o) => o.id)).toEqual([]);
    expect(prepared.diagnostics.afterCanonicalLatestCount).toBe(1);
    expect(prepared.diagnostics.exclusions.some((e) => e.id === "old-a")).toBe(true);
    expect(prepared.diagnostics.suitabilityExcluded).toBe(1);
  });

  it("Case4: missing analysis versions → outdated", () => {
    const prepared = prepareObservationsForLearning(
      [
        makeObs({
          id: "unset",
          url: "https://a.example.test/1",
          observedAt: new Date("2026-08-01T00:00:00Z"),
          classification: "A",
        }),
      ] as never,
      { suitabilityAOnly: true, requireCurrentAnalysisVersions: true },
    );
    expect(prepared.selected).toHaveLength(0);
    expect(prepared.diagnostics.outdatedAnalysisExcluded).toBe(1);
  });

  it("Case7: canonical then contentHash order preserved before analysis filter", () => {
    const prepared = prepareObservationsForLearning(
      [
        makeObs({
          id: "old",
          url: "https://a.example.test/1",
          hash: "same",
          observedAt: new Date("2026-01-01T00:00:00Z"),
          classification: "A",
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: INFORMATION_DENSITY_VERSION,
        }),
        makeObs({
          id: "newer-same-hash",
          url: "https://b.example.test/2",
          hash: "same",
          observedAt: new Date("2026-02-01T00:00:00Z"),
          classification: "A",
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: INFORMATION_DENSITY_VERSION,
        }),
        makeObs({
          id: "outdated-other",
          url: "https://c.example.test/3",
          observedAt: new Date("2026-03-01T00:00:00Z"),
          classification: "A",
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: "information_density_v1",
        }),
      ] as never,
      { suitabilityAOnly: true, requireCurrentAnalysisVersions: true },
    );
    expect(prepared.diagnostics.duplicateContentHashExcluded).toBe(1);
    expect(prepared.diagnostics.outdatedAnalysisExcluded).toBe(1);
    expect(prepared.selected.map((o) => o.id)).toEqual(["newer-same-hash"]);
  });

  it("without requireCurrentAnalysisVersions, version-unset A still selectable (fixture path)", () => {
    const prepared = prepareObservationsForLearning(
      [
        makeObs({
          id: "fixture-a",
          url: "https://fix.example.test/1",
          observedAt: new Date("2026-08-01T00:00:00Z"),
          classification: "A",
        }),
      ] as never,
      { suitabilityAOnly: true, requireCurrentAnalysisVersions: false },
    );
    expect(prepared.selected.map((o) => o.id)).toEqual(["fixture-a"]);
    expect(prepared.diagnostics.requiredAnalysisVersions).toBeNull();
  });
});

describe("aggregateAndProposeFormat analysis version fail-fast", () => {
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

  function svc(minSample = 3, minDomain = 2) {
    return new ArticlePatternService(patterns, lifecycleRepo, p5, p6, {
      minimumSampleCount: minSample,
      minimumDomainDiversity: minDomain,
    });
  }

  async function seedLive(input: {
    id: string;
    url: string;
    domain: string;
    classification: "A" | "B" | "C";
    scopeVersion?: string;
    densityVersion?: string | null;
  }) {
    const meta: Record<string, unknown> = {
      sourceKind: "live_url",
      learningSuitability: {
        classification: input.classification,
        score: input.classification === "A" ? 0.9 : 0.4,
        reasons: ["seed"],
        targetFormatKey: "NEW_RELEASE_SINGLE",
      },
    };
    if (input.scopeVersion) {
      meta.articleScope = {
        selectorKind: "article",
        scopeVersion: input.scopeVersion,
        fallbackUsed: false,
        confidence: 0.9,
      };
    }
    if (input.densityVersion) {
      meta.analysisVersions = {
        articleScope: input.scopeVersion ?? ARTICLE_SCOPE_VERSION,
        structure: "structure_v1",
        writing: "writing_v1",
        informationDensity: input.densityVersion,
      };
      meta.densityDiagnostics = {
        version: input.densityVersion,
        densityScore: 1.5,
        bucket: "medium",
      };
    }
    return patterns.createObservation({
      sourceUrl: input.url,
      sourceDomain: input.domain,
      contentHash: `hash-${input.id}`,
      articleTypeHint: "single_review",
      features: baseFeatures(),
      confidence: 0.9,
      metadata: meta,
    });
  }

  it("Case5: current analysis A alone insufficient domains → pattern_validation_failed", async () => {
    const service = svc(3, 3);
    await seedLive({
      id: "a1",
      url: "https://d1.example.test/1",
      domain: "d1.example.test",
      classification: "A",
      scopeVersion: ARTICLE_SCOPE_VERSION,
      densityVersion: INFORMATION_DENSITY_VERSION,
    });
    await seedLive({
      id: "a2",
      url: "https://d1.example.test/2",
      domain: "d1.example.test",
      classification: "A",
      scopeVersion: ARTICLE_SCOPE_VERSION,
      densityVersion: INFORMATION_DENSITY_VERSION,
    });
    // Outdated A on another domain must not rescue thresholds
    await seedLive({
      id: "old-a",
      url: "https://d2.example.test/1",
      domain: "d2.example.test",
      classification: "A",
      scopeVersion: ARTICLE_SCOPE_VERSION,
      densityVersion: "information_density_v1",
    });

    await expect(
      service.aggregateAndProposeFormat({
        formatKey: "NEW_RELEASE_SINGLE",
        sourceKind: "live_url",
      }),
    ).rejects.toMatchObject({
      code: "pattern_validation_failed",
    });
    await expect(
      service.aggregateAndProposeFormat({
        formatKey: "NEW_RELEASE_SINGLE",
        sourceKind: "live_url",
      }),
    ).rejects.toThrow(/insufficient_current_analysis_evidence/);
  });

  it("Case6: current analysis A meets thresholds → aggregate succeeds", async () => {
    const service = svc(2, 2);
    await seedLive({
      id: "a1",
      url: "https://d1.example.test/1",
      domain: "d1.example.test",
      classification: "A",
      scopeVersion: ARTICLE_SCOPE_VERSION,
      densityVersion: INFORMATION_DENSITY_VERSION,
    });
    await seedLive({
      id: "a2",
      url: "https://d2.example.test/1",
      domain: "d2.example.test",
      classification: "A",
      scopeVersion: ARTICLE_SCOPE_VERSION,
      densityVersion: INFORMATION_DENSITY_VERSION,
    });
    const result = await service.aggregateAndProposeFormat({
      formatKey: "NEW_RELEASE_SINGLE",
      sourceKind: "live_url",
    });
    expect(result.aggregation.meetsThresholds).toBe(true);
    expect(result.format?.status).toBe("PROPOSED");
    expect(result.learningInputDiagnostics.outdatedAnalysisExcluded).toBe(0);
    expect(result.learningInputDiagnostics.afterSuitabilityFilterCount).toBe(2);
  });

  it("Case8: fixture aggregate still works without analysisVersions", async () => {
    const service = svc(2, 2);
    await patterns.createObservation({
      sourceUrl: "https://fix-a.example.test/1",
      sourceDomain: "fix-a.example.test",
      contentHash: "fx-1",
      articleTypeHint: "single_review",
      features: baseFeatures(),
      confidence: 0.8,
      metadata: {
        sourceKind: "fixture",
        learningSuitability: {
          classification: "A",
          score: 0.9,
          reasons: ["fx"],
          targetFormatKey: "NEW_RELEASE_SINGLE",
        },
      },
    });
    await patterns.createObservation({
      sourceUrl: "https://fix-b.example.test/1",
      sourceDomain: "fix-b.example.test",
      contentHash: "fx-2",
      articleTypeHint: "single_review",
      features: baseFeatures(),
      confidence: 0.8,
      metadata: {
        sourceKind: "fixture",
        learningSuitability: {
          classification: "A",
          score: 0.9,
          reasons: ["fx"],
          targetFormatKey: "NEW_RELEASE_SINGLE",
        },
      },
    });
    const result = await service.aggregateAndProposeFormat({
      formatKey: "NEW_RELEASE_SINGLE",
      sourceKind: "fixture",
      suitabilityAOnly: true,
    });
    expect(result.aggregation.meetsThresholds).toBe(true);
    expect(result.format?.status).toBe("PROPOSED");
    expect(result.learningInputDiagnostics.requiredAnalysisVersions).toBeNull();
  });
});
