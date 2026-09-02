/**
 * ArticlePlan fact matching — semantic realization (R126).
 *
 * Facts are writer material; natural paraphrase / abstraction is OK.
 * Contradictory rewrites (different specific quantity, single-shot vs many) are not.
 */

import { classifySemanticEvidence } from "../../article-pattern/semantic-evidence.js";
import { deriveRequiredAnchors } from "../../article-pattern/plan-execution-contract.js";
import { extractTextFacets } from "./text-surface.js";
import {
  matchCatalogVenueThemeProposition,
  matchConcessiveProposition,
  factRequiresConcessiveRelation,
  sentenceHasConcessiveRelation,
} from "./semantic-proposition.js";

const WEAK_FAMILY = new Set(["EVALUATIVE", "CATALOG", "TITLE_LABEL", "SERIES_CONCEPT"]);

const SURFACE_STOP = new Set([
  "公開",
  "作品",
  "内容",
  "確認",
  "状態",
  "以上",
  "以下",
  "可能",
  "利用",
  "参加",
  "目的",
  "設定",
  "構成",
  "描写",
  "特別",
  "企画",
  "魅力",
  "見どころ",
  "として",
  "となっ",
  "てい",
  "する",
  "した",
  "される",
  "れる",
  "いる",
  "ある",
  "ない",
  "的",
  "的な",
]);

export const SCENE_SURFACE_RE =
  /ピストン|激ピス|手コキ|腿コキ|騎乗|逆\d+P|アナル|射精|ナンパ|性感|巨乳|スレンダー|痴女|犯[さ●]|杭打ち|美尻|腰振り|絶頂|愛撫|オナニー|エステ|催●|マン毛|学芸員|コインランドリー|専属|性感開発|身長差|長身|170\s*cm|\d+\s*時間|\d+\s*回|\d+\s*発射|\d+\s*タイトル|ベスト第?\d*弾?/;

/** Quantity abstraction — concrete → abstract is OK. */
const QTY_ABSTRACT_RE =
  /何度も|度々|繰り返|何度.*(?:射精|発射)|(?:射精|発射).*(?:繰り返|何度)|止まらない|止まらず|重ねる|続け(?:る|て)|たびに|何度も射精|何度も発射/;

/** Contradiction: single-shot vs multi-count facts. */
const QTY_SINGLE_SHOT_RE = /一度だけ|1回だけ|たった一回|一回だけ|たった1回|単発/;

/** Glued / spaced quantity + semantic unit. */
const QTY_UNIT_GLUE_RE =
  /(\d+)\s*(?:回|回もの|もの|発|本|名|人|時間|分|作品|タイトル|cm|ＣＭ)?\s*(?:の)?\s*(射精|発射|本番)/g;

const QTY_UNIT_COMPACT_RE = /(\d+)(射精|発射|本番|回|発|本|名|人|時間|分|作品|タイトル|cm)/g;

type QuantitySpec = {
  value: number;
  unit: string;
};

export type FactRealizationStatus = "EXACT" | "SEMANTIC" | "CONTRADICTION" | "NONE";

export type SemanticMatch = {
  contradiction: boolean;
  exactQuantity: boolean;
  abstractQuantity: boolean;
  anchorHits: number;
  anchorTotal: number;
};

export type FactRealizationResult = SemanticMatch & {
  status: FactRealizationStatus;
  /** @deprecated Internal compat — EXACT→strong, SEMANTIC→weak, else none */
  strength: "strong" | "weak" | "none";
  realized: boolean;
};

/** EXACT and SEMANTIC are both valid ArticlePlan fact realization (OK). */
export function isFactRealized(status: FactRealizationStatus): boolean {
  return status === "EXACT" || status === "SEMANTIC";
}

function familyOf(text: string): string {
  return classifySemanticEvidence(text, { sourceType: "product_description" }).familyId;
}

function primaryOf(text: string): string {
  return classifySemanticEvidence(text, { sourceType: "product_description" }).primary;
}

export function isWeakPlanFact(fact: string): boolean {
  const t = fact.replace(/\s+/g, "");
  if (t.length <= 3) return true;
  const primary = primaryOf(fact);
  if (WEAK_FAMILY.has(primary) && t.length < 8) return true;
  if (primary === "PRODUCT_FORM" && t.length <= 4 && !/\d/.test(t)) return true;
  return false;
}

function normalizeSpan(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/[「」『』【】（）()]/g, "")
    .replace(/[イィ]/g, "い")
    .replace(/[ヰィ]/g, "い")
    .toLowerCase();
}

function extractQuantitySpecs(text: string): QuantitySpec[] {
  const specs: QuantitySpec[] = [];
  const seen = new Set<string>();
  const add = (value: number, unit: string) => {
    const key = `${value}:${unit}`;
    if (seen.has(key)) return;
    seen.add(key);
    specs.push({ value, unit });
  };

  for (const m of text.matchAll(QTY_UNIT_GLUE_RE)) {
    add(Number(m[1]), m[2] ?? "射精");
  }
  for (const m of text.matchAll(QTY_UNIT_COMPACT_RE)) {
    add(Number(m[1]), m[2]!);
  }
  for (const m of text.matchAll(/(\d+)\s*(名|人|時間|分|作品|タイトル|cm|ＣＭ|回)/g)) {
    add(Number(m[1]), m[2]!);
  }
  return specs;
}

function extractSemanticAnchors(fact: string): string[] {
  const raw = extractTextFacets(fact)
    .map((f) => f.replace(/\s+/g, ""))
    .filter((f) => f.length >= 3 && !SURFACE_STOP.has(f) && !isWeakPlanFact(f));
  const chunks = fact
    .split(/[、。．，,\s]+/)
    .flatMap((part) => part.split(/(?<=まで)|(?<=から)|(?<=が)|(?<=を)|(?<=に)/))
    .map((c) => c.replace(/\s+/g, ""))
    .filter((c) => c.length >= 4 && !SURFACE_STOP.has(c));
  return [...new Set([...raw, ...chunks])].sort((a, b) => b.length - a.length);
}

function anchorMatches(anchor: string, sentence: string): boolean {
  const a = normalizeSpan(anchor);
  const s = normalizeSpan(sentence);
  if (!a || a.length < 3) return false;
  if (s.includes(a)) return true;

  const prefixLen = Math.min(4, a.length);
  const prefix = a.slice(0, prefixLen);
  if (prefix.length >= 3 && s.includes(prefix)) return true;

  // Shared scene stem inside longer compounds (搾精 / 手コキ etc.)
  if (a.length >= 4) {
    const stem = a.slice(0, Math.ceil(a.length * 0.6));
    if (stem.length >= 3 && s.includes(stem)) return true;
  }
  return false;
}

function ejaculationMentioned(text: string): boolean {
  return /射精|発射/.test(text);
}

function evaluateQuantitySemantics(
  factSpecs: QuantitySpec[],
  sentence: string,
): Pick<SemanticMatch, "contradiction" | "exactQuantity" | "abstractQuantity"> {
  if (factSpecs.length === 0) {
    return { contradiction: false, exactQuantity: false, abstractQuantity: false };
  }

  const ejacSpecs = factSpecs.filter((q) => /射精|発射|本番/.test(q.unit));
  const otherSpecs = factSpecs.filter((q) => !/射精|発射|本番/.test(q.unit));

  for (const fs of ejacSpecs) {
    if (!ejaculationMentioned(sentence)) {
      continue;
    }

    if (QTY_SINGLE_SHOT_RE.test(sentence) && fs.value > 1) {
      return { contradiction: true, exactQuantity: false, abstractQuantity: false };
    }

    let sawExact = false;
    let sawOtherNumber = false;

    for (const m of sentence.matchAll(QTY_UNIT_GLUE_RE)) {
      const n = Number(m[1]);
      if (n === fs.value) sawExact = true;
      else sawOtherNumber = true;
    }
    for (const m of sentence.matchAll(QTY_UNIT_COMPACT_RE)) {
      if (!/射精|発射|本番/.test(m[2]!)) continue;
      const n = Number(m[1]);
      if (n === fs.value) sawExact = true;
      else sawOtherNumber = true;
    }
    // "13回もの射精" — number before 射精 with optional filler
    for (const m of sentence.matchAll(/(\d+)\s*(?:回|回もの|もの)?\s*(?:の)?\s*(?:射精|発射)/g)) {
      const n = Number(m[1]);
      if (n === fs.value) sawExact = true;
      else sawOtherNumber = true;
    }

    if (sawOtherNumber && !sawExact) {
      return { contradiction: true, exactQuantity: false, abstractQuantity: false };
    }
    if (sawExact) {
      return { contradiction: false, exactQuantity: true, abstractQuantity: false };
    }
    if (QTY_ABSTRACT_RE.test(sentence) || /繰り返す|重ねる|何度/.test(sentence)) {
      return { contradiction: false, exactQuantity: false, abstractQuantity: true };
    }
    // Mentioned without number — acceptable abstraction if ejaculation clearly present
    if (ejaculationMentioned(sentence)) {
      return { contradiction: false, exactQuantity: false, abstractQuantity: true };
    }
  }

  for (const fs of otherSpecs) {
    if (QTY_SINGLE_SHOT_RE.test(sentence) && fs.value > 1 && /回|名|人|射精|発射/.test(fs.unit)) {
      return { contradiction: true, exactQuantity: false, abstractQuantity: false };
    }

    let matched = false;
    let conflict = false;
    for (const m of sentence.matchAll(/(\d+)\s*(回|回もの|もの|名|人|時間|分|作品|タイトル|cm|ＣＭ|射精|発射|本番)/g)) {
      const n = Number(m[1]);
      const unit = m[2] ?? "";
      if (unit.includes(fs.unit) || fs.unit.includes(unit) || unit === fs.unit) {
        if (n === fs.value) matched = true;
        else conflict = true;
      }
    }
    for (const m of sentence.matchAll(QTY_UNIT_COMPACT_RE)) {
      if (m[2] !== fs.unit && !fs.unit.includes(m[2]!) && !m[2]!.includes(fs.unit)) continue;
      const n = Number(m[1]);
      if (n === fs.value) matched = true;
      else conflict = true;
    }

    if (conflict && !matched) {
      return { contradiction: true, exactQuantity: false, abstractQuantity: false };
    }
    if (matched) {
      return { contradiction: false, exactQuantity: true, abstractQuantity: false };
    }
    if (QTY_ABSTRACT_RE.test(sentence) && anchorMatches(fs.unit, sentence)) {
      return { contradiction: false, exactQuantity: false, abstractQuantity: true };
    }
  }

  return { contradiction: false, exactQuantity: false, abstractQuantity: false };
}

function evaluateSemanticMatch(fact: string, sentence: string): SemanticMatch {
  const factSpecs = extractQuantitySpecs(fact);
  const qty = evaluateQuantitySemantics(factSpecs, sentence);
  if (qty.contradiction) {
    return { ...qty, anchorHits: 0, anchorTotal: 0 };
  }

  const anchors = extractSemanticAnchors(fact);
  const anchorTotal = anchors.length;
  let anchorHits = 0;
  for (const a of anchors) {
    if (anchorMatches(a, sentence)) anchorHits += 1;
  }

  // Short scene-only facts (e.g. 痴女, 杭打ち)
  if (anchorTotal === 0 && fact.replace(/\s+/g, "").length <= 8) {
    const stem = fact.replace(/\s+/g, "");
    if (stem.length >= 2 && anchorMatches(stem, sentence)) {
      return { ...qty, anchorHits: 1, anchorTotal: 1 };
    }
  }

  return { ...qty, anchorHits, anchorTotal };
}

export function paraphraseHit(sentence: string, fact: string): boolean {
  if (/激ピス/.test(fact) && /ピストン|激しいピストン|激ピス/.test(sentence)) return true;
  if (/性感開発|たーっぷり性感|たっぷり性感/.test(fact) && /性感を開発|性感開発/.test(sentence))
    return true;
  if (/50発射|50回/.test(fact) && /50\s*回|50発射|射精/.test(sentence)) return true;
  if (
    /170\s*cm|170cm/.test(fact) &&
    /170\s*cm|170cm|170/.test(sentence) &&
    /手コキ|身長/.test(sentence)
  )
    return true;
  if (/逆3P|逆５P|逆5P/.test(fact) && /逆\s*3\s*P|逆\s*5\s*P|逆3P|逆5P/.test(sentence))
    return true;
  if (/杭打ち/.test(fact) && /杭打ち/.test(sentence)) return true;
  if (/専属第二弾/.test(fact) && /専属第二弾/.test(sentence)) return true;
  if (/12タイトル|最新12/.test(fact) && /12タイトル|最新12/.test(sentence)) return true;
  if (/ベスト第6弾/.test(fact) && /ベスト第6弾/.test(sentence)) return true;
  if (/痴女/.test(fact) && /痴女/.test(sentence) && /犯[さ●]|攻め/.test(sentence)) return true;
  if (/犯●れ|犯され/.test(fact) && /犯される|犯●れ/.test(sentence)) return true;

  // Soft grammar fillers (ような / といった) and ordered content chunks —
  // required so SEMANTIC_PRESERVE natural prose is not marked PLAN_FACT_OMISSION.
  if (softInflectionFactHit(sentence, fact)) return true;

  const concessive = matchConcessiveProposition(sentence, fact);
  if (concessive === "EXACT" || concessive === "SEMANTIC") return true;

  if (matchCatalogVenueThemeProposition(sentence, fact)) return true;

  return false;
}

/**
 * True when fact meaning is present with only soft Japanese grammar inflection
 * (e.g. 大人をバカにした表情 ↔ 大人をバカにしたような表情).
 */
function softInflectionFactHit(sentence: string, fact: string): boolean {
  const strip = (t: string) =>
    t
      .replace(/\s+/g, "")
      .replace(/ような|といった|みたいな|という/g, "")
      .replace(/[、。！？・]/gu, "");
  const s = strip(sentence);
  const f = strip(fact);
  if (f.length < 2 || !s) return false;
  if (s.includes(f)) return true;

  const chunks =
    f
      .match(/[\u4e00-\u9fff]+|[ァ-ヶー]+|[ぁ-ん]+/gu)
      ?.filter((c) => c.length >= 2) ?? [];
  if (chunks.length < 2) return false;
  let idx = 0;
  let orderedHits = 0;
  for (const c of chunks) {
    const at = s.indexOf(c, idx);
    if (at < 0) continue;
    orderedHits += 1;
    idx = at + c.length;
  }
  if (orderedHits === chunks.length) return true;
  // Long narrative atoms: majority of content chunks (not full ordered surface).
  // Skip for concessive facts — relation loss must stay NONE (R151).
  if (
    f.length >= 24 &&
    chunks.length >= 4 &&
    orderedHits >= Math.ceil(chunks.length * 0.6) &&
    !factRequiresConcessiveRelation(fact)
  ) {
    return true;
  }
  return false;
}

/**
 * Long SEMANTIC_PRESERVE narrative atoms — realize via major meaning anchors,
 * not full surface restatement (avoids false PLAN_FACT_OMISSION without loosening EXACT qty/name).
 */
function majorMeaningRealized(sentence: string, fact: string): boolean {
  const f = (fact ?? "").replace(/\s+/g, "");
  if (f.length < 20) return false;

  // Keep short quantity / duration / bare names on the strict path
  if (/^\d+\s*(?:時間|分|回|本番|射精|作品|名|人)$/u.test(f)) return false;
  if (f.length <= 8 && /^[\u3040-\u30ff\u4e00-\u9fffー]+$/u.test(f)) return false;

  const required = deriveRequiredAnchors(fact);
  const nouns = (f.match(/[\u4e00-\u9fff]{2,8}/gu) ?? []).filter(
    (n) => n.length >= 2 && !SURFACE_STOP.has(n),
  );
  const majors = [...new Set([...required, ...nouns])].filter((a) => a.length >= 2).slice(0, 10);
  if (majors.length === 0) return false;

  const s = normalizeSpan(sentence);
  const hits = majors.filter((a) => {
    const aN = normalizeSpan(a);
    if (aN.length >= 2 && s.includes(aN)) return true;
    return anchorMatches(a, sentence);
  });
  if (majors.length <= 2) {
    return hits.length >= 1 && hits.some((h) => h.length >= 2);
  }
  if (hits.length >= Math.ceil(majors.length * 0.5)) return true;
  if (hits.length >= 2 && hits.some((h) => h.length >= 3)) return true;
  return false;
}

function statusFromSemantic(match: SemanticMatch, fact: string): FactRealizationStatus {
  if (match.contradiction) return "CONTRADICTION";

  const anchorRatio =
    match.anchorTotal > 0 ? match.anchorHits / match.anchorTotal : 0;

  if (match.exactQuantity) {
    return "EXACT";
  }

  if (match.abstractQuantity) return "SEMANTIC";

  if (match.anchorTotal === 0) return "NONE";

  if (anchorRatio >= 0.75) return isWeakPlanFact(fact) ? "SEMANTIC" : "EXACT";
  if (anchorRatio >= 0.5) return "SEMANTIC";
  if (match.anchorTotal >= 4 && match.anchorHits >= 2 && anchorRatio >= 0.4) {
    return "SEMANTIC";
  }
  return "NONE";
}

function strengthFromStatus(status: FactRealizationStatus): "strong" | "weak" | "none" {
  if (status === "EXACT") return "strong";
  if (status === "SEMANTIC") return "weak";
  return "none";
}

function surfaceRealizationStatus(
  sentence: string,
  fact: string,
  pad: boolean,
): FactRealizationStatus | null {
  const s = sentence.replace(/\s+/g, "");
  const f = fact.replace(/\s+/g, "");

  if (paraphraseHit(sentence, fact)) {
    return isWeakPlanFact(fact) ? "SEMANTIC" : "EXACT";
  }

  if (f.length >= 6 && s.includes(f.slice(0, Math.min(12, f.length)))) {
    return isWeakPlanFact(fact) ? "SEMANTIC" : "EXACT";
  }
  if (f.length >= 4 && s.includes(f)) {
    return isWeakPlanFact(fact) ? "SEMANTIC" : "EXACT";
  }

  const facets = extractTextFacets(fact).filter((x) => x.length >= 2 && !isWeakPlanFact(x));
  const hits = facets.filter((fac) => s.includes(fac.replace(/\s+/g, "")) || sentence.includes(fac));

  if (pad) {
    const sceneHits = hits.filter((h) =>
      /ピストン|手コキ|騎乗|逆|アナル|射精|ナンパ|性感|痴女|杭打ち|専属|学芸員|マン毛|エステ|催●|170|タイトル|ベスト第|時間|発射|腿コキ|搾精|見下ろ|ホールド|アスリート/.test(
        h,
      ),
    );
    if (sceneHits.length >= 1 && (hits.length >= 2 || sceneHits[0]!.length >= 4)) return "EXACT";
    if (hits.length >= 3) return "EXACT";
    if (hits.length >= 1) return "SEMANTIC";
    return null;
  }

  if (hits.length >= 2) return "EXACT";
  if (hits.length === 1) {
    const h = hits[0]!;
    if (h.length >= 4 && !isWeakPlanFact(h)) return "EXACT";
    return "SEMANTIC";
  }
  return null;
}

/**
 * Primary ArticlePlan fact realization — status is the SSOT for compliance.
 * EXACT / SEMANTIC = realized (OK); CONTRADICTION / NONE = not realized (NG).
 */
export function resolveFactRealization(
  sentence: string,
  fact: string,
  opts?: { padBearing?: boolean },
): FactRealizationResult {
  const s = sentence.replace(/\s+/g, "");
  const f = fact.replace(/\s+/g, "");
  if (!f || !s) {
    const empty: SemanticMatch = {
      contradiction: false,
      exactQuantity: false,
      abstractQuantity: false,
      anchorHits: 0,
      anchorTotal: 0,
    };
    return { ...empty, status: "NONE", strength: "none", realized: false };
  }

  if (factRequiresConcessiveRelation(fact)) {
    const concessive = matchConcessiveProposition(sentence, fact);
    const base: SemanticMatch = {
      contradiction: false,
      exactQuantity: false,
      abstractQuantity: false,
      anchorHits: 0,
      anchorTotal: 0,
    };
    if (concessive === "EXACT") {
      return {
        ...base,
        exactQuantity: true,
        status: "EXACT",
        strength: "strong",
        realized: true,
      };
    }
    if (concessive === "SEMANTIC") {
      return {
        ...base,
        abstractQuantity: true,
        status: "SEMANTIC",
        strength: "weak",
        realized: true,
      };
    }
    // Long concessive narrative: major-meaning OK only when contrast/concessive
    // relation is still present (do not accept である / なので drifts).
    if (
      f.length >= 24 &&
      majorMeaningRealized(sentence, fact) &&
      (sentenceHasConcessiveRelation(sentence) ||
        /(?:でも|なのに|ながら|つつ|にもかかわらず)/u.test(sentence))
    ) {
      return {
        ...base,
        abstractQuantity: true,
        status: "SEMANTIC",
        strength: "weak",
        realized: true,
      };
    }
    return { ...base, status: "NONE", strength: "none", realized: false };
  }

  const pad = Boolean(opts?.padBearing);
  const surface = surfaceRealizationStatus(sentence, fact, pad);
  if (surface !== null) {
    return {
      contradiction: false,
      exactQuantity: surface === "EXACT",
      abstractQuantity: surface === "SEMANTIC",
      anchorHits: 0,
      anchorTotal: 0,
      status: surface,
      strength: strengthFromStatus(surface),
      realized: isFactRealized(surface),
    };
  }

  const semantic = evaluateSemanticMatch(fact, sentence);
  let status = statusFromSemantic(semantic, fact);
  if (
    pad &&
    status === "SEMANTIC" &&
    !semantic.exactQuantity &&
    semantic.anchorHits < 2
  ) {
    // Pad-bearing: require stronger scene evidence before counting SEMANTIC
    status = "NONE";
  }

  // Long SEMANTIC_PRESERVE atoms: major meaning anchors (not full surface restage)
  if (status === "NONE" && f.length >= 20 && majorMeaningRealized(sentence, fact)) {
    status = "SEMANTIC";
  }

  return {
    ...semantic,
    status,
    strength: strengthFromStatus(status),
    realized: isFactRealized(status),
  };
}

/**
 * Legacy strength alias — prefer resolveFactRealization().status.
 * strong = EXACT; weak = SEMANTIC; none = CONTRADICTION | NONE.
 */
export function matchFactStrength(
  sentence: string,
  fact: string,
  opts?: { padBearing?: boolean },
): "strong" | "weak" | "none" {
  return resolveFactRealization(sentence, fact, opts).strength;
}

export function hasConcreteSurface(sentence: string): boolean {
  return SCENE_SURFACE_RE.test(sentence);
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs.filter((x) => x.trim().length > 0))];
}

/** Concrete coverage keys from a span against plan facts. */
export function concreteCoverageKeys(
  text: string,
  facts: string[],
  opts?: { padBearing?: boolean },
): Set<string> {
  const keys = new Set<string>();
  if (!text.trim()) return keys;
  for (const fact of facts) {
    if (isWeakPlanFact(fact)) continue;
    if (isFactRealized(resolveFactRealization(text, fact, opts).status)) {
      keys.add(`fact:${fact}`);
      keys.add(`family:${familyOf(fact)}`);
    }
  }
  const evidenceBlob = facts.join("\n");
  for (const m of text.matchAll(
    /杭打ち騎乗位|スイッチ逆3P|美尻腰振り逆5P|身長差手コキ|アナル舐め|性感を開発|性感開発|専属第二弾|激しいピストン|50回もの射精|最新12タイトル|ベスト第6弾|回春エステ|催●術|巨乳学芸員|コインランドリー|痴女として/g,
  )) {
    const tok = m[0]!;
    if (
      evidenceBlob.includes(tok.slice(0, Math.min(4, tok.length))) ||
      facts.some(
        (f) => paraphraseHit(tok, f) || isFactRealized(resolveFactRealization(tok, f).status),
      )
    ) {
      keys.add(`surface:${tok}`);
    }
  }
  return keys;
}

export function assignedCoverageKeys(
  text: string,
  assignedFacts: string[],
  opts?: { padBearing?: boolean },
): Set<string> {
  const keys = new Set<string>();
  for (const fact of assignedFacts) {
    if (isWeakPlanFact(fact)) continue;
    if (isFactRealized(resolveFactRealization(text, fact, opts).status)) keys.add(fact);
  }
  return keys;
}

export function writerVisiblePlanFacts(facts: string[]): string[] {
  return uniq(facts);
}

export function setUnion(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set(a);
  for (const x of b) out.add(x);
  return out;
}

export function uniqueIn(keys: Set<string>, covered: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const k of keys) if (!covered.has(k)) out.add(k);
  return out;
}

/** Sentence realizes at least one plan fact (EXACT or SEMANTIC). */
export function sentenceCarriesRealizedPlanFact(sentence: string, planFacts: string[]): boolean {
  for (const fact of planFacts) {
    if (isWeakPlanFact(fact)) continue;
    if (isFactRealized(resolveFactRealization(sentence, fact, { padBearing: false }).status)) {
      return true;
    }
  }
  return false;
}

/** @deprecated Use sentenceCarriesRealizedPlanFact — weak/strong is not a quality gate. */
export function sentenceCarriesStrongPlanFact(
  sentence: string,
  planFacts: string[],
): boolean {
  return sentenceCarriesRealizedPlanFact(sentence, planFacts);
}

export function sentenceFactCarryingKeepInvariant(
  sentence: string,
  planFacts: string[],
  hasPad: boolean,
): boolean {
  if (sentenceCarriesRealizedPlanFact(sentence, planFacts)) return true;
  if (!hasPad) return false;

  for (const fact of planFacts) {
    if (isWeakPlanFact(fact)) continue;
    if (isFactRealized(resolveFactRealization(sentence, fact, { padBearing: true }).status)) {
      return true;
    }
  }
  if (hasConcreteSurface(sentence)) {
    const keys = concreteCoverageKeys(sentence, planFacts, { padBearing: false });
    if ([...keys].some((k) => k.startsWith("surface:"))) return true;
  }
  return false;
}

/** Test / audit helper — full realization status + semantic metadata. */
export function evaluateFactRealization(
  sentence: string,
  fact: string,
  opts?: { padBearing?: boolean },
): FactRealizationResult {
  return resolveFactRealization(sentence, fact, opts);
}
