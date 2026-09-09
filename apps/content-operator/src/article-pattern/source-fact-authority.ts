/**
 * SOURCE FACT TYPE / authority — classification vs scene-level description.
 *
 * GENRE/TAG ≠ SCENE ≠ ACTION ≠ RELATIONSHIP ≠ STORY.
 * Not a banned-word list: Writer uses this to bound claim strength.
 */

export type SourceFactType =
  | "IDENTITY"
  | "QUANTITY"
  | "BODY_ATTRIBUTE"
  | "OFFICIAL_DESCRIPTION"
  | "GENRE_TAG"
  | "SCENE"
  | "ACTION"
  | "RELATIONSHIP"
  | "NARRATIVE"
  | "OTHER";

/** Official catalog genre / JSON-LD genre provenance. */
export function isCatalogGenreProvenance(
  originFieldOrSourceRef: string | null | undefined,
): boolean {
  const s = (originFieldOrSourceRef ?? "").toLowerCase();
  if (!s) return false;
  return (
    s.includes("catalog.genre") ||
    s.includes("videoobject.genre") ||
    s.includes("product.genre") ||
    /(?:^|[:.])genre(?:$|[.\[])/.test(s)
  );
}

const BARE_THEME_TAG_RE =
  /^(?:人妻|人妻・主婦|NTR|痴女|熟女|美少女|女子校生|ギャル|OL|SM|淫乱・ハード系|淫乱|ハード系|女優ベスト・総集編)$/iu;

const PLAY_ACTION_TAG_RE =
  /^(?:追撃ピストン|パイズリ|激ピス|杭打ち|騎乗|中出し|わからせ|お仕置き|ハーレム|腿コキ)$/u;

const BODY_ATTR_RE =
  /(?:巨乳|美乳|敏感|感度|Hカップ|細身|長身|美脚|デカ尻|低身長|グラマラスボディ|グラマラス)/u;

const SCENE_VERB_RE =
  /(?:する|される|され|抱|喘|絶頂|寝取|誘惑|責め|挿入|性交|咥|舐め|突き|イキ)/u;

const RELATIONSHIP_STORY_RE = /姉妹|兄妹|師弟|同居|隣人|寝取られ/;

const QTY_RE = /^\d+\s*(?:時間|分|回|発|本|名|人|射精|発射|作品|タイトル|コーナー)$/u;

/**
 * Authority class for a single Evidence surface.
 * Catalog genre provenance always wins as GENRE_TAG (never SCENE).
 */
export function classifySourceFactType(input: {
  fact: string;
  originField?: string | null;
  sourceRef?: string | null;
  /** Upstream blueprint / pack type hint */
  evidenceType?: string | null;
}): SourceFactType {
  const fact = (input.fact ?? "").trim();
  if (!fact) return "OTHER";

  if (
    isCatalogGenreProvenance(input.originField) ||
    isCatalogGenreProvenance(input.sourceRef)
  ) {
    return "GENRE_TAG";
  }

  if (input.evidenceType === "performer_identity") return "IDENTITY";
  if (QTY_RE.test(fact) || input.evidenceType === "quantity_or_runtime") {
    return "QUANTITY";
  }

  if (BARE_THEME_TAG_RE.test(fact) || /^(?:人妻|NTR|痴女|熟女|美少女|OL|SM)$/iu.test(fact)) {
    return "GENRE_TAG";
  }

  if (PLAY_ACTION_TAG_RE.test(fact)) {
    // Named play/act membership — not a scripted scene unless verbs/situation expand it.
    return "ACTION";
  }

  // Bare body-genre token without surrounding official description clause
  if (/^(?:巨乳|美乳|デカ尻|美脚|細身|長身)$/u.test(fact)) {
    return "GENRE_TAG";
  }

  if (
    BODY_ATTR_RE.test(fact) &&
    (fact.length >= 6 || /なのに|ながら|ボディ/.test(fact))
  ) {
    return "BODY_ATTRIBUTE";
  }

  if (RELATIONSHIP_STORY_RE.test(fact) && SCENE_VERB_RE.test(fact) && fact.length >= 14) {
    return "RELATIONSHIP";
  }

  if (
    (input.evidenceType === "scene_or_act" || input.evidenceType === "setting_or_situation") &&
    SCENE_VERB_RE.test(fact) &&
    fact.length >= 14
  ) {
    return "SCENE";
  }

  if (SCENE_VERB_RE.test(fact) && fact.length >= 14) {
    return "SCENE";
  }

  if (PLAY_ACTION_TAG_RE.test(fact) || /ピストン|パイズリ|騎乗|中出し/.test(fact)) {
    if (fact.length <= 16 && !SCENE_VERB_RE.test(fact)) return "ACTION";
  }

  if (
    input.evidenceType === "series_or_event" ||
    /ベスト|総集編|周年|デビュー|収録|コーナー/.test(fact)
  ) {
    return "OFFICIAL_DESCRIPTION";
  }

  if (BODY_ATTR_RE.test(fact)) return "BODY_ATTRIBUTE";

  return "OTHER";
}

/** Classification-level only — no scene/role/relationship invention as FACT. */
export function isClassificationLevelAuthority(t: SourceFactType): boolean {
  return t === "GENRE_TAG" || t === "ACTION" || t === "QUANTITY" || t === "IDENTITY";
}

export function sourceFactTypeWriterNote(t: SourceFactType): string {
  switch (t) {
    case "GENRE_TAG":
      return "GENRE_TAG: official classification/membership only. Do not invent roles, scenes, relationships, atmosphere, or story from the tag.";
    case "ACTION":
      return "ACTION: named play/act membership (or recorded action phrase). Do not invent unstated performance quality, psychology, or scene script beyond the surface.";
    case "SCENE":
      return "SCENE: scene-level description allowed within the planned surface — do not invent beyond it.";
    case "RELATIONSHIP":
      return "RELATIONSHIP: only as recorded in the planned surface — do not invent relationship dynamics.";
    case "BODY_ATTRIBUTE":
      return "BODY_ATTRIBUTE: official description body trait — not a genre-tag scene claim.";
    case "NARRATIVE":
      return "NARRATIVE: only if planned — do not invent plot progression.";
    case "IDENTITY":
      return "IDENTITY: cast/product identity surface.";
    case "QUANTITY":
      return "QUANTITY: scale/count membership.";
    case "OFFICIAL_DESCRIPTION":
      return "OFFICIAL_DESCRIPTION: product form / official copy surface.";
    default:
      return "OTHER: stay within planned surface; no invented scene/story.";
  }
}
