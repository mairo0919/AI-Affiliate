/**
 * Personal X voice for the existing writer and review.
 * Phrase lists are the initial production set and can be tightened later
 * without adding another generator.
 */

import type { XSocialPlan } from "./social-plan.js";
import { ungroundedContentWord } from "./x-copy-quality.js";

/**
 * AI-flavored promo words. Inflected forms are included.
 * Bare 強い is limited to a sentence-final beat so ordinary Japanese is not banned.
 */
export const X_AI_PHRASE_PATTERNS: RegExp[] = [
  /刺さ(?:る|っ|り|れ)/u,
  /強すぎ/u,
  /強い(?:よ|ね|わ|ぞ|[！。]|$)/u,
  /反則/u,
  /破壊力/u,
  /沼(?:る|っ|り|って|った)/u,
  /優勝/u,
  /神作品/u,
  /神作/u,
  /圧倒的/u,
  /没入感/u,
  /没入/u,
  /クオリティ(?:が)?高/u,
  /見逃せない/u,
  /要チェック/u,
  /チェック必須/u,
  /気になる人はチェック/u,
  /たまらない/u,
  /ヤバい/u,
  /やばい/u,
  /ガチで/u,
  /エグ(?:い|すぎ)/u,
  /尊い/u,
  /最高すぎ/u,
  /間違いない/u,
  /必見/u,
  /必須/u,
  /期待大/u,
];

export const X_AD_COPY_PATTERNS: RegExp[] = [
  /で話題/u,
  /好き必見/u,
  /気になる人はこちら/u,
  /気になる方はこちら/u,
  /詳細はこちら/u,
  /今すぐチェック/u,
  /チェックしよう/u,
  /おすすめです/u,
  /オススメです/u,
];

export function detectListedPhrase(text: string, patterns: RegExp[], exempt?: string | null): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const phrase = match?.[0];
    if (!phrase) continue;
    if (exempt && exempt.includes(phrase)) continue;
    return phrase;
  }
  return null;
}

export function countEmoji(text: string): number {
  return text.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
}

export function hasHashtag(text: string): boolean {
  return /#[^\s#]{1,40}/u.test(text);
}

function compact(text: string): string {
  return text.replace(/\s+/gu, "");
}

/** Long prose copied from the official description, after names and the title are removed. */
export function copiesOfficialDescription(
  body: string,
  description: string | null | undefined,
  exempt: string[] = [],
): boolean {
  let prose = compact(description ?? "");
  const flat = compact(body);
  for (const part of exempt) {
    const token = compact(part);
    if (token.length < 2) continue;
    prose = prose.split(token).join("");
  }
  if (prose.length < 18 || flat.length < 18) return false;
  const window = 18;
  for (let i = 0; i <= prose.length - window; i += 1) {
    if (flat.includes(prose.slice(i, i + window))) return true;
  }
  return false;
}

export function identifiesXWork(text: string, plan: XSocialPlan): boolean {
  const names = [
    plan.subject,
    plan.canonicalContext.seriesName,
    ...plan.canonicalContext.performers,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return names.some((name) => name.length >= 2 && text.includes(name));
}

export function ungroundedProductWord(text: string, grounded: string): string | null {
  return ungroundedContentWord(text, grounded);
}

export function recentOpeningClash(body: string, recent: readonly string[]): boolean {
  const opening = compact(body).slice(0, 8);
  if (opening.length < 6) return false;
  return recent.some((item) => compact(item).slice(0, 8) === opening);
}
