import { ARTICLE_SCOPE_VERSION } from "./article-content-scope.js";
import { INFORMATION_DENSITY_VERSION } from "./information-density.js";

/** Structure extraction logic version (bump when structure SSOT changes). */
export const STRUCTURE_ANALYSIS_VERSION = "structure_v1";

/** Writing feature extraction logic version (deterministic SSOT family). */
export const WRITING_ANALYSIS_VERSION = "writing_v1";

export type ObservationAnalysisVersions = {
  articleScope: string;
  structure: string;
  writing: string;
  informationDensity: string;
};

export type RequiredLearningAnalysisVersions = {
  articleScope: string;
  informationDensity: string;
};

export function buildAnalysisVersions(input?: {
  articleScope?: string;
  structure?: string;
  writing?: string;
  informationDensity?: string;
}): ObservationAnalysisVersions {
  return {
    articleScope: input?.articleScope ?? ARTICLE_SCOPE_VERSION,
    structure: input?.structure ?? STRUCTURE_ANALYSIS_VERSION,
    writing: input?.writing ?? WRITING_ANALYSIS_VERSION,
    informationDensity: input?.informationDensity ?? INFORMATION_DENSITY_VERSION,
  };
}

/** Versions required for NEW_RELEASE_SINGLE live_url learning / aggregate. */
export function getRequiredAnalysisVersionsForLearning(): RequiredLearningAnalysisVersions {
  return {
    articleScope: ARTICLE_SCOPE_VERSION,
    informationDensity: INFORMATION_DENSITY_VERSION,
  };
}

export function readAnalysisVersions(metadata: unknown): Partial<ObservationAnalysisVersions> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const raw = (metadata as { analysisVersions?: unknown }).analysisVersions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<ObservationAnalysisVersions> = {};
  if (typeof o.articleScope === "string" && o.articleScope) out.articleScope = o.articleScope;
  if (typeof o.structure === "string" && o.structure) out.structure = o.structure;
  if (typeof o.writing === "string" && o.writing) out.writing = o.writing;
  if (typeof o.informationDensity === "string" && o.informationDensity) {
    out.informationDensity = o.informationDensity;
  }
  return out;
}

export function readArticleScopeVersionFromMetadata(metadata: unknown): string | null {
  const fromAnalysis = readAnalysisVersions(metadata).articleScope;
  if (fromAnalysis) return fromAnalysis;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const scope = (metadata as { articleScope?: unknown }).articleScope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const v = (scope as { scopeVersion?: unknown }).scopeVersion;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * informationDensity analysis version from Observation metadata.
 * Missing / empty → treated as legacy (pre-v2).
 */
export function readInformationDensityVersion(metadata: unknown): string | null {
  const fromAnalysis = readAnalysisVersions(metadata).informationDensity;
  if (fromAnalysis) return fromAnalysis;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const dens = (metadata as { densityDiagnostics?: unknown }).densityDiagnostics;
  if (dens && typeof dens === "object" && !Array.isArray(dens)) {
    const v = (dens as { version?: unknown }).version;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/**
 * True when Observation meets required scope + density analysis versions.
 * Missing versions are outdated.
 */
export function observationMeetsRequiredAnalysisVersions(
  metadata: unknown,
  required: RequiredLearningAnalysisVersions = getRequiredAnalysisVersionsForLearning(),
): boolean {
  const scope = readArticleScopeVersionFromMetadata(metadata);
  const dens = readInformationDensityVersion(metadata);
  return scope === required.articleScope && dens === required.informationDensity;
}

export type RefreshAnalysisReason =
  | "scope_upgrade"
  | "density_upgrade"
  | "analysis_upgrade";

export function resolveRefreshReason(input: {
  scopeOutdated: boolean;
  densityOutdated: boolean;
}): RefreshAnalysisReason | null {
  if (input.scopeOutdated && input.densityOutdated) return "analysis_upgrade";
  if (input.scopeOutdated) return "scope_upgrade";
  if (input.densityOutdated) return "density_upgrade";
  return null;
}
