/**
 * Official FANZA product page → fact atoms for EvidencePack (LLM=0).
 *
 * Does NOT dump full description into Generator.
 * Does NOT treat sample image count as scene/act facts (no Vision).
 * Video object: extract concrete atoms only; keep videoEvidence generationEligible=false.
 */

import { classifySemanticEvidence, semanticClassToBlueprintType } from "./semantic-evidence.js";
import type { BlueprintEvidenceType } from "./reference-editorial-blueprint.js";
import type { ResearchEvidence } from "./research-evidence.js";
import { stripCatalogWrapper } from "./evidence-pack.js";

export type OfficialPageFactBucket =
  | "SUPPORTED_CONCRETE_FACT"
  | "CATALOG_METADATA"
  | "EVALUATIVE_OR_PROMOTIONAL"
  | "UNUSABLE";

export type OfficialPageFactAtom = {
  id: string;
  fact: string;
  bucket: OfficialPageFactBucket;
  familyId: string;
  primary: string;
  blueprintType: BlueprintEvidenceType;
  originField: string;
  source: "fanza_product_page";
  generatorAllowed: boolean;
};

export type OfficialPageEvidenceInput = {
  contentId?: string | null;
  descriptionText?: string | null;
  descriptionOriginField?: string;
  videoDescription?: string | null;
  videoOriginField?: string;
  actors?: string[] | null;
  /** Image availability for completeness only — never converted to prose facts. */
  imageContentKeys?: string[] | null;
  uniqueSampleSceneCount?: number | null;
};

const EVAL_PHRASE_RE =
  /キュート|エッチで|魅力|おすすめ|見逃せ|楽しめる|話題|最高|必見|超可愛|エチえち|本気をみさらせ|最強|天使な|大ボリュームで|詰まった|厳選の|いっちゃん/;

/** Source-backed character/expression stems — not promotional wrappers. */
const CHARACTER_CONCRETE_EXACT_RE =
  /^(?:生意気|生意気な表情|大人をバカにした表情)$/u;

/** Prefer concrete stem when a promotional phrase wraps a known trait/scene. */
function compressToConcreteStem(fact: string): string | null {
  const edition = fact.match(/(?:MOODYZ|エスワン)?ベスト第\d+弾/u);
  if (edition) return edition[0]!;
  const charExact = fact.match(CHARACTER_CONCRETE_EXACT_RE);
  if (charExact) return charExact[0]!;
  if (/(?:生意気)/u.test(fact) && fact.length <= 12) return "生意気";
  const stems = [
    "メスガキわからせ",
    "メスガキ",
    "わからせ",
    "痴女誘惑",
    "小悪魔痴女",
    "小悪魔",
    "ギャル妹",
    "絶対空域",
    "デカ尻",
    "激ピス",
    "お仕置きレ●プ",
    "お仕置きレ○プ",
    "MOODYZベスト",
    "ベスト",
    "総集編",
  ];
  for (const stem of stems) {
    if (fact.includes(stem)) return stem;
  }
  const qty = fact.match(/\d+\s*(?:作品|本番|射精|時間|分|コーナー)/);
  if (qty) return qty[0]!;
  return null;
}

/** Promo/eval surface tokens — never salvage as standalone facts (R136). */
const PROMO_SALVAGE_DENY_RE =
  /^(?:最高|最高傑作|豪華|スペシャル|魅力|誕生|詰まった|全部詰まった|超ボリューム|永久保存|過激|究極|大ボリューム|厳選|必見|おすすめ|楽しめる|話題)$/u;

/** Scene stems aligned with semantic-evidence SCENE_STEM_RE + common action prefixes. */
const SCENE_SALVAGE_MATCH_RE =
  /(?:追撃|猛烈|ハード|杭打ち|逆\d+P)?(?:キス|舐め|セックス|ピストン|激ピス|潮(?:吹)?|乱交|痴女(?:られ|誘惑)?|わからせ|洗脳|生ハメ|顔面|挿入|絶頂|責め|フェラ|騎乗|中出し|ハメ潮|アナル|レ[○●]プ|どしゃぶり)/gu;
const SCENE_SALVAGE_TEST_RE =
  /(?:追撃|猛烈|ハード|杭打ち|逆\d+P)?(?:キス|舐め|セックス|ピストン|激ピス|潮(?:吹)?|乱交|痴女(?:られ|誘惑)?|わからせ|洗脳|生ハメ|顔面|挿入|絶頂|責め|フェラ|騎乗|中出し|ハメ潮|アナル|レ[○●]プ|どしゃぶり)/u;

const QTY_SALVAGE_MATCH_RE = /\d+\s*(?:作品|本番|射精|時間|分|コーナー|タイトル|発射)/gu;
const QTY_SALVAGE_TEST_RE = /^\d+\s*(?:作品|本番|射精|時間|分|コーナー|タイトル|発射)$/u;

/** Body-trait stems — same coverage as semantic-evidence BODY_TRAIT_RE (no new taxonomy). */
const BODY_TRAIT_SALVAGE_MATCH_RE =
  /(?:巨乳|美乳|敏感|感度|Hカップ|細身|長身|美脚|デカ尻|低身長|グラマラスボディ|グラマラス)/gu;
const BODY_TRAIT_SALVAGE_TEST_RE =
  /(?:巨乳|美乳|敏感|感度|Hカップ|細身|長身|美脚|デカ尻|低身長|グラマラスボディ|グラマラス)/u;

/** Work-theme facets salvaged from promo wrappers (independent of eval parent). */
const THEME_FACET_SALVAGE_MATCH_RE = /(?:\bNTR\b|人妻|熟女|美少女|女子校生)/gi;
const THEME_FACET_SALVAGE_TEST_RE = /^(?:NTR|人妻|熟女|美少女|女子校生)$/iu;

function isPromoOnlySalvageToken(token: string): boolean {
  const t = token.trim();
  if (!t || PROMO_SALVAGE_DENY_RE.test(t)) return true;
  if (EVAL_PHRASE_RE.test(t) && t.length > 12 && !compressToConcreteStem(t)) return true;
  return false;
}

/** Contrast body-trait compounds attested in SOURCE (なのに). */
const CONTRAST_BODY_COMPOUND_RE =
  /((?:低身長|長身|細身|巨乳|美乳)(?:なのに)(?:グラマラスボディ|グラマラス|デカ尻|巨乳|美乳|美脚|細身))/gu;

/** Compilation / work-structure scope salvaged from promo wrappers. */
const COMPILATION_SCOPE_RE = /全コーナーを収録/gu;

/** Ambiguous performer-quality clause — keep only with attested performer attachment. */
const AMBIGUOUS_PERFORMER_QUALITY_RE = /^円熟した濃厚なセックスとエロポテンシャル$/u;

const THEME_SCOPE_TOKEN_RE =
  /(?:人妻|NTR|痴女|熟女|美少女|女子校生|追撃ピストン)/gu;

function isRelationPreservingCompound(fact: string): boolean {
  const f = fact.trim();
  return (
    /なのに/u.test(f) ||
    /全コーナーを収録/u.test(f) ||
    /などを収録$/u.test(f) ||
    /の円熟した濃厚なセックスとエロポテンシャル$/u.test(f)
  );
}

function normalizeAtomSurfaceKey(fact: string): string {
  return fact.replace(/\s+/g, "");
}

/** SCENE_ACTION duplicate only when one normalized surface fully contains a shorter variant. */
function sceneActionSurfaceSubsumes(longerFact: string, shorterFact: string): boolean {
  const longKey = normalizeAtomSurfaceKey(longerFact);
  const shortKey = normalizeAtomSurfaceKey(shorterFact);
  if (!longKey.includes(shortKey) || longKey.length <= shortKey.length) return false;
  // "奥田咲の円熟…" must not suppress the actor fact "奥田咲"
  if (longKey.startsWith(`${shortKey}の`)) return false;
  return true;
}

function dedupeSceneActionsByContainment(atoms: OfficialPageFactAtom[]): OfficialPageFactAtom[] {
  const scenes = atoms.filter((a) => a.generatorAllowed && a.primary === "SCENE_ACTION");
  if (scenes.length <= 1) return atoms;

  const keptKeys = new Set<string>();
  const sorted = [...scenes].sort((a, b) => b.fact.length - a.fact.length);

  for (const candidate of sorted) {
    const key = normalizeAtomSurfaceKey(candidate.fact);
    const subsumedByKept = [...keptKeys].some((keptKey) => {
      const kept = sorted.find((s) => normalizeAtomSurfaceKey(s.fact) === keptKey);
      return kept != null && sceneActionSurfaceSubsumes(kept.fact, candidate.fact);
    });
    if (subsumedByKept) continue;

    for (const keptKey of [...keptKeys]) {
      const kept = sorted.find((s) => normalizeAtomSurfaceKey(s.fact) === keptKey);
      if (kept != null && sceneActionSurfaceSubsumes(candidate.fact, kept.fact)) {
        keptKeys.delete(keptKey);
      }
    }
    keptKeys.add(key);
  }

  return atoms.map((a) => {
    if (!a.generatorAllowed || a.primary !== "SCENE_ACTION") return a;
    if (keptKeys.has(normalizeAtomSurfaceKey(a.fact))) return a;
    return { ...a, bucket: "UNUSABLE" as const, generatorAllowed: false };
  });
}

/**
 * SOURCE-attested relation compounds that must not be fully stem-split away.
 * No new schema — returns plain fact strings for existing atom pipeline.
 */
export function extractRelationPreservingFacts(
  text: string,
  actors?: string[] | null,
): string[] {
  const raw = text.trim();
  if (raw.length < 4) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (fact: string) => {
    const t = fact.trim();
    if (t.length < 4 || t.length > 48) return;
    if (PROMO_SALVAGE_DENY_RE.test(t) || /最高傑作|豪華でスペシャル/u.test(t)) return;
    const key = t.replace(/\s+/g, "");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  CONTRAST_BODY_COMPOUND_RE.lastIndex = 0;
  for (const m of raw.matchAll(CONTRAST_BODY_COMPOUND_RE)) {
    add(m[1] ?? m[0]!);
  }

  // 最新Nタイトル + なお且つ全コーナーを収録 → one attested compilation-scope fact
  const combo = raw.match(
    /最新\s*(\d+)\s*タイトル[^。！？]{0,48}全コーナーを収録/u,
  );
  if (combo) {
    add(`最新${combo[1]}タイトルの全コーナーを収録`);
  } else {
    COMPILATION_SCOPE_RE.lastIndex = 0;
    if (COMPILATION_SCOPE_RE.test(raw)) add("全コーナーを収録");
  }

  // Theme list + collection-scope marker (など…詰まった) → short scope fact; drop pure promo
  const themeScope = raw.match(
    new RegExp(
      `((?:${THEME_SCOPE_TOKEN_RE.source})(?:[、,・](?:${THEME_SCOPE_TOKEN_RE.source}))*)など[^。！？]{0,28}?(?:全部詰まった|詰まった|を収録)`,
      "u",
    ),
  );
  if (themeScope?.[1]) {
    const themes = themeScope[1]
      .split(/[、,・]/u)
      .map((t) => t.trim())
      .filter(Boolean);
    if (themes.length >= 2) add(`${themes.join("・")}などを収録`);
  }

  // Ambiguous quality clause: attach performer only when SOURCE places name in the same claim window
  for (const actor of actors ?? []) {
    const name = actor.trim();
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const attributed = new RegExp(
      `円熟した濃厚なセックスとエロポテンシャル[^。！？]{0,48}[‘'']?${escaped}`,
      "u",
    );
    if (attributed.test(raw)) {
      add(`${name}の円熟した濃厚なセックスとエロポテンシャル`);
    }
  }

  return out;
}

/**
 * R136 — Extract source-supported concrete sub-tokens from promo/eval segments.
 * Parent segment remains excluded; only independent safe tokens are returned.
 * Also salvages short compilation-scope phrases (全コーナーを収録).
 */
export function extractSafeConcreteSalvageTokens(segment: string): string[] {
  const seg = segment.trim();
  if (seg.length < 2) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  const tryAdd = (raw: string, maxLen = 24) => {
    const token = stripCatalogWrapper(raw).trim() || raw.trim();
    if (token.length < 2 || token.length > maxLen) return;
    const key = token.replace(/\s+/g, "");
    if (seen.has(key) || isPromoOnlySalvageToken(token)) return;

    const sem = classifySemanticEvidence(token, { sourceType: "product_description" });
    if (sem.primary === "EVALUATIVE" || sem.primary === "CATALOG") return;

    const isScene =
      SCENE_SALVAGE_TEST_RE.test(token) && sem.primary === "SCENE_ACTION";
    const isQty = QTY_SALVAGE_TEST_RE.test(token);
    const isBodyTrait =
      BODY_TRAIT_SALVAGE_TEST_RE.test(token) &&
      (sem.primary === "BODY_TRAIT" || BODY_TRAIT_SALVAGE_TEST_RE.test(token));
    const isTheme = THEME_FACET_SALVAGE_TEST_RE.test(token);
    const isCompilationScope = /全コーナーを収録/u.test(token);
    const isContrastCompound =
      /なのに/u.test(token) && BODY_TRAIT_SALVAGE_TEST_RE.test(token);

    if (
      !isScene &&
      !isQty &&
      !isBodyTrait &&
      !isTheme &&
      !isCompilationScope &&
      !isContrastCompound
    ) {
      return;
    }

    const classified = classifyAtomFact(token, "salvage_candidate_check", 0);
    if (classified.bucket !== "SUPPORTED_CONCRETE_FACT" || !classified.generatorAllowed) return;

    seen.add(key);
    out.push(token);
  };

  CONTRAST_BODY_COMPOUND_RE.lastIndex = 0;
  for (const m of seg.matchAll(CONTRAST_BODY_COMPOUND_RE)) tryAdd(m[1] ?? m[0]!, 40);
  COMPILATION_SCOPE_RE.lastIndex = 0;
  for (const m of seg.matchAll(COMPILATION_SCOPE_RE)) tryAdd(m[0]!, 24);

  for (const m of seg.matchAll(SCENE_SALVAGE_MATCH_RE)) tryAdd(m[0]!);
  for (const m of seg.matchAll(QTY_SALVAGE_MATCH_RE)) tryAdd(m[0]!);
  for (const m of seg.matchAll(BODY_TRAIT_SALVAGE_MATCH_RE)) tryAdd(m[0]!);
  for (const m of seg.matchAll(THEME_FACET_SALVAGE_MATCH_RE)) tryAdd(m[0]!);

  return out;
}

function pushSalvagedTokensFromEvalSegment(
  seg: string,
  originField: string,
  atoms: OfficialPageFactAtom[],
  nextIdx: () => number,
  pendingFactKeys: Set<string>,
): void {
  if (!EVAL_PHRASE_RE.test(seg)) return;

  for (const token of extractSafeConcreteSalvageTokens(seg)) {
    const factKey = token.replace(/\s+/g, "");
    if (pendingFactKeys.has(factKey)) continue;
    if (atoms.some((a) => a.generatorAllowed && a.fact.replace(/\s+/g, "") === factKey)) continue;

    const classified = classifyAtomFact(token, originField, nextIdx());
    if (classified.bucket !== "SUPPORTED_CONCRETE_FACT" || !classified.generatorAllowed) continue;

    atoms.push(classified);
    pendingFactKeys.add(factKey);
  }
}

/**
 * R151 — extract balanced paired spans before punctuation split.
 * Prevents 【…】 / 「…」 from being torn into orphan shards.
 */
export function extractBalancedPunctuationSpans(text: string): string[] {
  const pairs: Array<[string, string]> = [
    ["【", "】"],
    ["「", "」"],
    ["『", "』"],
    ["（", "）"],
    ["(", ")"],
    ["[", "]"],
  ];
  const out: string[] = [];
  for (const [open, close] of pairs) {
    const re = new RegExp(
      `${open.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^${close.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]{1,48})${close.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "gu",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const span = m[0]!;
      if (span.length >= 3 && span.length <= 52 && !out.includes(span)) out.push(span);
    }
  }
  return out;
}

/** Split marketing copy into candidate phrase segments. */
function splitDescriptionSegments(text: string): string[] {
  const protectedSpans = extractBalancedPunctuationSpans(text);
  let work = text;
  const placeholders: string[] = [];
  for (const span of protectedSpans) {
    const token = `\uE000${placeholders.length}\uE001`;
    placeholders.push(span);
    work = work.split(span).join(token);
  }
  const parts = work
    .split(/[！!？?。．、,，／/|｜・…~～]+/)
    .map((s) => {
      let restored = s.trim();
      for (let i = 0; i < placeholders.length; i++) {
        restored = restored.split(`\uE000${i}\uE001`).join(placeholders[i]!);
      }
      return restored.trim();
    })
    .filter((s) => s.length >= 2 && s.length <= 60);
  // Also emit balanced spans as atomic segments when long enough
  for (const span of protectedSpans) {
    if (span.length >= 4 && span.length <= 52 && !parts.includes(span)) {
      parts.unshift(span);
    }
  }
  return parts;
}

function extractPatternAtoms(text: string): string[] {
  const out: string[] = [];
  const patterns: RegExp[] = [
    /(\d+)\s*作品/g,
    /(\d+)\s*本番/g,
    /(\d+)\s*射精/g,
    /(\d+)\s*時間/g,
    /(\d+)\s*分/g,
    /(\d+)\s*コーナー/g,
    /メスガキ/g,
    /わからせ/g,
    /痴女られ?/g,
    /痴女誘惑/g,
    /激ピス/g,
    /追撃ピストン/g,
    /ギャル妹/g,
    /小悪魔痴女/g,
    /小悪魔/g,
    /絶対空域/g,
    /デカ尻/g,
    /グラマラスボディ/g,
    /低身長/g,
    /人妻/g,
    /\bNTR\b/gi,
    /お仕置きレ[○●]プ/g,
    /大人をバカにした表情/g,
    /生意気な表情/g,
    /生意気/g,
    /(?:MOODYZ|エスワン)?ベスト第\d+弾/g,
    /MOODYZベスト/g,
    /ベスト第?\d*弾?/g,
    /総集編/g,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push(m[0]!);
    }
  }
  return out;
}

/**
 * Standalone fragments that are not product-intro Evidence atoms.
 * Shape-based (not a word blacklist): exclamations, dialogue crumbs,
 * kana-only parenthetical readings, ultra-short context-lost tokens.
 * Keeps short concrete facets with kanji/scene stems (e.g. 絶対空域, 激ピス).
 */
export function isUnusablePageAtomFragment(fact: string): boolean {
  const t = (fact ?? "").trim();
  if (!t) return true;

  // Parenthetical kana-only reading: （きょうしゃ）
  if (/^[（(]\s*[ぁ-んァ-ヶー･・\s]{1,20}\s*[）)]$/u.test(t)) return true;

  // Hiragana-only short interjection / moan: あぁ
  if (/^[ぁ-んーゝゞ]{1,4}$/u.test(t)) return true;

  // Short uppercase Latin genre/facet codes (NTR, SM, …) — product theme, not dialogue
  if (/^[A-Z]{2,4}$/u.test(t)) return false;

  // Katakana-only ultra-short dialogue stem: ヤッテ — keep known scene/product stems
  if (/^[ァ-ヶー]{2,5}$/u.test(t)) {
    if (
      /(?:ピス|フェラ|キス|ハメ|オナニ|イラマ|スパン|ベスト|ノンストップ|エステ|ハーレム)/u.test(
        t,
      )
    ) {
      return false;
    }
    return true;
  }

  // Ultra-short with no kanji/digit and not a certified short stem pattern
  if (
    t.length <= 3 &&
    !/[\u4e00-\u9fff0-9]/u.test(t) &&
    !/(?:ピス|フェラ|キス)/u.test(t)
  ) {
    return true;
  }

  return false;
}

function classifyAtomFact(
  fact: string,
  originField: string,
  idx: number,
): OfficialPageFactAtom {
  let cleaned = stripCatalogWrapper(fact).trim() || fact.trim();

  // Bare ambiguous quality without performer attachment → not Writer fuel
  if (AMBIGUOUS_PERFORMER_QUALITY_RE.test(cleaned)) {
    const semEval = classifySemanticEvidence(cleaned, {
      sourceType: "product_description",
    });
    return {
      id: `page_atom::${originField.replace(/[^a-zA-Z0-9._-]/g, "_")}::${idx}`,
      fact: cleaned,
      bucket: "EVALUATIVE_OR_PROMOTIONAL",
      familyId: semEval.familyId,
      primary: semEval.primary,
      blueprintType: semEval.blueprintType,
      originField,
      source: "fanza_product_page",
      generatorAllowed: false,
    };
  }

  // Long promo wrappers → compress to stem when possible
  if (cleaned.length > 12 && EVAL_PHRASE_RE.test(cleaned)) {
    const stem = compressToConcreteStem(cleaned);
    if (stem && stem !== cleaned) {
      // Mark original as excluded path by classifying the stem instead
      cleaned = stem;
    } else if (!compressToConcreteStem(cleaned)) {
      const semEval = classifySemanticEvidence(cleaned, {
        sourceType: "product_description",
      });
      return {
        id: `page_atom::${originField.replace(/[^a-zA-Z0-9._-]/g, "_")}::${idx}`,
        fact: cleaned,
        bucket: "EVALUATIVE_OR_PROMOTIONAL",
        familyId: semEval.familyId,
        primary: semEval.primary,
        blueprintType: semEval.blueprintType,
        originField,
        source: "fanza_product_page",
        generatorAllowed: false,
      };
    }
  }

  const sem = classifySemanticEvidence(cleaned, {
    sourceType: "product_description",
  });

  let bucket: OfficialPageFactBucket = "SUPPORTED_CONCRETE_FACT";
  if (CHARACTER_CONCRETE_EXACT_RE.test(cleaned)) {
    bucket = "SUPPORTED_CONCRETE_FACT";
  } else if (
    sem.primary === "EVALUATIVE" ||
    (EVAL_PHRASE_RE.test(cleaned) && !compressToConcreteStem(cleaned))
  ) {
    bucket = "EVALUATIVE_OR_PROMOTIONAL";
  }
  // Relation-preserving compounds stay concrete even if classify leans evaluative on wrappers
  if (
    isRelationPreservingCompound(cleaned) &&
    !/最高傑作|豪華|スペシャルなベスト版/u.test(cleaned)
  ) {
    bucket = "SUPPORTED_CONCRETE_FACT";
  }
  if (sem.primary === "CATALOG") bucket = "CATALOG_METADATA";
  if (cleaned.length < 2) bucket = "UNUSABLE";
  if (isUnusablePageAtomFragment(cleaned)) bucket = "UNUSABLE";
  if (
    /^(etc\.?|いっちゃん|な小悪魔|の本気|で45射精|の大ボリューム)$/i.test(cleaned)
  ) {
    bucket = "UNUSABLE";
  }

  const generatorAllowed = bucket === "SUPPORTED_CONCRETE_FACT";

  // SSOT: primary from semantic classify; blueprint derived only from primary.
  const primary = CHARACTER_CONCRETE_EXACT_RE.test(cleaned)
    ? "CHARACTER_TRAIT"
    : sem.primary;
  let familyId = CHARACTER_CONCRETE_EXACT_RE.test(cleaned)
    ? `CHARACTER_${cleaned}`
    : sem.familyId;

  // Stable family keys only — do not invent alternate primary vs classifier
  if (/なのに/u.test(cleaned) && BODY_TRAIT_SALVAGE_TEST_RE.test(cleaned) && primary === "BODY_TRAIT") {
    familyId = `BODY_CONTRAST_${cleaned.replace(/\s+/g, "").slice(0, 24)}`;
  } else if (primary === "PRODUCT_FORM" && /収録|タイトル|コーナー|ベスト|総集編|コレクション/u.test(cleaned)) {
    familyId = `COMPILATION_SCOPE_${cleaned.replace(/\s+/g, "").slice(0, 24)}`;
  }

  const blueprintType: BlueprintEvidenceType = semanticClassToBlueprintType(
    primary as Parameters<typeof semanticClassToBlueprintType>[0],
  );

  return {
    id: `page_atom::${originField.replace(/[^a-zA-Z0-9._-]/g, "_")}::${idx}`,
    fact: cleaned,
    bucket,
    familyId,
    primary,
    blueprintType,
    originField,
    source: "fanza_product_page",
    generatorAllowed,
  };
}

/** Reader-invitation speech act — strip from clause, never reason to drop promo/eval wrapper. */
const READER_INVITATION_TAIL_RE =
  /(?:鑑賞後は[^。！？]*愛でられたら幸いでございます|我々を驚かせる[^。！？]*出会えるはず[^。！？]*)/gu;

const READER_INVITATION_PHRASE_RES: RegExp[] = [
  /この2人と一緒に(?:鑑賞しましょう|見てみましょう)/gu,
  /一緒に(?:鑑賞しましょう|見てみましょう)/gu,
  /鑑賞しましょう/gu,
  /一緒に見てみましょう/gu,
  /楽しみましょう/gu,
  /ご覧ください/gu,
  /チェックしてみてください/gu,
  /スケベにご紹介/gu,
  /ご紹介/gu,
  /案内する/gu,
  /紹介する/gu,
  /愛でられたら幸いでございます/gu,
  /出会えるはず/gu,
];

function trimClauseEdges(text: string): string {
  return text
    .replace(/^[、，。．！!？?◆\s]+/u, "")
    .replace(/[、，。．！!？?◆\s]+$/u, "")
    .trim();
}

function stripReaderInvitationPhrases(text: string): string {
  let t = text.trim();
  if (!t) return "";
  t = t.replace(READER_INVITATION_TAIL_RE, "");
  for (const re of READER_INVITATION_PHRASE_RES) {
    re.lastIndex = 0;
    t = t.replace(re, "");
  }
  return trimClauseEdges(t);
}

function clauseHasSubstantiveContent(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (/^\d+\s*(?:分|時間|作品|本番|射精|名|人|cm|コーナー|タイトル)$/.test(t)) return true;
  if (
    /(?:ピストン|フェラ|舐め|騎乗|ハーレム|痴女|NTR|手コキ|中出し|マン毛|ナンパ|コインランドリー|エステ|学芸員|女子大生|人妻|写真館|杭打ち|逆\d+P|射精|絶頂|セックス|ベスト|総集編|デビュー|タイトル|コーナー|ハーレム|170cm|高身長|巨乳|デカ尻|ガニ股|潮|絶頂)/u.test(
      t,
    )
  ) {
    return true;
  }
  return t.length >= 6 && /[\u4e00-\u9fffァ-ヶー]{2,}/u.test(t);
}

function isPureReaderInvitationRemainder(text: string): boolean {
  const stripped = stripReaderInvitationPhrases(text).trim();
  if (stripped.length < 2) return true;
  if (clauseHasSubstantiveContent(stripped)) return false;
  return /(?:鑑賞|ご覧|チェック|楽しみ|愛でられ|出会えるはず|幸いで)/u.test(stripped);
}

/** Upstream-certified concrete primaries — short tokens must not drop on length alone (r98). */
const UPSTREAM_CONCRETE_PRIMARIES = new Set([
  "SCENE_ACTION",
  "DURATION",
  "QUANTITY",
  "PERFORMER",
  "PERFORMER_IDENTITY",
  "PRODUCT_PERSONA",
  "CHARACTER_TRAIT",
  "BODY_TRAIT",
  "UNKNOWN_CONCRETE",
  "PRODUCT_FORM",
  "TITLE_LABEL",
  "SERIES_CONCEPT",
  "SERIES_CONTEXT",
  "EVENT",
  "RELATIONSHIP",
]);

/** True when nothing substantive remains after invitation strip (drop whole clause). */
export function isReaderInvitationOnlyClause(text: string): boolean {
  const classified = classifyAtomFact(text, "reader_invitation_check", 0);
  if (
    classified.bucket === "SUPPORTED_CONCRETE_FACT" &&
    classified.generatorAllowed &&
    UPSTREAM_CONCRETE_PRIMARIES.has(classified.primary)
  ) {
    return isPureReaderInvitationRemainder(text);
  }
  const stripped = stripReaderInvitationPhrases(text);
  return stripped.length < 2 || !clauseHasSubstantiveContent(stripped);
}

/**
 * Remove reader-invitation phrases; keep setting/subject/action/object and promo/eval wording.
 * Splits on ◆ and keeps the strongest concrete segment(s) as one clause (longest wins).
 */
export function stripReaderInvitationFromClause(text: string): string {
  const raw = text.trim();
  if (!raw) return "";

  const segments = raw.split(/◆|／|\//).map((s) => stripReaderInvitationPhrases(s.trim()));
  const concrete = segments.filter(
    (s) => s.length >= 2 && clauseHasSubstantiveContent(s) && !isReaderInvitationOnlyClause(s),
  );
  if (concrete.length > 0) {
    return concrete.sort((a, b) => b.length - a.length)[0]!;
  }

  const inline = stripReaderInvitationPhrases(raw);
  return inline.length >= 2 && clauseHasSubstantiveContent(inline) ? inline : "";
}

/**
 * Writer-safe clause from a page fact: preserves relation/context; strips reader invitation only.
 * Promo/evaluative expressions (究極, 濃密, 最高傑作, 魅力, 夢の〜) are kept in clauses.
 * Standalone promo-only crumbs without substantive product content still drop.
 */
export function writerSafeClauseFromPageFact(fact: string): string | null {
  const raw = stripCatalogWrapper(fact).trim() || fact.trim();
  if (raw.length < 2) return null;

  const classified = classifyAtomFact(raw, "writer_safe_projection", 0);
  if (classified.bucket === "UNUSABLE" || classified.bucket === "CATALOG_METADATA") {
    return null;
  }

  const clause = stripReaderInvitationFromClause(raw);
  if (
    classified.bucket === "EVALUATIVE_OR_PROMOTIONAL" &&
    (clause.length < 8 || !clauseHasSubstantiveContent(clause) || isReaderInvitationOnlyClause(clause))
  ) {
    return null;
  }

  if (clause.length >= 2 && !isReaderInvitationOnlyClause(clause)) {
    return clause;
  }

  // Short SUPPORTED concrete atoms (絶対空域 / ギャル妹 / performer names) must survive.
  if (
    classified.bucket === "SUPPORTED_CONCRETE_FACT" &&
    classified.generatorAllowed &&
    (UPSTREAM_CONCRETE_PRIMARIES.has(classified.primary) || raw.length <= 24)
  ) {
    const invitationStripped = stripReaderInvitationPhrases(raw).trim();
    if (
      invitationStripped.length >= 2 &&
      invitationStripped.length <= 40 &&
      !isPureReaderInvitationRemainder(raw)
    ) {
      return invitationStripped;
    }
  }

  return null;
}

/** @deprecated Use writerSafeClauseFromPageFact — kept for audit scripts; no stem compression. */
export function writerSafeStemFromPageFact(fact: string): string | null {
  return writerSafeClauseFromPageFact(fact);
}

/**
 * Deterministic fact atomization from official page description / VideoObject / actors.
 */
export function extractOfficialPageFactAtoms(
  input: OfficialPageEvidenceInput,
): {
  atoms: OfficialPageFactAtom[];
  concrete: OfficialPageFactAtom[];
  excluded: OfficialPageFactAtom[];
  imageAvailability: {
    uniqueSampleSceneCount: number | null;
    packagePresent: boolean;
    note: string;
  };
} {
  const atoms: OfficialPageFactAtom[] = [];
  let idx = 0;
  const actorNames = (input.actors ?? [])
    .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    .map((a) => a.trim());

  const pushFromText = (text: string | null | undefined, originField: string) => {
    if (!text?.trim()) return;
    const raw = text.trim();
    // Relation-preserving compounds before stem fishing (contrast / scope / attached quality)
    for (const rel of extractRelationPreservingFacts(raw, actorNames)) {
      atoms.push(classifyAtomFact(rel, originField, idx++));
    }
    // Pattern atoms first (high precision)
    for (const p of extractPatternAtoms(raw)) {
      atoms.push(classifyAtomFact(p, originField, idx++));
    }
    // Segment scan
    const salvagedFactKeys = new Set<string>();
    for (const seg of splitDescriptionSegments(raw)) {
      // R136: salvage safe concrete sub-tokens before parent promo exclusion
      pushSalvagedTokensFromEvalSegment(seg, originField, atoms, () => idx++, salvagedFactKeys);

      if (EVAL_PHRASE_RE.test(seg) && compressToConcreteStem(seg)) {
        // Record promo wrapper as excluded; stem already/also extracted via patterns/classify
        const stem = compressToConcreteStem(seg)!;
        if (seg !== stem) {
          const sem = classifySemanticEvidence(seg, { sourceType: "product_description" });
          atoms.push({
            id: `page_atom::${originField.replace(/[^a-zA-Z0-9._-]/g, "_")}::${idx++}`,
            fact: seg,
            bucket: "EVALUATIVE_OR_PROMOTIONAL",
            familyId: sem.familyId,
            primary: sem.primary,
            blueprintType: sem.blueprintType,
            originField,
            source: "fanza_product_page",
            generatorAllowed: false,
          });
        }
      }
      if (
        atoms.some(
          (a) =>
            a.originField === originField &&
            seg.includes(a.fact) &&
            a.fact.length < seg.length &&
            a.generatorAllowed,
        )
      ) {
        const classified = classifyAtomFact(seg, originField, idx++);
        if (classified.bucket !== "SUPPORTED_CONCRETE_FACT") {
          atoms.push(classified);
        }
        continue;
      }
      atoms.push(classifyAtomFact(seg, originField, idx++));
    }
  };

  pushFromText(
    input.descriptionText,
    input.descriptionOriginField ?? "jsonld.Product.description",
  );
  pushFromText(
    input.videoDescription,
    input.videoOriginField ?? "jsonld.VideoObject.description",
  );

  for (const actor of actorNames) {
    const name = actor;
    const sem = classifySemanticEvidence(name, {
      kind: "performer",
      sourceType: "performer_metadata",
    });
    atoms.push({
      id: `page_atom::actor::${idx++}`,
      fact: name,
      bucket: "SUPPORTED_CONCRETE_FACT",
      familyId: sem.familyId,
      primary: sem.primary,
      blueprintType: sem.blueprintType,
      originField: "jsonld.VideoObject.actor",
      source: "fanza_product_page",
      generatorAllowed: true,
    });
  }

  /** R149 — metadata actor atoms beat description shards on same surface/family. */
  const pageAtomAuthority = (a: OfficialPageFactAtom): number => {
    if (a.originField === "jsonld.VideoObject.actor") return 100;
    if (isRelationPreservingCompound(a.fact) && a.generatorAllowed) return 95;
    if (a.blueprintType === "performer_identity") return 90;
    if (a.primary === "PERFORMER_IDENTITY") return 85;
    return 10;
  };

  const factWinner = new Map<string, OfficialPageFactAtom>();
  const familyWinner = new Map<string, OfficialPageFactAtom>();
  for (const a of atoms) {
    if (!a.generatorAllowed) continue;
    const factKey = a.fact.replace(/\s+/g, "");
    const prevFact = factWinner.get(factKey);
    if (!prevFact || pageAtomAuthority(a) > pageAtomAuthority(prevFact)) {
      factWinner.set(factKey, a);
    }
    // SCENE_ACTION: stem-family dedupe replaced by containment dedupe below.
    if (a.primary === "SCENE_ACTION") continue;
    const prevFam = familyWinner.get(a.familyId);
    if (!prevFam || pageAtomAuthority(a) > pageAtomAuthority(prevFam)) {
      familyWinner.set(a.familyId, a);
    } else if (
      pageAtomAuthority(a) === pageAtomAuthority(prevFam) &&
      a.fact.length > prevFam.fact.length
    ) {
      // Prefer more specific surface within the same family (e.g. MOODYZベスト第2弾 > MOODYZベスト).
      familyWinner.set(a.familyId, a);
    }
  }

  const emittedFact = new Set<string>();
  const emittedFamily = new Set<string>();
  const deduped: OfficialPageFactAtom[] = [];
  for (const a of atoms) {
    const factKey = a.fact.replace(/\s+/g, "");
    if (a.generatorAllowed && factWinner.get(factKey) !== a) {
      deduped.push({ ...a, bucket: "UNUSABLE", generatorAllowed: false });
      continue;
    }
    if (emittedFact.has(factKey)) continue;
    emittedFact.add(factKey);
    if (a.generatorAllowed && a.primary !== "SCENE_ACTION") {
      if (familyWinner.get(a.familyId) !== a) {
        deduped.push({ ...a, bucket: "UNUSABLE", generatorAllowed: false });
        continue;
      }
      if (emittedFamily.has(a.familyId)) {
        deduped.push({ ...a, bucket: "UNUSABLE", generatorAllowed: false });
        continue;
      }
      emittedFamily.add(a.familyId);
    }
    deduped.push(a);
  }

  const sceneContainmentDeduped = dedupeSceneActionsByContainment(deduped);

  // Prefer relation compounds over bare stems they already contain (existing dedupe path only).
  const relationCompounds = sceneContainmentDeduped.filter(
    (a) => a.generatorAllowed && isRelationPreservingCompound(a.fact),
  );
  const afterSubsume = sceneContainmentDeduped.map((a) => {
    if (!a.generatorAllowed || isRelationPreservingCompound(a.fact)) return a;
    // Never drop performer identity / actor metadata via compound subsumption
    if (
      a.originField.includes("actor") ||
      a.primary === "PERFORMER_IDENTITY" ||
      a.blueprintType === "performer_identity"
    ) {
      return a;
    }
    const shortKey = a.fact.replace(/\s+/g, "");
    if (shortKey.length < 2) return a;
    const subsumed = relationCompounds.some((c) => {
      const longKey = c.fact.replace(/\s+/g, "");
      if (!longKey.includes(shortKey) || longKey.length <= shortKey.length) return false;
      // "奥田咲の円熟…" must not suppress the actor fact "奥田咲"
      if (longKey.startsWith(`${shortKey}の`)) return false;
      return true;
    });
    if (!subsumed) return a;
    return { ...a, bucket: "UNUSABLE" as const, generatorAllowed: false };
  });

  const concrete = afterSubsume.filter((a) => a.generatorAllowed);
  const excluded = afterSubsume.filter((a) => !a.generatorAllowed);
  const keys = input.imageContentKeys ?? [];
  const packagePresent = keys.some((k) => k.includes(":package"));

  return {
    atoms: afterSubsume,
    concrete,
    excluded,
    imageAvailability: {
      uniqueSampleSceneCount: input.uniqueSampleSceneCount ?? null,
      packagePresent,
      note: "Image contentKeys are ArticleImages fuel only — never prose scene facts without Vision.",
    },
  };
}

/** Convert generator-allowed page atoms into ResearchEvidence for EvidencePack merge. */
export function officialPageAtomsToResearchEvidence(
  atoms: OfficialPageFactAtom[],
): ResearchEvidence[] {
  return atoms
    .filter((a) => a.generatorAllowed)
    .map((a) => ({
      evidenceId: a.id,
      sourceType: (a.originField.includes("actor")
        ? "performer_metadata"
        : "product_description") as "performer_metadata" | "product_description",
      sourceRef: `fanza_product_page:${a.originField}`,
      observedFact: a.fact,
      confidence: "high" as const,
      facetType: a.blueprintType,
      allowedForGeneration: true,
      semanticFamilyId: a.familyId,
    }));
}

export type PageEvidenceMetaShape = {
  description?: { text?: string; originField?: string } | null;
  video?: {
    description?: string | null;
    actor?: string[] | null;
    thumbnailUrl?: string | null;
    contentUrl?: string | null;
    playerUrl?: string | null;
    uploadDate?: string | null;
    allowedForGeneration?: boolean;
    originField?: string;
  } | null;
  actors?: string[];
  images?: Array<{ contentKey?: string; sourceUrl?: string }>;
  uniqueSampleSceneCount?: number;
  uniquePackageCount?: number;
  contentId?: string | null;
  /** Official product title from page extract (persisted). */
  productName?: string | null;
  productNameProvenance?: "page_json_ld" | "page_dom" | null;
  productNameOriginField?: string | null;
  /** Canonical catalog metadata (not description atoms). */
  catalog?: {
    maker?: { value: string; provenance: string; originField: string } | null;
    label?: { value: string; provenance: string; originField: string } | null;
    series?: { value: string; provenance: string; originField: string } | null;
    genres?: Array<{ value: string; provenance: string; originField: string }>;
    durationMinutes?: { value: number; provenance: string; originField: string } | null;
    releaseDate?: { value: string; provenance: string; originField: string } | null;
    manufacturerSku?: { value: string; provenance: string; originField: string } | null;
  } | null;
};

export function extractAtomsFromPageEvidenceMeta(
  meta: PageEvidenceMetaShape | null | undefined,
): ReturnType<typeof extractOfficialPageFactAtoms> {
  if (!meta) {
    return extractOfficialPageFactAtoms({});
  }
  return extractOfficialPageFactAtoms({
    contentId: meta.contentId,
    descriptionText: meta.description?.text ?? null,
    descriptionOriginField: meta.description?.originField ?? "jsonld.Product.description",
    videoDescription: meta.video?.description ?? null,
    videoOriginField: meta.video?.originField ?? "jsonld.VideoObject.description",
    actors: meta.actors?.length ? meta.actors : meta.video?.actor ?? null,
    imageContentKeys: (meta.images ?? [])
      .map((i) => i.contentKey)
      .filter((k): k is string => Boolean(k)),
    uniqueSampleSceneCount: meta.uniqueSampleSceneCount ?? null,
  });
}
