import { FRESHNESS_DISCLAIMER } from "./freshness-disclaimer.js";
import type { ArticleImage } from "./article-images.js";
import type { StructureImageLayout } from "../article-pattern/structure-pattern.js";

/** Shared meta / disclosure / adult note styling for Blogger HTML. */
export const BLOG_META_NOTE_CLASS = "blog-meta-note";
export const BLOG_META_NOTE_STYLE = "font-size:10px;line-height:1.5;";

/** Spacing so consecutive figures do not look glued together. */
export const BLOG_FIGURE_STYLE = "margin:1.25em 0;";

export function formatBloggerHtml(input: {
  title: string;
  lead: string;
  sections: Array<{ heading?: string | null; paragraphs: string[]; lists?: string[] }>;
  cta: { label: string; url: string | null };
  images?: ArticleImage[];
  imageLayout?: StructureImageLayout | null;
  disclosure?: string;
  adultNotice?: string;
  freshnessDisclaimer?: string;
  /** Prebuilt JSON-LD script; skipped when HTML already has Article/BlogPosting ld+json. */
  jsonLdScript?: string | null;
}): string {
  const blocks: string[] = [];
  const hero = (input.images ?? []).find((img) => img.role === "hero");
  const auxiliaries = (input.images ?? []).filter((img) => img.role === "auxiliary");
  const layout = input.imageLayout ?? {
    heroPosition: "before_lead" as const,
    auxiliaryPosition: "after_first_section" as const,
    preferredImageCount: Math.max(1, (input.images ?? []).length || 2),
  };

  // Layout: hero → lead → sample → body(+samples) → remaining samples → CTA
  if (hero && layout.heroPosition === "before_lead") {
    blocks.push(renderFigure(hero));
  }

  blocks.push(`<p>${escapeHtml(input.lead)}</p>`);

  if (hero && layout.heroPosition === "after_lead") {
    blocks.push(renderFigure(hero));
  }

  const auxQueue = [...auxiliaries];

  // First sample immediately after lead (product-intro rhythm).
  if (auxQueue.length > 0) {
    blocks.push(renderFigure(auxQueue.shift()!));
  }

  const bodyParaTotal = input.sections.reduce(
    (n, s) => n + s.paragraphs.filter((p) => p.trim()).length,
    0,
  );
  const insertAfter = new Set(planAuxiliaryInsertIndexes(bodyParaTotal, auxQueue.length));
  let bodyParaIndex = 0;

  for (const section of input.sections) {
    const heading = section.heading?.trim();
    if (heading) {
      blocks.push(`<h2>${escapeHtml(heading)}</h2>`);
    }
    for (const p of section.paragraphs) {
      blocks.push(`<p>${escapeHtml(p)}</p>`);
      bodyParaIndex += 1;
      if (insertAfter.has(bodyParaIndex) && auxQueue.length > 0) {
        blocks.push(renderFigure(auxQueue.shift()!));
        insertAfter.delete(bodyParaIndex);
      }
    }
    if (section.lists?.length) {
      blocks.push("<ul>");
      for (const item of section.lists) {
        blocks.push(`<li>${escapeHtml(item)}</li>`);
      }
      blocks.push("</ul>");
    }
  }

  // Remaining samples before CTA (may be consecutive; figure margin separates them).
  while (auxQueue.length > 0) {
    blocks.push(renderFigure(auxQueue.shift()!));
  }

  if (input.cta.url) {
    blocks.push(
      `<p><a href="${escapeAttr(input.cta.url)}">${escapeHtml(input.cta.label)}</a></p>`,
    );
  } else {
    blocks.push(`<p>${escapeHtml(input.cta.label)}（リンク準備中）</p>`);
  }

  const freshness = input.freshnessDisclaimer ?? FRESHNESS_DISCLAIMER;
  const disclosure = input.disclosure ?? "本記事はアフィリエイト広告を含む場合があります。";
  const adult = input.adultNotice ?? "18歳未満の方はご利用いただけません。";
  blocks.push(renderMetaNote(freshness));
  blocks.push(renderMetaNote(disclosure));
  blocks.push(renderMetaNote(adult));
  const html = blocks.join("\n");
  const ld = input.jsonLdScript?.trim();
  if (ld && !(/application\/ld\+json/i.test(html) && /BlogPosting|Article/i.test(html))) {
    return `${html}\n${ld}`;
  }
  return html;
}

/**
 * Place up to N auxiliaries after body paragraphs (not 1:1 required).
 * Extra auxiliaries are appended by the caller before CTA.
 */
export function planAuxiliaryInsertIndexes(
  bodyParagraphCount: number,
  auxiliaryCount: number,
): number[] {
  if (auxiliaryCount <= 0 || bodyParagraphCount <= 0) return [];
  const n = Math.min(auxiliaryCount, bodyParagraphCount);
  if (n === 1) return [1];
  const indexes: number[] = [];
  for (let i = 1; i <= n; i++) {
    const idx = Math.min(
      bodyParagraphCount,
      Math.max(1, Math.round((bodyParagraphCount * i) / n)),
    );
    if (!indexes.includes(idx)) indexes.push(idx);
  }
  let fill = 1;
  while (indexes.length < n && fill <= bodyParagraphCount) {
    if (!indexes.includes(fill)) indexes.push(fill);
    fill += 1;
  }
  return indexes.sort((a, b) => a - b).slice(0, n);
}

function renderMetaNote(text: string): string {
  return `<p class="${BLOG_META_NOTE_CLASS}" style="${BLOG_META_NOTE_STYLE}">${escapeHtml(text)}</p>`;
}

function renderFigure(image: ArticleImage): string {
  return [
    `<figure style="${BLOG_FIGURE_STYLE}">`,
    `<img src="${escapeAttr(image.sourceUrl)}" alt="${escapeAttr(image.alt)}" loading="lazy" />`,
    "</figure>",
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
