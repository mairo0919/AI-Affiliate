/**
 * Daily content mix slot — not a fixed weekday rotation.
 * Uses recent publication history + configurable weights.
 */

import type { ReleaseAgeBucket } from "./release-age.js";

export type ContentMixSlot = "RECENT_PRODUCT" | "MID_PRODUCT" | "OLDER_PRODUCT" | "RANKING";

export interface ContentMixWeights {
  recent: number;
  mid: number;
  older: number;
  ranking: number;
}

export interface MixHistoryEntry {
  slot: ContentMixSlot;
  at: string; // ISO
}

export function slotToAgeBucket(slot: ContentMixSlot): ReleaseAgeBucket | null {
  switch (slot) {
    case "RECENT_PRODUCT":
      return "RECENT";
    case "MID_PRODUCT":
      return "MID";
    case "OLDER_PRODUCT":
      return "OLDER";
    default:
      return null;
  }
}

/**
 * Prefer under-represented slots vs recent history; weighted among underfilled.
 * Ranking only when rankingAllowed and rankingDue.
 */
export function chooseContentMixSlot(input: {
  weights: ContentMixWeights;
  recentSlots: ContentMixSlot[];
  rankingAllowed: boolean;
  rankingDue: boolean;
  /** Deterministic salt (e.g. tokyo date) for stable tie-break — not a weekday calendar. */
  dayKey: string;
}): { slot: ContentMixSlot; reason: string } {
  const counts: Record<ContentMixSlot, number> = {
    RECENT_PRODUCT: 0,
    MID_PRODUCT: 0,
    OLDER_PRODUCT: 0,
    RANKING: 0,
  };
  for (const s of input.recentSlots) counts[s] += 1;

  const candidates: Array<{ slot: ContentMixSlot; weight: number; deficit: number }> = [
    { slot: "RECENT_PRODUCT", weight: input.weights.recent, deficit: 0 },
    { slot: "MID_PRODUCT", weight: input.weights.mid, deficit: 0 },
    { slot: "OLDER_PRODUCT", weight: input.weights.older, deficit: 0 },
  ];
  if (input.rankingAllowed && input.rankingDue) {
    candidates.push({ slot: "RANKING", weight: input.weights.ranking, deficit: 0 });
  }

  const totalRecent = Math.max(1, input.recentSlots.length);
  for (const c of candidates) {
    const share = counts[c.slot] / totalRecent;
    const target = c.weight / Math.max(1e-6, sumWeights(input.weights, input.rankingAllowed && input.rankingDue));
    c.deficit = target - share;
  }

  candidates.sort((a, b) => {
    if (Math.abs(b.deficit - a.deficit) > 1e-9) return b.deficit - a.deficit;
    if (Math.abs(b.weight - a.weight) > 1e-9) return b.weight - a.weight;
    return hashTie(input.dayKey, a.slot) - hashTie(input.dayKey, b.slot);
  });

  const top = candidates[0]!;
  return {
    slot: top.slot,
    reason: `mix_deficit=${top.deficit.toFixed(3)};weight=${top.weight};day=${input.dayKey}`,
  };
}

function sumWeights(w: ContentMixWeights, includeRanking: boolean): number {
  return w.recent + w.mid + w.older + (includeRanking ? w.ranking : 0);
}

function hashTie(dayKey: string, slot: string): number {
  let h = 0;
  const s = `${dayKey}:${slot}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
