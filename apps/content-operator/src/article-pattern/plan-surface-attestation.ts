/**
 * Plan-surface attestation helpers (LLM=0).
 *
 * Detect Writer surplus beyond ARTICLE_PLAN facts without huge banned-word lists:
 * - short work-theme semantic overreach (genre knowledge → emotion/story)
 * - unsupported evaluative residue after plan surfaces are removed
 */

import { WORK_THEME_FACET_RE } from "./evidence-material-role.js";

/** Bare work-theme tags that SEMANTIC may connect, but must not invent psychology/story for. */
export function isBareWorkThemeFact(fact: string): boolean {
  const f = (fact ?? "").trim();
  return f.length > 0 && f.length <= 8 && WORK_THEME_FACET_RE.test(f);
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
  // Attested in plan → allowed
  const hits = sentence.match(THEME_OVERREACH_STEM_RE) ?? [];
  return hits.some((h) => !planBlob.includes(h));
}

/**
 * Evaluative / promotional residue after plan surfaces removed.
 * Uses framing patterns (not bare adjectives) so SOURCE-attested words like 魅力
 * inside planned facts are not punished.
 */
const EVAL_FRAME_RE =
  /(?:情熱的(?:な|に)|甘美な|見どころとなって(?:いる|います)?|見どころです|見どころの一つ(?:です)?|見どころのひとつ(?:です)?|存分に|楽しめます|楽しめる(?:内容)?(?:となっています)?|味わえます|堪能でき(?:る|ます)(?:内容)?|余すところなく|目を離せませ(?:ん)?|魅力的な|魅力のひとつ(?:です)?|魅力の一つ(?:です)?|魅力が詰ま(?:って(?:いる|います)?)?|格別の|必見の|おすすめの|買うべき|今すぐ|ボリューム満点|ボリュームたっぷり|お届けします)/u;

export function hasUnsupportedEvaluativeResidue(
  sentence: string,
  planFacts: readonly string[],
): boolean {
  const planBlob = planFacts.join("");
  const frames = sentence.match(new RegExp(EVAL_FRAME_RE.source, "gu")) ?? [];
  const volumeCloser =
    /たっぷり\d+分の大ボリュームとなっています|たっぷり\d+分との内容となっています|\d+分とボリュームたっぷりの内容となっています|大ボリュームでお届けします|たっぷりのボリュームでお届けします/u.test(
      sentence,
    );
  if (frames.length === 0 && !volumeCloser) return false;
  if (volumeCloser && !/たっぷり|大ボリューム|お届け/.test(planBlob)) return true;
  // Frame present in prose and not attested by any planned fact surface.
  return frames.some((h) => !planBlob.includes(h));
}

/** True when sentence is mostly evaluative closer with little/no planned fact realization. */
export function isPureUnsupportedEvaluativePadding(
  sentence: string,
  planFacts: readonly string[],
): boolean {
  if (!hasUnsupportedEvaluativeResidue(sentence, planFacts)) return false;
  const realizesSubstantial = planFacts.some(
    (f) => f.trim().length >= 6 && sentence.includes(f.trim().slice(0, Math.min(8, f.trim().length))),
  );
  return !realizesSubstantial;
}

/**
 * Strip unattested promotional frames from a sentence; empty if nothing concrete remains.
 * Prefer surgical strip over dropping whole plan-bearing sentences.
 */
export function stripUnsupportedEvalFrames(
  sentence: string,
  planFacts: readonly string[],
): string {
  if (!hasUnsupportedEvaluativeResidue(sentence, planFacts)) return sentence;
  let s = sentence;
  // Preserve quantity while removing volume closers (do not eat 180分 etc.)
  s = s.replace(/たっぷり(\d+分)の大ボリュームとなっています/gu, "$1です");
  s = s.replace(/たっぷり(\d+分)との内容となっています/gu, "$1です");
  s = s.replace(/(\d+分)とボリュームたっぷりの内容となっています/gu, "$1です");
  s = s.replace(/大ボリュームでお届けします/gu, "です");
  s = s.replace(/たっぷりのボリュームでお届けします/gu, "です");
  s = s.replace(new RegExp(EVAL_FRAME_RE.source, "gu"), "");
  // Soft shells that typically wrap 存分に / volume closers after frame removal
  s = s.replace(/[をが]?感じられる(?:内容)?(?:で|です|ます)?/gu, "");
  s = s.replace(/[をが]?堪能でき(?:る|ます)(?:内容)?(?:となっています|で|です|ます)?/gu, "");
  // Drop soft promotional shells that only exist to close the paragraph.
  s = s.replace(/、?作品全体を通じて[^。．]{0,48}/gu, "");
  s = s.replace(/、?彼女の魅力が[^。．]{0,24}/gu, "");
  // dangling particles / empty predicatives left by frame removal (boundary-only; never eat をはじめ)
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
  // Dangling particle closers left after removing お届け/promo predicates
  if (/(?:で)[。．]?$/u.test(s) && s.replace(/[。．\s]/gu, "").length >= 12) {
    s = s.replace(/で[。．]?$/u, "です。");
  }
  s = s.replace(/(?:が|も|を|は|と|の)[。．]$/u, "。");
  // Broken leftovers after surgical strip → prefer DROP over damaged Japanese
  if (/(?:にわたるで|を作品です|をです[。．]?$|を通じて[。．]?$|は[。．]$|(?:が|も|を|と|の)[。．]$)/u.test(s)) {
    return "";
  }
  if (s.length >= 8 && !/[。．！？]$/u.test(s)) s = `${s}。`;
  if (s.replace(/[。．！？\s、]/gu, "").length < 8) return "";
  // Soft closer shell with no plan realization → drop
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
