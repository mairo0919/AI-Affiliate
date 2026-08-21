import type { ArticleFormatDefinition } from "@ai-affiliate/database";
import type { ArticleFormatSpec } from "./types.js";
import {
  parseStructurePatterns,
  type StructurePattern,
} from "./structure-pattern.js";
import {
  parseEditorialPatterns,
  type EditorialPattern,
} from "./editorial-pattern.js";

/** ACTIVE ArticleFormat resolved for generation / Quality Gate (single SSOT shape). */
export type ResolvedActiveFormat = {
  formatId: string;
  formatKey: string;
  spec: ArticleFormatSpec;
  /**
   * Learned Structure Patterns from A-rated articles (abstract only).
   * Empty when not yet extracted — generation remains format+writingPolicy compatible.
   */
  structurePatterns: StructurePattern[];
  /**
   * Learned Editorial/Writing Patterns (opening, claim pick, transitions, CTA, title).
   * Separate from Structure — how to write inside the skeleton.
   */
  editorialPatterns: EditorialPattern[];
};

export type ResolveActiveFormat = (
  formatKey: string,
) => Promise<ResolvedActiveFormat | null>;

type ActiveFormatLookup = {
  getActiveFormatByKey: (formatKey: string) => Promise<ArticleFormatDefinition | null>;
  parseSpec: (format: ArticleFormatDefinition) => ArticleFormatSpec | null;
};

/**
 * SSOT factory: ACTIVE FormatDefinition → FormatSpec for Generation + Quality Gate.
 * Do not duplicate this lookup in createP45Stack / createAdminStack.
 */
export function createResolveActiveFormat(patterns: ActiveFormatLookup): ResolveActiveFormat {
  return async (formatKey: string) => {
    const active = await patterns.getActiveFormatByKey(formatKey);
    if (!active) return null;
    const spec = patterns.parseSpec(active);
    if (!spec) return null;
    const meta =
      active.metadata && typeof active.metadata === "object" && !Array.isArray(active.metadata)
        ? (active.metadata as Record<string, unknown>)
        : {};
    return {
      formatId: active.id,
      formatKey: active.formatKey,
      spec,
      structurePatterns: parseStructurePatterns(meta.structurePatterns),
      editorialPatterns: parseEditorialPatterns(meta.editorialPatterns),
    };
  };
}

/** Spec-only adapter when a caller only needs ArticleFormatSpec. */
export function asResolveFormatSpec(
  resolve: ResolveActiveFormat,
): (formatKey: string) => Promise<ArticleFormatSpec | null> {
  return async (formatKey) => (await resolve(formatKey))?.spec ?? null;
}
