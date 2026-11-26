/**
 * Web notes about one work beyond the FANZA page (2026-11-26 user decision).
 *
 * One web search per work (performer + product code); piracy, tube, store, and official pages are skipped; up to a few review
 * blogs are read. Praise and reputation sentences are dropped. A sentence is kept only when two words
 * in it that the official text lacks also appear on another site, so a single blog's invention does not reach the Writer. The Writer may
 * use these notes only in a sentence attributed to review sites.
 */
import type { AppConfig } from "@ai-affiliate/config";
import { safeFetchText } from "@ai-affiliate/shared";
import type { ArticlePatternSearchAdapter } from "./source-search.js";
import { blockingSemanticClaims } from "./article-semantic-claim.js";
import { EXTERNAL_FACTUAL_CLAIM_RE } from "./plan-surface-attestation.js";

const MAX_PAGES = 4;
const MAX_FETCHES = 8;
const MAX_SITES = 3;
const MAX_SENTENCES_PER_SITE = 4;

/** Stores, official, SNS, piracy, tube, subtitle, and torrent hosts carry no usable review text. */
const SKIP_HOST_RE =
  /(^|\.)(dmm\.co\.jp|dmm\.com|mgstage\.com|duga\.jp|sokmil\.com|amazon\.co\.jp|rakuten\.co\.jp|s1s1s1\.com|moodyz\.com|madonna-av\.com|idolerotic\.net|prestige-av\.com|sod\.co\.jp|wikipedia\.org|namu\.wiki|themoviedb\.org|imdb\.com|twitter\.com|x\.com|youtube\.com|seesaawiki\.jp|av-wiki\.net)$|yahoo\.co\.jp|suruga-ya\.jp|mercari\.com|nyaa|sukebei|jav|jable|missav|123av|xsz-av|av-lib|tktube|3xplanet|subtitle|srt|torrent|tube|avwebm|eromon|gravurefit|xvideos|pornhub|xhamster|fc2/i;

/** Shop and page furniture lines, not statements about the work. */
const BOILERPLATE_RE =
  /https?:|円|価格|セール|キャンペーン|OFF|配信|発売日|品番|サンプル|ダウンロード|購入|クリック|ランキング|お問い合わせ|プライバシー|著作権|Copyright|コメント|シェア|関連記事|カテゴリ|タグ|ログイン|18歳/i;

/** Blog opinion and audience lines (who it suits, how well received); input cleaning, not a reject. */
const OPINION_RE = /注目|人気|ファン|満足|向いて|人には|人にも|評価|印象|感じ|思う|でしょう|かもしれ|体感|楽しめ|おすすめ|オススメ/;

const CONTENT_WORD_RE = /[\p{Script=Han}\p{Script=Katakana}ー]{3,}/gu;

export function isUsableWebNoteHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !SKIP_HOST_RE.test(host);
  } catch {
    return false;
  }
}

/** Performer name plus the product code as blogs write it (sone00638 → SONE-638). */
export function buildWorkWebQuery(input: { contentId: string; performers: string[] }): string {
  const performer = input.performers[0]?.trim() ?? "";
  const m = input.contentId.toLowerCase().match(/([a-z]+)0*(\d{3,})$/);
  const code = m ? `${m[1]!.toUpperCase()}-${m[2]}` : input.contentId;
  return [performer, code].filter(Boolean).join(" ");
}

export function htmlToSentences(html: string): string[] {
  const text = html
    .replace(/<(script|style|noscript|nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text
    .split(/(?<=[。！？!?])|\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 12 && s.length <= 160 && /[\p{Script=Hiragana}]/u.test(s) && !BOILERPLATE_RE.test(s))
    // A blog's praise, recommendation, or reputation is not a statement of what happens in the work.
    .filter((s) => blockingSemanticClaims(s, []).length === 0 && !EXTERNAL_FACTUAL_CLAIM_RE.test(s) && !OPINION_RE.test(s));
}

function copiesOfficial(sentence: string, official: string): boolean {
  const s = sentence.replace(/\s+/g, "");
  if (s.length < 20) return official.includes(s);
  for (let i = 0; i + 20 <= s.length; i += 5) {
    if (official.includes(s.slice(i, i + 20))) return true;
  }
  return false;
}

/**
 * Keep per site the sentences with a word that the official text lacks and another site also
 * uses. Returns lines "host: sentence".
 */
export function corroboratedWebNotes(input: {
  pages: Array<{ url: string; sentences: string[] }>;
  officialText: string;
}): string[] {
  const official = input.officialText.replace(/\s+/g, "");
  const sites = new Map<string, string[]>();
  for (const page of input.pages) {
    const host = new URL(page.url).hostname.replace(/^www\./, "");
    if (sites.has(host)) continue;
    sites.set(host, page.sentences.filter((s) => !copiesOfficial(s, official)));
  }
  const wordsBySite = new Map<string, Set<string>>();
  for (const [host, sentences] of sites) {
    const words = new Set<string>();
    for (const s of sentences) for (const w of s.match(CONTENT_WORD_RE) ?? []) if (!official.includes(w)) words.add(w);
    wordsBySite.set(host, words);
  }
  const out: string[] = [];
  let siteCount = 0;
  for (const [host, sentences] of sites) {
    const elsewhere = new Set<string>();
    for (const [other, words] of wordsBySite) if (other !== host) for (const w of words) elsewhere.add(w);
    // Two shared words, so a common word such as カメラ alone does not count as agreement.
    const kept = sentences
      .filter((s) => new Set((s.match(CONTENT_WORD_RE) ?? []).filter((w) => !official.includes(w) && elsewhere.has(w))).size >= 2)
      .slice(0, MAX_SENTENCES_PER_SITE);
    if (kept.length === 0) continue;
    out.push(...kept.map((s) => `${host}: ${s}`));
    siteCount += 1;
    if (siteCount >= MAX_SITES) break;
  }
  return out;
}

/** One search and a few page reads; any failure returns no notes (never blocks the work). */
export async function collectWorkWebNotes(input: {
  config: AppConfig;
  search: ArticlePatternSearchAdapter;
  contentId: string;
  productTitle: string;
  performers: string[];
  officialText: string;
  fetchHtml?: (url: string) => Promise<string>;
}): Promise<string[]> {
  if (!input.config.articlePatternSearchApiKey?.trim() || input.performers.length === 0) return [];
  const query = buildWorkWebQuery(input);
  const fetchHtml =
    input.fetchHtml ??
    (async (url: string) =>
      (await safeFetchText(url, { timeoutMs: 10_000, maxBytes: 600_000 })).text);
  try {
    const hits = (await input.search.search({ query, limit: 20 })).filter((h) => isUsableWebNoteHost(h.url));
    const pages: Array<{ url: string; sentences: string[] }> = [];
    for (const hit of hits.slice(0, MAX_FETCHES)) {
      if (pages.length >= MAX_PAGES) break;
      const html = await fetchHtml(hit.url).catch(() => "");
      const sentences = htmlToSentences(html);
      if (sentences.length > 0) pages.push({ url: hit.url, sentences });
    }
    return corroboratedWebNotes({ pages, officialText: `${input.productTitle}\n${input.officialText}` });
  } catch {
    return [];
  }
}
