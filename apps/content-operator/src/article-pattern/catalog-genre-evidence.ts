/**
 * Official catalog genre/tag → Evidence atoms (FANZA page JSON-LD / ItemList).
 * Delivery-only catalog noise is excluded; product-meaningful themes/traits kept.
 *
 * GENRE_TAG authority only — never elevate classification to SCENE/RELATIONSHIP.
 */

import { classifySemanticEvidence } from "./semantic-evidence.js";
import type { OfficialPageFactAtom } from "./official-page-evidence-atoms.js";

/** Platform/delivery facets — not article scene fuel. */
const DELIVERY_OR_PLATFORM_GENRE =
  /^(?:ハイビジョン|独占配信|VR|スマホ対応|ダウンロード|ストリーミング|HD|4K|単体作品)$/u;

/** Weak duration buckets when exact runtime already exists in description. */
const WEAK_DURATION_BUCKET = /^(?:4時間以上作品|2時間以上作品)$/u;

/** Catalog labels that are not adult theme/play/body/form fuel for intros. */
const NON_PRODUCT_INTRO_GENRE = /^(?:そっくりさん|イメージビデオ|その他)$/u;

export type CatalogGenreInput = {
  value: string;
  provenance: string;
  originField: string;
};

/**
 * Keep official genres that add product-specific theme / body / form signal.
 */
export function isProductMeaningfulCatalogGenre(value: string): boolean {
  const v = (value ?? "").trim();
  if (!v || v.length > 40) return false;
  if (DELIVERY_OR_PLATFORM_GENRE.test(v)) return false;
  if (WEAK_DURATION_BUCKET.test(v)) return false;
  if (NON_PRODUCT_INTRO_GENRE.test(v)) return false;
  return true;
}

/**
 * Map catalog genre label → pack facet without SCENE/RELATIONSHIP promotion.
 * Family stays genre-scoped so description scenes do not collapse into the tag.
 */
function catalogGenreAuthorityFields(value: string): {
  primary: string;
  familyId: string;
  blueprintType: OfficialPageFactAtom["blueprintType"];
} {
  const sem = classifySemanticEvidence(value, { sourceType: "product_description" });
  const familyId = `GENRE_${value.replace(/\s+/g, "").slice(0, 24)}`;

  // Form / compilation catalog labels
  if (/(?:ベスト|総集編|コレクション)/u.test(value)) {
    return {
      primary: "PRODUCT_FORM",
      familyId,
      blueprintType: "series_or_event",
    };
  }

  // Never: SCENE_ACTION / RELATIONSHIP / setting_or_situation from genre membership alone.
  if (
    sem.primary === "SCENE_ACTION" ||
    sem.primary === "RELATIONSHIP" ||
    sem.primary === "UNKNOWN_CONCRETE" ||
    sem.blueprintType === "scene_or_act" ||
    sem.blueprintType === "setting_or_situation"
  ) {
    return {
      primary: "SERIES_CONCEPT",
      familyId,
      blueprintType: "series_or_event",
    };
  }

  // Body-looking genre (巨乳) stays GENRE family — not BODY_* description family.
  if (sem.primary === "BODY_TRAIT") {
    return {
      primary: "SERIES_CONCEPT",
      familyId,
      blueprintType: "series_or_event",
    };
  }

  return {
    primary: sem.primary,
    familyId,
    blueprintType:
      sem.blueprintType === "unknown_concrete" ? "series_or_event" : sem.blueprintType,
  };
}

export function catalogGenreToAtom(
  genre: CatalogGenreInput,
  idx: number,
): OfficialPageFactAtom | null {
  const value = genre.value.trim();
  if (!isProductMeaningfulCatalogGenre(value)) return null;

  const originField = genre.originField || "catalog.genre";
  const auth = catalogGenreAuthorityFields(value);
  // Official genre membership is generator-allowed even when short.
  return {
    id: `page_atom::catalog.genre::${idx}`,
    fact: value,
    bucket: "SUPPORTED_CONCRETE_FACT",
    familyId: auth.familyId,
    primary: auth.primary,
    blueprintType: auth.blueprintType,
    originField,
    source: "fanza_product_page",
    generatorAllowed: true,
    sourceFactType: "GENRE_TAG",
  };
}

export function extractCatalogGenreAtoms(
  genres: CatalogGenreInput[] | null | undefined,
): OfficialPageFactAtom[] {
  if (!Array.isArray(genres) || genres.length === 0) return [];
  const out: OfficialPageFactAtom[] = [];
  const seen = new Set<string>();
  let idx = 0;
  for (const g of genres) {
    if (!g?.value) continue;
    const atom = catalogGenreToAtom(g, idx++);
    if (!atom) continue;
    if (seen.has(atom.fact)) continue;
    seen.add(atom.fact);
    out.push(atom);
  }
  return out;
}
