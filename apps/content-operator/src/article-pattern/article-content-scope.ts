/**
 * Shared article-content scope for Article Pattern learning.
 * Used by contentHash and structure extraction so they do not drift.
 * scopedHtml / normalizedText are ephemeral — never persist to DB.
 */

export const ARTICLE_SCOPE_VERSION = "article_scope_v1";

/** Hash basis remains the normalized-main-article contract name. */
export const ARTICLE_PATTERN_HASH_BASIS = "normalized_main_article_v1";

export type ArticleScopeSelectorKind =
  | "article"
  | "role_main"
  | "itemprop_article_body"
  | "heuristic_content"
  | "body_fallback";

export type ArticleContentScope = {
  /** HTML fragment of the selected main article region (ephemeral). */
  scopedHtml: string;
  selectorKind: ArticleScopeSelectorKind;
  scopeVersion: typeof ARTICLE_SCOPE_VERSION;
  fallbackUsed: boolean;
  confidence: number;
  /** Lowercased whitespace-normalized text for hashing (ephemeral). */
  normalizedText: string;
  normalizedLength: number;
};

export type ArticleScopeDiagnostics = {
  selectorKind: ArticleScopeSelectorKind;
  scopeVersion: typeof ARTICLE_SCOPE_VERSION;
  fallbackUsed: boolean;
  confidence: number;
};

const MIN_MAIN_TEXT_LEN = 80;

function attrValue(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m?.[1] ?? "";
}

/** Index just after the matching closing tag, or -1. */
function findMatchingClose(html: string, tag: string, from: number): number {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const close = new RegExp(`</${tag}\\s*>`, "gi");
  let depth = 1;
  let i = from;
  while (depth > 0 && i < html.length) {
    open.lastIndex = i;
    close.lastIndex = i;
    const o = open.exec(html);
    const c = close.exec(html);
    if (!c) return -1;
    if (o && o.index < c.index) {
      depth += 1;
      i = o.index + o[0].length;
    } else {
      depth -= 1;
      i = c.index + c[0].length;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Remove elements whose class or id token matches `tokenRe`.
 */
function removeElementsMatchingAttr(html: string, tokenRe: RegExp): string {
  const openRe =
    /<(div|section|ul|ol|nav|aside|table|article)\b([^>]*?)>/gi;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  const src = html;
  while ((m = openRe.exec(src))) {
    const attrs = m[2] ?? "";
    const classId = `${attrValue(attrs, "class")} ${attrValue(attrs, "id")}`;
    if (!tokenRe.test(classId)) continue;
    const tag = (m[1] ?? "div").toLowerCase();
    const from = m.index;
    const innerStart = m.index + m[0].length;
    const end = findMatchingClose(src, tag, innerStart);
    if (end < 0) continue;
    out += src.slice(last, from);
    last = end;
    openRe.lastIndex = end;
  }
  out += src.slice(last);
  return out.length > 0 ? out : html;
}

/**
 * Strip chrome that must never contribute to article structure / hash.
 * Order matches the historical normalized_main_article_v1 pre-clean.
 */
export function stripNonArticleChrome(html: string): string {
  let work = html;
  work = work
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  for (let i = 0; i < 6; i++) {
    const before = work;
    work = removeElementsMatchingAttr(
      work,
      /\b(ad|ads|advert|sponsor|related|recommend|ranking-widget|sidebar|social|share|cookie|banner|popular-posts|widget)\b/i,
    );
    if (work === before) break;
  }
  return work;
}

function stripToNormalizedText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tryExtract(html: string, openRe: RegExp): string | null {
  const m = openRe.exec(html);
  if (!m) return null;
  const tagMatch = m[0].match(/^<([a-z0-9]+)/i);
  const tag = (tagMatch?.[1] ?? "div").toLowerCase();
  const innerStart = m.index + m[0].length;
  const afterClose = findMatchingClose(html, tag, innerStart);
  if (afterClose < 0) return null;
  const closeIdx = html.toLowerCase().lastIndexOf(`</${tag}`, afterClose);
  if (closeIdx < innerStart) return null;
  return html.slice(innerStart, closeIdx);
}

/**
 * Extract the main article region used for hashing and structure features.
 * Selector priority (canonical for hash + structure):
 * 1. <article>
 * 2. <main> / role=main
 * 3. itemprop=articleBody
 * 4. heuristic content containers (entry-content, post-content, …)
 * 5. <body> / full document fallback
 */
export function extractArticleContentScope(html: string): ArticleContentScope {
  const work = stripNonArticleChrome(html);

  const attempts: Array<{
    kind: ArticleScopeSelectorKind;
    confidence: number;
    openRe: RegExp;
  }> = [
    { kind: "article", confidence: 0.92, openRe: /<(article)\b[^>]*>/i },
    { kind: "role_main", confidence: 0.88, openRe: /<(main)\b[^>]*>/i },
    {
      kind: "role_main",
      confidence: 0.85,
      openRe: /<(div|section)\b[^>]*role=["']main["'][^>]*>/i,
    },
    {
      kind: "itemprop_article_body",
      confidence: 0.85,
      openRe: /<(div|section|article)\b[^>]*itemprop=["']articleBody["'][^>]*>/i,
    },
    {
      kind: "heuristic_content",
      confidence: 0.75,
      openRe:
        /<(div|section|article)\b[^>]*(?:class|id)=["'][^"']*(?:entry-content|article-body|article_body|post-content|post_content|entryBody|skin-entryBody|main-content|main_text)[^"']*["'][^>]*>/i,
    },
  ];

  for (const a of attempts) {
    const inner = tryExtract(work, a.openRe);
    if (inner && stripToNormalizedText(inner).length >= MIN_MAIN_TEXT_LEN) {
      const normalizedText = stripToNormalizedText(inner);
      return {
        scopedHtml: inner,
        selectorKind: a.kind,
        scopeVersion: ARTICLE_SCOPE_VERSION,
        fallbackUsed: false,
        confidence: a.confidence,
        normalizedText,
        normalizedLength: normalizedText.length,
      };
    }
  }

  const bodyInner = tryExtract(work, /<(body)\b[^>]*>/i) ?? work;
  const normalizedText = stripToNormalizedText(bodyInner);
  return {
    scopedHtml: bodyInner,
    selectorKind: "body_fallback",
    scopeVersion: ARTICLE_SCOPE_VERSION,
    fallbackUsed: true,
    confidence: 0.4,
    normalizedText,
    normalizedLength: normalizedText.length,
  };
}

export function toArticleScopeDiagnostics(
  scope: ArticleContentScope,
): ArticleScopeDiagnostics {
  return {
    selectorKind: scope.selectorKind,
    scopeVersion: scope.scopeVersion,
    fallbackUsed: scope.fallbackUsed,
    confidence: scope.confidence,
  };
}
