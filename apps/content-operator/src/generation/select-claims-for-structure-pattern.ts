/**
 * Select which SUPPORTED claims to offer the LLM for Structure + Editorial Patterns.
 * SUPPORTED = allowed facts, not "must use all".
 */

import type { StructurePattern } from "../article-pattern/structure-pattern.js";
import type { EditorialPattern } from "../article-pattern/editorial-pattern.js";

export type ClaimKind =
  | "identity_name"
  | "performer"
  | "maker"
  | "series"
  | "availability"
  | "trait_or_scene"
  | "temporal_sale"
  | "other";

export type ClaimForSelection = {
  id: string;
  statement: string;
};

const TRAIT_RE =
  /感度|巨乳|潮吹|ピストン|シーン|シチュ|ナンパ|清楚|刺激|絶頂|ハメ|水着|連続|痙攣|敏感|Hカップ|デカ乳|ベロキス|舐め|痴女|わからせ|洗脳|姉妹|バスツアー|乱交|生ハメ|顔面|潮|独占配信|ベスト|収録/;

/** True when statement carries concrete scene/trait signal (even inside a long title). */
export function statementHasConcreteTrait(statement: string): boolean {
  return TRAIT_RE.test(statement);
}

/**
 * Classify claim kind for selection.
 * Marketing wrappers like 【セール】 inside a long title do NOT force temporal_sale —
 * those titles are treated as trait/identity carriers (SALE still must not be asserted
 * without a dedicated SUPPORTED sale claim).
 */
export function classifyClaimKind(statement: string): ClaimKind {
  const s = statement;
  const looksLikeMarketingTitle = s.length > 60 && /【/.test(s);

  // Dedicated short temporal claims only
  if (
    /セール|キャンペーン|期間限定|割引/.test(s) &&
    !looksLikeMarketingTitle &&
    !TRAIT_RE.test(s) &&
    s.length < 100
  ) {
    return "temporal_sale";
  }
  if (/出演者|出演／|キャスト|performer/i.test(s) && s.length < 80) return "performer";
  if (/メーカー|レーベル|maker|label/i.test(s) && s.length < 80) return "maker";
  if (/シリーズ情報|シリーズ名|series/i.test(s) && s.length < 80) return "series";
  if (/配信中|販売終了|販売／配信|availability|AVAILABLE|UNAVAILABLE/i.test(s)) {
    return "availability";
  }
  // Long product-title claims with scene/trait vocabulary are editorial carriers,
  // not mere identity/catalog rows — even when they end with 「公開ページ上で確認できる」.
  if (statementHasConcreteTrait(s)) return "trait_or_scene";
  if (/出演|キャスト/i.test(s)) return "performer";
  if (/メーカー|レーベル/i.test(s)) return "maker";
  if (/シリーズ/i.test(s)) return "series";
  if (/公開ページ上で確認できる|は公開/.test(s)) return "identity_name";
  return "other";
}

const KIND_PRIORITY: Record<ClaimKind, number> = {
  trait_or_scene: 100,
  performer: 90,
  series: 55,
  identity_name: 50,
  maker: 25,
  other: 20,
  temporal_sale: 10,
  availability: 5,
};

/**
 * Rank and cap claims for Structure + Editorial Patterns.
 * Opening priorities from Editorial Pattern outweigh flat Structure prefer/avoid unions
 * for low-value catalog kinds (maker/availability).
 */
export function selectClaimsForStructurePattern(
  claims: ClaimForSelection[],
  pattern: StructurePattern | null | undefined,
  editorial?: EditorialPattern | null,
): {
  selectedClaims: Array<ClaimForSelection & { kind: ClaimKind }>;
  deferredClaimIds: string[];
  maxClaimsSuggested: number;
  openingClaimIds: string[];
} {
  const maxClaimsSuggested =
    editorial?.informationSelection.maxClaimsSuggested ??
    pattern?.constraints.maxClaimsSuggested ??
    Math.min(4, claims.length);

  const openingPriority = editorial?.opening.claimPriority ?? [
    "trait_or_scene",
    "performer",
    "series",
  ];
  const openingAvoid = new Set(
    editorial?.opening.claimAvoid ?? ["maker", "availability", "temporal_sale"],
  );
  const omitLow = new Set(
    editorial?.informationSelection.omitWhenLowValue ?? ["availability", "maker"],
  );
  const infoPriority = editorial?.informationSelection.priority ?? openingPriority;

  // Structure block hints — but do not let interest_development's series/maker prefer
  // override editorial opening avoid for selection ranking of low-value kinds.
  const preferred = new Set(
    (pattern?.blocks ?? []).flatMap((b) => b.generation?.claimKindsPreferred ?? []),
  );
  const avoided = new Set(
    (pattern?.blocks ?? []).flatMap((b) => b.generation?.claimKindsAvoid ?? []),
  );

  const ranked = claims.map((c) => {
    const kind = classifyClaimKind(c.statement);
    let score = KIND_PRIORITY[kind] ?? 0;

    const infoIdx = infoPriority.indexOf(kind);
    if (infoIdx >= 0) score += 40 - infoIdx * 5;

    if (preferred.has(kind) && !openingAvoid.has(kind) && !omitLow.has(kind)) {
      score += 20;
    }
    if (avoided.has(kind) || openingAvoid.has(kind) || omitLow.has(kind)) {
      score -= 55;
    }

    // Boost concrete traits even when embedded in long marketing titles
    if (statementHasConcreteTrait(c.statement)) {
      score += 50;
      if (editorial?.opening.preferTraitsEmbeddedInTitleClaims) score += 20;
    }

    // Long identity/title dumps without traits are weak
    if (
      (kind === "identity_name" || kind === "other") &&
      c.statement.length > 80 &&
      !statementHasConcreteTrait(c.statement)
    ) {
      score -= 30;
    }

    // Opening suitability score (for ordering selected list)
    let openingScore = score;
    const openIdx = openingPriority.indexOf(kind);
    if (openIdx >= 0) openingScore += 30 - openIdx * 8;
    if (openingAvoid.has(kind)) openingScore -= 80;

    return { ...c, kind, score, openingScore };
  });

  ranked.sort((a, b) => b.score - a.score || b.openingScore - a.openingScore);

  const selected = ranked.slice(0, Math.max(1, maxClaimsSuggested));
  const selectedIds = new Set(selected.map((c) => c.id));
  const deferredClaimIds = ranked.filter((c) => !selectedIds.has(c.id)).map((c) => c.id);

  // Opening subset: top maxOpeningClaims by openingScore among selected
  const maxOpening = editorial?.opening.maxOpeningClaims ?? 2;
  const openingClaimIds = [...selected]
    .sort((a, b) => b.openingScore - a.openingScore)
    .filter((c) => !openingAvoid.has(c.kind))
    .slice(0, maxOpening)
    .map((c) => c.id);

  // Ensure selected list is ordered with opening claims first for Prompt interpretation
  const openingSet = new Set(openingClaimIds);
  selected.sort((a, b) => {
    const ao = openingSet.has(a.id) ? 1 : 0;
    const bo = openingSet.has(b.id) ? 1 : 0;
    if (ao !== bo) return bo - ao;
    return b.openingScore - a.openingScore;
  });

  return {
    selectedClaims: selected.map(({ id, statement, kind }) => ({ id, statement, kind })),
    deferredClaimIds,
    maxClaimsSuggested,
    openingClaimIds,
  };
}
