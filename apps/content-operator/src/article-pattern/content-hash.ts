import { createHash } from "node:crypto";
import {
  ARTICLE_PATTERN_HASH_BASIS,
  extractArticleContentScope,
} from "./article-content-scope.js";

export const ARTICLE_PATTERN_HASH_ALGORITHM = "sha256";
export { ARTICLE_PATTERN_HASH_BASIS };

/**
 * Extract ephemeral normalized main-article text for hashing.
 * Result must not be persisted to DB.
 * Delegates to shared Article Scope SSOT (article_scope_v1).
 */
export function extractNormalizedMainArticleText(html: string): string {
  return extractArticleContentScope(html).normalizedText;
}

export function hashNormalizedArticleContent(html: string): {
  contentHash: string;
  hashAlgorithm: typeof ARTICLE_PATTERN_HASH_ALGORITHM;
  hashBasis: typeof ARTICLE_PATTERN_HASH_BASIS;
  normalizedLength: number;
  scopeVersion: string;
  selectorKind: string;
  fallbackUsed: boolean;
} {
  const scope = extractArticleContentScope(html);
  const contentHash = createHash("sha256")
    .update(scope.normalizedText, "utf8")
    .digest("hex");
  return {
    contentHash,
    hashAlgorithm: ARTICLE_PATTERN_HASH_ALGORITHM,
    hashBasis: ARTICLE_PATTERN_HASH_BASIS,
    normalizedLength: scope.normalizedLength,
    scopeVersion: scope.scopeVersion,
    selectorKind: scope.selectorKind,
    fallbackUsed: scope.fallbackUsed,
  };
}
