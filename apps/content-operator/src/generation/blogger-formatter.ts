import { FRESHNESS_DISCLAIMER } from "./freshness-disclaimer.js";
import type { ArticleImage } from "./article-images.js";
import type { StructureImageLayout } from "../article-pattern/structure-pattern.js";

/** Shared meta / disclosure / adult note styling for Blogger HTML. */
export const BLOG_META_NOTE_CLASS = "blog-meta-note";
export const BLOG_META_NOTE_STYLE = "font-size:10px;line-height:1.5;";

/** Theme hooks — presentation only; do not change content meaning. */
export const BLOG_HERO_CLASS = "blog-hero";
export const BLOG_SAMPLE_CLASS = "blog-sample";
export const BLOG_CTA_CLASS = "blog-cta";

/** Spacing so consecutive figures do not look glued together. */
export const BLOG_FIGURE_STYLE = "margin:1.25em 0;";

/** Sample images render at half width (hero stays full width). Theme may override. */
export const BLOG_SAMPLE_IMG_STYLE = "width:50%;max-width:100%;height:auto;display:block;";

export function formatBloggerHtml(input: {
  title: string;
  /** Legacy-only; omit or empty on new leadless writes. */
  lead?: string | null;
  sections: Array<{ heading?: string | null; paragraphs: string[]; lists?: string[] }>;
  cta: { label: string; url: string | null };
  images?: ArticleImage[];
  /** Legacy structure-pattern hint — R62 product layout ignores placement hints. */
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

  // 1. Main image (full width)
  if (hero) {
    blocks.push(renderHeroFigure(hero));
  }

  // 2. Legacy lead paragraph only when present (old ContentVersions).
  // New leadless writes go Hero → Body directly — never invent lead from summary.
  if (typeof input.lead === "string" && input.lead.trim()) {
    blocks.push(`<p>${escapeHtml(input.lead.trim())}</p>`);
  }

  // 3. Product description — single prose block (no section headings)
  for (const p of collectBodyParagraphs(input.sections)) {
    blocks.push(`<p>${escapeHtml(p)}</p>`);
  }

  // 4. Mid CTA (before sample gallery)
  blocks.push(renderCtaBlock(input.cta));

  // 5. Sample images (half width); no figcaption unless image has grounded caption SSOT
  for (const image of auxiliaries) {
    blocks.push(renderSampleFigure(image));
  }

  // 6. Bottom CTA
  blocks.push(renderCtaBlock(input.cta));

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

/** Merge section paragraphs into one explanation block (headings/lists excluded). */
export function collectBodyParagraphs(
  sections: Array<{ paragraphs?: string[] }>,
): string[] {
  const out: string[] = [];
  for (const section of sections) {
    for (const p of section.paragraphs ?? []) {
      const trimmed = p.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

/**
 * Place up to N auxiliaries after body paragraphs (legacy interleaved layout helper).
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

function renderCtaBlock(cta: { label: string; url: string | null }): string {
  if (cta.url) {
    return `<p class="${BLOG_CTA_CLASS}"><a href="${escapeAttr(cta.url)}" data-otonaselect-cta="1" data-cta="detail_confirm" data-provider="fanza" rel="noopener noreferrer">${escapeHtml(cta.label)}</a></p>`;
  }
  return `<p class="${BLOG_CTA_CLASS}">${escapeHtml(cta.label)}（リンク準備中）</p>`;
}

function renderHeroFigure(image: ArticleImage): string {
  return [
    `<figure class="${BLOG_HERO_CLASS}" style="${BLOG_FIGURE_STYLE}">`,
    `<img src="${escapeAttr(image.sourceUrl)}" alt="${escapeAttr(image.alt)}" loading="lazy" />`,
    "</figure>",
  ].join("");
}

function renderSampleFigure(image: ArticleImage): string {
  const groundedCaption = groundedImageCaption(image);
  const captionBlock = groundedCaption
    ? `<figcaption>${escapeHtml(groundedCaption)}</figcaption>`
    : "";
  return [
    `<figure class="${BLOG_SAMPLE_CLASS}" style="${BLOG_FIGURE_STYLE}">`,
    `<img src="${escapeAttr(image.sourceUrl)}" alt="${escapeAttr(image.alt)}" loading="lazy" style="${BLOG_SAMPLE_IMG_STYLE}" />`,
    captionBlock,
    "</figure>",
  ].join("");
}

/** Only explicit grounded caption SSOT on ArticleImage — no list/alt projection. */
function groundedImageCaption(image: ArticleImage): string | null {
  const raw = (image as ArticleImage & { groundedCaption?: string | null }).groundedCaption;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
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
