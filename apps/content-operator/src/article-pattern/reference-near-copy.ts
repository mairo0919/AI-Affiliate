/**
 * Near-copy detection: Reference article prose must not be reused via word-swap.
 * Operates on abstract token overlap — does not store reference body long-term.
 */

export type NearCopyFinding = {
  hit: boolean;
  maxOverlap: number;
  threshold: number;
  evidence?: { overlapTokens: string[] };
};

const TOKEN_RE = /[\u4e00-\u9fff]{2,}|[ァ-ヶー]{3,}|[a-zA-Z]{4,}/g;

function tokens(text: string): string[] {
  return [...(text.match(TOKEN_RE) ?? [])].map((t) => t.toLowerCase());
}

/**
 * Compare generated article text against ephemeral reference snippets (if any)
 * or against blueprint-forbidden phrase lists. High contiguous overlap → hit.
 */
export function detectReferenceNearCopy(input: {
  generatedText: string;
  /** Optional ephemeral reference paragraphs (observe-time only; usually empty at gen) */
  referenceSnippets?: string[];
  /** Shared long tokens that must not dominate (titles of known reference hosts etc.) */
  blockedPhrases?: string[];
  threshold?: number;
}): NearCopyFinding {
  const threshold = input.threshold ?? 0.55;

  for (const phrase of input.blockedPhrases ?? []) {
    if (phrase.length >= 8 && input.generatedText.includes(phrase)) {
      return {
        hit: true,
        maxOverlap: 1,
        threshold,
        evidence: { overlapTokens: [phrase.slice(0, 40)] },
      };
    }
  }

  const gen = tokens(input.generatedText);
  if (gen.length < 8) return { hit: false, maxOverlap: 0, threshold };

  let maxOverlap = 0;
  let overlapTokens: string[] = [];

  for (const snip of input.referenceSnippets ?? []) {
    const ref = tokens(snip);
    if (ref.length < 6) continue;
    const refSet = new Set(ref);
    const shared = gen.filter((t) => refSet.has(t));
    const overlap = shared.length / Math.max(ref.length, 1);
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      overlapTokens = [...new Set(shared)].slice(0, 12);
    }
  }

  return {
    hit: maxOverlap >= threshold,
    maxOverlap: Number(maxOverlap.toFixed(3)),
    threshold,
    evidence: overlapTokens.length ? { overlapTokens } : undefined,
  };
}
