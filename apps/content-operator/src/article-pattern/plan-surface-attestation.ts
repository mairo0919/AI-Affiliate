/**
 * Plan-surface attestation helpers (LLM=0).
 *
 * Distinguish:
 * - EXTERNAL factual claims (売上No.1, 大人気, …) — unsupported without plan Evidence
 * - EDITORIAL interpretation grounded in planned facts — allowed
 * - Hard promotional frames with no plan grounding — unsupported
 * - Soft editorial frames on fact-bearing sentences — allowed when grounded
 */

import { WORK_THEME_FACET_RE } from "./evidence-material-role.js";

/** Bare work-theme / genre-tag surfaces that SEMANTIC may connect, but must not invent psychology/story for. */
export function isBareWorkThemeFact(fact: string): boolean {
  const f = (fact ?? "").trim();
  if (!f) return false;
  if (f.length <= 8 && WORK_THEME_FACET_RE.test(f)) return true;
  return /^(?:人妻・主婦|淫乱・ハード系|パイズリ|巨乳|追撃ピストン|女優ベスト・総集編)$/u.test(f);
}

const MEMBERSHIP_FRAMING_RE =
  /(?:含ま(?:れ)?|収録|要素|バリエーション|コーナー|など|といった|を含む|としての|であり|です|ます|また|おり|いる|ある|作品|内容|本作)/gu;

const GRAMMAR_ONLY_RE = /[、。！？\s\u3000のをはがにとでもへやかもや〜ー・「」『』（）()0-9a-zA-Z]/gu;

/**
 * Contentful runs remaining after removing plan-attested surfaces and membership framing.
 */
export function planAttestationResidue(
  sentence: string,
  planFacts: readonly string[],
): string {
  let rest = (sentence ?? "").trim();
  if (!rest) return "";
  const facts = [...planFacts]
    .map((f) => f.trim())
    .filter((f) => f.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const f of facts) {
    if (rest.includes(f)) rest = rest.split(f).join("");
  }
  rest = rest.replace(MEMBERSHIP_FRAMING_RE, "");
  return rest.replace(GRAMMAR_ONLY_RE, "");
}

/**
 * Short theme facts realized in sentence, with invented psychology/story/role detail.
 * Membership framing alone (含む・収録・要素) is allowed.
 */
const THEME_OVERREACH_STEM_RE =
  /(?:複雑な感情|感情や役柄|役柄が描か|心理描写|内面描写|苦悩|葛藤|心情|物語性|ドラマチックな役)/u;

export function hasShortThemeSemanticOverreach(
  sentence: string,
  planFacts: readonly string[],
): boolean {
  const themes = planFacts.filter(isBareWorkThemeFact).filter((t) => sentence.includes(t));
  if (themes.length === 0) return false;
  if (!THEME_OVERREACH_STEM_RE.test(sentence)) return false;
  const planBlob = planFacts.join("");
  const hits = sentence.match(THEME_OVERREACH_STEM_RE) ?? [];
  return hits.some((h) => !planBlob.includes(h));
}

/**
 * External-world factual claims — third-party / market / reputation as fact.
 * Not the same as Writer editorial opinion (向き先・おすすめ・楽しめる).
 * Require Evidence / planned facts; never invent from vibe.
 *
 * Claim-type patterns (not bare-word bans of ファン / おすすめ / 魅力 / 楽しめる).
 */
export const EXTERNAL_FACTUAL_CLAIM_RE =
  /(?:売上(?:No\.?1|ナンバーワン|一位|１位)|大人気|大ヒット|爆発的人気|ファンから高評価|ファンに(?:支持|好評)|多くの(?:ユーザー|人|ファン)から(?:支持|高評価|評価)|世間から(?:高く)?評価|最高傑作(?:と評価)?|必見の一作|他の作品より優|必ず興奮|絶対にハマ|ランキング上位|人気急上昇|話題沸騰|話題になって(?:いる|います)?|売れ筋|(?:として|で)知られて(?:いる|います)?|と称される)/u;

/**
 * Hard purchase-urgency / empty spotlight frames without plan grounding.
 * Do NOT treat bare おすすめ / ファン / 楽しめる / 魅力 as hard promo — those may be editorial.
 */
const HARD_PROMO_FRAME_RE =
  /(?:情熱的(?:な|に)|甘美な|見どころとなって(?:いる|います)?|見どころです|見どころの一つ(?:です)?|見どころのひとつ(?:です)?|目を離せませ(?:ん)?|見逃せませ(?:ん)?|格別の|必見の|買うべき|今すぐ|お届けします)/u;

/**
 * Soft editorial frames — OK when sentence already realizes planned facts /
 * quantity / theme grounding (editorial interpretation). Unsupported only as empty closers.
 */
const SOFT_EDITORIAL_FRAME_RE =
  /(?:存分に|楽しめます|楽しめる(?:内容)?(?:となっています)?|味わえます|堪能でき(?:る|ます)(?:内容)?|余すところなく|魅力的な|魅力のひとつ(?:です)?|魅力の一つ(?:です)?|魅力が詰ま(?:って(?:いる|います)?)?|充実した内容|ボリューム満点|ボリュームたっぷり|大ボリューム)/u;

function realizesSubstantialPlanFact(
  sentence: string,
  planFacts: readonly string[],
): boolean {
  return planFacts.some((f) => {
    const t = f.trim();
    if (t.length < 4) return sentence.includes(t);
    const needle = t.slice(0, Math.min(10, t.length));
    return sentence.includes(needle);
  });
}

function planThemeOrPlayTokens(planFacts: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of planFacts) {
    const t = f.trim();
    if (!t) continue;
    if (isBareWorkThemeFact(t) || /人妻|NTR|痴女|追撃ピストン|プレイ|シーン/u.test(t)) {
      out.push(t);
    }
    for (const part of t.split(/[・、,／\/\|]/u)) {
      const p = part.replace(/などを収録|を収録|など/gu, "").trim();
      if (
        p.length >= 2 &&
        (isBareWorkThemeFact(p) || /人妻|NTR|痴女|追撃ピストン/u.test(p))
      ) {
        out.push(p);
      }
    }
  }
  return [...new Set(out)];
}

function hasEditorialGrounding(sentence: string, planFacts: readonly string[]): boolean {
  if (realizesSubstantialPlanFact(sentence, planFacts)) return true;
  const hasVolume = planFacts.some((f) =>
    /\d+\s*時間|\d+\s*コーナー|\d+\s*タイトル|ベスト|収録/u.test(f),
  );
  const themeTokens = planThemeOrPlayTokens(planFacts);
  const hasThemeOrPlay = themeTokens.length > 0;
  const citesConcreteVolume =
    /\d+\s*(?:時間|コーナー|タイトル|分)/u.test(sentence) ||
    /まとめて見たい|ボリュームのある|横断して見られる|適したボリューム/u.test(sentence);
  if (
    hasVolume &&
    citesConcreteVolume &&
    /ボリューム|まとめて|横断|楽しめ|堪能|充実|向いた|向け|適した/u.test(sentence) &&
    sentence.replace(/\s+/g, "").length >= 16
  ) {
    return true;
  }
  const themeCited = themeTokens.some((tok) => sentence.includes(tok));
  if (
    hasThemeOrPlay &&
    themeCited &&
    /プレイ|シーン|方向性|バリエーション|横断|多彩|エロさ|エロティシズム/u.test(sentence) &&
    sentence.replace(/\s+/g, "").length >= 16
  ) {
    return true;
  }
  return false;
}

export function hasExternalFactualClaimResidue(
  sentence: string,
  planFacts: readonly string[],
): boolean {
  const planBlob = planFacts.join("");
  const claims = sentence.match(new RegExp(EXTERNAL_FACTUAL_CLAIM_RE.source, "gu")) ?? [];
  return claims.some((h) => !planBlob.includes(h));
}

/**
 * True when sentence adds unsupported surplus:
 * - external factual claims without plan Evidence, OR
 * - hard promo frames without attestation, OR
 * - soft editorial frames used as empty closers (no plan grounding)
 *
 * Soft editorial interpretation on fact-bearing / volume-grounded sentences is allowed.
 */
export function hasUnsupportedEvaluativeResidue(
  sentence: string,
  planFacts: readonly string[],
): boolean {
  if (hasExternalFactualClaimResidue(sentence, planFacts)) return true;

  const planBlob = planFacts.join("");
  const hard = sentence.match(new RegExp(HARD_PROMO_FRAME_RE.source, "gu")) ?? [];
  if (hard.some((h) => !planBlob.includes(h))) return true;

  const volumeCloser =
    /たっぷり\d+分の大ボリュームとなっています|たっぷり\d+分との内容となっています|\d+分とボリュームたっぷりの内容となっています|大ボリュームでお届けします|たっぷりのボリュームでお届けします/u.test(
      sentence,
    );
  if (volumeCloser && !/たっぷり|大ボリューム|お届け/.test(planBlob)) {
    // Pure volume closer with no quantity in plan → unsupported
    if (!planFacts.some((f) => /\d+\s*分|\d+\s*時間/u.test(f))) return true;
  }

  const soft = sentence.match(new RegExp(SOFT_EDITORIAL_FRAME_RE.source, "gu")) ?? [];
  const unattestedSoft = soft.filter((h) => !planBlob.includes(h));
  if (unattestedSoft.length === 0 && !volumeCloser) return false;

  // Soft frames OK when grounded in planned facts / quantity / themes.
  if (hasEditorialGrounding(sentence, planFacts)) return false;

  return unattestedSoft.length > 0 || volumeCloser;
}

/** True when sentence is mostly empty promo/eval closer with little/no planned fact realization. */
export function isPureUnsupportedEvaluativePadding(
  sentence: string,
  planFacts: readonly string[],
): boolean {
  if (!hasUnsupportedEvaluativeResidue(sentence, planFacts)) return false;
  if (hasExternalFactualClaimResidue(sentence, planFacts)) {
    return !realizesSubstantialPlanFact(sentence, planFacts);
  }
  return !realizesSubstantialPlanFact(sentence, planFacts);
}

/**
 * Strip unattested promotional frames from a sentence; empty if nothing concrete remains.
 * Prefer surgical strip over dropping whole plan-bearing sentences.
 * Does not strip soft editorial frames when the sentence is editorially grounded.
 */
export function stripUnsupportedEvalFrames(
  sentence: string,
  planFacts: readonly string[],
): string {
  if (!hasUnsupportedEvaluativeResidue(sentence, planFacts)) return sentence;
  if (
    !hasExternalFactualClaimResidue(sentence, planFacts) &&
    hasEditorialGrounding(sentence, planFacts)
  ) {
    return sentence;
  }
  let s = sentence;
  // Preserve quantity while removing volume closers (do not eat 180分 etc.)
  s = s.replace(/たっぷり(\d+分)の大ボリュームとなっています/gu, "$1です");
  s = s.replace(/たっぷり(\d+分)との内容となっています/gu, "$1です");
  s = s.replace(/(\d+分)とボリュームたっぷりの内容となっています/gu, "$1です");
  s = s.replace(/大ボリュームでお届けします/gu, "です");
  s = s.replace(/たっぷりのボリュームでお届けします/gu, "です");
  s = s.replace(new RegExp(EXTERNAL_FACTUAL_CLAIM_RE.source, "gu"), "");
  s = s.replace(new RegExp(HARD_PROMO_FRAME_RE.source, "gu"), "");
  if (!hasEditorialGrounding(sentence, planFacts)) {
    s = s.replace(new RegExp(SOFT_EDITORIAL_FRAME_RE.source, "gu"), "");
    s = s.replace(/[をが]?堪能でき(?:る|ます)(?:内容)?(?:となっています|で|です|ます)?/gu, "");
  }
  s = s.replace(/[をが]?感じられる(?:内容)?(?:で|です|ます)?/gu, "");
  s = s.replace(/、?作品全体を通じて[^。．]{0,48}/gu, "");
  s = s.replace(/、?彼女の魅力が[^。．]{0,24}/gu, "");
  s = s.replace(/[をがもは]、/gu, "、");
  s = s.replace(/、{2,}/gu, "、");
  s = s.replace(/とで([。．]|$)/gu, "です$1");
  s = s.replace(/と([。．])/gu, "です$1");
  s = s.replace(/と魅力([。．]|$)/gu, "$1");
  s = s.replace(/(?:を|が|も|は)(?:内容)?(?:です|ます)([。．！？]|$)/gu, "$1");
  s = s.replace(/内容です/gu, "です");
  s = s.replace(/[、，]\s*([。．])/gu, "$1");
  s = s.replace(/のと(?:なって|なり)(?:いる|います)?([。．]|$)/gu, "です$1");
  s = s.replace(/がと(?:なって|なり)(?:いる|います)?([。．]|$)/gu, "です$1");
  s = s.replace(/にわたるで/gu, "にわたって");
  s = s.replace(/を作品です/gu, "です");
  s = s.replace(/を内容です/gu, "です");
  s = s.replace(/は。/gu, "。");
  s = s.replace(/\s+/gu, "").trim();
  if (/(?:で)[。．]?$/u.test(s) && s.replace(/[。．\s]/gu, "").length >= 12) {
    s = s.replace(/で[。．]?$/u, "です。");
  }
  s = s.replace(/(?:が|も|を|は|と|の)[。．]$/u, "。");
  if (/(?:にわたるで|を作品です|をです[。．]?$|を通じて[。．]?$|は[。．]$|(?:が|も|を|と|の)[。．]$)/u.test(s)) {
    return "";
  }
  if (s.length >= 8 && !/[。．！？]$/u.test(s)) s = `${s}。`;
  if (s.replace(/[。．！？\s、]/gu, "").length < 8) return "";
  if (
    /(?:となっています|しております)[。．]?$/u.test(s) &&
    !planFacts.some((f) => {
      const t = f.trim();
      return t.length >= 2 && s.includes(t);
    })
  ) {
    return "";
  }
  return s;
}

/** Combined legacy pattern for tests that still import EVAL_FRAME_RE. */
export const EVAL_FRAME_RE = new RegExp(
  `(?:${HARD_PROMO_FRAME_RE.source}|${SOFT_EDITORIAL_FRAME_RE.source})`,
  "u",
);
