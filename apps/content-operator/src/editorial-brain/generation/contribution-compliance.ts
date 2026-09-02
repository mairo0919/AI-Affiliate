/**
 * Facet presence helpers + X channel contribution allocation.
 * Blogger SEGMENT allocation / contribution compliance removed (R124).
 */

import {
  facetKey,
  observeFacetsInText,
  type InformationalContribution,
} from "./informational-contribution.js";

const CATALOG_FACET_RE =
  /メーカー|レーベル|配信中|AVAILABLE|公開ページ|販売|配給|制作|MOODYZ|ファン感謝祭/;

function concretenessScore(c: InformationalContribution): number {
  let score = c.facet.length;
  if (/^\d+泊\d+日$/.test(c.facet)) score += 55;
  if (/\d+(名|時間|作品|泊|日|人)/.test(c.facet)) score += 40;
  if (/^\d+日$/.test(c.facet) || /^\d+泊$/.test(c.facet)) score -= 25;
  if (
    /ベロキス|舐め|痴女|わからせ|洗脳|姉妹|バスツアー|乱交|生ハメ|顔面|潮|ピストン|ナンパ|巨乳|感度|水着|ベスト|収録|メスガキ/.test(
      c.facet,
    )
  ) {
    score += 30;
  }
  if (CATALOG_FACET_RE.test(c.facet)) score -= 50;
  if (/^\d+(?:名|時間|作品|分|人)$/.test(c.facet)) score += 15;
  return score;
}

function facetHit(text: string, facet: string): boolean {
  const t = text.replace(/\s+/g, "");
  const f = facet.replace(/\s+/g, "");
  if (f.length < 2) return false;
  if (t.includes(f)) return true;
  if (f.length >= 5) {
    const parts = f.match(/[\u4e00-\u9fff]{2,}|\d+(?:名|時間|作品|分|人|泊|日)/g) ?? [];
    let hits = 0;
    for (const p of parts) {
      if (p.length >= 2 && t.includes(p)) hits += 1;
    }
    if (hits >= Math.min(2, parts.length) || (parts.length === 1 && hits === 1)) return true;
  }
  return false;
}

/** Shared facet presence — reference execution + contribution-family routing. */
export function contributionFacetPresent(text: string, facet: string): boolean {
  return facetHit(text, facet);
}

/**
 * X: detect near-verbatim source-title restatement via contribution sequence overlap.
 */
export function detectSourceTitleRestatement(input: {
  body: string;
  sourceStatements: string[];
}): { hit: boolean; evidence: Record<string, unknown> } {
  const body = input.body.trim();
  if (body.length < 12) return { hit: false, evidence: {} };

  const sources = input.sourceStatements
    .map((s) => s.trim())
    .filter((s) => s.length >= 24)
    .sort((a, b) => b.length - a.length);
  if (sources.length === 0) return { hit: false, evidence: {} };

  const source = sources[0]!;
  const sourceFacets = observeFacetsInText(source).filter((f) => f.length >= 2);
  const bodyFacets = observeFacetsInText(body).filter((f) => f.length >= 2);
  if (sourceFacets.length < 4) return { hit: false, evidence: { reason: "source_too_few_facets" } };

  const sourceKeys = new Set(sourceFacets.map(facetKey));
  const matched = bodyFacets.filter((f) => sourceKeys.has(facetKey(f)));
  const matchedUnique = [...new Set(matched.map(facetKey))];
  const coverage = matchedUnique.length / sourceFacets.length;

  const norm = (t: string) => t.replace(/\s+/g, "").replace(/[「」【】]/g, "");
  const sn = norm(source);
  const bn = norm(body);
  let longest = 0;
  const window = 24;
  for (let i = 0; i + window <= sn.length; i += 4) {
    if (bn.includes(sn.slice(i, i + window))) longest = Math.max(longest, window);
  }
  for (let i = 0; i + 40 <= sn.length; i += 8) {
    if (bn.includes(sn.slice(i, i + 40))) longest = Math.max(longest, 40);
  }

  const novelBody = bodyFacets.filter((f) => !sourceKeys.has(facetKey(f)));
  const highCoverage = matchedUnique.length >= 4 && coverage >= 0.55;
  const longCopy = longest >= 24 && matchedUnique.length >= 3;
  const noNovel = novelBody.length === 0;
  const selective =
    matchedUnique.length <= 3 && coverage < 0.45 && longest < 24;

  if (selective) {
    return {
      hit: false,
      evidence: { selective: true, matched: matchedUnique.length, coverage, longest },
    };
  }

  const hit = noNovel && (highCoverage || longCopy);
  return {
    hit,
    evidence: {
      matched: matchedUnique.length,
      sourceFacets: sourceFacets.length,
      coverage,
      longestContiguous: longest,
      novelBody: novelBody.slice(0, 4),
    },
  };
}

/** Allocate X hook/support contributions at facet level. */
export function allocateXFacetContributions(input: {
  claimStatements: Array<{ id: string; statement: string }>;
  hookClaimIds: string[];
  supportClaimIds: string[];
}): {
  sufficient: boolean;
  reason: string | null;
  hookContributions: InformationalContribution[];
  supportContributions: InformationalContribution[];
} {
  const byId = new Map(input.claimStatements.map((c) => [c.id, c]));
  const pickConcrete = (ids: string[]): InformationalContribution[] => {
    const out: InformationalContribution[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const claim = byId.get(id);
      if (!claim) continue;
      const contribs = observeFacetsInText(claim.statement)
        .filter((f) => f.length >= 2 && !CATALOG_FACET_RE.test(f))
        .map((facet) => ({ id: `${id}::${facet}`, claimId: id, facet }))
        .sort((a, b) => concretenessScore(b) - concretenessScore(a));
      for (const c of contribs) {
        const k = facetKey(c.facet);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(c);
      }
    }
    return out;
  };

  const fromHookClaims = pickConcrete(
    input.hookClaimIds.length ? input.hookClaimIds : input.claimStatements.map((c) => c.id),
  );
  const hookContributions = fromHookClaims.slice(0, 2);
  const hookKeys = new Set(hookContributions.map((c) => facetKey(c.facet)));
  const supportPool = pickConcrete(
    input.supportClaimIds.length
      ? input.supportClaimIds
      : input.claimStatements.map((c) => c.id),
  ).filter((c) => !hookKeys.has(facetKey(c.facet)));
  const leftoverFromHook = fromHookClaims
    .slice(2)
    .filter((c) => !hookKeys.has(facetKey(c.facet)));
  const supportContributions = (supportPool.length ? supportPool : leftoverFromHook).slice(0, 2);

  if (hookContributions.length === 0) {
    return {
      sufficient: false,
      reason: "no_concrete_hook_facet",
      hookContributions: [],
      supportContributions: [],
    };
  }

  const onlyShortIdentity =
    hookContributions.every((c) => c.facet.length <= 4) && supportContributions.length === 0;
  if (onlyShortIdentity) {
    return {
      sufficient: false,
      reason: "compresses_to_product_name_only",
      hookContributions,
      supportContributions: [],
    };
  }

  return {
    sufficient: true,
    reason: null,
    hookContributions,
    supportContributions,
  };
}
