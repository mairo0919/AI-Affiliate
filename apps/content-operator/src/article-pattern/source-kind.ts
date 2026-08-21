/** Observation provenance for aggregation filtering (SSOT on Observation.metadata.sourceKind). */
export type ArticlePatternSourceKind = "fixture" | "live_url";

export const ARTICLE_PATTERN_SOURCE_KINDS = ["fixture", "live_url"] as const;

export function parseSourceKind(raw: unknown): ArticlePatternSourceKind | null {
  if (raw === "fixture" || raw === "live_url") return raw;
  return null;
}

/**
 * Resolve sourceKind from Observation metadata.
 * Legacy rows without sourceKind are treated as fixture (never auto-included in live-only aggregate).
 */
export function resolveObservationSourceKind(metadata: unknown): ArticlePatternSourceKind {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const kind = parseSourceKind((metadata as { sourceKind?: unknown }).sourceKind);
    if (kind) return kind;
  }
  return "fixture";
}

export function isNonEmptyWritingPolicy(policy: unknown): boolean {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return false;
  return Object.keys(policy as Record<string, unknown>).length > 0;
}
