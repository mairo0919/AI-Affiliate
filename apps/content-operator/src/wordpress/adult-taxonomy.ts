/**
 * Extract adult attribute tags from Research Evidence (provider-agnostic).
 * Priority: official genres → product attributes → title → description.
 * Never invents terms not backed by Evidence text + dictionary match.
 */

import {
  ADULT_TAXONOMY_DICTIONARY,
  type AdultTaxonomyTerm,
} from "./adult-taxonomy-dictionary.js";
import { stableTermSlug } from "./wordpress-seo-attach.js";

function uniqPreserve(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = name.replace(/\s+/g, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export type AdultTagMatchSource =
  | "genre"
  | "related_tag"
  | "attribute"
  | "title"
  | "description";

export type AdultTagMatch = {
  canonicalName: string;
  source: AdultTagMatchSource;
  matchedAlias: string;
  asciiHint: string | null;
  stableSlug: string;
  type: AdultTaxonomyTerm["type"];
  priority: number;
};

export type ExtractAdultAttributeTagsInput = {
  /** Provider-normalized official genre/category label names. */
  genres?: string[] | null;
  /** Provider-normalized official related tags. */
  relatedTags?: string[] | null;
  /** Other official attribute strings (excluding performer names). */
  attributes?: string[] | null;
  officialTitle?: string | null;
  officialDescription?: string | null;
  /** Optional extra free-text blobs already attested in Evidence. */
  extraText?: string[] | null;
};

export type ExtractAdultAttributeTagsResult = {
  tags: string[];
  matches: AdultTagMatch[];
  counts: {
    fromGenre: number;
    fromRelatedTag: number;
    fromAttribute: number;
    fromTitle: number;
    fromDescription: number;
  };
};

const BANNED_ATTRIBUTE_EXACT = new Set([
  "動画",
  "作品",
  "紹介",
  "おすすめ",
  "av",
  "ａｖ",
  "記事",
  "商品",
  "ページ",
  "公式",
  "詳細",
  "人気",
  "アダルト",
  "エロ",
]);

function normalizeForCompare(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function compileAliasNeedle(alias: string): RegExp {
  const a = alias.trim();
  // Latin / short codes: prefer word-ish boundaries to avoid random letter hits.
  if (/^[a-z0-9][a-z0-9'’-]*$/i.test(a) && a.length <= 6) {
    return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(a)}(?:$|[^a-z0-9])`, "i");
  }
  return new RegExp(escapeRegExp(a), "i");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textContainsAlias(text: string, alias: string): boolean {
  if (!text || !alias) return false;
  if (normalizeForCompare(text).includes(normalizeForCompare(alias))) {
    // For very short JP aliases (≤1), require exact label equality elsewhere.
    if (alias.replace(/\s+/g, "").length <= 1) return false;
    return compileAliasNeedle(alias).test(text);
  }
  return false;
}

function labelEqualsAlias(label: string, alias: string): boolean {
  return normalizeForCompare(label) === normalizeForCompare(alias);
}

/**
 * Match dictionary against Evidence fields with source priority.
 */
export function extractAdultAttributeTags(
  input: ExtractAdultAttributeTagsInput,
): ExtractAdultAttributeTagsResult {
  const genres = (input.genres ?? []).map((g) => g.trim()).filter(Boolean);
  const relatedTags = (input.relatedTags ?? []).map((t) => t.trim()).filter(Boolean);
  const attributes = (input.attributes ?? []).map((a) => a.trim()).filter(Boolean);
  const title = input.officialTitle?.trim() ?? "";
  const description = input.officialDescription?.trim() ?? "";
  const extras = (input.extraText ?? []).map((t) => t.trim()).filter(Boolean);

  const byCanonical = new Map<string, AdultTagMatch>();
  const counts = {
    fromGenre: 0,
    fromRelatedTag: 0,
    fromAttribute: 0,
    fromTitle: 0,
    fromDescription: 0,
  };

  const bump = (source: AdultTagMatchSource, delta: 1 | -1) => {
    if (source === "genre") counts.fromGenre = Math.max(0, counts.fromGenre + delta);
    if (source === "related_tag") counts.fromRelatedTag = Math.max(0, counts.fromRelatedTag + delta);
    if (source === "attribute") counts.fromAttribute = Math.max(0, counts.fromAttribute + delta);
    if (source === "title") counts.fromTitle = Math.max(0, counts.fromTitle + delta);
    if (source === "description") counts.fromDescription = Math.max(0, counts.fromDescription + delta);
  };

  const consider = (
    term: AdultTaxonomyTerm,
    source: AdultTagMatchSource,
    matchedAlias: string,
  ) => {
    if (BANNED_ATTRIBUTE_EXACT.has(normalizeForCompare(term.canonicalName))) return;
    const existing = byCanonical.get(term.canonicalName);
    const rank = sourceRank(source);
    if (existing && sourceRank(existing.source) <= rank) {
      if (existing.priority >= term.priority) return;
    }
    const match: AdultTagMatch = {
      canonicalName: term.canonicalName,
      source,
      matchedAlias,
      asciiHint: term.asciiHint ?? null,
      stableSlug: stableTermSlug(term.canonicalName, "t", term.asciiHint ?? null),
      type: term.type,
      priority: term.priority,
    };
    if (!existing) {
      bump(source, 1);
    } else if (sourceRank(existing.source) > rank) {
      bump(existing.source, -1);
      bump(source, 1);
    }
    byCanonical.set(term.canonicalName, match);
  };

  // 1) Official genres
  for (const term of ADULT_TAXONOMY_DICTIONARY) {
    for (const alias of term.aliases) {
      for (const g of genres) {
        if (labelEqualsAlias(g, alias) || textContainsAlias(g, alias)) {
          consider(term, "genre", alias);
        }
      }
    }
  }

  // 2) Official related tags
  for (const term of ADULT_TAXONOMY_DICTIONARY) {
    for (const alias of term.aliases) {
      for (const t of relatedTags) {
        if (labelEqualsAlias(t, alias) || textContainsAlias(t, alias)) {
          consider(term, "related_tag", alias);
        }
      }
    }
  }

  // 3) Official product attributes
  for (const term of ADULT_TAXONOMY_DICTIONARY) {
    for (const alias of term.aliases) {
      for (const a of attributes) {
        if (labelEqualsAlias(a, alias) || textContainsAlias(a, alias)) {
          consider(term, "attribute", alias);
        }
      }
    }
  }

  // 4) Official title
  if (title) {
    for (const term of ADULT_TAXONOMY_DICTIONARY) {
      for (const alias of term.aliases) {
        if (textContainsAlias(title, alias)) {
          consider(term, "title", alias);
        }
      }
    }
  }

  // 5) Official description
  if (description) {
    for (const term of ADULT_TAXONOMY_DICTIONARY) {
      for (const alias of term.aliases) {
        if (alias.replace(/\s+/g, "").length < 2) continue;
        if (textContainsAlias(description, alias)) {
          consider(term, "description", alias);
        }
      }
    }
  }

  for (const blob of extras) {
    for (const term of ADULT_TAXONOMY_DICTIONARY) {
      for (const alias of term.aliases) {
        if (textContainsAlias(blob, alias)) {
          if (!byCanonical.has(term.canonicalName)) {
            consider(term, "title", alias);
          }
        }
      }
    }
  }

  const matches = [...byCanonical.values()].sort(
    (a, b) => b.priority - a.priority || a.canonicalName.localeCompare(b.canonicalName, "ja"),
  );
  return {
    tags: uniqPreserve(matches.map((m) => m.canonicalName)),
    matches,
    counts,
  };
}

function sourceRank(source: AdultTagMatchSource): number {
  switch (source) {
    case "genre":
      return 1;
    case "related_tag":
      return 2;
    case "attribute":
      return 3;
    case "title":
      return 4;
    case "description":
      return 5;
    default:
      return 9;
  }
}

/** Lookup ascii hint / slug for a canonical adult tag name. */
export function adultTagStableSlug(canonicalName: string): string {
  const hit = ADULT_TAXONOMY_DICTIONARY.find((t) => t.canonicalName === canonicalName);
  return stableTermSlug(canonicalName, "t", hit?.asciiHint ?? null);
}
