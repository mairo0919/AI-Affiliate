/**
 * NEW_RELEASE_SINGLE Source Discovery query strategy.
 * Goal: find single AV work review/intro articles — NOT FANZA service reviews.
 */

export type DiscoveryQueryRound = {
  round: number;
  family: string;
  purpose: string;
  queries: string[];
};

/**
 * Adaptive query families for single-product AV article discovery.
 * Negatives push away service/subscription/ranking/portal intent.
 */
export const NEW_RELEASE_SINGLE_QUERY_STRATEGY: DiscoveryQueryRound[] = [
  {
    round: 1,
    family: "generic_single_review",
    purpose: "Single AV work review / impression articles",
    queries: [
      'AV 作品 レビュー 感想 品番 -ランキング -比較 -"FANZA TV" -月額 -料金 -サイト',
      'AV 新作 一本 レビュー 感想 -ランキング -ベスト -月額 -サービス -まとめ',
      'アダルトビデオ 作品名 レビュー 感想 -比較 -料金 -登録 -ポータル',
    ],
  },
  {
    round: 2,
    family: "highlights_midori",
    purpose: "Work-level midokoro / highlights framing",
    queries: [
      'AV 見どころ レビュー 感想 作品 -ランキング -月額 -"FANZA TV" -まとめ',
      'AV 作品 紹介 見どころ 感想 レビュー -比較 -料金 -使い方 -サイト',
      'FANZA 作品 感想 レビュー AV -"FANZA TV" -料金 -比較 -月額 -評判 -ランキング',
    ],
  },
  {
    round: 3,
    family: "actress_work_review",
    purpose: "Actress + single work review (not catalog lists)",
    queries: [
      "AV 女優 作品 レビュー 感想 一本 -ランキング -ベスト -比較 -一覧",
      "AV 出演作 レビュー 感想 見どころ -月額 -料金 -サービス -まとめ",
      "成人向け 動画 作品 レビュー 感想 品番 -比較サイト -登録 -ランキング",
    ],
  },
  {
    round: 4,
    family: "domain_diversity",
    purpose: "Reduce note.com bias; seek non-note single reviews",
    queries: [
      'AV 作品 レビュー 感想 見どころ -site:note.com -ランキング -"FANZA TV" -月額 -まとめ',
      'アダルトビデオ 一本 レビュー 感想 -site:note.com -比較 -料金 -サイト',
      'AV 品番 レビュー 感想 -site:note.com -サービス -評判 -ランキング',
    ],
  },
];

/** @deprecated Prefer NEW_RELEASE_SINGLE_QUERY_STRATEGY rounds */
export const DEFAULT_SINGLE_DISCOVERY_QUERIES: string[] =
  NEW_RELEASE_SINGLE_QUERY_STRATEGY.flatMap((r) => r.queries);

export function listNewReleaseSingleQueries(options?: {
  maxRounds?: number;
  maxQueries?: number;
  overrideQueries?: string[];
}): { rounds: DiscoveryQueryRound[]; flatQueries: string[] } {
  if (options?.overrideQueries?.length) {
    const round: DiscoveryQueryRound = {
      round: 1,
      family: "override",
      purpose: "CLI/test override queries",
      queries: options.overrideQueries,
    };
    return { rounds: [round], flatQueries: [...options.overrideQueries] };
  }
  const maxRounds = Math.max(1, options?.maxRounds ?? NEW_RELEASE_SINGLE_QUERY_STRATEGY.length);
  const rounds = NEW_RELEASE_SINGLE_QUERY_STRATEGY.filter((r) => r.round <= maxRounds);
  let flat = rounds.flatMap((r) => r.queries);
  if (options?.maxQueries != null && options.maxQueries > 0) {
    flat = flat.slice(0, options.maxQueries);
    const limited: DiscoveryQueryRound[] = [];
    let used = 0;
    for (const r of rounds) {
      if (used >= options.maxQueries) break;
      const q = r.queries.slice(0, options.maxQueries - used);
      if (q.length === 0) break;
      limited.push({ ...r, queries: q });
      used += q.length;
    }
    return { rounds: limited, flatQueries: flat };
  }
  return { rounds, flatQueries: flat };
}
