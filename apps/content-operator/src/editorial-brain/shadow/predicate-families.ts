/**
 * Predicate / relation families for semantic assertion review.
 * Surface phrases are candidate signals; final failure codes stay on EDITORIAL_FAILURE_CODES.
 *
 * Principle: detecting "向いている" is not the goal —
 * detecting an unsupported audience-suitability / evaluation relation is.
 */

export type PredicateFamily =
  | "FACTUAL_ATTRIBUTE"
  | "EVENT_OR_SCENE"
  | "IDENTITY"
  | "SETTING"
  | "EVALUATION"
  | "SUITABILITY"
  | "RECOMMENDATION"
  | "SOCIAL_PROOF"
  | "COMPARISON"
  | "CAUSAL_INTERPRETATION"
  | "FILLER_META"
  | "OTHER";

/** Internal repetition classification — not new failure taxonomy codes. */
export type RepetitionKind =
  | "FULL_RESTATEMENT"
  | "PARTIAL_OVERLAP_WITH_GAIN"
  | "ROLE_EXPECTED_RECAP"
  | "NONE";

/** Setting / world-building relations not entailed by a bare name. */
export const SETTING_RELATION_RE =
  /を舞台に|舞台にした|舞台として|シチュエーション|屋外プール|水着姿で|でナンパされる|ナンパされる設定|をテーマに|テーマとなって/;

/**
 * Evaluation / desirability / attractiveness — unsupported unless Claim states the same relation.
 * Covers conjugations (向いている / 向いています / 向き).
 */
export const EVALUATION_RELATION_RE =
  /魅力を高|魅力を活|魅力を堪能|が魅力|魅力的|彼女の魅力|存在感を|存在感が|興味深い|興味を引|ギャップが魅力|刺激的なシーンが展開|セールスポイント|インパクト|見どころ|見応え|価値があ|優れてい|際立つ魅力|として知られ|特別な時間|禁断のドラマ|織りなす|質の高い|質の高さ|専門性の高い|統一感|が期待さ|が魅せる|を魅せる|印象を与え|強い印象|が際立つ|を際立た|を活かした|を活かし|が強調|多角的に表現|魅力が/;

/** Audience suitability / preference matching / targeting. */
export const SUITABILITY_RELATION_RE =
  /に向いてい|向いています|向いている|向きです|に適した|適した作品|適している|適していま|求める(人|方|視聴者|読者)|好む(人|方)|ファンにとっ|を探している方|選びやす|選ばれやす|視聴者に向|読者に向/;

/** Recommendation / endorsement / urgency CTA copy (not a supported fact). */
export const RECOMMENDATION_RELATION_RE =
  /おすすめできる|おすすめです|おすすめの|お勧め|推奨|注目すべき|チェックすべき|必見|お見逃しなく|今すぐチェック|今すぐ確認|見逃せない|堪能しよう/;

/** Enjoyment / experience-value judgment. */
export const ENJOYMENT_RELATION_RE =
  /楽しめます|楽しめる|楽しめる内容|楽しめる作品|楽しめる展開|堪能できる|堪能し/;

/** Interpretive / contrastive invented relations. */
export const INTERPRETIVE_RELATION_RE =
  /見た目とは裏腹|ながら.{0,12}(感度|刺激|過激)|ギャップが|意外に|一見.{0,8}実際/;

/**
 * Fabricated objective social proof — rankings, sales, review scores, user counts,
 * awards, ordinal #1 claims. Generic promotional "人気" / "有名" is NOT social-proof fraud.
 */
export const SOCIAL_PROOF_RELATION_RE =
  /売上(?:ランキング|実績|No\.?1|第?\s*1\s*位)|(?:総合|週間|月間|FANZA|アダルト)?ランキング\s*(?:1位|第1位|一位|トップ|入賞)|レビュー(?:高評価|評価\s*[45]\.?[05]?|星\s*[45])|(?:\d+[万人]+(?:人|名)?|累計\d+)(?:が|も)?(?:購入|視聴|利用)|受賞|グランプリ|No\.?\s*1|ナンバーワン|第\s*1\s*位|売上No|口コミ\s*\d+\s*件/;

export const FILLER_META_RELATION_RE =
  /ぜひチェック|詳しく確認|より深く理解|より深く内容|興味を持った方は|について紹介|本記事では|この記事では|作品ページで確認|詳細を作品ページ/;

export const CATALOG_READOUT_RE =
  /シリーズ名は|出演者として|レーベルは|配信状態は|AVAILABLE|SUPPORTED/;

export function detectPredicateFamilies(text: string): PredicateFamily[] {
  const out = new Set<PredicateFamily>();
  if (SETTING_RELATION_RE.test(text)) out.add("SETTING");
  if (EVALUATION_RELATION_RE.test(text)) out.add("EVALUATION");
  if (SUITABILITY_RELATION_RE.test(text)) out.add("SUITABILITY");
  if (RECOMMENDATION_RELATION_RE.test(text)) out.add("RECOMMENDATION");
  if (ENJOYMENT_RELATION_RE.test(text)) out.add("EVALUATION");
  if (INTERPRETIVE_RELATION_RE.test(text)) out.add("CAUSAL_INTERPRETATION");
  if (SOCIAL_PROOF_RELATION_RE.test(text)) out.add("SOCIAL_PROOF");
  if (FILLER_META_RELATION_RE.test(text)) out.add("FILLER_META");
  if (out.size === 0) out.add("OTHER");
  return [...out];
}

/** True when assertion asserts evaluation / suitability / recommendation / enjoyment. */
export function hasEvaluativeRelation(text: string): boolean {
  return (
    EVALUATION_RELATION_RE.test(text) ||
    SUITABILITY_RELATION_RE.test(text) ||
    RECOMMENDATION_RELATION_RE.test(text) ||
    ENJOYMENT_RELATION_RE.test(text)
  );
}

export function hasInterpretiveRelation(text: string): boolean {
  return INTERPRETIVE_RELATION_RE.test(text);
}

export function claimStatesEvaluativeRelation(statement: string): boolean {
  return hasEvaluativeRelation(statement);
}

export function claimStatesInterpretiveRelation(statement: string): boolean {
  return hasInterpretiveRelation(statement);
}

export function isRoleExpectedRecap(sourceSegment: string): boolean {
  return sourceSegment === "summary" || sourceSegment === "title";
}

/**
 * Decide whether facet reuse is a blocking restatement.
 * Same claimId / shared facets alone are not enough — informational contribution matters.
 */
export function classifyRepetitionKind(input: {
  sourceSegment: string;
  novelFacetCount: number;
  reusedFacetCount: number;
  primarySupportType: string;
}): RepetitionKind {
  if (isRoleExpectedRecap(input.sourceSegment)) {
    return input.novelFacetCount === 0 && input.reusedFacetCount > 0
      ? "ROLE_EXPECTED_RECAP"
      : "NONE";
  }
  if (input.novelFacetCount > 0 && input.reusedFacetCount > 0) {
    return "PARTIAL_OVERLAP_WITH_GAIN";
  }
  if (input.novelFacetCount > 0) return "NONE";
  if (input.reusedFacetCount > 0) {
    // Evaluative/interpretive primary failures are not also FULL_RESTATEMENT
    if (
      input.primarySupportType === "EVALUATIVE" ||
      input.primarySupportType === "INTERPRETIVE" ||
      input.primarySupportType === "NAME_DERIVED" ||
      input.primarySupportType === "UNSUPPORTED"
    ) {
      return "NONE";
    }
    return "FULL_RESTATEMENT";
  }
  return "NONE";
}
