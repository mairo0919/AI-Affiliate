/**
 * Personal X voice for the existing writer and review.
 * Phrase lists are the initial production set and can be tightened later
 * without adding another generator.
 */

import type { XSocialPlan } from "./social-plan.js";
import { ungroundedContentWord } from "./x-copy-quality.js";

export const X_COPY_ARCHETYPES = [
  "SHORT_REACTION",
  "PERFORMER_COMMENT",
  "FOUND_IT",
  "PERSONAL_PREFERENCE",
  "LOW_EXPECTATION",
  "CASUAL_REVIEW",
  "ONE_LINER",
  "QUESTION",
] as const;

export type XCopyArchetype = (typeof X_COPY_ARCHETYPES)[number];

/** Shape only. The writer must not reuse a fixed sentence. */
const ARCHETYPE_SHAPE: Record<XCopyArchetype, string> = {
  SHORT_REACTION: "短い感想。一文か二文で止める。",
  PERFORMER_COMMENT: "出演者について軽く話す。経歴の説明にしない。",
  FOUND_IT: "新作を見つけた独り言。保存や後で見る、で終えてよい。",
  PERSONAL_PREFERENCE: "自分の好みを言う。おすすめ文にしない。",
  LOW_EXPECTATION: "少し低い期待から入って、気になった点だけ足す。",
  CASUAL_REVIEW: "見た感想を普通に書く。レビュー記事の体裁にしない。",
  ONE_LINER: "かなり短い独り言。一文で終えてよい。",
  QUESTION: "軽い疑問か独り言。答えを綺麗にまとめない。",
};

const ARCHETYPE_LENGTH: Record<XCopyArchetype, string> = {
  SHORT_REACTION: "SHORT。長くしない。",
  PERFORMER_COMMENT: "SHORTかMEDIUM。",
  FOUND_IT: "SHORT。",
  PERSONAL_PREFERENCE: "SHORTかMEDIUM。",
  LOW_EXPECTATION: "SHORT。",
  CASUAL_REVIEW: "MEDIUMまで。最大文字数まで埋めない。",
  ONE_LINER: "VERY_SHORT。短く終える。",
  QUESTION: "VERY_SHORTかSHORT。",
};

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

/** Reaction words that are not product facts. Adjust from live samples. */
export const X_SUBJECTIVE_WORDS = [
  "昨日",
  "今日",
  "最近",
  "普通",
  "個人",
  "保存",
  "今回",
  "新作",
  "内容",
  "好み",
  "感想",
  "自分",
  "笑",
  "一応",
  "設定",
  "組合",
  "期待",
  "最初",
  "今度",
  "結構",
  "タイトル",
  "シリーズ",
] as const;

const REACTION_RE =
  /見た|よかった|好き|気にな|思った|出てた|出てる|保存|一応|なんか|普通に|個人的|なんだよ|だよね|かも|笑|あとで|昨日|今回|新しい|これか|久しぶり|とりあえず/u;

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function chooseXCopyArchetype(seed: string, recent: readonly string[] = []): XCopyArchetype {
  const used = new Set(recent);
  const start = hashSeed(seed) % X_COPY_ARCHETYPES.length;
  for (let step = 0; step < X_COPY_ARCHETYPES.length; step += 1) {
    const pick = X_COPY_ARCHETYPES[(start + step) % X_COPY_ARCHETYPES.length]!;
    if (!used.has(pick)) return pick;
  }
  return X_COPY_ARCHETYPES[start]!;
}

export function xCopyArchetypeDirection(archetype: XCopyArchetype): string {
  return `${archetype}: ${ARCHETYPE_SHAPE[archetype]} 長さは${ARCHETYPE_LENGTH[archetype]}`;
}

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

export function stripSubjectiveWords(text: string): string {
  let next = text;
  for (const word of X_SUBJECTIVE_WORDS) next = next.split(word).join("");
  return next;
}

export function ungroundedProductWord(text: string, grounded: string): string | null {
  return ungroundedContentWord(stripSubjectiveWords(text), grounded);
}

export function isSubjectiveReaction(sentence: string, grounded: string): boolean {
  if (!REACTION_RE.test(sentence)) return false;
  return ungroundedProductWord(sentence, grounded) == null;
}

export function recentOpeningClash(body: string, recent: readonly string[]): boolean {
  const opening = compact(body).slice(0, 8);
  if (opening.length < 6) return false;
  return recent.some((item) => compact(item).slice(0, 8) === opening);
}
