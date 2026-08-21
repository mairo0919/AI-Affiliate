import {
  getRequiredAnalysisVersionsForLearning,
  observationMeetsRequiredAnalysisVersions,
} from "./analysis-versions.js";
import type { LearningSuitabilityClass } from "./learning-suitability.js";

export type ClassifyObservationSummaryInput = {
  isLatestForCanonical: boolean;
  classification: LearningSuitabilityClass;
  sourceDomain: string;
  /** Observation metadata — version check via observationMeetsRequiredAnalysisVersions */
  metadata: unknown;
};

export type ClassifyObservationsSummary = {
  latestObservationCount: number;
  classificationCounts: { A: number; B: number; C: number };
  latestACount: number;
  latestADomains: string[];
  latestADomainCount: number;
  currentAnalysisACount: number;
  currentAnalysisADomains: string[];
  currentAnalysisADomainCount: number;
  outdatedAnalysisACount: number;
};

/**
 * Ops summary for classify-observations: canonical-latest only.
 * Current analysis = existing SSOT (article_scope_v1 + information_density_v2).
 */
export function buildClassifyObservationsSummary(
  items: ClassifyObservationSummaryInput[],
): ClassifyObservationsSummary {
  const required = getRequiredAnalysisVersionsForLearning();
  const latest = items.filter((i) => i.isLatestForCanonical);

  const classificationCounts = { A: 0, B: 0, C: 0 };
  const latestADomains = new Set<string>();
  const currentAnalysisADomains = new Set<string>();
  let latestACount = 0;
  let currentAnalysisACount = 0;
  let outdatedAnalysisACount = 0;

  for (const item of latest) {
    classificationCounts[item.classification] += 1;
    if (item.classification !== "A") continue;
    latestACount += 1;
    latestADomains.add(item.sourceDomain);
    if (observationMeetsRequiredAnalysisVersions(item.metadata, required)) {
      currentAnalysisACount += 1;
      currentAnalysisADomains.add(item.sourceDomain);
    } else {
      outdatedAnalysisACount += 1;
    }
  }

  const latestADomainList = [...latestADomains].sort();
  const currentAnalysisADomainList = [...currentAnalysisADomains].sort();

  return {
    latestObservationCount: latest.length,
    classificationCounts,
    latestACount,
    latestADomains: latestADomainList,
    latestADomainCount: latestADomainList.length,
    currentAnalysisACount,
    currentAnalysisADomains: currentAnalysisADomainList,
    currentAnalysisADomainCount: currentAnalysisADomainList.length,
    outdatedAnalysisACount,
  };
}

/** Build classify-observations CLI JSON (summary always; items unless summary-only). */
export function buildClassifyObservationsCliPayload(input: {
  formatKey: string;
  sourceKind: string;
  items: Array<{
    id: string;
    sourceUrl: string;
    canonicalUrl: string | null;
    sourceDomain: string;
    isLatestForCanonical?: boolean;
    suitability: {
      classification: LearningSuitabilityClass;
      score: number;
      reasons: string[];
    };
    writingExtractionStatus?: string | null;
    writingLlmFallbackReason?: string | null;
  }>;
  summary: ClassifyObservationsSummary;
  summaryOnly?: boolean;
}): Record<string, unknown> {
  const { formatKey, sourceKind, items, summary, summaryOnly } = input;
  const counts = { A: 0, B: 0, C: 0 };
  const aDomains = new Set<string>();
  for (const item of items) {
    counts[item.suitability.classification] += 1;
    if (item.suitability.classification === "A") aDomains.add(item.sourceDomain);
  }
  const payload: Record<string, unknown> = {
    formatKey,
    sourceKind,
    total: items.length,
    counts,
    aDomainCount: aDomains.size,
    aDomains: [...aDomains],
    duplicateExcludedEstimate: items.filter((i) => i.isLatestForCanonical === false).length,
    summary,
    note: "No article body in output. Reclassify only — no aggregate/approve/activate.",
  };
  if (!summaryOnly) {
    payload.items = items.map((item) => ({
      id: item.id,
      sourceUrl: item.sourceUrl,
      canonicalUrl: item.canonicalUrl,
      sourceDomain: item.sourceDomain,
      isLatestForCanonical: item.isLatestForCanonical === true,
      classification: item.suitability.classification,
      score: item.suitability.score,
      reasons: item.suitability.reasons,
      writingExtractionStatus: item.writingExtractionStatus ?? null,
      writingLlmFallback: Boolean(item.writingLlmFallbackReason),
      writingLlmFallbackReason: item.writingLlmFallbackReason ?? null,
    }));
  }
  return payload;
}
