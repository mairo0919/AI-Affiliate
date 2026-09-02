/**
 * Semantic evidence classification + family IDs (r17+ SSOT).
 * Fact semantics outrank claim kind "trait_or_scene".
 * No free-form person-name guessing — title identity tokens / performer provenance only.
 *
 * r26: TITLE_LABEL / SERIES_CONCEPT / PRODUCT_PERSONA stay product-scoped.
 * Never auto-promote title/series labels to PERFORMER_TRAIT or reputation.
 */

import type { BlueprintEvidenceType } from "./reference-editorial-blueprint.js";

export type SemanticEvidenceClass =
  | "SCENE_ACTION"
  | "CHARACTER_TRAIT"
  | "PERFORMER_TRAIT"
  | "PERFORMER_REPUTATION"
  | "TITLE_LABEL"
  | "SERIES_CONCEPT"
  | "PRODUCT_PERSONA"
  | "BODY_TRAIT"
  | "QUANTITY"
  | "DURATION"
  | "EVENT"
  | "RELATIONSHIP"
  | "PERFORMER_IDENTITY"
  | "SERIES_CONTEXT"
  | "PRODUCT_FORM"
  | "UNKNOWN_CONCRETE"
  | "CATALOG"
  | "EVALUATIVE";

export type SemanticEvidenceClassification = {
  primary: SemanticEvidenceClass;
  classes: SemanticEvidenceClass[];
  /** Stable family key — duplicates collapse here */
  familyId: string;
  blueprintType: BlueprintEvidenceType;
};

const SCENE_STEM_RE =
  /(キス|舐め|セックス|ピストン|激ピス|潮|乱交|痴女|わからせ|洗脳|生ハメ|顔面|挿入|絶頂|責め)/;
const CHARACTER_STEM_RE = /メスガキ|清楚|ギャル|お姉さん|妹|女王様|ドS|ドM|小悪魔/;
const BODY_TRAIT_RE =
  /巨乳|美乳|敏感|感度|Hカップ|細身|長身|美脚|デカ尻|低身長|グラマラスボディ|グラマラス/;
const QTY_WORKS_RE = /(\d+)\s*(作品|本番|射精|本|コーナー|タイトル)/;
const QTY_PEOPLE_RE = /(\d+)\s*(名|人)/;
const DURATION_RE = /(\d+)\s*(時間|分)/;
const SERIES_RE = /シリーズ|ツアー|イベント|感謝祭/;
const PRODUCT_FORM_RE = /ベスト|総集編|コレクション|COMPLETE|complete/;
const EVENT_RE = /イベント|感謝祭|周年/;
const RELATIONSHIP_RE = /姉妹|兄妹|師弟|同居|隣人/;
const MAKER_RE = /メーカー|レーベル|MOODYZ|エスワン|SOD|IDEAPOCKET/;
const AVAIL_RE = /配信|公開|独占|販売|ページで確認|公開情報として/;
const EVAL_RE = /魅力|おすすめ|見どころ|興奮|話題|最高|必見|堪能|として知られる|と称される/;
const PERFORMER_MARK_RE = /出演|女優|男優|が演じ|キャスト/;
const REPUTATION_RE = /として知られる|と称される|で有名|代表的な|キャラクター性が際立/;
/** Space-separated title identity token: short Japanese, no digits / scene stems */
const TITLE_IDENTITY_TOKEN_RE = /^[\u4e00-\u9fffァ-ヶーぁ-ん]{2,12}$/;

/** Bare stem only (e.g. メスガキ) — not multi-token title phrases. */
const BARE_CHARACTER_STEM_RE = /^(メスガキ|清楚|ギャル|お姉さん|妹|女王様|ドS|ドM|小悪魔|ギャル妹|小悪魔痴女)$/;

/** Source-backed character/expression stems — concrete trait, not promo wrappers. */
const CHARACTER_CONCRETE_EXACT_RE =
  /^(?:生意気|生意気な表情|大人をバカにした表情)$/u;

/**
 * Compilation / collection scope: one product inventories multiple works or content varieties.
 * Requires multi-item / multi-unit structure — not the bare verb 収録 alone.
 */
export function isCompilationCollectionScope(raw: string): boolean {
  const f = (raw ?? "").trim();
  if (!f) return false;
  if (/全コーナーを収録/u.test(f)) return true;
  // Multi-theme/content list + collection verb (A・B・Cなどを収録)
  if (/(?:・|、).{0,48}など.{0,20}を収録$/u.test(f)) return true;
  // Latest-N titles as the product's contained inventory
  if (
    /最新\s*\d+\s*タイトル/u.test(f) &&
    (/(?:収録|コーナー)/u.test(f) ||
      /(?:今回は|彼女の).{0,12}最新\s*\d+\s*タイトル/u.test(f) ||
      /最新\s*\d+\s*タイトルの全コーナー/u.test(f))
  ) {
    return true;
  }
  // Digit+unit inventory framed as best/compilation contents
  if (
    /\d+\s*(?:タイトル|作品|コーナー)/u.test(f) &&
    /(?:ベスト|総集編|コレクション)/u.test(f) &&
    /収録/u.test(f)
  ) {
    return true;
  }
  return false;
}
/** Absolute minutes for a duration number+unit pair (8時間 → 480). */
export function durationNumberUnitToMinutes(n: number, unit: string): number | null {
  if (!Number.isFinite(n) || n < 0) return null;
  if (unit === "時間") return n * 60;
  if (unit === "分") return n;
  return null;
}

/**
 * First-seen duration surfaces from texts, keyed by absolute minutes.
 * Used so Writer projection does not present equivalent unit forms as independent facts.
 */
export function collectPreferredDurationSurfaces(...texts: string[]): Map<number, string> {
  const preferred = new Map<number, string>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(new RegExp(DURATION_RE.source, "g"))) {
      const minutes = durationNumberUnitToMinutes(Number(m[1]), m[2]!);
      if (minutes == null) continue;
      if (!preferred.has(minutes)) {
        preferred.set(minutes, `${m[1]}${m[2]}`);
      }
    }
  }
  return preferred;
}

/**
 * Replace duration surfaces that are minute-equivalent to an already-preferred form.
 * Does not invent units: only collapses equivalents already present elsewhere.
 */
export function collapseEquivalentDurationSurfaces(
  text: string,
  preferredByMinutes: Map<number, string>,
): string {
  if (!text || preferredByMinutes.size === 0) return text;
  return text.replace(new RegExp(DURATION_RE.source, "g"), (match, num, unit) => {
    const minutes = durationNumberUnitToMinutes(Number(num), unit);
    if (minutes == null) return match;
    const preferred = preferredByMinutes.get(minutes);
    if (!preferred) return match;
    const compact = match.replace(/\s+/g, "");
    if (compact === preferred) return match;
    return preferred;
  });
}

function normalizeFamilyStem(raw: string): string {
  return raw
    .replace(/\s+/g, "")
    .replace(/[。．、，]/g, "")
    .slice(0, 24)
    .toUpperCase();
}

function isTitleOrProductScopedSource(sourceType: string, titleIdentityToken?: boolean): boolean {
  return (
    sourceType === "product_title" ||
    sourceType === "product_description" ||
    titleIdentityToken === true
  );
}

/**
 * Title/series/marketing labels that contain character stems but are NOT performer traits.
 * e.g. 「令和イチのメスガキ」 from product title.
 */
function isCompoundTitleOrProductLabel(raw: string): boolean {
  if (!CHARACTER_STEM_RE.test(raw)) return false;
  if (BARE_CHARACTER_STEM_RE.test(raw)) return false;
  // Multi-token / era-prefixed / possessive compounds
  if (/の/.test(raw) || /令和|平成|昭和|シリーズ|ベスト|わからせ/.test(raw)) return true;
  if (raw.length >= 6) return true;
  return false;
}

export function semanticClassToBlueprintType(
  primary: SemanticEvidenceClass,
): BlueprintEvidenceType {
  switch (primary) {
    case "SCENE_ACTION":
      return "scene_or_act";
    case "CHARACTER_TRAIT":
    case "PERFORMER_TRAIT":
    case "BODY_TRAIT":
      return "body_trait";
    case "TITLE_LABEL":
    case "SERIES_CONCEPT":
    case "PRODUCT_PERSONA":
    case "EVENT":
    case "SERIES_CONTEXT":
    case "PRODUCT_FORM":
      return "series_or_event";
    case "QUANTITY":
    case "DURATION":
      return "quantity_or_runtime";
    case "RELATIONSHIP":
      return "setting_or_situation";
    case "PERFORMER_IDENTITY":
      return "performer_identity";
    case "CATALOG":
      return "availability_or_catalog";
    case "EVALUATIVE":
    case "PERFORMER_REPUTATION":
      return "evaluative_framing";
    default:
      return "unknown_concrete";
  }
}

export function buildSemanticFamilyId(
  primary: SemanticEvidenceClass,
  fact: string,
): string {
  const f = fact.trim();
  if (primary === "QUANTITY") {
    const m = f.match(QTY_WORKS_RE) ?? f.match(QTY_PEOPLE_RE);
    if (m) return `COUNT_${m[1]}`;
    return `QUANTITY_${normalizeFamilyStem(f)}`;
  }
  if (primary === "DURATION") {
    const m = f.match(DURATION_RE);
    if (m) {
      // Normalize to minutes so "8時間" and "480分" share one family (no unit dictionary).
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0) {
        const minutes = m[2] === "時間" ? n * 60 : n;
        return `DURATION_${minutes}MIN`;
      }
    }
    return `DURATION_${normalizeFamilyStem(f)}`;
  }
  if (primary === "SCENE_ACTION") {
    // Independent scene segments may share a stem (e.g. ピストン) — family by surface, not stem alone.
    return `SCENE_${normalizeFamilyStem(f.replace(/\s+/g, "").slice(0, 32))}`;
  }
  if (primary === "TITLE_LABEL") {
    return `TITLE_${normalizeFamilyStem(f.slice(0, 16))}`;
  }
  if (primary === "SERIES_CONCEPT") {
    return `SERIES_${normalizeFamilyStem(f.slice(0, 12))}`;
  }
  if (primary === "PRODUCT_PERSONA") {
    const stem = f.match(CHARACTER_STEM_RE)?.[0] ?? f.slice(0, 10);
    return `PERSONA_${normalizeFamilyStem(stem)}`;
  }
  if (primary === "CHARACTER_TRAIT" || primary === "PERFORMER_TRAIT") {
    const stem = f.match(CHARACTER_STEM_RE)?.[0] ?? f.slice(0, 10);
    return `CHARACTER_${normalizeFamilyStem(stem)}`;
  }
  if (primary === "PERFORMER_REPUTATION") {
    return `REPUTATION_${normalizeFamilyStem(f.slice(0, 12))}`;
  }
  if (primary === "BODY_TRAIT") {
    const stem = f.match(BODY_TRAIT_RE)?.[0] ?? f.slice(0, 10);
    return `BODY_${normalizeFamilyStem(stem)}`;
  }
  if (primary === "PERFORMER_IDENTITY") {
    const name = f.replace(/出演|女優|男優|キャスト|として/g, "").trim() || f;
    return `PERFORMER_${normalizeFamilyStem(name)}`;
  }
  if (primary === "PRODUCT_FORM") {
    // Distinguish compilation/best surfaces — a single PRODUCT_FORM_BEST key
    // collapsed theme-scope / corner-scope / edition labels into one pack slot.
    return `PRODUCT_FORM_${normalizeFamilyStem(f.slice(0, 24))}`;
  }  if (primary === "SERIES_CONTEXT") return `SERIES_${normalizeFamilyStem(f.slice(0, 12))}`;
  if (primary === "EVENT") return `EVENT_${normalizeFamilyStem(f.slice(0, 12))}`;
  if (primary === "RELATIONSHIP") return `RELATION_${normalizeFamilyStem(f.slice(0, 12))}`;
  return `UNKNOWN_${normalizeFamilyStem(f.slice(0, 16))}`;
}

/**
 * Classify a single fact. Claim kind "trait_or_scene" is ignored (intermediate only).
 * Explicit kinds maker/performer/series/availability still constrain catalog vs identity.
 */
export function classifySemanticEvidence(
  fact: string,
  opts?: {
    kind?: string | null;
    sourceType?: string | null;
    /** When true, short Japanese title tokens without other hits → PERFORMER_IDENTITY */
    titleIdentityToken?: boolean;
  },
): SemanticEvidenceClassification {
  const raw = (fact ?? "").trim();
  const kind = (opts?.kind ?? "").toLowerCase();
  const sourceType = opts?.sourceType ?? "";
  const fromTitle =
    sourceType === "product_title" || opts?.titleIdentityToken === true;
  const productScoped = isTitleOrProductScopedSource(sourceType, opts?.titleIdentityToken);
  const performerProvenance =
    kind === "performer" || kind === "cast" || sourceType === "performer_metadata";

  // Explicit non-intermediate kinds
  if (kind === "maker" || kind === "label") {
    return finish("CATALOG", ["CATALOG"], raw);
  }
  if (kind === "availability" || kind === "temporal_sale") {
    return finish("CATALOG", ["CATALOG"], raw);
  }
  if (performerProvenance && !CHARACTER_STEM_RE.test(raw) && !BODY_TRAIT_RE.test(raw)) {
    return finish("PERFORMER_IDENTITY", ["PERFORMER_IDENTITY"], raw);
  }
  if (kind === "series") {
    return finish("SERIES_CONTEXT", ["SERIES_CONTEXT"], raw);
  }

  // Exact character/expression stems (source-backed concrete traits)
  if (CHARACTER_CONCRETE_EXACT_RE.test(raw)) {
    return finish("CHARACTER_TRAIT", ["CHARACTER_TRAIT"], raw);
  }

  // Compilation / collection inventory — prefer PRODUCT_FORM over qty/scene stems
  if (isCompilationCollectionScope(raw)) {
    return finish("PRODUCT_FORM", ["PRODUCT_FORM"], raw);
  }

  // Reputation phrasing without separate supported performer trait → evaluative reputation
  if (REPUTATION_RE.test(raw) && CHARACTER_STEM_RE.test(raw) && !performerProvenance) {
    return finish("PERFORMER_REPUTATION", ["PERFORMER_REPUTATION", "EVALUATIVE"], raw);
  }

  const classes: SemanticEvidenceClass[] = [];
  if (EVAL_RE.test(raw) && !QTY_WORKS_RE.test(raw) && !DURATION_RE.test(raw) && !SCENE_STEM_RE.test(raw)) {
    classes.push("EVALUATIVE");
  }
  if (MAKER_RE.test(raw) || AVAIL_RE.test(raw)) classes.push("CATALOG");
  if (QTY_WORKS_RE.test(raw) || QTY_PEOPLE_RE.test(raw)) classes.push("QUANTITY");
  if (DURATION_RE.test(raw)) classes.push("DURATION");
  if (SCENE_STEM_RE.test(raw)) classes.push("SCENE_ACTION");
  if (BODY_TRAIT_RE.test(raw)) classes.push("BODY_TRAIT");
  if (PRODUCT_FORM_RE.test(raw)) classes.push("PRODUCT_FORM");
  if (SERIES_RE.test(raw)) classes.push("SERIES_CONTEXT");
  if (EVENT_RE.test(raw)) classes.push("EVENT");
  if (RELATIONSHIP_RE.test(raw)) classes.push("RELATIONSHIP");
  if (PERFORMER_MARK_RE.test(raw) || (performerProvenance && !CHARACTER_STEM_RE.test(raw))) {
    classes.push("PERFORMER_IDENTITY");
  }

  // Character-stem handling — scope by provenance (r26 FIRST_LOSS fix)
  if (CHARACTER_STEM_RE.test(raw)) {
    if (fromTitle && isCompoundTitleOrProductLabel(raw)) {
      classes.push("TITLE_LABEL");
    } else if (fromTitle && BARE_CHARACTER_STEM_RE.test(raw)) {
      classes.push("PRODUCT_PERSONA");
    } else if (productScoped && !performerProvenance) {
      // Official description / title theme → product persona, NOT performer trait
      if (isCompoundTitleOrProductLabel(raw)) classes.push("TITLE_LABEL");
      else classes.push("PRODUCT_PERSONA");
    } else if (performerProvenance) {
      classes.push("PERFORMER_TRAIT");
      classes.push("CHARACTER_TRAIT"); // compat alias
    } else {
      // Unknown provenance: keep as product persona to avoid reputation leap
      classes.push("PRODUCT_PERSONA");
    }
  }

  if (
    opts?.titleIdentityToken &&
    TITLE_IDENTITY_TOKEN_RE.test(raw) &&
    !SCENE_STEM_RE.test(raw) &&
    !CHARACTER_STEM_RE.test(raw) &&
    !BODY_TRAIT_RE.test(raw) &&
    !PRODUCT_FORM_RE.test(raw) &&
    !SERIES_RE.test(raw) &&
    !QTY_WORKS_RE.test(raw) &&
    !DURATION_RE.test(raw) &&
    !AVAIL_RE.test(raw) &&
    !MAKER_RE.test(raw) &&
    raw !== "独占"
  ) {
    classes.push("PERFORMER_IDENTITY");
  }

  const unique = [...new Set(classes)];
  if (unique.length === 0) {
    return finish("UNKNOWN_CONCRETE", ["UNKNOWN_CONCRETE"], raw);
  }

  // Priority: title/product scope before performer trait; qty/duration before scene
  const priority: SemanticEvidenceClass[] = [
    "PERFORMER_IDENTITY",
    "QUANTITY",
    "DURATION",
    "SCENE_ACTION",
    "TITLE_LABEL",
    "SERIES_CONCEPT",
    "PRODUCT_PERSONA",
    "PRODUCT_FORM",
    "SERIES_CONTEXT",
    "EVENT",
    "BODY_TRAIT",
    "PERFORMER_TRAIT",
    "CHARACTER_TRAIT",
    "RELATIONSHIP",
    "UNKNOWN_CONCRETE",
    "CATALOG",
    "PERFORMER_REPUTATION",
    "EVALUATIVE",
  ];
  if (
    (unique.includes("QUANTITY") || unique.includes("DURATION")) &&
    !unique.includes("SCENE_ACTION") &&
    !unique.includes("TITLE_LABEL") &&
    !unique.includes("PRODUCT_PERSONA") &&
    !unique.includes("CHARACTER_TRAIT") &&
    !unique.includes("PERFORMER_TRAIT") &&
    !unique.includes("BODY_TRAIT")
  ) {
    const primary = unique.includes("QUANTITY") ? "QUANTITY" : "DURATION";
    return finish(primary, unique, raw);
  }
  if (unique.includes("SCENE_ACTION") && !unique.includes("TITLE_LABEL")) {
    return finish("SCENE_ACTION", unique, raw);
  }
  // Title label wins over character-stem performer trait leap
  if (unique.includes("TITLE_LABEL")) {
    return finish("TITLE_LABEL", unique, raw);
  }
  const primary = priority.find((p) => unique.includes(p)) ?? "UNKNOWN_CONCRETE";
  return finish(primary, unique, raw);
}

function finish(
  primary: SemanticEvidenceClass,
  classes: SemanticEvidenceClass[],
  fact: string,
): SemanticEvidenceClassification {
  return {
    primary,
    classes: [...new Set(classes)],
    familyId: buildSemanticFamilyId(primary, fact),
    blueprintType: semanticClassToBlueprintType(primary),
  };
}

/** Roles requested by WritingSkeleton → compatible semantic classes */
export function roleCompatibleClasses(role: string): SemanticEvidenceClass[] {
  switch (role) {
    case "scene_or_act":
      return ["SCENE_ACTION"];
    case "performer_identity":
    case "performer_or_concrete_trait":
      return ["PERFORMER_IDENTITY"];
    case "body_trait":
      return ["BODY_TRAIT", "CHARACTER_TRAIT", "PERFORMER_TRAIT"];
    case "quantity_or_runtime":
      return ["QUANTITY", "DURATION"];
    case "series_or_event":
      return [
        "SERIES_CONTEXT",
        "PRODUCT_FORM",
        "EVENT",
        "TITLE_LABEL",
        "SERIES_CONCEPT",
        "PRODUCT_PERSONA",
      ];
    case "setting_or_situation":
      return ["RELATIONSHIP", "UNKNOWN_CONCRETE"];
    case "unknown_concrete":
      return [
        "UNKNOWN_CONCRETE",
        "CHARACTER_TRAIT",
        "PERFORMER_TRAIT",
        "PRODUCT_PERSONA",
        "TITLE_LABEL",
        "BODY_TRAIT",
        "PRODUCT_FORM",
        "SERIES_CONTEXT",
        "EVENT",
        "RELATIONSHIP",
      ];
    default:
      return [];
  }
}

export function isDevelopmentFamily(primary: SemanticEvidenceClass): boolean {
  return [
    "SCENE_ACTION",
    "CHARACTER_TRAIT",
    "PERFORMER_TRAIT",
    "TITLE_LABEL",
    "SERIES_CONCEPT",
    "PRODUCT_PERSONA",
    "BODY_TRAIT",
    "QUANTITY",
    "DURATION",
    "EVENT",
    "RELATIONSHIP",
    "SERIES_CONTEXT",
    "PRODUCT_FORM",
    "UNKNOWN_CONCRETE",
    "PERFORMER_IDENTITY",
  ].includes(primary);
}

/** Forbidden performer-reputation attribution when only TITLE_LABEL / PRODUCT_PERSONA evidence exists. */
export const TITLE_SCOPE_ATTRIBUTION_FAIL_RE =
  /として知られる|と称される|キャラクター性が際立|代表的な.{0,12}キャラ|彼女の個性としての|本人の.{0,8}キャラクター性/;

/** Allowed product-scoped title/series wording (examples — not templates). */
export function titleLabelAttributionAllowed(text: string): boolean {
  if (TITLE_SCOPE_ATTRIBUTION_FAIL_RE.test(text)) return false;
  return true;
}
