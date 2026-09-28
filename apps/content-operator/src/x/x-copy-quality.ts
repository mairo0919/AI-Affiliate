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
    /出演作では|が出演する|という状況設定|状況設定が特徴|状況設定が明確|として制作されて|一環として制作され|出演して|の設定|特徴|公式情報|確認でき|明らかになって|という点|本作|視点が一貫|登場/u.test(
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

/** Quoted span that is only a title with the spaces removed. */
export function hasQuotedTitleFragment(text: string): boolean {
  for (const match of text.matchAll(/「([^」]{10,})」/gu)) {
    const inner = match[1] ?? "";
    if (!/[はがをにで]/u.test(inner)) return true;
  }
  return false;
}
