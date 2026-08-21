/**
 * Deterministic strip of unsupported evaluative / interpretive padding.
 *
 * OPTION B: Do NOT rewrite prose into catalog shells (e.g. 「が確認できる」).
 * Drop unsupported evaluative/interpretive sentences; preserve fact-carrying
 * sentences as-is when they contain keep facets. Expression rewrite → Brain repair.
 */

import {
  hasEvaluativeRelation,
  hasInterpretiveRelation,
  claimStatesEvaluativeRelation,
} from "../shadow/predicate-families.js";

function sentenceCarriesKeepFacet(text: string, keepFacets: string[]): boolean {
  const t = text.replace(/\s+/g, "");
  for (const raw of keepFacets) {
    const f = raw.replace(/\s+/g, "");
    if (f.length >= 2 && t.includes(f)) return true;
  }
  return false;
}

function shouldDropSentence(text: string, claimsAllowEval: boolean): boolean {
  if (!claimsAllowEval && hasEvaluativeRelation(text)) return true;
  if (hasInterpretiveRelation(text)) return true;
  if (/興味がある方は|チェックするとよい|他では見られない内容/.test(text) && text.length < 60) {
    return true;
  }
  // Pure catalog confirmation filler (not a scene contribution)
  if (/出演者として.{1,30}(名前が)?確認できる/.test(text)) return true;
  if (/クレジットされているだけ/.test(text)) return true;
  if (/は公開ページ上で確認できる/.test(text) && text.length < 80) return true;
  if (/配信状態は「配信中」と確認できる/.test(text)) return true;
  if (/メーカー／レーベルとして/.test(text) && text.length < 60) return true;
  return false;
}

/**
 * @deprecated Do not use for generation path. Kept for isolation tests only.
 * OPTION B forbids deterministic expression rewrite into catalog phrasing.
 */
export function scrubEvaluativeWrappers_DEPRECATED_DO_NOT_USE(text: string): string {
  return text;
}

function stripBadSentences(
  text: string,
  claimsAllowEval: boolean,
  keepFacets: string[] = [],
): string {
  if (!text) return text;
  const parts = text
    .split(/(?<=[。．！？!?])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1 && !/[。．！？!?]/.test(text)) {
    // Single fragment: keep if facet-bearing; else drop if evaluative
    if (sentenceCarriesKeepFacet(text, keepFacets)) return text;
    if (shouldDropSentence(text, claimsAllowEval)) return "";
    return text;
  }
  return parts
    .map((s) => {
      if (!shouldDropSentence(s, claimsAllowEval)) return s;
      // Fact carrier with keep facet: keep original wording (no rewrite to 確認できる)
      if (sentenceCarriesKeepFacet(s, keepFacets)) return s;
      return "";
    })
    .filter((s) => s.length > 0)
    .join("");
}

export function stripUnsupportedEvaluativePadding(input: {
  article: {
    title: string;
    summary: string;
    lead: string;
    sections: Array<{ heading?: string | null; paragraphs: string[]; lists?: string[] }>;
    cta?: { label?: string; url?: string };
  };
  claimStatements: Array<{ statement: string }>;
  /** Facets that must survive strip even inside mild evaluative wrappers */
  keepFacets?: string[];
}): typeof input.article {
  const claimsAllowEval = input.claimStatements.some((c) =>
    claimStatesEvaluativeRelation(c.statement),
  );
  const keepFacets = (input.keepFacets ?? [])
    .map((f) => f.trim())
    .filter((f) => f.length >= 2);
  // Title: never rewrite expressions; only drop pure eval if no keep facet
  let title = input.article.title;
  if (
    shouldDropSentence(title, claimsAllowEval) &&
    !sentenceCarriesKeepFacet(title, keepFacets)
  ) {
    title = title; // keep title identity even if mildly evaluative — Brain decides
  }
  return {
    ...input.article,
    title,
    summary: stripBadSentences(input.article.summary, claimsAllowEval, keepFacets),
    lead: stripBadSentences(input.article.lead, claimsAllowEval, keepFacets),
    sections: input.article.sections.map((sec) => ({
      ...sec,
      paragraphs: sec.paragraphs
        .map((p) => stripBadSentences(p, claimsAllowEval, keepFacets))
        .filter((p) => p.length > 0),
    })),
  };
}
