/**
 * Leadless product-intro write contract helpers.
 *
 * New write path: no article.lead field (not empty string / null).
 * Legacy read path: may still contain lead — readers tolerate absence.
 */

/** Writer-visible ARTICLE_PLAN: omit empty/legacy lead slot entirely. */
export function toWriterVisibleArticlePlan(
  plan: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...plan };
  const lead = next.lead as { facts?: unknown } | undefined;
  if (
    lead == null ||
    (Array.isArray(lead.facts) && lead.facts.length === 0)
  ) {
    delete next.lead;
  }
  return next;
}

/** Persist/publish article: remove lead key so it cannot reappear as a surface. */
export function stripArticleLeadKey<T extends Record<string, unknown>>(
  article: T,
): Omit<T, "lead"> {
  if (!Object.prototype.hasOwnProperty.call(article, "lead")) {
    return article as Omit<T, "lead">;
  }
  const rest = { ...article };
  delete rest.lead;
  return rest as Omit<T, "lead">;
}

export function articleHasLeadKey(article: unknown): boolean {
  return (
    !!article &&
    typeof article === "object" &&
    !Array.isArray(article) &&
    Object.prototype.hasOwnProperty.call(article, "lead")
  );
}

/** Legacy-only: read lead when present; never invent from summary for new writes. */
export function readLegacyLead(
  article: { lead?: unknown; summary?: unknown } | null | undefined,
): string | null {
  if (!article) return null;
  if (typeof article.lead === "string" && article.lead.trim()) {
    return article.lead.trim();
  }
  return null;
}
