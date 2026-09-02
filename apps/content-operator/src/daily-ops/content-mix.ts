/**
 * Daily content mix — randomized with anti-bias from publication history.
 * Not a fixed weekday calendar. Ranking order stays deterministic (Analysis scores).
 *
 * Writer format remains NEW_RELEASE_SINGLE; mix slots steer *which* product/performer
 * is selected, not a new Writer taxonomy.
 */

import type { ReleaseAgeBucket } from "./release-age.js";

export type ContentMixSlot =
  | "SINGLE_PRODUCT"
  | "POPULAR_RANKING"
  | "PERFORMER_RANKING"
  | "NEW_RELEASE"
  | "OLDER_TITLE";

/** @deprecated legacy history values — normalize via normalizeMixSlot */
export type LegacyContentMixSlot =
  | "RECENT_PRODUCT"
  | "MID_PRODUCT"
  | "OLDER_PRODUCT"
  | "RANKING";

export interface ContentMixWeights {
  singleProduct: number;
  popularRanking: number;
  performerRanking: number;
  newRelease: number;
  olderTitle: number;
}

export interface MixHistoryEntry {
  slot: ContentMixSlot;
  at: string;
}

const ALL_SLOTS: ContentMixSlot[] = [
  "SINGLE_PRODUCT",
  "POPULAR_RANKING",
  "PERFORMER_RANKING",
  "NEW_RELEASE",
  "OLDER_TITLE",
];

export function normalizeMixSlot(raw: unknown): ContentMixSlot | null {
  if (typeof raw !== "string") return null;
  switch (raw) {
    case "SINGLE_PRODUCT":
    case "POPULAR_RANKING":
    case "PERFORMER_RANKING":
    case "NEW_RELEASE":
    case "OLDER_TITLE":
      return raw;
    case "RECENT_PRODUCT":
      return "NEW_RELEASE";
    case "MID_PRODUCT":
      return "SINGLE_PRODUCT";
    case "OLDER_PRODUCT":
      return "OLDER_TITLE";
    case "RANKING":
      return "POPULAR_RANKING";
    default:
      return null;
  }
}

export function slotToAgeBucket(slot: ContentMixSlot): ReleaseAgeBucket | null {
  switch (slot) {
    case "NEW_RELEASE":
      return "RECENT";
    case "OLDER_TITLE":
      return "OLDER";
    case "SINGLE_PRODUCT":
      return "MID";
    case "POPULAR_RANKING":
    case "PERFORMER_RANKING":
      return null;
    default:
      return null;
  }
}

export type MixSortMode = "default" | "popularity" | "performer";

export function slotToSortMode(slot: ContentMixSlot): MixSortMode {
  switch (slot) {
    case "POPULAR_RANKING":
      return "popularity";
    case "PERFORMER_RANKING":
      return "performer";
    default:
      return "default";
  }
}

/**
 * Prefer under-represented slots vs recent history; weighted + day/channel salt for ties.
 * Optional excludeSlot avoids forcing Blog/X to the same type on the same day.
 */
export function chooseContentMixSlot(input: {
  weights: ContentMixWeights;
  recentSlots: ContentMixSlot[];
  dayKey: string;
  /** Blog vs X — different salt so same-day picks can diverge */
  channelSalt?: string;
  /** Soft avoid (e.g. Blog already took this type today) */
  excludeSlot?: ContentMixSlot | null;
  /** Extra entropy 0..1; default from dayKey hash */
  randomUnit?: number;
}): { slot: ContentMixSlot; reason: string } {
  const counts = emptyCounts();
  for (const s of input.recentSlots) counts[s] += 1;

  const candidates = ALL_SLOTS.map((slot) => ({
    slot,
    weight: weightFor(slot, input.weights),
    deficit: 0,
  })).filter((c) => c.weight > 0);

  const totalW = candidates.reduce((s, c) => s + c.weight, 0) || 1;
  const totalRecent = Math.max(1, input.recentSlots.length);
  for (const c of candidates) {
    const share = counts[c.slot] / totalRecent;
    const target = c.weight / totalW;
    c.deficit = target - share;
  }

  const salt = `${input.dayKey}:${input.channelSalt ?? "ALL"}`;
  const rnd =
    typeof input.randomUnit === "number" && Number.isFinite(input.randomUnit)
      ? Math.min(1, Math.max(0, input.randomUnit))
      : hashUnit(salt);

  candidates.sort((a, b) => {
    // Soft demote excluded slot without hard ban
    const aEx = input.excludeSlot === a.slot ? -0.15 : 0;
    const bEx = input.excludeSlot === b.slot ? -0.15 : 0;
    const aScore = a.deficit + aEx + rnd * 0.08 * hashUnit(`${salt}:${a.slot}`);
    const bScore = b.deficit + bEx + rnd * 0.08 * hashUnit(`${salt}:${b.slot}`);
    if (Math.abs(bScore - aScore) > 1e-9) return bScore - aScore;
    return hashTie(salt, a.slot) - hashTie(salt, b.slot);
  });

  const top = candidates[0]!;
  return {
    slot: top.slot,
    reason: `mix_deficit=${top.deficit.toFixed(3)};weight=${top.weight};day=${input.dayKey};ch=${input.channelSalt ?? "ALL"}`,
  };
}

function emptyCounts(): Record<ContentMixSlot, number> {
  return {
    SINGLE_PRODUCT: 0,
    POPULAR_RANKING: 0,
    PERFORMER_RANKING: 0,
    NEW_RELEASE: 0,
    OLDER_TITLE: 0,
  };
}

function weightFor(slot: ContentMixSlot, w: ContentMixWeights): number {
  switch (slot) {
    case "SINGLE_PRODUCT":
      return w.singleProduct;
    case "POPULAR_RANKING":
      return w.popularRanking;
    case "PERFORMER_RANKING":
      return w.performerRanking;
    case "NEW_RELEASE":
      return w.newRelease;
    case "OLDER_TITLE":
      return w.olderTitle;
  }
}

function hashTie(dayKey: string, slot: string): number {
  let h = 0;
  const s = `${dayKey}:${slot}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function hashUnit(s: string): number {
  return (hashTie(s, "") % 10_000) / 10_000;
}

/** Legacy config shape → R72 weights */
export function migrateLegacyMixWeights(legacy: {
  recent?: number;
  mid?: number;
  older?: number;
  ranking?: number;
}): ContentMixWeights {
  return {
    singleProduct: legacy.mid ?? 0.25,
    popularRanking: legacy.ranking ?? 0.15,
    performerRanking: 0.15,
    newRelease: legacy.recent ?? 0.25,
    olderTitle: legacy.older ?? 0.2,
  };
}
