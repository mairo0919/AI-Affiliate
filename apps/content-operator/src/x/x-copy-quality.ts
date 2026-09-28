/**
 * Structural X copy quality.
 * Detects broken phrases and title-fragment sentences without a fixed product list.
 */

/** Long title compound with no case particle. Too easy to paste as a sentence. */
export function isParticleFreeTitleStack(text: string): boolean {
  const s = text.replace(/\s+/gu, "");
  return s.length >= 16 && !/[はがをにで]/u.test(s);
}

/** Noun + の + を left behind when a word was deleted. Nominalizers (もの / こと / verb) are kept. */
export function hasParticleHole(text: string): boolean {
  const s = text.replace(/\s+/gu, "");
  if (!s) return false;
  if (/[^るたないてでもと]のを/u.test(s)) return true;
  if (/[をが][をが]/u.test(s)) return true;
  if (/にを/u.test(s)) return true;
  return false;
}

/**
 * A title run pasted as one noun: long, no case particle, often joined with ＆
 * or with the spaces removed.
 */
export function isTitleFragmentRun(text: string): boolean {
  const s = text.replace(/[「」『』\s]/gu, "");
  if (s.length < 18) return false;
  if (/[はがをにで]/u.test(s)) return false;
  if (/[＆&]/u.test(text)) return true;
  if (s.length >= 28 && !/(?:です|ます|した|している|される)$/u.test(s)) return true;
  return false;
}

/** Mass-produced explainer frames. A normal clause with a subject and predicate does not match. */
export function isTemplateExplainer(text: string): boolean {
  if (
    /出演作では|が出演する[^。]{0,20}作品|作品では|という状況設定|状況設定が特徴|状況設定が明確|として制作されて|一環として制作され|が特徴|は特徴|も特徴|展開され/u.test(
      text,
    )
  ) {
    return true;
  }
  if (/では[、，][^。]{0,80}が特徴です/u.test(text)) return true;
  if (
    /が特徴です|点が特徴|登場して|が登場した|タイトル通り|公式設定が紹介|をまとめて楽しめる|からリリースされて|進化を続ける|まとめられています|振り返ることが/u.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

const STRUCTURAL_CONTENT_WORD =
  /^(?:作品|紹介|収録|出演|企画|シリーズ|焦点|ベスト|総集|配信|限定|時間|ボリューム|タイトル)$/u;

/**
 * A kanji word in the post that is not in the safe facts, the performer, or the small set of framing words.
 * This catches a new scene, feeling, or viewpoint that the planner did not pass through.
 */
export function ungroundedContentWord(text: string, grounded: string): string | null {
  const tokens = text.match(/[一-龯]{2,}/gu) ?? [];
  for (const token of tokens) {
    if (STRUCTURAL_CONTENT_WORD.test(token)) continue;
    if (grounded.includes(token)) continue;
    return token;
  }
  const kana = text.match(/[ァ-ヶー]{3,}/gu) ?? [];
  for (const token of kana) {
    if (grounded.includes(token)) continue;
    return token;
  }
  return null;
}

const SOURCE_PHRASE_SPLIT = /[！!？?。．…／/|｜＆&]+|\s+/u;

/** Phrases as they appear in the source, without deleting the separators. */
export function sourcePhrases(text: string): string[] {
  return text
    .split(SOURCE_PHRASE_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

/**
 * A writer fact may be a contiguous slice of a source string,
 * or a measured catalog reading (runtime, cast count, best-of) of that source.
 * A string created by deleting a word, or by deleting spaces between phrases, is not a fact.
 */
export function isExpressionSafeFact(fact: string, sources: string[]): boolean {
  const value = fact.trim();
  if (!value || hasParticleHole(value)) return false;
  if (isTitleFragmentRun(value) || isParticleFreeTitleStack(value)) return false;
  if (isFaithfulCatalogReading(value, sources)) return true;
  return sources.some((source) => source.includes(value));
}

/** Runtime / cast-count / compilation shape copied from a number or label that is actually in the source. */
export function isFaithfulCatalogReading(fact: string, sources: string[]): boolean {
  const blob = sources.join("\n");
  const hours = /^(\d+(?:\.\d+)?)時間の収録ボリューム$/u.exec(fact);
  if (hours && new RegExp(`(?<![\\d.])${hours[1].replace(".", "\\.")}\\s*時間`, "u").test(blob)) {
    return true;
  }
  const people = /^(\d+)名が出演する企画$/u.exec(fact);
  if (people && new RegExp(`(?<![\\d.])${people[1]}\\s*名`, "u").test(blob)) return true;
  if (fact === "複数タイトルを横断した総集編" && /BEST|ベスト|総集編/iu.test(blob)) return true;
  return false;
}

/**
 * Body contains two source phrases joined by deleting the separator that stood between them.
 */
export function hasJoinedSourcePhrases(body: string, source: string): boolean {
  const phrases = sourcePhrases(source).filter((part) => part.length >= 4);
  const compactBody = body.replace(/[\s「」『』“”"]/gu, "");
  for (let i = 0; i < phrases.length - 1; i += 1) {
    const glued = `${phrases[i] ?? ""}${phrases[i + 1] ?? ""}`;
    if (glued.length < 10) continue;
    if (source.includes(glued)) continue;
    if (compactBody.includes(glued)) return true;
  }
  return false;
}

/** Quoted span that is only a title with the spaces removed. */
export function hasQuotedTitleFragment(text: string): boolean {
  for (const match of text.matchAll(/「([^」]{10,})」/gu)) {
    const inner = match[1] ?? "";
    if (!/[はがをにで]/u.test(inner)) return true;
  }
  return false;
}
