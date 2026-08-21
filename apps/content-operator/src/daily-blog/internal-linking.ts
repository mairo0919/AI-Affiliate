/**
 * Internal link candidates — only when published URL already exists.
 */

export interface PublishedArticleRef {
  canonicalId: string;
  publishedUrl: string;
  articleKind: "PRODUCT" | "RANKING";
  actressKeys?: string[];
  makerKey?: string | null;
  seriesKey?: string | null;
}

export function productToRankingLinks(
  product: { canonicalId: string; actressKeys?: string[]; makerKey?: string | null; seriesKey?: string | null },
  publishedRankings: PublishedArticleRef[],
): string[] {
  const urls: string[] = [];
  for (const r of publishedRankings) {
    if (r.articleKind !== "RANKING" || !r.publishedUrl) continue;
    const actressHit = (product.actressKeys ?? []).some((a) => (r.actressKeys ?? []).includes(a));
    const makerHit = product.makerKey && r.makerKey && product.makerKey === r.makerKey;
    const seriesHit = product.seriesKey && r.seriesKey && product.seriesKey === r.seriesKey;
    if (actressHit || makerHit || seriesHit) urls.push(r.publishedUrl);
  }
  return [...new Set(urls)];
}

export function rankingToProductLinks(
  rankingProductIds: string[],
  publishedProducts: PublishedArticleRef[],
): Array<{ canonicalId: string; url: string }> {
  const map = new Map(
    publishedProducts
      .filter((p) => p.articleKind === "PRODUCT" && p.publishedUrl)
      .map((p) => [p.canonicalId, p.publishedUrl] as const),
  );
  const out: Array<{ canonicalId: string; url: string }> = [];
  for (const id of rankingProductIds) {
    const url = map.get(id);
    if (url) out.push({ canonicalId: id, url });
  }
  return out;
}
