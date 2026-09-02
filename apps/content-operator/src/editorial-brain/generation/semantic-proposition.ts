/**
 * R151 — Semantic proposition dimensions for safe Fact Matching.
 *
 * SEMANTIC requires preserved required dimensions of the planned fact.
 * False negative preferred over false positive.
 */

/** Concessive / contrastive relation markers (plan or Writer). */
const CONCESSIVE_MARKERS =
  /(?:と|といえ|とは)言えど|ではあるものの|であるが|だけれども|けれども|けれど|ものの|にもかかわらず|それでも|それなのに/u;

const CONCESSIVE_EXACT_MARKERS = /(?:と|といえ|とは)言えど/u;

const CONCESSIVE_SEMANTIC_MARKERS = /ではあるものの|ものの|にもかかわらず|それでも/u;

/** Neutral copula replacement that drops concessive relation. */
const NEUTRAL_COPULA_DRIFT = /である(?:彼|彼女|彼ら)?(?:の|は|が)?/u;

const CAUSAL_MARKERS = /(?:ので|ため|から|した結果)/u;

export function factRequiresConcessiveRelation(fact: string): boolean {
  return CONCESSIVE_EXACT_MARKERS.test(fact) || CONCESSIVE_SEMANTIC_MARKERS.test(fact);
}

export function sentenceHasConcessiveRelation(sentence: string): boolean {
  return CONCESSIVE_MARKERS.test(sentence);
}

export function sentenceHasNeutralCopulaWithoutConcessive(
  sentence: string,
  subjectHint: string,
): boolean {
  if (!NEUTRAL_COPULA_DRIFT.test(sentence)) return false;
  if (sentenceHasConcessiveRelation(sentence)) return false;
  const sub = subjectHint.trim();
  if (sub && sentence.includes(sub) && /である/.test(sentence)) return true;
  return NEUTRAL_COPULA_DRIFT.test(sentence) && !sentenceHasConcessiveRelation(sentence);
}

/** Tail proposition after concessive marker — shared anchors for realization check. */
export function propositionTailAfterConcessive(fact: string): string | null {
  const m = fact.match(/(?:と|といえ|とは)言えど(.+)/u) ?? fact.match(/ではあるものの(.+)/u);
  return m?.[1]?.trim() ?? null;
}

function tailAnchorsRealized(sentence: string, tail: string): boolean {
  const t = tail.replace(/\s+/g, "");
  const s = sentence.replace(/\s+/g, "");
  if (t.length >= 8 && s.includes(t.slice(0, Math.min(12, t.length)))) return true;
  const chunks = tail
    .split(/[、。◆]/u)
    .flatMap((p) => p.match(/[\u3040-\u9fff\u30a0-\u30ff]{4,}/gu) ?? [])
    .filter((c) => c.length >= 4);
  if (chunks.length === 0) return false;
  const hits = chunks.filter((c) => s.includes(c.replace(/\s+/g, "")));
  return hits.length >= Math.min(2, chunks.length);
}

/**
 * Concessive proposition matching — category-based, not CID-specific.
 * Returns EXACT / SEMANTIC / null (NONE).
 */
export function matchConcessiveProposition(
  sentence: string,
  fact: string,
): "EXACT" | "SEMANTIC" | null {
  if (!factRequiresConcessiveRelation(fact)) return null;

  const subjectMatch = fact.match(/^(.{1,16}?)(?:と|といえ|とは)言えど/u);
  const subject = subjectMatch?.[1]?.trim() ?? "";
  const tail = propositionTailAfterConcessive(fact);
  if (!tail) return null;

  if (sentenceHasNeutralCopulaWithoutConcessive(sentence, subject)) return null;
  if (CAUSAL_MARKERS.test(sentence) && !CONCESSIVE_MARKERS.test(sentence)) return null;

  if (CONCESSIVE_EXACT_MARKERS.test(sentence) && sentence.includes(subject.slice(0, 2))) {
    if (tailAnchorsRealized(sentence, tail)) return "EXACT";
  }

  if (CONCESSIVE_SEMANTIC_MARKERS.test(sentence)) {
    if (subject && !sentence.includes(subject.slice(0, 2))) return null;
    if (tailAnchorsRealized(sentence, tail)) return "SEMANTIC";
  }

  if (/^彼(?:は|が|も)/u.test(sentence.trim()) && !sentenceHasConcessiveRelation(sentence)) {
    return null;
  }

  return null;
}

/** Curated-venue catalog theme — quoted theme + venue noun category. */
export function matchCatalogVenueThemeProposition(
  sentence: string,
  fact: string,
): boolean {
  const curated = /選りすぐり|厳選|セレクション/u.test(fact);
  const venue = /写真館|ギャラリー|コレクション|展示館/u.test(fact);
  if (!curated || !venue) return false;

  const themeMatch = fact.match(/「([^」]{1,24})」/u);
  if (!themeMatch) return false;
  const theme = themeMatch[1]!;

  if (!/選りすぐり|厳選/u.test(sentence)) return false;
  if (!sentence.includes(theme)) return false;
  if (!/写真館|モロ出し|ギャラリー|展示/u.test(sentence)) return false;

  return true;
}

/** Required dimensions policy — exported for tests and docs. */
export const SEMANTIC_DIMENSION_POLICY = {
  rule: "Writer proposition must preserve all required semantic dimensions of the planned fact.",
  dimensions: [
    "entity",
    "action",
    "object",
    "quantity",
    "polarity",
    "comparison",
    "contrast",
    "causality",
    "temporal",
    "modality",
    "exclusivity",
    "role",
  ] as const,
  forbiddenExamples: [
    { plan: "Aと言えどB", writer: "Aである彼がB", loss: "contrast" },
    { plan: "AだけB", writer: "AもB", loss: "exclusivity" },
    { plan: "AよりB", writer: "AとB", loss: "comparison" },
    { plan: "AためB", writer: "A。B", loss: "causality" },
  ],
} as const;
