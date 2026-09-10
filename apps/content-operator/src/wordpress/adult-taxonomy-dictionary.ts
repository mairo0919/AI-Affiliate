/**
 * Provider-agnostic adult attribute taxonomy dictionary.
 * Canonical terms + aliases for Evidence-backed tag extraction.
 * Do not invent terms — only match text/labels that appear in Research Evidence.
 */

export type AdultTaxonomyTermType =
  | "body"
  | "role"
  | "situation"
  | "play"
  | "format"
  | "work_type";

export type AdultTaxonomyTerm = {
  canonicalName: string;
  aliases: string[];
  type: AdultTaxonomyTermType;
  /** Higher = preferred when collapsing near-duplicates. */
  priority: number;
  /**
   * Optional ASCII hint for stable WP tag slug (t-{hint}).
   * Not a translation for display — display name stays Japanese canonicalName.
   */
  asciiHint?: string;
};

/**
 * Managed dictionary. Extend here (or replace with JSON loader later).
 * Keep Category coarse — these terms are Tag candidates only.
 */
export const ADULT_TAXONOMY_DICTIONARY: readonly AdultTaxonomyTerm[] = [
  // body
  {
    canonicalName: "巨乳",
    aliases: ["巨乳", "きょにゅう"],
    type: "body",
    priority: 100,
    asciiHint: "kyonyu",
  },
  {
    canonicalName: "爆乳",
    aliases: ["爆乳"],
    type: "body",
    priority: 95,
    asciiHint: "bakunyuu",
  },
  {
    canonicalName: "美乳",
    aliases: ["美乳"],
    type: "body",
    priority: 90,
    asciiHint: "binyuu",
  },
  {
    canonicalName: "スレンダー",
    aliases: ["スレンダー", "スリム"],
    type: "body",
    priority: 80,
    asciiHint: "slender",
  },
  // role / persona
  {
    canonicalName: "人妻",
    aliases: ["人妻", "ひとづま"],
    type: "role",
    priority: 100,
    asciiHint: "hitozuma",
  },
  {
    canonicalName: "熟女",
    aliases: ["熟女", "じゅくじょ"],
    type: "role",
    priority: 95,
    asciiHint: "jukujo",
  },
  {
    canonicalName: "若妻",
    aliases: ["若妻"],
    type: "role",
    priority: 90,
    asciiHint: "wakazuma",
  },
  {
    canonicalName: "ギャル",
    aliases: ["ギャル", "gal"],
    type: "role",
    priority: 90,
    asciiHint: "gal",
  },
  {
    canonicalName: "痴女",
    aliases: ["痴女", "ちじょ"],
    type: "role",
    priority: 95,
    asciiHint: "chijo",
  },
  {
    canonicalName: "素人",
    aliases: ["素人", "しろうと"],
    type: "role",
    priority: 90,
    asciiHint: "shirouto",
  },
  {
    canonicalName: "お姉さん",
    aliases: ["お姉さん", "おねえさん", "お姉様"],
    type: "role",
    priority: 70,
    asciiHint: "oneesan",
  },
  {
    canonicalName: "OL",
    aliases: ["OL", "オーエル", "オフィスレディ"],
    type: "role",
    priority: 85,
    asciiHint: "ol",
  },
  {
    canonicalName: "女教師",
    aliases: ["女教師", "女の先生"],
    type: "role",
    priority: 90,
    asciiHint: "jokyoshi",
  },
  {
    canonicalName: "ナース",
    aliases: ["ナース", "看護婦", "看護師"],
    type: "role",
    priority: 80,
    asciiHint: "nurse",
  },
  {
    canonicalName: "制服",
    aliases: ["制服"],
    type: "situation",
    priority: 70,
    asciiHint: "seifuku",
  },
  {
    canonicalName: "メイド",
    aliases: ["メイド"],
    type: "role",
    priority: 75,
    asciiHint: "maid",
  },
  // situation / play
  {
    canonicalName: "メンエス",
    aliases: ["メンエス", "メンズエステ", "mens esthe", "men's esthe"],
    type: "situation",
    priority: 100,
    asciiHint: "menes",
  },
  {
    canonicalName: "ナンパ",
    aliases: ["ナンパ", "ナンパ待ち"],
    type: "situation",
    priority: 90,
    asciiHint: "nanpa",
  },
  {
    canonicalName: "NTR",
    aliases: ["NTR", "寝取り", "寝取られ", "ねとられ", "ねとり"],
    type: "play",
    priority: 95,
    asciiHint: "ntr",
  },
  {
    canonicalName: "エステ",
    aliases: ["エステ", "マッサージ", "リフレ"],
    type: "situation",
    priority: 60,
    asciiHint: "esthe",
  },
  // format / work type
  {
    canonicalName: "デビュー",
    aliases: ["デビュー", "DEBUT", "Debut", "新人"],
    type: "format",
    priority: 90,
    asciiHint: "debut",
  },
  {
    canonicalName: "ベスト",
    aliases: ["ベスト", "BEST", "Best"],
    type: "format",
    priority: 85,
    asciiHint: "best",
  },
  {
    canonicalName: "総集編",
    aliases: ["総集編"],
    type: "format",
    priority: 85,
    asciiHint: "soshuhen",
  },
  {
    canonicalName: "完全版",
    aliases: ["完全版", "COMPLETE", "Complete"],
    type: "format",
    priority: 80,
    asciiHint: "kanzenban",
  },
  {
    canonicalName: "VR",
    aliases: ["VR", "ＶＲ"],
    type: "work_type",
    priority: 95,
    asciiHint: "vr",
  },
  {
    canonicalName: "単体作品",
    aliases: ["単体作品", "単体"],
    type: "work_type",
    priority: 80,
    asciiHint: "tantai",
  },
  {
    canonicalName: "企画",
    aliases: ["企画"],
    type: "work_type",
    priority: 70,
    asciiHint: "kikaku",
  },
  {
    canonicalName: "8時間",
    aliases: ["8時間", "８時間"],
    type: "format",
    priority: 60,
    asciiHint: "8hours",
  },
  {
    canonicalName: "4時間",
    aliases: ["4時間", "４時間"],
    type: "format",
    priority: 60,
    asciiHint: "4hours",
  },
] as const;

export function adultTaxonomyCanonicalCount(): number {
  return ADULT_TAXONOMY_DICTIONARY.length;
}

export function adultTaxonomyAliasCount(): number {
  return ADULT_TAXONOMY_DICTIONARY.reduce((n, t) => n + t.aliases.length, 0);
}
