/**
 * Evidence material roles + body presentation purposes (LLM=0).
 *
 * Distinguishes work-understanding material from performer career/profile
 * noise — without product-specific hardcoding.
 * presentationPurpose is NOT a fact source; it only labels how planned facts
 * should be used for product intro.
 */

import { classifySemanticEvidence } from "./semantic-evidence.js";

/** Semantic role of an Evidence surface for body selection. */
export type EvidenceMaterialRole =
  | "WORK_CONTENT"
  | "COLLECTION_SCOPE"
  | "PERFORMER_IDENTITY"
  | "PERFORMER_CAREER"
  | "PERFORMER_EXTERNAL_ACTIVITY"
  | "PERFORMER_GENERAL_PROFILE"
  | "QUANTITY_SCALE"
  | "OTHER";

/**
 * Lightweight presentation purpose for ARTICLE_PLAN body facts/slots.
 * Tells Writer what aspect of the product the facts explain — not new facts.
 */
export type BodyPresentationPurpose =
  | "PRODUCT_IDENTITY"
  | "COLLECTION_SCOPE"
  | "SCENE_VARIETY"
  | "PERFORMER_TRAIT_IN_WORK"
  | "PLAY_STYLE"
  | "QUANTITY_SCALE"
  | "OTHER";

/** External career / non-work activity — demote from core body coverage. */
const PERFORMER_CAREER_RE =
  /(?:映画|舞台|ドラマ|テレビ|地上波|銀幕).{0,16}(?:活躍|出演|進出|デビュー)|(?:活躍中)|(?:女優業以外)|(?:マルチ(?:に|な)?活躍)|(?:グラビア以外)|(?:本業以外)/u;

/** Work-internal theme / scene facet stems (product content, not performer name). */
export const WORK_THEME_FACET_RE =
  /^(?:人妻|NTR|熟女|美少女|女子校生|ギャル|痴女|OL|SM)$/iu;

const PLAY_STYLE_RE =
  /(?:ピストン|激ピス|杭打ち|騎乗|中出し|わからせ|お仕置き|ハーレム|逆\s*[35]P|腿コキ)/u;

const COLLECTION_SCOPE_RE =
  /(?:\d+\s*(?:タイトル|作品|コーナー|本番)|ベスト第?\d*弾|総集編|コレクション|全コーナー|最新\d+)/u;

const QUANTITY_SCALE_RE =
  /^\d+\s*(?:時間|分|回|発|本|名|人|射精|発射)$/u;

const PRODUCT_IDENTITY_RE =
  /(?:周年|デビューから|記念)|(?:エスワン|MOODYZ).{0,8}ベスト|ベスト第\d+弾/u;

/**
 * Classify how an Evidence fact should participate in product-intro body.
 */
export function classifyEvidenceMaterialRole(fact: string): EvidenceMaterialRole {
  const f = (fact ?? "").trim();
  if (!f) return "OTHER";

  if (PERFORMER_CAREER_RE.test(f)) {
    // Pure career/external activity with no work-content payload
    if (!PLAY_STYLE_RE.test(f) && !COLLECTION_SCOPE_RE.test(f) && !WORK_THEME_FACET_RE.test(f)) {
      if (/(?:映画|舞台|ドラマ|テレビ)/u.test(f)) return "PERFORMER_EXTERNAL_ACTIVITY";
      return "PERFORMER_CAREER";
    }
  }

  if (QUANTITY_SCALE_RE.test(f)) return "QUANTITY_SCALE";
  if (COLLECTION_SCOPE_RE.test(f)) return "COLLECTION_SCOPE";

  const primary = classifySemanticEvidence(f).primary;
  if (primary === "PERFORMER_IDENTITY") {
    return "PERFORMER_IDENTITY";
  }
  if (
    WORK_THEME_FACET_RE.test(f) ||
    primary === "SCENE_ACTION" ||
    primary === "RELATIONSHIP" ||
    PLAY_STYLE_RE.test(f)
  ) {
    return "WORK_CONTENT";
  }
  if (
    primary === "BODY_TRAIT" ||
    primary === "CHARACTER_TRAIT" ||
    primary === "PERFORMER_TRAIT"
  ) {
    return "WORK_CONTENT";
  }
  if (PRODUCT_IDENTITY_RE.test(f)) return "COLLECTION_SCOPE";

  // Short profile-like praise without work facets
  if (
    f.length <= 24 &&
    /(?:人気|知名度|ファン多数|注目の女優)/u.test(f) &&
    !PLAY_STYLE_RE.test(f)
  ) {
    return "PERFORMER_GENERAL_PROFILE";
  }

  return "OTHER";
}

/** Core body coverage should use work/collection/quantity — not career profile. */
export function isCoreBodyMaterial(fact: string): boolean {
  const role = classifyEvidenceMaterialRole(fact);
  return (
    role === "WORK_CONTENT" ||
    role === "COLLECTION_SCOPE" ||
    role === "QUANTITY_SCALE" ||
    role === "OTHER" ||
    role === "PERFORMER_IDENTITY"
  );
}

export function isDemotedBodyMaterial(fact: string): boolean {
  const role = classifyEvidenceMaterialRole(fact);
  return (
    role === "PERFORMER_CAREER" ||
    role === "PERFORMER_EXTERNAL_ACTIVITY" ||
    role === "PERFORMER_GENERAL_PROFILE"
  );
}

export function derivePresentationPurpose(fact: string): BodyPresentationPurpose {
  const f = (fact ?? "").trim();
  if (!f) return "OTHER";
  if (QUANTITY_SCALE_RE.test(f)) return "QUANTITY_SCALE";
  if (COLLECTION_SCOPE_RE.test(f) || PRODUCT_IDENTITY_RE.test(f)) return "COLLECTION_SCOPE";
  if (PLAY_STYLE_RE.test(f)) return "PLAY_STYLE";
  if (WORK_THEME_FACET_RE.test(f)) return "SCENE_VARIETY";

  const primary = classifySemanticEvidence(f).primary;
  if (primary === "SCENE_ACTION" || primary === "RELATIONSHIP") return "SCENE_VARIETY";
  if (
    primary === "BODY_TRAIT" ||
    primary === "CHARACTER_TRAIT" ||
    primary === "PERFORMER_TRAIT"
  ) {
    return "PERFORMER_TRAIT_IN_WORK";
  }
  if (primary === "PRODUCT_FORM" || primary === "EVENT" || primary === "TITLE_LABEL") {
    return "PRODUCT_IDENTITY";
  }
  if (/(?:円熟|濃厚なセックス|エロポテンシャル)/u.test(f)) return "PLAY_STYLE";
  return "OTHER";
}

export function dominantPresentationPurpose(
  facts: readonly string[],
): BodyPresentationPurpose | null {
  if (facts.length === 0) return null;
  const counts = new Map<BodyPresentationPurpose, number>();
  for (const f of facts) {
    const p = derivePresentationPurpose(f);
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  // Prefer work-understanding purposes when tied
  const preference: BodyPresentationPurpose[] = [
    "SCENE_VARIETY",
    "PLAY_STYLE",
    "PERFORMER_TRAIT_IN_WORK",
    "COLLECTION_SCOPE",
    "QUANTITY_SCALE",
    "PRODUCT_IDENTITY",
    "OTHER",
  ];
  let best: BodyPresentationPurpose = "OTHER";
  let bestN = -1;
  for (const p of preference) {
    const n = counts.get(p) ?? 0;
    if (n > bestN) {
      best = p;
      bestN = n;
    }
  }
  return best;
}
