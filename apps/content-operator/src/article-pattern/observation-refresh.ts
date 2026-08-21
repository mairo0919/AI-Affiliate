import type { AppConfig } from "@ai-affiliate/config";
import type { ArticleStructureObservation } from "@ai-affiliate/database";
import { ARTICLE_SCOPE_VERSION } from "./article-content-scope.js";
import {
  readInformationDensityVersion,
  resolveRefreshReason,
  type RefreshAnalysisReason,
} from "./analysis-versions.js";
import {
  ArticlePatternError,
  ArticlePatternService,
} from "./article-pattern-service.js";
import { canonicalizeArticlePatternUrl } from "./canonical-url.js";
import { INFORMATION_DENSITY_VERSION } from "./information-density.js";
import { readLearningSuitability } from "./learning-suitability.js";
import { resolveObservationSourceKind } from "./source-kind.js";

export {
  buildAnalysisVersions,
  readInformationDensityVersion,
} from "./analysis-versions.js";
export { INFORMATION_DENSITY_VERSION } from "./information-density.js";

export type RefreshSkipReason =
  | "already_current_scope_and_analysis"
  /** @deprecated alias kept for older call sites / logs */
  | "already_current_scope"
  | "filtered_out"
  | "invalid_url";

export type ObservationStructureSnapshot = {
  articleTypeHint: string | null;
  estimatedProductCount: number | null;
  rankingUsed: boolean | null;
  classification: "A" | "B" | "C" | null;
  suitabilityScore: number | null;
  densityBucket: string | null;
  densityScore: number | null;
};

export type ObservationRefreshCandidate = {
  observation: ArticleStructureObservation;
  canonicalUrl: string;
  previousScopeVersion: string | null;
  previousInformationDensityVersion: string | null;
  scopeOutdated: boolean;
  densityOutdated: boolean;
  refreshReason?: RefreshAnalysisReason;
};

export type ObservationRefreshItemResult = {
  status: "refreshed" | "skipped" | "failed";
  reason?: string;
  canonicalUrl: string;
  previousObservationId: string;
  newObservationId?: string;
  previousScopeVersion: string | null;
  newScopeVersion?: string | null;
  previousInformationDensityVersion: string | null;
  currentInformationDensityVersion?: string | null;
  refreshReason?: RefreshAnalysisReason;
  densityUpgraded?: boolean;
  previous: ObservationStructureSnapshot;
  current?: ObservationStructureSnapshot;
};

export type ObservationRefreshResult = {
  targetScopeVersion: string;
  targetInformationDensityVersion: string;
  domainFilter: string | null;
  processed: number;
  refreshed: number;
  skippedCurrentScope: number;
  skippedCurrentAnalysis: number;
  densityUpgraded: number;
  failed: number;
  classificationBefore: { A: number; B: number; C: number; unknown: number };
  classificationAfter: { A: number; B: number; C: number; unknown: number };
  items: ObservationRefreshItemResult[];
  aggregated: false;
  approved: false;
  activated: false;
  generated: false;
  searchUsed: false;
};

function observationTime(o: ArticleStructureObservation): number {
  const t = o.observedAt?.getTime?.() ?? new Date(o.observedAt as unknown as string).getTime();
  if (Number.isFinite(t)) return t;
  const c = o.createdAt?.getTime?.() ?? new Date(o.createdAt as unknown as string).getTime();
  return Number.isFinite(c) ? c : 0;
}

export function readArticleScopeVersion(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const scope = (metadata as { articleScope?: unknown }).articleScope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const v = (scope as { scopeVersion?: unknown }).scopeVersion;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function readDensityBucket(o: ArticleStructureObservation): string | null {
  const features =
    o.features && typeof o.features === "object" && !Array.isArray(o.features)
      ? (o.features as Record<string, unknown>)
      : null;
  const writing =
    features?.writingFeatures &&
    typeof features.writingFeatures === "object" &&
    !Array.isArray(features.writingFeatures)
      ? (features.writingFeatures as Record<string, unknown>)
      : null;
  return typeof writing?.informationDensityBucket === "string"
    ? writing.informationDensityBucket
    : null;
}

function readDensityScore(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const dens = (metadata as { densityDiagnostics?: unknown }).densityDiagnostics;
  if (!dens || typeof dens !== "object" || Array.isArray(dens)) return null;
  const score = (dens as { densityScore?: unknown }).densityScore;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function snapshotFromObservation(o: ArticleStructureObservation): ObservationStructureSnapshot {
  const features =
    o.features && typeof o.features === "object" && !Array.isArray(o.features)
      ? (o.features as Record<string, unknown>)
      : null;
  const suit = readLearningSuitability(o.metadata);
  return {
    articleTypeHint: o.articleTypeHint ?? null,
    estimatedProductCount:
      typeof features?.estimatedProductCount === "number" ? features.estimatedProductCount : null,
    rankingUsed: typeof features?.rankingUsed === "boolean" ? features.rankingUsed : null,
    classification: suit?.classification ?? null,
    suitabilityScore: typeof suit?.score === "number" ? suit.score : null,
    densityBucket: readDensityBucket(o),
    densityScore: readDensityScore(o.metadata),
  };
}

/**
 * Canonical-latest live observations that need scope and/or analysis version upgrade.
 */
export function selectObservationsForScopeRefresh(
  observations: ArticleStructureObservation[],
  options: {
    targetScopeVersion?: string;
    targetInformationDensityVersion?: string;
    sourceKind?: "live_url";
    domain?: string;
    classification?: "A" | "B" | "C";
    ids?: string[];
    urls?: string[];
    limit: number;
  },
): {
  candidates: ObservationRefreshCandidate[];
  skippedCurrentScope: ObservationRefreshCandidate[];
  skippedCurrentAnalysis: ObservationRefreshCandidate[];
  skippedOther: Array<{ id: string; reason: RefreshSkipReason }>;
} {
  const targetScopeVersion = options.targetScopeVersion ?? ARTICLE_SCOPE_VERSION;
  const targetDensityVersion =
    options.targetInformationDensityVersion ?? INFORMATION_DENSITY_VERSION;
  const sourceKind = options.sourceKind ?? "live_url";
  const domainFilter = options.domain?.trim().toLowerCase() || undefined;
  const idSet = options.ids?.length ? new Set(options.ids) : null;
  const urlCanonicals = new Set(
    (options.urls ?? [])
      .map((u) => canonicalizeArticlePatternUrl(u) ?? u.trim())
      .filter(Boolean),
  );

  const live = observations.filter(
    (o) => resolveObservationSourceKind(o.metadata) === sourceKind,
  );

  const latestByCanonical = new Map<string, ArticleStructureObservation>();
  const skippedOther: Array<{ id: string; reason: RefreshSkipReason }> = [];
  for (const row of live) {
    const canonical = canonicalizeArticlePatternUrl(row.sourceUrl);
    if (!canonical) {
      skippedOther.push({ id: row.id, reason: "invalid_url" });
      continue;
    }
    const prev = latestByCanonical.get(canonical);
    if (!prev || observationTime(row) >= observationTime(prev)) {
      latestByCanonical.set(canonical, row);
    }
  }

  let canonicalKeys = [...latestByCanonical.keys()];
  if (idSet) {
    const wanted = new Set<string>();
    for (const row of live) {
      if (!idSet.has(row.id)) continue;
      const c = canonicalizeArticlePatternUrl(row.sourceUrl);
      if (c) wanted.add(c);
    }
    canonicalKeys = canonicalKeys.filter((c) => wanted.has(c));
  }
  if (urlCanonicals.size > 0) {
    canonicalKeys = canonicalKeys.filter((c) => urlCanonicals.has(c));
  }

  const candidates: ObservationRefreshCandidate[] = [];
  const skippedCurrentAnalysis: ObservationRefreshCandidate[] = [];

  for (const canonical of canonicalKeys) {
    const row = latestByCanonical.get(canonical)!;
    if (domainFilter && row.sourceDomain.toLowerCase() !== domainFilter) {
      skippedOther.push({ id: row.id, reason: "filtered_out" });
      continue;
    }
    if (options.classification) {
      const cls = readLearningSuitability(row.metadata)?.classification;
      if (cls !== options.classification) {
        skippedOther.push({ id: row.id, reason: "filtered_out" });
        continue;
      }
    }

    const previousScopeVersion = readArticleScopeVersion(row.metadata);
    const previousInformationDensityVersion = readInformationDensityVersion(row.metadata);
    const scopeOutdated = previousScopeVersion !== targetScopeVersion;
    const densityOutdated = previousInformationDensityVersion !== targetDensityVersion;
    const refreshReason = resolveRefreshReason({ scopeOutdated, densityOutdated });

    const entryBase = {
      observation: row,
      canonicalUrl: canonical,
      previousScopeVersion,
      previousInformationDensityVersion,
      scopeOutdated,
      densityOutdated,
    };

    if (!refreshReason) {
      skippedCurrentAnalysis.push(entryBase);
      continue;
    }

    candidates.push({
      ...entryBase,
      refreshReason,
    });
  }

  candidates.sort(
    (a, b) => observationTime(a.observation) - observationTime(b.observation),
  );
  const limited = candidates.slice(0, Math.max(0, options.limit));

  return {
    candidates: limited,
    /** Alias: fully current (scope + analysis) */
    skippedCurrentScope: skippedCurrentAnalysis,
    skippedCurrentAnalysis,
    skippedOther,
  };
}

/**
 * Re-fetch + re-observe known live URLs for scope and/or analysis version upgrades.
 * Does not call Brave/Search. Does not delete previous Observations.
 */
export class ArticlePatternObservationRefreshService {
  constructor(private readonly patterns: ArticlePatternService) {}

  async refreshLiveObservations(input: {
    config: AppConfig;
    confirmExternal: boolean;
    domain?: string;
    classification?: "A" | "B" | "C";
    ids?: string[];
    urls?: string[];
    limit?: number;
    targetScopeVersion?: string;
    targetInformationDensityVersion?: string;
    /** Test: inject HTML by canonical/source URL */
    mockHtmlByUrl?: Map<string, string>;
    /** Test: provide observations instead of DB list */
    existingObservations?: ArticleStructureObservation[];
  }): Promise<ObservationRefreshResult> {
    const targetScopeVersion = input.targetScopeVersion ?? ARTICLE_SCOPE_VERSION;
    const targetInformationDensityVersion =
      input.targetInformationDensityVersion ?? INFORMATION_DENSITY_VERSION;
    const configuredMax = input.config.articlePatternRefreshMaxUrls ?? 20;
    const limit = Math.min(100, Math.max(1, input.limit ?? configuredMax));

    const rows =
      input.existingObservations ??
      (await this.patterns.listLiveObservations(500));

    const selected = selectObservationsForScopeRefresh(rows, {
      targetScopeVersion,
      targetInformationDensityVersion,
      domain: input.domain,
      classification: input.classification,
      ids: input.ids,
      urls: input.urls,
      limit,
    });

    const items: ObservationRefreshItemResult[] = [];
    const classificationBefore = { A: 0, B: 0, C: 0, unknown: 0 };
    const classificationAfter = { A: 0, B: 0, C: 0, unknown: 0 };
    const includeSkipDetails = Boolean(
      input.domain || input.ids?.length || input.urls?.length || input.classification,
    );

    for (const skip of selected.skippedCurrentAnalysis) {
      const previous = snapshotFromObservation(skip.observation);
      bumpClass(classificationBefore, previous.classification);
      bumpClass(classificationAfter, previous.classification);
      if (includeSkipDetails) {
        items.push({
          status: "skipped",
          reason: "already_current_scope_and_analysis",
          canonicalUrl: skip.canonicalUrl,
          previousObservationId: skip.observation.id,
          previousScopeVersion: skip.previousScopeVersion,
          newScopeVersion: skip.previousScopeVersion,
          previousInformationDensityVersion: skip.previousInformationDensityVersion,
          currentInformationDensityVersion: skip.previousInformationDensityVersion,
          previous,
        });
      }
    }

    let refreshed = 0;
    let failed = 0;
    let densityUpgraded = 0;

    for (const candidate of selected.candidates) {
      const previous = snapshotFromObservation(candidate.observation);
      bumpClass(classificationBefore, previous.classification);

      const mockHtml =
        input.mockHtmlByUrl?.get(candidate.canonicalUrl) ??
        input.mockHtmlByUrl?.get(candidate.observation.sourceUrl);

      try {
        const created = await this.patterns.observeFromUrl({
          sourceUrl: candidate.observation.sourceUrl,
          confirmExternal: input.confirmExternal,
          config: input.config,
          mockHtml,
          discovery: {
            discoverySource: "observation_analysis_refresh",
            targetFormatKey: "NEW_RELEASE_SINGLE",
          },
          refresh: {
            reason: candidate.refreshReason!,
            previousObservationId: candidate.observation.id,
            previousScopeVersion: candidate.previousScopeVersion,
            previousInformationDensityVersion: candidate.previousInformationDensityVersion,
          },
        });

        const current = snapshotFromObservation(created);
        const currentDensityVersion = readInformationDensityVersion(created.metadata);
        bumpClass(classificationAfter, current.classification);
        refreshed += 1;
        const densUp =
          candidate.densityOutdated &&
          currentDensityVersion === targetInformationDensityVersion;
        if (densUp) densityUpgraded += 1;
        items.push({
          status: "refreshed",
          reason: candidate.refreshReason,
          canonicalUrl: candidate.canonicalUrl,
          previousObservationId: candidate.observation.id,
          newObservationId: created.id,
          previousScopeVersion: candidate.previousScopeVersion,
          newScopeVersion: readArticleScopeVersion(created.metadata),
          previousInformationDensityVersion: candidate.previousInformationDensityVersion,
          currentInformationDensityVersion: currentDensityVersion,
          refreshReason: candidate.refreshReason,
          densityUpgraded: densUp,
          previous,
          current,
        });
      } catch (error) {
        failed += 1;
        const reason =
          error instanceof ArticlePatternError
            ? error.code
            : error instanceof Error
              ? error.message.slice(0, 120)
              : "refresh_failed";
        items.push({
          status: "failed",
          reason,
          canonicalUrl: candidate.canonicalUrl,
          previousObservationId: candidate.observation.id,
          previousScopeVersion: candidate.previousScopeVersion,
          previousInformationDensityVersion: candidate.previousInformationDensityVersion,
          previous,
        });
      }
    }

    return {
      targetScopeVersion,
      targetInformationDensityVersion,
      domainFilter: input.domain?.trim().toLowerCase() ?? null,
      processed: selected.candidates.length + selected.skippedCurrentAnalysis.length,
      refreshed,
      skippedCurrentScope: selected.skippedCurrentAnalysis.length,
      skippedCurrentAnalysis: selected.skippedCurrentAnalysis.length,
      densityUpgraded,
      failed,
      classificationBefore,
      classificationAfter,
      items,
      aggregated: false,
      approved: false,
      activated: false,
      generated: false,
      searchUsed: false,
    };
  }
}

function bumpClass(
  counts: { A: number; B: number; C: number; unknown: number },
  classification: "A" | "B" | "C" | null,
): void {
  if (classification === "A" || classification === "B" || classification === "C") {
    counts[classification] += 1;
  } else {
    counts.unknown += 1;
  }
}
