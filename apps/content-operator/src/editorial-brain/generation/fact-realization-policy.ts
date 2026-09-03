/**
 * Fact realization policy — distinguishes identity-strict vs narrative/weaveable facts.
 *
 * Needed because softInflection/majorMeaning alone cannot:
 * - drop optional light modifiers (ただ) while keeping core nouns (唯一/慰み/姪っ子)
 * - realize deixis weave (この美女 ↔ 美女のこの人妻) without accepting bare noun drops
 * - treat discourse connectives (それもそのはずで) as soft narrative, not EXACT surface
 *
 * Quantities, performer names, and distinctive product terms stay IDENTITY_STRICT.
 */

import { deriveRequiredAnchors } from "../../article-pattern/plan-execution-contract.js";

export type FactRealizationPolicy =
  | "IDENTITY_STRICT"
  | "NARRATIVE_CORE"
  | "WEAVEABLE_DEIXIS"
  | "DISCOURSE_CONNECTIVE";

/** Optional intensifiers / soft exclusivity that do not change the proposition core. */
const OPTIONAL_NARRATIVE_MODIFIER_RE =
  /^(?:ただ|たった|ほんの|まさに|いわゆる|まさしく|実に|まさにその)/u;

const OPTIONAL_NARRATIVE_MODIFIER_INLINE_RE =
  /(?:ただ|たった|ほんの|まさに|いわゆる|まさしく)/gu;

const QUANTITY_OR_DURATION_RE =
  /\d+\s*(?:回|発|本|名|人|時間|分|作品|タイトル|cm|コーナー|発射|射精|本番)/u;

const DISTINCTIVE_PRODUCT_RE =
  /(?:連発射精|追撃ピストン|杭打ち|激ピス|マン毛モロ出し|逆\s*[35]P|ノンストップ)/u;

const PERFORMER_LIKE_RE =
  /^(?:[\u4e00-\u9fff]{2,4}[\u3040-\u309f\u30a0-\u30ffー]{1,4}|[\u4e00-\u9fff]{2,5})$/u;

const NON_NAME_STEM_RE =
  /(?:わからせ|痴女|空域|妹|悪魔|生意気|デカ尻|巨乳|美乳|激ピス|ピストン|本番|射精|ベスト|表情|お仕置き|メスガキ|ギャル|中出し|騎乗|ハーレム|タイトル|作品|時間|分|コーナー|人妻|NTR|熟女|美少女|グラマラス|低身長|円熟|濃厚|慰み|存在|はず|美女|男)/iu;

/** この美女 / その女優 — short deixis + generic noun. */
const WEAVEABLE_DEIXIS_RE =
  /^(?:この|その|あの)([\u4e00-\u9fffァ-ヶー]{2,6})$/u;

/** Discourse glue fragments that are not independent propositions. */
const DISCOURSE_CONNECTIVE_RE =
  /^(?:それもそのはずで|そのはずで|だからこそ|というのは|にもかかわらず|とはいえ)$/u;

function normalize(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/[「」『』【】（）()、。！？・]/gu, "")
    .toLowerCase();
}

function contentChunks(text: string): string[] {
  return (
    normalize(text)
      .match(/[\u4e00-\u9fff]+|[ァ-ヶー]{2,}|[ぁ-ん]{2,}/gu)
      ?.filter((c) => c.length >= 2) ?? []
  );
}

function isLikelyPerformerName(fact: string): boolean {
  const f = fact.trim();
  if (f.length < 2 || f.length > 8) return false;
  if (!PERFORMER_LIKE_RE.test(f)) return false;
  if (NON_NAME_STEM_RE.test(f)) return false;
  if (QUANTITY_OR_DURATION_RE.test(f) || DISTINCTIVE_PRODUCT_RE.test(f)) return false;
  return /[\u4e00-\u9fff]/.test(f);
}

/**
 * Classify how strictly a planned fact must be realized in Writer prose.
 */
export function classifyFactRealizationPolicy(fact: string): FactRealizationPolicy {
  const f = (fact ?? "").trim();
  if (!f) return "NARRATIVE_CORE";

  if (DISCOURSE_CONNECTIVE_RE.test(f)) return "DISCOURSE_CONNECTIVE";

  const deixis = f.match(WEAVEABLE_DEIXIS_RE);
  if (deixis) return "WEAVEABLE_DEIXIS";

  // Identity-critical — never soften
  if (QUANTITY_OR_DURATION_RE.test(f) && f.length <= 24) return "IDENTITY_STRICT";
  if (isLikelyPerformerName(f)) return "IDENTITY_STRICT";
  if (DISTINCTIVE_PRODUCT_RE.test(f) && f.length <= 16) return "IDENTITY_STRICT";
  if (/^[\d.]+$/.test(f)) return "IDENTITY_STRICT";

  // Short bare nouns that are work themes stay narrative (membership), not identity
  if (f.length <= 8 && /^(?:人妻|NTR|痴女|熟女|美少女|即ハメ|即ホテル|ナマ派|ドエロい)$/iu.test(f)) {
    return "NARRATIVE_CORE";
  }

  return "NARRATIVE_CORE";
}

/**
 * Strip optional narrative modifiers for core comparison.
 * Does not strip quantity/name identity tokens.
 */
export function stripOptionalNarrativeModifiers(fact: string): string {
  let t = fact.trim();
  t = t.replace(OPTIONAL_NARRATIVE_MODIFIER_RE, "");
  // Only strip inline intensifiers when not part of quantity/exclusivity-critical だけ/のみ
  if (!/(?:だけ|のみ|しか)/u.test(t)) {
    t = t.replace(OPTIONAL_NARRATIVE_MODIFIER_INLINE_RE, "");
  }
  return t.trim();
}

/**
 * Narrative core realization: major content chunks present after optional-modifier strip.
 * Rejects when identity-strict policy applies (caller must gate).
 */
export function narrativeCoreRealized(sentence: string, fact: string): boolean {
  const policy = classifyFactRealizationPolicy(fact);
  if (policy === "IDENTITY_STRICT") return false;

  const coreFact = stripOptionalNarrativeModifiers(fact);
  const s = normalize(sentence);
  const f = normalize(coreFact);
  if (!f || f.length < 4 || !s) return false;
  if (s.includes(f)) return true;

  const chunks = contentChunks(coreFact).filter((c) => {
    // Drop pure particle-like hiragana glue
    if (/^[ぁ-ん]+$/u.test(c) && c.length <= 2) return false;
    return true;
  });
  if (chunks.length === 0) return false;

  // Prefer kanji/katakana anchors when present
  const majors = chunks.filter((c) => /[\u4e00-\u9fffァ-ヶー]/.test(c));
  const required = majors.length > 0 ? majors : chunks;
  const hits = required.filter((c) => s.includes(c));

  if (required.length === 1) return hits.length === 1;
  if (required.length === 2) return hits.length === 2;
  // Majority of core content tokens
  return hits.length >= Math.ceil(required.length * 0.7);
}

/**
 * Weaveable deixis: この美女 realized when noun + deixis appear in the same sentence
 * (order-flexible). Bare noun alone is NOT enough (true omission still detected).
 */
export function weaveableDeixisRealized(sentence: string, fact: string): boolean {
  if (classifyFactRealizationPolicy(fact) !== "WEAVEABLE_DEIXIS") return false;
  const m = fact.trim().match(WEAVEABLE_DEIXIS_RE);
  if (!m?.[1]) return false;
  const noun = m[1];
  const s = normalize(sentence);
  if (!s.includes(normalize(noun))) return false;
  // Deixis present somewhere in the sentence (この/その/あの)
  return /(?:この|その|あの)/u.test(sentence);
}

/**
 * Discourse connective: soft stem presence (はず / だから / いえ).
 */
export function discourseConnectiveRealized(sentence: string, fact: string): boolean {
  if (classifyFactRealizationPolicy(fact) !== "DISCOURSE_CONNECTIVE") return false;
  const s = normalize(sentence);
  const f = normalize(fact);
  if (s.includes(f)) return true;
  if (/はず/.test(f) && /はず/.test(s)) return true;
  if (/だから/.test(f) && /だから|そのため|ので/.test(s)) return true;
  if (/いえ/.test(f) && /いえ|ものの|けれど/.test(s)) return true;
  // ordered majority of content chunks
  const chunks = contentChunks(fact);
  if (chunks.length < 2) return false;
  let hits = 0;
  for (const c of chunks) {
    if (s.includes(c)) hits += 1;
  }
  return hits >= Math.ceil(chunks.length * 0.6);
}

/**
 * Policy-aware semantic realization (beyond exact surface).
 * Returns true when meaning is present under the fact's policy.
 */
export function policySemanticRealized(sentence: string, fact: string): boolean {
  const policy = classifyFactRealizationPolicy(fact);
  if (policy === "IDENTITY_STRICT") return false;
  if (policy === "WEAVEABLE_DEIXIS") return weaveableDeixisRealized(sentence, fact);
  if (policy === "DISCOURSE_CONNECTIVE") return discourseConnectiveRealized(sentence, fact);
  // NARRATIVE_CORE — also try anchors from execution contract
  if (narrativeCoreRealized(sentence, fact)) return true;
  const anchors = deriveRequiredAnchors(stripOptionalNarrativeModifiers(fact)).filter(
    (a) => a.length >= 2 && !OPTIONAL_NARRATIVE_MODIFIER_INLINE_RE.test(a),
  );
  if (anchors.length === 0) return false;
  const s = normalize(sentence);
  const hits = anchors.filter((a) => s.includes(normalize(a)));
  if (anchors.length <= 2) return hits.length === anchors.length;
  return hits.length >= Math.ceil(anchors.length * 0.7);
}
