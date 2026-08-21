import { describe, expect, it, vi } from "vitest";
import { ARTICLE_SCOPE_VERSION } from "./article-content-scope.js";
import { INFORMATION_DENSITY_VERSION } from "./information-density.js";
import {
  buildClassifyObservationsSummary,
  buildClassifyObservationsCliPayload,
  type ClassifyObservationSummaryInput,
} from "./classify-observations-summary.js";
import { observationMeetsRequiredAnalysisVersions } from "./analysis-versions.js";
import * as patternAggregation from "./pattern-aggregation.js";
import { ArticlePatternService } from "./article-pattern-service.js";

function meta(input: {
  scopeVersion?: string | null;
  densityVersion?: string | null;
  analysisVersions?: boolean;
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = { sourceKind: "live_url" };
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
  return metadata;
}

function row(
  partial: Partial<ClassifyObservationSummaryInput> &
    Pick<ClassifyObservationSummaryInput, "classification" | "sourceDomain">,
): ClassifyObservationSummaryInput {
  return {
    isLatestForCanonical: partial.isLatestForCanonical ?? true,
    classification: partial.classification,
    sourceDomain: partial.sourceDomain,
    metadata:
      partial.metadata ??
      meta({
        scopeVersion: ARTICLE_SCOPE_VERSION,
        densityVersion: INFORMATION_DENSITY_VERSION,
      }),
  };
}

describe("buildClassifyObservationsSummary", () => {
  it("does not count old A when latest for canonical is current C", () => {
    const summary = buildClassifyObservationsSummary([
      row({
        isLatestForCanonical: false,
        classification: "A",
        sourceDomain: "a.example.test",
        metadata: meta({
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: "information_density_v1",
        }),
      }),
      row({
        isLatestForCanonical: true,
        classification: "C",
        sourceDomain: "a.example.test",
        metadata: meta({
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: INFORMATION_DENSITY_VERSION,
        }),
      }),
    ]);
    expect(summary.latestObservationCount).toBe(1);
    expect(summary.classificationCounts).toEqual({ A: 0, B: 0, C: 1 });
    expect(summary.latestACount).toBe(0);
    expect(summary.currentAnalysisACount).toBe(0);
    expect(summary.outdatedAnalysisACount).toBe(0);
  });

  it("counts latest current A", () => {
    const metadata = meta({
      scopeVersion: ARTICLE_SCOPE_VERSION,
      densityVersion: INFORMATION_DENSITY_VERSION,
    });
    expect(observationMeetsRequiredAnalysisVersions(metadata)).toBe(true);
    const summary = buildClassifyObservationsSummary([
      row({
        classification: "A",
        sourceDomain: "current.example.test",
        metadata,
      }),
    ]);
    expect(summary.latestACount).toBe(1);
    expect(summary.currentAnalysisACount).toBe(1);
    expect(summary.currentAnalysisADomains).toEqual(["current.example.test"]);
    expect(summary.currentAnalysisADomainCount).toBe(1);
    expect(summary.outdatedAnalysisACount).toBe(0);
  });

  it("does not count outdated analysis A as currentAnalysisA", () => {
    const summary = buildClassifyObservationsSummary([
      row({
        classification: "A",
        sourceDomain: "old.example.test",
        metadata: meta({
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: "information_density_v1",
        }),
      }),
      row({
        classification: "A",
        sourceDomain: "unset.example.test",
        metadata: meta({}),
      }),
    ]);
    expect(summary.latestACount).toBe(2);
    expect(summary.currentAnalysisACount).toBe(0);
    expect(summary.currentAnalysisADomainCount).toBe(0);
    expect(summary.outdatedAnalysisACount).toBe(2);
  });

  it("dedupes domains for latest A and currentAnalysisA", () => {
    const current = meta({
      scopeVersion: ARTICLE_SCOPE_VERSION,
      densityVersion: INFORMATION_DENSITY_VERSION,
    });
    const summary = buildClassifyObservationsSummary([
      row({ classification: "A", sourceDomain: "same.example.test", metadata: current }),
      row({ classification: "A", sourceDomain: "same.example.test", metadata: current }),
      row({
        classification: "A",
        sourceDomain: "other.example.test",
        metadata: current,
      }),
      row({
        classification: "A",
        sourceDomain: "old.example.test",
        metadata: meta({
          scopeVersion: ARTICLE_SCOPE_VERSION,
          densityVersion: "information_density_v1",
        }),
      }),
    ]);
    expect(summary.latestACount).toBe(4);
    expect(summary.latestADomainCount).toBe(3);
    expect(summary.latestADomains).toEqual([
      "old.example.test",
      "other.example.test",
      "same.example.test",
    ]);
    expect(summary.currentAnalysisACount).toBe(3);
    expect(summary.currentAnalysisADomainCount).toBe(2);
    expect(summary.currentAnalysisADomains).toEqual([
      "other.example.test",
      "same.example.test",
    ]);
    expect(summary.outdatedAnalysisACount).toBe(1);
  });
});

describe("buildClassifyObservationsCliPayload", () => {
  const sampleItems = [
    {
      id: "obs-1",
      sourceUrl: "https://a.example.test/x",
      canonicalUrl: "https://a.example.test/x",
      sourceDomain: "a.example.test",
      isLatestForCanonical: true,
      suitability: {
        classification: "A" as const,
        score: 0.9,
        reasons: ["test"],
      },
      writingExtractionStatus: "deterministic_only" as string | null,
      writingLlmFallbackReason: null as string | null,
    },
  ];
  const sampleSummary = buildClassifyObservationsSummary([
    row({ classification: "A", sourceDomain: "a.example.test" }),
  ]);

  it("--summary-only omits items", () => {
    const payload = buildClassifyObservationsCliPayload({
      formatKey: "NEW_RELEASE_SINGLE",
      sourceKind: "live_url",
      items: sampleItems,
      summary: sampleSummary,
      summaryOnly: true,
    });
    expect(payload.summary).toEqual(sampleSummary);
    expect(payload).not.toHaveProperty("items");
  });

  it("default payload keeps items", () => {
    const payload = buildClassifyObservationsCliPayload({
      formatKey: "NEW_RELEASE_SINGLE",
      sourceKind: "live_url",
      items: sampleItems,
      summary: sampleSummary,
    });
    expect(Array.isArray(payload.items)).toBe(true);
    expect((payload.items as unknown[]).length).toBe(1);
  });

  it("summary builders do not call aggregate / approve / activate", () => {
    const aggregateSpy = vi.spyOn(patternAggregation, "aggregateArticlePatterns");
    const approveSpy = vi.spyOn(ArticlePatternService.prototype, "approveFormat");
    const activateSpy = vi.spyOn(ArticlePatternService.prototype, "activateFormat");
    const aggregateAndProposeSpy = vi.spyOn(
      ArticlePatternService.prototype,
      "aggregateAndProposeFormat",
    );

    buildClassifyObservationsSummary([
      row({ classification: "A", sourceDomain: "a.example.test" }),
    ]);
    buildClassifyObservationsCliPayload({
      formatKey: "NEW_RELEASE_SINGLE",
      sourceKind: "live_url",
      items: sampleItems,
      summary: sampleSummary,
      summaryOnly: true,
    });

    expect(aggregateSpy).not.toHaveBeenCalled();
    expect(approveSpy).not.toHaveBeenCalled();
    expect(activateSpy).not.toHaveBeenCalled();
    expect(aggregateAndProposeSpy).not.toHaveBeenCalled();

    aggregateSpy.mockRestore();
    approveSpy.mockRestore();
    activateSpy.mockRestore();
    aggregateAndProposeSpy.mockRestore();
  });
});
