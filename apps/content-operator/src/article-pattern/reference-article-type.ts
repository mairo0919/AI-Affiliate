/**
 * Reference article types — isolate Writing Skeletons by genre.
 * Never apply ranking skeleton to single_product (and vice versa).
 */

export const REFERENCE_ARTICLE_TYPES = [
  "single_product",
  "ranking",
  "roundup",
  "comparison",
  "new_release",
  "recommendation",
] as const;

export type ReferenceArticleType = (typeof REFERENCE_ARTICLE_TYPES)[number];

/** Alias: roundup == multiple_products */
export type ReferenceArticleTypeAlias = ReferenceArticleType | "multiple_products";

export function normalizeReferenceArticleType(
  raw: string | null | undefined,
): ReferenceArticleType | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t === "multiple_products" || t === "roundup_multiple") return "roundup";
  if ((REFERENCE_ARTICLE_TYPES as readonly string[]).includes(t)) {
    return t as ReferenceArticleType;
  }
  return null;
}

/**
 * Deterministic classifier from URL/title/outline — no LLM.
 * Does not invent unseen body content.
 */
export function classifyArticleType(input: {
  url?: string | null;
  title?: string | null;
  headingOutline?: string[] | null;
}): ReferenceArticleType {
  const title = (input.title ?? "").trim();
  const url = (input.url ?? "").trim().toLowerCase();
  const headings = (input.headingOutline ?? []).join("\n");
  const blob = `${title}\n${headings}\n${url}`;

  if (/トップ\s*\d+|TOP\s*\d+|ランキング|人気作品|名作AVトップ/i.test(blob)) {
    return "ranking";
  }
  if (/\d+位[:：]|第\d+位/.test(blob) && (/ランキング|人気|TOP/i.test(blob) || (input.headingOutline ?? []).length >= 5)) {
    return "ranking";
  }
  if (/比較|vs\.?|どっち|違い/i.test(blob)) return "comparison";
  if (/おすすめ\d+|まとめ\d+|ピックアップ\d+|厳選\d+/i.test(blob) && !/ランキング|トップ\d+/i.test(blob)) {
    return "roundup";
  }
  if (/新作|発売|リリース|今月のおすすめ/i.test(blob)) return "new_release";
  if (/おすすめ|推薦|必見/i.test(title) && !/ランキング|トップ\d+/i.test(blob)) {
    return "recommendation";
  }
  return "single_product";
}

/** Hard isolation: generation article type must match reference library type. */
export function articleTypesCompatibleForSkeleton(
  generationType: ReferenceArticleType,
  referenceType: ReferenceArticleType,
): boolean {
  if (generationType === referenceType) return true;
  // Soft aliases only within multi-product family
  const multi = new Set<ReferenceArticleType>(["ranking", "roundup", "comparison"]);
  if (multi.has(generationType) && multi.has(referenceType)) {
    // ranking ≠ roundup for skeleton selection — keep strict
    return false;
  }
  return false;
}
