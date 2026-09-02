/**
 * Minimal claim / prose eval-surface checks for generation contracts — not reviewer ontology.
 */

/** Claim explicitly supports evaluative surface in development (contract allowlist). */
export function claimSupportsEvalSurface(statement: string): boolean {
  return /おすすめ|魅力|楽しめる|必見|魅力的|向いている|適している|見どころ|堪能/.test(
    statement,
  );
}

/** Promotional eval surface on generated prose (X compaction / non-OPTION B strip). */
export function hasPromotionalEvalSurface(text: string): boolean {
  return /おすすめ|楽しめる|必見|魅力的|堪能|見どころ|見逃せない|向いている/.test(text);
}
