import type { ArticleStructureFeatures } from "./types.js";
import {
  extractArticleContentScope,
  toArticleScopeDiagnostics,
  type ArticleContentScope,
  type ArticleScopeDiagnostics,
} from "./article-content-scope.js";
import { hashNormalizedArticleContent } from "./content-hash.js";
import {
  assertWritingFeaturesAreAbstract,
  extractWritingFeaturesWithDiagnostics,
  type InformationDensityDiagnostics,
} from "./writing-extraction.js";

const CTA_HINT =
  /詳細|購入|チェック|公式|アフィリエイト|affiliate|buy|cart|cta|公式サイト|商品ページ/i;
const RANKING_HINT =
  /ランキング|ベスト\s*\d+|best\s*\d+|ranking|top\s*\d+|おすすめ\s*\d+\s*選|第\s*[0-9０-９]+\s*位/i;
/** Headings that are site chrome / section labels, not product entries. */
const NON_PRODUCT_HEADING_RE =
  /関連記事|人気記事|おすすめ記事|最新記事|人気の記事|注目記事|カテゴリ|タグ|プロフィール|profile|アーカイブ|コメント|目次|選ぶポイント|公開事実|詳細を見る|まとめ|要約|faq|よくある質問|注意|免責|広告/i;
const PRODUCT_HEADING_RE =
  /作品|レビュー|品番|見どころ|紹介|第\s*[0-9０-９]+|[0-9０-９]+\s*位|BEST|TOP\s*\d+|おすすめ\s*\d+|SSIS|MIDV|SOE|STARS|SONE|PRED|ABF|h_\d+/i;
const PRODUCT_CODE_RE =
  /\b[a-z]{2,6}-?\d{2,4}\b|\bh_\d{3,}[a-z0-9]+|\bssis[-_]?\d+|\bmidv[-_]?\d+|\bsoe[-_]?\d+|\bstars[-_]?\d+/gi;
const FAQ_HINT = /faq|よくある質問|q&a/i;
const SUMMARY_HINT = /まとめ|要約|summary|conclusion/i;
const PROS_HINT = /メリット|デメリット|pros|cons|良い点|注意点/i;
const DISCLOSURE_HINT = /アフィリエイト|広告|PR|promoted/i;
const AGE_HINT = /18歳|年齢確認|adult|R18|アダルト/i;
const REVIEW_HINT = /レビュー|体験|感想|レビューした/i;
const CATALOG_HINT = /スペック|作品情報|発売日|収録時間|品番/i;

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchAll(html: string, re: RegExp): RegExpMatchArray[] {
  return [...html.matchAll(re)];
}

function headingLevelPattern(tag: string): string {
  const level = tag.toLowerCase().replace(/^h/, "");
  return `h${level}`;
}

function positionBucket(index: number, total: number): string {
  if (total <= 1) return "middle";
  const ratio = index / Math.max(1, total - 1);
  if (ratio < 0.33) return "top";
  if (ratio > 0.66) return "bottom";
  return "middle";
}

/**
 * Estimate product count from article-scope signals only.
 * Never uses raw ul/ol count (sidebar/related lists must not inflate).
 */
export function estimateScopedProductCount(input: {
  text: string;
  headingLabels: string[];
  headingTags: string[];
  rankingUsed: boolean;
  comparisonTableUsed: boolean;
  tableRowCount: number;
  externalProductLinkCount: number;
}): number {
  let count = 1;

  const rankedHeadings = input.headingLabels.filter((h) =>
    /第\s*[0-9０-９]+\s*位|[0-9０-９]+\s*位|BEST\s*\d+|TOP\s*\d+|ベスト\s*\d+/i.test(h),
  );
  if (rankedHeadings.length >= 2) {
    count = Math.max(count, rankedHeadings.length);
  }

  const codes = new Set(
    (input.text.toLowerCase().match(PRODUCT_CODE_RE) ?? []).map((c) =>
      c.replace(/[-_]/g, "").toLowerCase(),
    ),
  );
  if (codes.size >= 2) {
    count = Math.max(count, Math.min(20, codes.size));
  }

  const productHeadings = input.headingLabels.filter(
    (h, i) =>
      !NON_PRODUCT_HEADING_RE.test(h) &&
      (PRODUCT_HEADING_RE.test(h) ||
        (/^h2$/i.test(input.headingTags[i] ?? "") &&
          input.rankingUsed &&
          h.length >= 4)),
  );
  if (productHeadings.length >= 2) {
    count = Math.max(count, productHeadings.length);
  }

  // Comparison table rows (header excluded roughly)
  if (input.comparisonTableUsed && input.tableRowCount >= 3) {
    count = Math.max(count, Math.min(20, input.tableRowCount - 1));
  }

  // Multiple affiliate/product CTAs only when ranking body is present
  if (input.rankingUsed && input.externalProductLinkCount >= 3) {
    count = Math.max(count, Math.min(10, input.externalProductLinkCount));
  }

  // Body "N選" / BEST N explicit size when ranking
  if (input.rankingUsed) {
    const nSel = input.text.match(/(?:ベスト|おすすめ|BEST|TOP)\s*([0-9０-９]{1,2})/i);
    if (nSel?.[1]) {
      const digits = nSel[1].replace(/[０-９]/g, (d) =>
        String("０１２３４５６７８９".indexOf(d)),
      );
      const n = Number.parseInt(digits, 10);
      if (Number.isFinite(n) && n >= 2 && n <= 20) {
        count = Math.max(count, n);
      }
    }
  }

  return Math.max(1, Math.min(20, count));
}

/**
 * Ranking flag from article-scope text/headings only.
 * Does not use list counts (chrome widgets).
 */
export function detectScopedRankingUsed(input: {
  text: string;
  headingLabels: string[];
}): boolean {
  if (RANKING_HINT.test(input.text)) return true;
  return input.headingLabels.some(
    (h) => RANKING_HINT.test(h) && !NON_PRODUCT_HEADING_RE.test(h),
  );
}

/**
 * Deterministic HTML → structural features.
 * Structure signals are computed on Article Scope (SSOT), not full-page chrome.
 * Never returns or retains article prose suitable for templating.
 */
export function extractArticleStructureFeatures(input: {
  html: string;
  title?: string | null;
  sourceUrl?: string;
}): {
  features: ArticleStructureFeatures;
  articleTypeHint: string;
  contentHash: string;
  confidence: number;
  hashAlgorithm: string;
  hashBasis: string;
  normalizedLength: number;
  articleScope: ArticleScopeDiagnostics;
  scope: ArticleContentScope;
  densityDiagnostics: InformationDensityDiagnostics;
} {
  const scope = extractArticleContentScope(input.html);
  const html = scope.scopedHtml;
  const text = stripTags(html);
  const hashed = hashNormalizedArticleContent(input.html);
  const contentHash = hashed.contentHash;

  const headingMatches = matchAll(html, /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi);
  const headingPatterns = headingMatches.map((m) => headingLevelPattern(m[1] ?? "h2"));
  const headingTags = headingMatches.map((m) => (m[1] ?? "h2").toLowerCase());
  const headingLabels = headingMatches.map((m) => stripTags(m[2] ?? "").slice(0, 40));

  const images = matchAll(html, /<img\b[^>]*>/gi);
  const imagePositions = images.map((_, i) => positionBucket(i, images.length));
  const imageRoles = images.map((tag, i) => {
    const raw = typeof tag === "string" ? tag : String(tag[0] ?? "");
    if (/cover|thumb|sample|pl\.jpg/i.test(raw)) return "product";
    if (i === 0) return "hero";
    return "unknown";
  });

  const anchors = matchAll(html, /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  let internalLinkCount = 0;
  let externalProductLinkCount = 0;
  const ctaPositions: string[] = [];
  let ctaCount = 0;
  let host = "";
  try {
    host = input.sourceUrl ? new URL(input.sourceUrl).hostname : "";
  } catch {
    host = "";
  }

  for (let i = 0; i < anchors.length; i++) {
    const href = anchors[i]?.[1] ?? "";
    const label = stripTags(anchors[i]?.[2] ?? "");
    let linkHost = "";
    try {
      linkHost = new URL(href, input.sourceUrl ?? "https://example.invalid").hostname;
    } catch {
      linkHost = "";
    }
    if (host && linkHost && linkHost === host) internalLinkCount += 1;
    else if (/dmm\.|fanza\.|amazon\.|affiliate|af\.|click/i.test(href)) {
      externalProductLinkCount += 1;
    }
    if (CTA_HINT.test(label) || CTA_HINT.test(href)) {
      ctaCount += 1;
      ctaPositions.push(positionBucket(i, anchors.length));
    }
  }

  const tables = matchAll(html, /<table\b/gi).length;
  const tableRowCount = matchAll(html, /<tr\b/gi).length;
  const lists = matchAll(html, /<(ul|ol)\b/gi).length;
  const paragraphs = matchAll(html, /<p\b[^>]*>[\s\S]*?<\/p>/gi);
  const introLength = paragraphs[0]
    ? stripTags(paragraphs[0][0] ?? "").length
    : Math.min(text.length, 200);
  const totalLength = text.length;

  const rankingUsed = detectScopedRankingUsed({ text, headingLabels });
  const comparisonTableUsed = tables > 0;

  const sectionOrder: string[] = [];
  if (introLength > 0) sectionOrder.push("intro");
  if (headingMatches.length > 0) sectionOrder.push("product_sections");
  if (tables > 0) sectionOrder.push("comparison_table");
  if (lists > 0) sectionOrder.push("list");
  if (ctaCount > 0) sectionOrder.push("cta");
  if (FAQ_HINT.test(text) || headingLabels.some((h) => FAQ_HINT.test(h))) sectionOrder.push("faq");
  if (SUMMARY_HINT.test(text) || headingLabels.some((h) => SUMMARY_HINT.test(h))) {
    sectionOrder.push("summary");
  }

  const faqUsed = sectionOrder.includes("faq");
  const summaryUsed = sectionOrder.includes("summary");
  const prosConsUsed = PROS_HINT.test(text);

  let disclosurePosition: string | null = null;
  let ageNoticePosition: string | null = null;
  const chunks: Array<string | RegExpMatchArray> = paragraphs.length > 0 ? paragraphs : [text];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkText =
      typeof chunk === "string" ? chunk : stripTags(String(chunk?.[0] ?? ""));
    if (!disclosurePosition && DISCLOSURE_HINT.test(chunkText)) {
      disclosurePosition = positionBucket(i, chunks.length);
    }
    if (!ageNoticePosition && AGE_HINT.test(chunkText)) {
      ageNoticePosition = positionBucket(i, chunks.length);
    }
  }

  const reviewHits = (text.match(REVIEW_HINT) ?? []).length;
  const catalogHits = (text.match(CATALOG_HINT) ?? []).length;
  const reviewVsCatalogRatio =
    reviewHits + catalogHits === 0 ? 0.5 : reviewHits / (reviewHits + catalogHits);

  const estimatedProductCount = estimateScopedProductCount({
    text,
    headingLabels,
    headingTags,
    rankingUsed,
    comparisonTableUsed,
    tableRowCount,
    externalProductLinkCount,
  });

  const averageProductSectionLength =
    estimatedProductCount > 0 ? Math.round(totalLength / estimatedProductCount) : totalLength;

  const title = (input.title ?? "").trim();
  const seoTitlePattern =
    title.length === 0
      ? "missing"
      : title.length < 20
        ? "short"
        : title.length > 60
          ? "long"
          : RANKING_HINT.test(title)
            ? "ranking"
            : "descriptive";

  let articleTypeHint = "single_review";
  if (rankingUsed || estimatedProductCount >= 3) articleTypeHint = "ranking_or_collection";
  if (comparisonTableUsed) articleTypeHint = "comparison";
  if (estimatedProductCount === 1 && reviewVsCatalogRatio < 0.4) articleTypeHint = "catalog_overview";

  const writingExtraction = extractWritingFeaturesWithDiagnostics({
    html,
    title: input.title,
  });

  const features: ArticleStructureFeatures = {
    estimatedProductCount,
    headingCount: headingMatches.length,
    headingPatterns: headingPatterns.slice(0, 20),
    introLength,
    totalLength,
    averageProductSectionLength,
    imageCount: images.length,
    imagePositions: imagePositions.slice(0, 20),
    imageRoles: imageRoles.slice(0, 20),
    ctaCount,
    ctaPositions: ctaPositions.slice(0, 20),
    ctaStyle: ctaCount === 0 ? "none" : ctaCount === 1 ? "single" : "multiple",
    rankingUsed,
    comparisonTableUsed,
    prosConsUsed,
    summaryUsed,
    faqUsed,
    disclosurePosition,
    ageNoticePosition,
    internalLinkCount,
    externalProductLinkCount,
    tone: reviewVsCatalogRatio >= 0.6 ? "review-leaning" : "catalog-leaning",
    reviewVsCatalogRatio: Number(reviewVsCatalogRatio.toFixed(3)),
    seoTitlePattern,
    keywordPlacement: headingPatterns.includes("h1") ? ["title", "h1"] : ["title"],
    sectionOrder,
    // Deterministic writing also uses article scope (not full-page chrome).
    writingFeatures: writingExtraction.features,
  };

  const confidence = Math.min(
    0.95,
    0.35 +
      scope.confidence * 0.25 +
      (headingMatches.length > 0 ? 0.15 : 0) +
      (ctaCount > 0 ? 0.1 : 0) +
      (totalLength > 400 ? 0.1 : 0) +
      (sectionOrder.length >= 3 ? 0.1 : 0),
  );

  return {
    features,
    articleTypeHint,
    contentHash,
    confidence,
    hashAlgorithm: hashed.hashAlgorithm,
    hashBasis: hashed.hashBasis,
    normalizedLength: hashed.normalizedLength,
    articleScope: toArticleScopeDiagnostics(scope),
    scope,
    densityDiagnostics: writingExtraction.densityDiagnostics,
  };
}

/** Guard: features JSON must not contain long prose fields. */
export function assertFeaturesAreStructuralOnly(features: ArticleStructureFeatures): void {
  const serialized = JSON.stringify(features);
  if (serialized.length > 12_000) {
    throw new Error("article_structure_features_too_large");
  }
  for (const pattern of features.headingPatterns) {
    if (pattern.length > 8) throw new Error("heading_pattern_not_structural");
  }
  for (const section of features.sectionOrder) {
    if (section.length > 40 || /\s{2,}/.test(section)) {
      throw new Error("section_order_not_structural");
    }
  }
  for (const role of features.imageRoles ?? []) {
    if (role.length > 24) throw new Error("image_role_not_structural");
  }
  assertWritingFeaturesAreAbstract(features.writingFeatures);
}
