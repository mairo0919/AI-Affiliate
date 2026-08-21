import type { ArticleStructureObservation } from "@ai-affiliate/database";
import {
  getRequiredAnalysisVersionsForLearning,
  observationMeetsRequiredAnalysisVersions,
  type RequiredLearningAnalysisVersions,
} from "./analysis-versions.js";
import { canonicalizeArticlePatternUrl } from "./canonical-url.js";
import {
  evaluateSingleArticleLearningSuitability,
  readLearningSuitability,
  type LearningSuitabilityResult,
} from "./learning-suitability.js";
import { resolveObservationSourceKind, type ArticlePatternSourceKind } from "./source-kind.js";

export type ObservationLearningExclusion = {
  id: string;
  sourceUrl: string;
  canonicalUrl: string | null;
  reason:
    | "duplicate_canonical_url"
    | "duplicate_content_hash"
    | "outdated_analysis_version"
    | "suitability_not_a"
    | "invalid_url";
  keptId?: string;
};

export type LearningInputPreparation = {
  selected: ArticleStructureObservation[];
  diagnostics: {
    inputCount: number;
    afterCanonicalLatestCount: number;
    afterContentHashDedupeCount: number;
    afterAnalysisVersionFilterCount: number;
    afterSuitabilityFilterCount: number;
    duplicateCanonicalExcluded: number;
    duplicateContentHashExcluded: number;
    outdatedAnalysisExcluded: number;
    suitabilityExcluded: number;
    requiredAnalysisVersions: RequiredLearningAnalysisVersions | null;
    outdatedAnalysisObservationIds: string[];
    exclusions: ObservationLearningExclusion[];
    selectedSummaries: Array<{
      id: string;
      sourceUrl: string;
      canonicalUrl: string;
      sourceDomain: string;
      contentHash: string;
      observedAt: string;
      isLatestForCanonical: true;
      suitability: LearningSuitabilityResult | null;
    }>;
  };
};

function observationTime(o: ArticleStructureObservation): number {
  const t = o.observedAt?.getTime?.() ?? new Date(o.observedAt as unknown as string).getTime();
  if (Number.isFinite(t)) return t;
  const c = o.createdAt?.getTime?.() ?? new Date(o.createdAt as unknown as string).getTime();
  return Number.isFinite(c) ? c : 0;
}

/**
 * Prepare observations for Pattern learning / aggregate.
 * Order:
 * 1) optional sourceKind
 * 2) canonical URL → keep latest only
 * 3) identical contentHash → keep latest only
 * 4) optional current analysis version filter (scope + density)
 * 5) optional suitability=A filter
 */
export function prepareObservationsForLearning(
  observations: ArticleStructureObservation[],
  options?: {
    suitabilityAOnly?: boolean;
    targetFormatKey?: string;
    sourceKind?: ArticlePatternSourceKind | "all";
    /**
     * When true, keep only Observations whose articleScope + informationDensity
     * match current learning SSOT versions. Missing versions are outdated.
     */
    requireCurrentAnalysisVersions?: boolean;
    requiredAnalysisVersions?: RequiredLearningAnalysisVersions;
  },
): LearningInputPreparation {
  const exclusions: ObservationLearningExclusion[] = [];
  let rows = [...observations];

  if (options?.sourceKind && options.sourceKind !== "all") {
    rows = rows.filter((o) => resolveObservationSourceKind(o.metadata) === options.sourceKind);
  }

  const inputCount = rows.length;
  const requiredAnalysisVersions = options?.requireCurrentAnalysisVersions
    ? (options.requiredAnalysisVersions ?? getRequiredAnalysisVersionsForLearning())
    : null;

  // 1) Latest per canonical URL
  const byCanonical = new Map<string, ArticleStructureObservation>();
  for (const row of rows) {
    const canonical = canonicalizeArticlePatternUrl(row.sourceUrl);
    if (!canonical) {
      exclusions.push({
        id: row.id,
        sourceUrl: row.sourceUrl,
        canonicalUrl: null,
        reason: "invalid_url",
      });
      continue;
    }
    const prev = byCanonical.get(canonical);
    if (!prev) {
      byCanonical.set(canonical, row);
      continue;
    }
    if (observationTime(row) >= observationTime(prev)) {
      exclusions.push({
        id: prev.id,
        sourceUrl: prev.sourceUrl,
        canonicalUrl: canonical,
        reason: "duplicate_canonical_url",
        keptId: row.id,
      });
      byCanonical.set(canonical, row);
    } else {
      exclusions.push({
        id: row.id,
        sourceUrl: row.sourceUrl,
        canonicalUrl: canonical,
        reason: "duplicate_canonical_url",
        keptId: prev.id,
      });
    }
  }
  const afterCanonical = [...byCanonical.values()];
  const afterCanonicalLatestCount = afterCanonical.length;

  // 2) Dedupe identical contentHash (keep latest)
  const byHash = new Map<string, ArticleStructureObservation>();
  for (const row of afterCanonical) {
    const hash = row.contentHash || `missing:${row.id}`;
    const prev = byHash.get(hash);
    if (!prev) {
      byHash.set(hash, row);
      continue;
    }
    if (observationTime(row) >= observationTime(prev)) {
      exclusions.push({
        id: prev.id,
        sourceUrl: prev.sourceUrl,
        canonicalUrl: canonicalizeArticlePatternUrl(prev.sourceUrl),
        reason: "duplicate_content_hash",
        keptId: row.id,
      });
      byHash.set(hash, row);
    } else {
      exclusions.push({
        id: row.id,
        sourceUrl: row.sourceUrl,
        canonicalUrl: canonicalizeArticlePatternUrl(row.sourceUrl),
        reason: "duplicate_content_hash",
        keptId: prev.id,
      });
    }
  }
  const afterHash = [...byHash.values()];
  const afterContentHashDedupeCount = afterHash.length;

  // 3) Current analysis version filter (after latest/hash, before suitability)
  let afterAnalysis = afterHash;
  const outdatedAnalysisObservationIds: string[] = [];
  if (requiredAnalysisVersions) {
    afterAnalysis = [];
    for (const row of afterHash) {
      if (observationMeetsRequiredAnalysisVersions(row.metadata, requiredAnalysisVersions)) {
        afterAnalysis.push(row);
      } else {
        outdatedAnalysisObservationIds.push(row.id);
        exclusions.push({
          id: row.id,
          sourceUrl: row.sourceUrl,
          canonicalUrl: canonicalizeArticlePatternUrl(row.sourceUrl),
          reason: "outdated_analysis_version",
        });
      }
    }
  }
  const afterAnalysisVersionFilterCount = afterAnalysis.length;

  // 4) Suitability filter
  let selected = afterAnalysis;
  if (options?.suitabilityAOnly) {
    const targetFormatKey = options.targetFormatKey ?? "NEW_RELEASE_SINGLE";
    selected = [];
    for (const row of afterAnalysis) {
      const existing = readLearningSuitability(row.metadata);
      const suitability =
        existing ??
        evaluateSingleArticleLearningSuitability(row, { targetFormatKey });
      if (suitability.classification === "A") {
        selected.push(row);
      } else {
        exclusions.push({
          id: row.id,
          sourceUrl: row.sourceUrl,
          canonicalUrl: canonicalizeArticlePatternUrl(row.sourceUrl),
          reason: "suitability_not_a",
        });
      }
    }
  }

  const selectedSummaries = selected.map((row) => {
    const canonical = canonicalizeArticlePatternUrl(row.sourceUrl) ?? row.sourceUrl;
    const existing = readLearningSuitability(row.metadata);
    return {
      id: row.id,
      sourceUrl: row.sourceUrl,
      canonicalUrl: canonical,
      sourceDomain: row.sourceDomain,
      contentHash: row.contentHash,
      observedAt: (row.observedAt instanceof Date
        ? row.observedAt
        : new Date(row.observedAt as unknown as string)
      ).toISOString(),
      isLatestForCanonical: true as const,
      suitability:
        existing ??
        evaluateSingleArticleLearningSuitability(row, {
          targetFormatKey: options?.targetFormatKey ?? "NEW_RELEASE_SINGLE",
        }),
    };
  });

  return {
    selected,
    diagnostics: {
      inputCount,
      afterCanonicalLatestCount,
      afterContentHashDedupeCount,
      afterAnalysisVersionFilterCount,
      afterSuitabilityFilterCount: selected.length,
      duplicateCanonicalExcluded: exclusions.filter((e) => e.reason === "duplicate_canonical_url")
        .length,
      duplicateContentHashExcluded: exclusions.filter((e) => e.reason === "duplicate_content_hash")
        .length,
      outdatedAnalysisExcluded: exclusions.filter((e) => e.reason === "outdated_analysis_version")
        .length,
      suitabilityExcluded: exclusions.filter((e) => e.reason === "suitability_not_a").length,
      requiredAnalysisVersions,
      outdatedAnalysisObservationIds,
      exclusions,
      selectedSummaries,
    },
  };
}
