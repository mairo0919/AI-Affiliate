/**
 * SOURCE RESOLUTION — DETAIL_DENSITY for expansion depth (not banned-word HOW).
 *
 * RICH → allow longer, scene-level development from recorded facts.
 * THEME → concise membership/composition; do not pad to RICH length.
 * METADATA → shortest; quantity/cast/form only.
 */

export type SourceResolution =
  | "RICH_SCENE_EVIDENCE"
  | "THEME_LEVEL_EVIDENCE"
  | "METADATA_ONLY";

/** How far Planner/Writer may expand for this SOURCE density. */
export type SourceExpansionPolicy = {
  resolution: SourceResolution;
  /** Hard-ish ceiling on body.facts after selection. */
  maxBodyFacts: number;
  /** Max short genre/play/membership tags kept in body plan. */
  maxThemeTagFacts: number;
  /**
   * When false, omitting leftover short GENRE_TAG/ACTION tags is not PLAN_FACT_OMISSION.
   * Identity / quantity / long description facts stay mandatory.
   */
  requireAllThemeTagCoverage: boolean;
  /** Compact Writer-visible density permission (not a paragraph template). */
  writerDensityNote: string;
};

const SCENE_VERB_RE =
  /(?:する|させる|される|され|抱|喘|絶頂|寝取|誘惑|責め|挿入|性交|咥|舐め|突き|イキ|屈服|わからせ|お仕置き)/u;

const THEME_OR_PLAY_RE =
  /人妻|NTR|痴女|追撃ピストン|わからせ|杭打ち|騎乗|中出し|パイズリ|巨乳|淫乱|ハード|主婦|熟女|美少女|ギャル|SM|OL/u;

const META_FORM_RE =
  /ベスト|総集編|シリーズ|単体|メーカー|レーベル|時間|コーナー|タイトル|デビュー|周年/u;

/** Short membership / play / body genre tags — not scene scripts. */
export const SHORT_THEME_OR_PLAY_TAG_RE =
  /^(?:人妻|人妻・主婦|NTR|痴女|熟女|美少女|女子校生|ギャル|OL|SM|淫乱・ハード系|淫乱|ハード系|パイズリ|巨乳|追撃ピストン|女優ベスト・総集編)$/iu;

export function detectSourceResolution(facts: readonly string[]): SourceResolution {
  const cleaned = facts.map((f) => f.trim()).filter(Boolean);
  if (cleaned.length === 0) return "METADATA_ONLY";

  const hasRichScene = cleaned.some((f) => {
    if (f.length < 12) return false;
    if (!SCENE_VERB_RE.test(f)) return false;
    // Exclude pure career/promo lines
    if (/映画や舞台|絶賛活躍|最高傑作/.test(f) && !THEME_OR_PLAY_RE.test(f)) return false;
    // Short membership tags alone are not scene scripts
    if (isShortThemeOrPlayTag(f)) return false;
    return true;
  });
  if (hasRichScene) return "RICH_SCENE_EVIDENCE";

  const hasTheme = cleaned.some(
    (f) => THEME_OR_PLAY_RE.test(f) || (/・/.test(f) && THEME_OR_PLAY_RE.test(f)),
  );
  if (hasTheme) return "THEME_LEVEL_EVIDENCE";

  const mostlyMeta = cleaned.every(
    (f) => META_FORM_RE.test(f) || /^\d+/.test(f) || f.length <= 12,
  );
  return mostlyMeta ? "METADATA_ONLY" : "THEME_LEVEL_EVIDENCE";
}

export function expansionPolicyForResolution(
  resolution: SourceResolution,
): SourceExpansionPolicy {
  switch (resolution) {
    case "RICH_SCENE_EVIDENCE":
      return {
        resolution,
        maxBodyFacts: 18,
        maxThemeTagFacts: 10,
        requireAllThemeTagCoverage: true,
        writerDensityNote:
          "SOURCE is RICH: develop recorded scene/play/detail naturally across paragraphs. Do not invent beyond planned facts. Length follows material — do not pad empty prose.",
      };
    case "THEME_LEVEL_EVIDENCE":
      return {
        resolution,
        maxBodyFacts: 10,
        maxThemeTagFacts: 4,
        requireAllThemeTagCoverage: false,
        writerDensityNote:
          "SOURCE is THEME_LEVEL (membership/quantity/form, not scene scripts). Prefer a concise natural intro (often 2 short paragraphs). Select representative planned tags — do not explain every genre, do not invent roles/scenes/relationships to fill length. Stop when the product is clearly introduced; short is OK when complete.",
      };
    case "METADATA_ONLY":
      return {
        resolution,
        maxBodyFacts: 6,
        maxThemeTagFacts: 2,
        requireAllThemeTagCoverage: false,
        writerDensityNote:
          "SOURCE is METADATA_ONLY: keep the article short — cast, quantity, product form. Do not force adult scene concreteness. Stop when identity and scale are clear.",
      };
  }
}

export function sourceResolutionWriterGuidance(
  resolution: SourceResolution,
): string {
  return expansionPolicyForResolution(resolution).writerDensityNote;
}

/** Score short tags for representative selection (higher = keep first). */
export function themeTagSelectionScore(fact: string): number {
  const f = fact.trim();
  let s = f.length;
  if (/パイズリ|追撃ピストン|わからせ|絶対空域|お仕置き/.test(f)) s += 40;
  if (/人妻・主婦|淫乱・ハード系|小悪魔痴女|ギャル妹/.test(f)) s += 24;
  if (/NTR|痴女|巨乳/.test(f)) s += 12;
  if (/女優ベスト|総集編/.test(f)) s += 4;
  return s;
}

/**
 * Keep up to maxTags diverse short theme/play labels; drop the rest.
 * Soft-dedupe: prefer longer compound over contained stem (人妻・主婦 > 人妻).
 */
export function selectRepresentativeThemeTags(
  tags: readonly string[],
  maxTags: number,
): string[] {
  if (maxTags <= 0 || tags.length === 0) return [];
  const cleaned = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  // Drop stems covered by a longer tag
  const drop = new Set<string>();
  for (const a of cleaned) {
    for (const b of cleaned) {
      if (a !== b && b.includes(a) && b.length > a.length) drop.add(a);
    }
  }
  const candidates = cleaned.filter((t) => !drop.has(t));
  candidates.sort((a, b) => themeTagSelectionScore(b) - themeTagSelectionScore(a));
  return candidates.slice(0, maxTags);
}

export function isShortThemeOrPlayTag(fact: string): boolean {
  return SHORT_THEME_OR_PLAY_TAG_RE.test((fact ?? "").trim());
}
