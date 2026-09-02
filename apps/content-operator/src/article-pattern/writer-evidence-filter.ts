import { classifySemanticEvidence } from "./semantic-evidence.js";

/** Semantic primaries that mark official copy clauses — not spoken dialogue (r98). */
const OFFICIAL_CONCRETE_SEMANTIC_PRIMARIES = new Set([
  "SCENE_ACTION",
  "DURATION",
  "QUANTITY",
  "PERFORMER",
  "BODY_TRAIT",
  "SETTING",
  "SERIES_OR_EVENT",
  "TITLE_LABEL",
]);

/**
 * r98 — Official product copy with performer/entity label in 「」 (not spoken dialogue).
 * Keeps clauses like …「初乃ふみか」…たーっぷり性感開発; still drops real speech/POV narrative.
 */
export function isOfficialPerformerLabelQuotationClause(
  text: string,
  sourceType = "product_description",
): boolean {
  const t = (text ?? "").trim();
  if (!/[「」]/.test(t)) return false;

  const quotes = [...t.matchAll(/「([^」]+)」/g)];
  if (quotes.length === 0) return false;

  for (const m of quotes) {
    const inner = m[1]!.trim();
    if (inner.length < 2) return false;
    if (/[？！。、]|(?:です|だよ|ください|しましょう|って|なんて|よぉ|ねぇ|かな)/u.test(inner)) {
      return false;
    }
    if (/(?:ボク|俺|僕|私)/u.test(inner)) return false;
  }

  const withoutQuotes = t.replace(/[「」]/g, "");
  if (/(?:ボク|俺|僕)(?:の|は|が|も)/u.test(withoutQuotes)) return false;

  const sem = classifySemanticEvidence(t, { sourceType });
  if (OFFICIAL_CONCRETE_SEMANTIC_PRIMARIES.has(sem.primary)) return true;

  if (withoutQuotes.length >= 8 && /(?:を|に|で|と|が)/u.test(withoutQuotes)) {
    return true;
  }

  return false;
}

/**
 * R147 — causal / multi-clause narrative unsuitable as title execution target.
 * Distinct from isWriterSynopsisLike (length/POV dump); shape-based for Planner title slot.
 */
export function isUnsafeTitleExecutionTarget(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length < 2) return true;
  if (isWriterSynopsisLike(t)) return true;
  if (/[。！？]/u.test(t)) return true;
  if (
    /(?:して|した|あげた|送って|できず|我慢|暴走|なった|すると|その後|言えど)/u.test(t) &&
    t.length >= 20
  ) {
    return true;
  }
  if (
    /(?:男子生徒|女子生徒|生徒は|先生の|2人きり|二人きり).{2,}(?:我慢|暴走|送|無防備)/u.test(t)
  ) {
    return true;
  }
  const verbHits =
    t.match(/(?:して|した|できる|できず|なる|なった|する|される|暴走|送)/gu)?.length ?? 0;
  if (verbHits >= 2 && t.length >= 18) return true;
  return false;
}

/** Compact SOURCE-backed facet suitable for title slot execution. */
export function isTitleSafeExecutionTarget(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length < 2 || isUnsafeTitleExecutionTarget(t)) return false;
  if (/^【/.test(t) && t.length <= 48) return true;
  if (t.length <= 40 && !isWriterNarrativeFragment(t)) return true;
  return t.length <= 32;
}

/** Block narrative synopsis dumps from Writer-visible claims / description projection. */
export function isWriterSynopsisLike(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length > 120) return true;
  if ((t.match(/。/g)?.length ?? 0) >= 2) return true;
  if (/(?:ボク|俺|僕|私)(?:の|は|が|も)/u.test(t)) return true;
  if (/(?:部下|上司|旦那|人妻).{0,24}(?:ボク|俺|僕|私)/u.test(t)) return true;
  if (t.length > 60 && /(?:ボク|彼の|彼女の|部下の|上司の|旦那).{0,40}(?:ボク|彼|彼女|部下)/u.test(t)) {
    return true;
  }
  return false;
}

const WRITER_ELIGIBLE_EVIDENCE_TYPES = new Set([
  "performer_identity",
  "quantity_or_runtime",
  "scene_or_act",
  "body_trait",
  "series_or_event",
  "setting_or_situation",
]);

/** Concrete page atoms eligible for Writer projection (excludes narrative description shards). */
export function isWriterEligibleEvidenceType(type: string): boolean {
  return WRITER_ELIGIBLE_EVIDENCE_TYPES.has(type);
}

/** Catalog confirmation shells — not natural product-intro fuel for Writer. */
export function isWriterCatalogConfirmation(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (/(?:公式ページ|公式カタログ|公開ページ|公開カタログ)上?で確認できる/.test(t)) return true;
  if (/^出演者として/u.test(t) && /(?:公式|公開|商品)ページ/.test(t)) return true;
  if (/^公式情報として/u.test(t)) return true;
  if (/商品ページに記載されている/u.test(t)) return true;
  return false;
}

/**
 * Narrative / play-by-play glue — not product-intro fuel.
 * Structural only (POV, dialogue, progression markers) — no product keyword allowlist.
 */
export function isWriterNarrativeFragment(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;
  if (/^(でも|そして|さらに|挙げ句|一度|今日も|最後は|今じゃ|「|▼)/u.test(t)) return true;
  if (/(?:ボク|俺|僕)(?:の|は|が|も|。|、|を|に)?/u.test(t)) return true;
  if (/[「」]/.test(t)) return true;
  if (/▼|→/.test(t)) return true;
  if (/したら最後|一瞬で|に豹変|撃ちまくる|味わったら|限界突破/.test(t)) return true;
  return false;
}

/** Promotional bracket labels 【…】 — structural scene/trait markers, not product-specific. */
const WRITER_BRACKET_LABEL_RE = /【([^】]{2,24})】/u;

/** Short crumbs that still look like finite / continuative clauses — not intro nouns. */
function isWriterClauseLikeCrumbs(text: string): boolean {
  const t = text.trim();
  // Quantity / collection-scope noun phrases are product facts, not clause shards.
  if (/\d+\s*(?:回|発|本|名|人|時間|分|作品|タイトル|cm|コーナー|発射|射精|本番)/u.test(t)) {
    return false;
  }
  if (/(?:たび|ながら|てから|して|する|くる|いる|ある|なる|やった|いるし)$/u.test(t)) return true;
  if (/[をが]/u.test(t)) return true;
  if (/[はも]/u.test(t) && t.length >= 10) return true;
  if (/で.{2,}(?:す|る|た|て)/u.test(t)) return true;
  // Soft incomplete utterance (dialogue split) — too short to be a noun label.
  if (t.length <= 8 && /(?:し|って|けど|のに)$/u.test(t)) return true;
  return false;
}

/**
 * Salvage a Writer-usable statement from *unresolved* unknown_concrete only.
 *
 * Intended for: true fragments, legacy unknown input, surfaces not yet
 * certified as EvidencePack generationEligible concrete.
 *
 * NOT for: re-judging complete concrete facts already admitted by the Extractor
 * (those use projectWriterSafeFact(..., { packConcrete: true }) thin pass-through).
 * Not all-pass: bracket labels or short concrete noun phrases only.
 */
export function salvageWriterFactFromUnknownConcrete(fact: string): string | null {
  const t = (fact ?? "").trim();
  if (t.length < 2 || isWriterSynopsisLike(t) || isWriterNarrativeFragment(t)) return null;
  // Defer to page-atom fragment gate when available (same shape rules).
  if (/^[（(]\s*[ぁ-んァ-ヶー･・\s]{1,20}\s*[）)]$/u.test(t)) return null;
  if (/^[ぁ-んーゝゞ]{1,4}$/u.test(t)) return null;
  if (/^[ァ-ヶー]{2,5}$/u.test(t) && !/(?:ピス|フェラ|キス|ハメ|オナニ|イラマ|ノンストップ)/u.test(t)) {
    return null;
  }

  const bracket = t.match(WRITER_BRACKET_LABEL_RE);
  if (bracket?.[1]) {
    const label = bracket[1].trim();
    if (
      label.length >= 2 &&
      label.length <= 24 &&
      !isWriterSynopsisLike(label) &&
      !isWriterNarrativeFragment(label)
    ) {
      return label;
    }
  }

  // Short standalone concrete crumb (persona / setting / identity) — no clause shards.
  if (
    t.length >= 2 &&
    t.length <= 22 &&
    !isWriterNarrativeFragment(t) &&
    !isWriterClauseLikeCrumbs(t) &&
    !/魅力|おすすめ|見どころ|興奮|話題|最高|必見|堪能|背徳|理性崩壊/.test(t)
  ) {
    // Kanji/kana noun labels, or short uppercase Latin genre codes (NTR, SM, …)
    if (/[\u4e00-\u9fffァ-ヶー]{2,}/u.test(t) || /^[A-Z]{2,4}$/u.test(t)) {
      return t;
    }
  }
  return null;
}

export type WriterEvidenceProjection = {
  statement: string;
  resolvedType: string;
  /** true when statement was salvaged from unknown_concrete */
  fromUnknownSalvage: boolean;
};

/**
 * Project pack evidence into Writer-eligible concrete (r81).
 * unknown_concrete is not excluded wholesale — only salvaged trait/scene/setting crumbs.
 */
export function projectWriterEvidenceFact(
  type: string,
  fact: string,
): WriterEvidenceProjection | null {
  const raw = (fact ?? "").trim();
  if (raw.length < 2) return null;
  if (isWriterCatalogConfirmation(raw)) return null;

  if (type === "product_identity") {
    if (isWriterSynopsisLike(raw)) return null;
    return { statement: raw, resolvedType: type, fromUnknownSalvage: false };
  }

  if (isWriterEligibleEvidenceType(type)) {
    if (isWriterSynopsisLike(raw)) return null;
    if (raw.length > 100) return null;
    // Align with projectWriterSafeFact: keep context-rich product clauses (r95)
    // even when narrative markers appear; drop score-0 narrative crumbs only.
    if (
      isWriterNarrativeFragment(raw) &&
      writerClauseContextScore(raw) === 0 &&
      !isOfficialPerformerLabelQuotationClause(raw)
    ) {
      return null;
    }
    return { statement: raw, resolvedType: type, fromUnknownSalvage: false };
  }

  if (type !== "unknown_concrete") return null;
  const salvaged = salvageWriterFactFromUnknownConcrete(raw);
  if (!salvaged) return null;
  // Align with skeleton roleCompatibleClasses(UNKNOWN → setting_or_situation).
  return {
    statement: salvaged,
    resolvedType: "setting_or_situation",
    fromUnknownSalvage: true,
  };
}

/**
 * Rank Writer claim candidates — prefer context-preserving clauses over bare tokens (r95).
 * Higher = keep earlier when capping cardinality.
 */
export function writerClauseContextScore(statement: string): number {
  const s = statement.trim();
  if (s.length < 6) return 0;
  const hasRelation =
    /(?:を|に|で|と|が).{1,48}(?:ピストン|フェラ|舐め|騎乗|ハーレム|痴女|NTR|手コキ|中出し|マン毛|ナンパ|コインランドリー|エステ|学芸員|女子大生|人妻|セックス|ベスト|射精|170cm|杭打ち|逆\d+P|絶頂|デビュー|タイトル|コーナー)/u.test(
      s,
    ) ||
    /(?:コインランドリー|回春エステ|写真館|団地妻|170cmオーバー|4人|13射精|8時間|12タイトル)/u.test(
      s,
    );
  if (!hasRelation) return 0;
  if (s.length >= 24) return 115;
  if (s.length >= 12) return 108;
  return 102;
}

export function writerClaimSelectionScore(p: WriterEvidenceProjection): number {
  const { statement: s, resolvedType: t, fromUnknownSalvage } = p;
  const context = writerClauseContextScore(s);
  if (context > 0) return context;
  if (t === "performer_identity" && s.length <= 20) return 100;
  // Bracket-salvaged scene/trait labels outrank bare short crumbs.
  if (fromUnknownSalvage && s.length <= 24) {
    return /[\u4e00-\u9fffァ-ヶー]{2,}/u.test(s) && !isWriterClauseLikeCrumbs(s) ? 95 : 85;
  }
  if (t === "body_trait") return 80;
  if (t === "setting_or_situation") return s.length <= 28 ? 75 : 50;
  if (t === "scene_or_act") return s.length <= 40 ? 70 : 45;
  if (t === "quantity_or_runtime") return 60;
  if (t === "series_or_event") return s.length <= 28 ? 40 : 20;
  return 30;
}

/**
 * Long scene-order / first-person play-by-play — must not reach Writer as-is.
 * Short promotional blurbs (e.g. bang-separated marketing) are NOT this.
 */
export function isLongSceneOrderSynopsis(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length < 80) return false;
  const firstPerson = /(?:ボク|俺|僕)(?:の|は|が|も|。|、)/u.test(t);
  const sceneBullets = /▼/.test(t) || (t.match(/・/g)?.length ?? 0) >= 3;
  const progression =
    /さらに|挙げ句|最後は|一度.+たら最後|豹変|即ハメ|中出しして/.test(t);
  const sentenceEnds = t.match(/[。！？]/g)?.length ?? 0;
  // First-person multi-clause narrative = scene synopsis even when medium length.
  if (firstPerson && sentenceEnds >= 2) return true;
  if (firstPerson && t.length >= 160) return true;
  if (sceneBullets && progression) return true;
  if (t.length >= 320 && sentenceEnds >= 5 && progression) return true;
  return false;
}

const SCENE_PROGRESSION_SENTENCE_RE =
  /さらに|挙げ句|最後は|一度.+たら最後|豹変|即ハメ|中出し|▼|・|射精させ|踏みつけ|壁ドン|騎乗位|正常位|お掃除フェラ|電話中|給湯室|玄関で/;

const MAX_WRITER_DESCRIPTION_CHARS = 280;
const MAX_SYNOPSIS_INTRO_CHARS = 180;

/**
 * Normalize official page description into Writer WHAT (r76).
 *
 * - Keep natural promotional / product-intro phrasing when already short.
 * - Compress long scene-order synopsis to opening identity/setting only.
 * - Never artificially join atoms with "！".
 * - Never dump full play-by-play synopsis.
 */
export function normalizeOfficialDescriptionForWriter(
  raw: string | null | undefined,
): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;

  if (!isLongSceneOrderSynopsis(text)) {
    if (text.length <= MAX_WRITER_DESCRIPTION_CHARS) return text;
    // Soft trim at last sentence/bang boundary — keep natural phrasing, no atom join.
    const slice = text.slice(0, MAX_WRITER_DESCRIPTION_CHARS);
    const cut = Math.max(slice.lastIndexOf("！"), slice.lastIndexOf("。"), slice.lastIndexOf("!"));
    return (cut >= 40 ? slice.slice(0, cut + 1) : slice).trim() || null;
  }

  // Scene-order synopsis → keep only early identity / setting sentences.
  const parts = text
    .split(/(?<=[。！？!？])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  const kept: string[] = [];
  let used = 0;
  for (const part of parts) {
    if (SCENE_PROGRESSION_SENTENCE_RE.test(part) && kept.length > 0) break;
    if (kept.length >= 2) break;
    if (used + part.length > MAX_SYNOPSIS_INTRO_CHARS && kept.length > 0) break;
    kept.push(part);
    used += part.length;
    // After a clear performer/identity opener, stop before POV play-by-play expands.
    if (
      kept.length >= 1 &&
      /[・]/.test(part) &&
      part.length <= 80 &&
      !/(?:ボク|俺|僕)(?:の|は|が|も)/u.test(part)
    ) {
      break;
    }
  }
  const out = kept.join("").trim();
  if (!out) return null;
  // Still too narrative / long → refuse full dump (null beats synopsis pass-through).
  if (isLongSceneOrderSynopsis(out) || out.length > MAX_SYNOPSIS_INTRO_CHARS) {
    const first = kept[0]?.trim() ?? "";
    return first.length >= 8 && first.length <= MAX_SYNOPSIS_INTRO_CHARS ? first : null;
  }
  return out;
}
