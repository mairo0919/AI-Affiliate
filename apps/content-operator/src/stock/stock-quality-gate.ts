/**
 * Deterministic auxiliary safety checks for stock/repair.
 * Never replaces canonical runQualityReviews / ContentReviewService.
 */

import {
  classifyCastShape,
  extractItemListCatalogFacts,
  shouldAvoidSingularPerformerFraming,
} from "./ensure-official-enrichment.js";
import {
  extractSynopsisTheme,
  isMechanicalTemplateTitle,
  isPerformerGenreListTitle,
} from "./repair-quality-guard.js";

function plainTextLength(htmlOrText: unknown): number {
  return String(htmlOrText ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

const GENERIC_PROSE_RE =
  /魅力を存分に味わえる|濃厚な内容|おすすめです|じっくり楽しみたい方|ボリューム感|刺激的な展開/g;

/**
 * Auxiliary gate after Review PASS — thin/generic/multi-performer misframe → hold.
 */
export function evaluateStockArticleQualityGate(input: {
  productTitle: string;
  rawData: unknown;
  structuredContent: Record<string, unknown>;
  writerTitle?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const catalog = extractItemListCatalogFacts(input.rawData);
  const actors = catalog.actors;
  const castShape = classifyCastShape({ actors, productTitle: input.productTitle });
  const title =
    input.writerTitle?.trim() ||
    String(input.structuredContent.title ?? input.structuredContent.seoTitle ?? "").trim() ||
    "";
  const body = plainTextLength(
    input.structuredContent.bodyHtml ??
      input.structuredContent.body ??
      input.structuredContent.html ??
      input.structuredContent.contentHtml,
  );
  const bodyText = String(
    input.structuredContent.bodyHtml ??
      input.structuredContent.body ??
      input.structuredContent.html ??
      "",
  ).replace(/<[^>]+>/g, " ");
  const genericHits = bodyText.match(GENERIC_PROSE_RE)?.length ?? 0;
  const sentences = Math.max(
    1,
    bodyText.split(/[。．.!?！？\n]/).filter((s) => s.trim().length > 8).length,
  );
  const genericRatio = genericHits / sentences;

  if (shouldAvoidSingularPerformerFraming({ actors, productTitle: input.productTitle })) {
    const singularHit = actors.find(
      (a) =>
        a.length >= 2 &&
        (title.includes(`${a}出演`) ||
          title.includes(`${a}が魅せる`) ||
          title.includes(`${a}が贈る`) ||
          (/^注目は.+｜/.test(title) && title.includes(a))),
    );
    const namedInTitle = actors.filter((a) => a.length >= 2 && title.includes(a));
    if (
      singularHit ||
      (namedInTitle.length === 1 && actors.length >= 3 && /出演|が魅せる|が贈る/.test(title))
    ) {
      return {
        ok: false,
        reason: `MULTI_PERFORMER_SINGULAR_TITLE:${castShape}`,
      };
    }
  }

  if (
    /^(?:ベストと総集編|ベスト・総集編|女優ベスト・総集編|ベスト|総集編)(?:の見どころ(?:整理)?|ガイド)?$/u.test(
      title,
    )
  ) {
    return { ok: false, reason: "GENERIC_FORM_TITLE" };
  }

  if (isPerformerGenreListTitle(title, actors)) {
    return { ok: false, reason: "PERFORMER_GENRE_LIST_TITLE" };
  }

  const synopsis = extractSynopsisTheme(input.productTitle, actors);
  if (synopsis && isMechanicalTemplateTitle(title)) {
    return { ok: false, reason: "MECHANICAL_TEMPLATE_OVER_SYNOPSIS" };
  }
  if (
    synopsis &&
    !title.includes(synopsis.slice(0, Math.min(6, synopsis.length))) &&
    isPerformerGenreListTitle(title, actors)
  ) {
    return { ok: false, reason: "SYNOPSIS_IGNORED_FOR_GENRE_TITLE" };
  }

  if (
    body > 0 &&
    body < 420 &&
    (castShape === "BEST_COMPILATION" || actors.length >= 2 || catalog.genres.length >= 3)
  ) {
    return { ok: false, reason: `THIN_ARTICLE_FOR_RICH_CAST:body=${body}` };
  }

  if (body > 0 && body < 280) {
    return { ok: false, reason: `THIN_ARTICLE:body=${body}` };
  }

  if (genericRatio >= 0.35 && genericHits >= 2) {
    return { ok: false, reason: `GENERIC_PROSE_RATIO:${genericRatio.toFixed(2)}` };
  }

  return { ok: true };
}
