/**
 * Deterministic informationDensityBucket for NEW_RELEASE_SINGLE learning.
 * Measures concrete / editorial / descriptive decision-support — not keyword÷length.
 * Never stores prose or site-specific phrase dictionaries beyond abstract signal regexes.
 */

/** Bump when computeInformationDensity formula / thresholds change. */
export const INFORMATION_DENSITY_VERSION = "information_density_v2";

export type InformationDensityLengthBucket =
  | "very_short"
  | "short"
  | "medium"
  | "long"
  | "very_long";

export type InformationDensityDiagnostics = {
  version: typeof INFORMATION_DENSITY_VERSION;
  concreteEvidenceCount: number;
  editorialEvidenceCount: number;
  descriptiveEvidenceCount: number;
  genericSignalCount: number;
  structureSupport: number;
  absoluteEvidence: number;
  evidenceRatio: number;
  repetitionPenalty: number;
  genericOnlyPenalty: number;
  catalogHeavyCap: boolean;
  paragraphCount: number;
  sentenceCount: number;
  textLength: number;
  lengthBucket: InformationDensityLengthBucket;
  densityScore: number;
  bucket: "low" | "medium" | "high";
};

/** Catalog / product identity facts (abstract labels). */
const CONCRETE_RE =
  /メーカー|シリーズ|出演|品番|レーベル|配信|価格|公開情報|スペック|発売日|収録時間|作品情報|公式カタログ|\d{1,3}(?:,\d{3})*円/g;

/** Product-code shaped tokens (abstract pattern, not site phrases). */
const PRODUCT_CODE_RE =
  /\b[a-z]{2,6}-?\d{2,4}\b|\bh_\d{3,}[a-z0-9]+\b|\b(?:ssis|midv|soe|stars|sone|pred|abf)[-_]?\d+\b/gi;

/**
 * Editorial / decision-support reasoning — excludes bare generic praise
 * (おすすめ / 魅力 / すごい alone are GENERIC_RE).
 */
const EDITORIAL_RE =
  /見どころ|ポイント|向いている|選び方|選ぶ理由|おすすめ理由|注意点|特徴|評価理由|向き不向き|メリット|欠点|判断材料|候補に|比較すると|観点|選びやすい|見る価値|整理する|材料として/g;

/** Generic praise / empty recommendation — not sufficient alone. */
const GENERIC_RE =
  /おすすめ|魅力|推し|すごい|魅力的|最高|必見|神作|ヤバい|気になる|綺麗|きれい|エロい|良作/g;

/**
 * Descriptive specificity markers for scene/structure explanation
 * (adult-review style without storing article-specific idioms).
 */
const DESCRIPTIVE_RE =
  /シーン|シチュエーション|展開|描写|演技|構図|カット|前半|後半|序盤|終盤|冒頭|クライマックス|具体的|内容|テンポ|雰囲気|視点|一本|場合|ときに/g;

export function densityLengthBucket(textLength: number): InformationDensityLengthBucket {
  if (textLength < 280) return "very_short";
  if (textLength < 600) return "short";
  if (textLength < 1200) return "medium";
  if (textLength < 2800) return "long";
  return "very_long";
}

function countRe(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function computeInformationDensity(input: {
  text: string;
  paragraphs: string[];
  headings: string[];
  repetitionRate: number;
  audienceFramingUsed: boolean;
  benefitFramingUsed: boolean;
  scenarioFramingUsed: boolean;
  sectionPurposeSequence: string[];
}): InformationDensityDiagnostics {
  const text = input.text;
  const textLength = text.length;
  const lengthBucket = densityLengthBucket(textLength);

  const substantiveParas = input.paragraphs.filter((p) => p.trim().length >= 24);
  const paragraphCount = substantiveParas.length;
  const sentences = text
    .split(/[。．!！?？]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10);
  const sentenceCount = sentences.length;

  const concreteRaw =
    countRe(text, CONCRETE_RE) + Math.min(3, countRe(text, PRODUCT_CODE_RE));
  const editorialRaw = countRe(text, EDITORIAL_RE);
  const descriptiveMarkerRaw = countRe(text, DESCRIPTIVE_RE);
  const genericSignalCount = countRe(text, GENERIC_RE);

  // Narrative reviews: medium/long paragraphs count as descriptive structure (no phrase dict).
  const mediumParas = substantiveParas.filter((p) => p.length >= 60).length;
  const longParas = substantiveParas.filter((p) => p.length >= 120).length;
  const descriptiveFromStructure = Math.min(4, Math.floor(mediumParas / 2) + longParas);

  const concreteEvidenceCount = Math.min(8, concreteRaw);
  const editorialEvidenceCount = Math.min(8, editorialRaw);
  const descriptiveEvidenceCount = Math.min(
    10,
    descriptiveMarkerRaw + descriptiveFromStructure,
  );

  const framingBonus =
    (input.audienceFramingUsed ? 0.35 : 0) +
    (input.benefitFramingUsed ? 0.35 : 0) +
    (input.scenarioFramingUsed ? 0.35 : 0);

  const sectionBonus =
    input.sectionPurposeSequence.some((s) =>
      ["selection_criteria", "editorial_angle", "product_facts"].includes(s),
    )
      ? 0.3
      : 0;

  const absoluteEvidence =
    Math.min(concreteEvidenceCount, 6) * 0.45 +
    Math.min(editorialEvidenceCount, 6) * 0.5 +
    Math.min(descriptiveEvidenceCount, 8) * 0.32 +
    framingBonus +
    sectionBonus;

  // Weak structure support — headings capped hard (no chrome inflation).
  const bodyHeadings = input.headings.filter((h) => h.trim().length > 0).length;
  const headingSupport = Math.min(2, Math.max(0, bodyHeadings - 1)) * 0.08;
  const structureSupport = clamp(
    (paragraphCount >= 5 ? 0.4 : paragraphCount >= 3 ? 0.25 : paragraphCount >= 2 ? 0.12 : 0) +
      (sentenceCount >= 10 ? 0.3 : sentenceCount >= 6 ? 0.18 : sentenceCount >= 4 ? 0.08 : 0) +
      headingSupport,
    0,
    0.85,
  );

  // Soft length normalization: absolute evidence dominates; short text cannot inflate via ratio.
  const softDenom = 1 + Math.min(6, textLength / 500);
  const evidenceRatio = absoluteEvidence / softDenom;

  const evidenceCore = concreteEvidenceCount + editorialEvidenceCount + descriptiveEvidenceCount;
  const genericOnly =
    evidenceCore < 2 && genericSignalCount >= 1 && framingBonus < 0.35;
  const genericThin =
    evidenceCore < 3 &&
    genericSignalCount >= 2 &&
    editorialEvidenceCount === 0 &&
    framingBonus < 0.5;
  const genericOnlyPenalty = genericOnly ? 0.55 : genericThin ? 0.3 : 0;

  const repetitionPenalty =
    input.repetitionRate >= 0.35 ? 0.5 : input.repetitionRate >= 0.15 ? 0.18 : 0;

  const catalogHeavy =
    concreteEvidenceCount >= 5 &&
    editorialEvidenceCount < 2 &&
    descriptiveEvidenceCount < 3 &&
    framingBonus < 0.35;
  const catalogHeavyCap = catalogHeavy;

  let densityScore =
    absoluteEvidence * 0.65 +
    evidenceRatio * 0.55 +
    structureSupport * 0.5 -
    genericOnlyPenalty -
    repetitionPenalty;

  // Length gates: prevent tiny keyword spam → high; no auto-high for long empty prose.
  if (lengthBucket === "very_short") {
    densityScore = Math.min(densityScore, 1.05);
    if (absoluteEvidence < 1.8) densityScore = Math.min(densityScore, 0.85);
  } else if (lengthBucket === "short") {
    densityScore = Math.min(densityScore, 1.85);
  }

  if (genericOnly || (lengthBucket === "very_short" && evidenceCore < 3)) {
    densityScore = Math.min(densityScore, 0.9);
  }
  if (catalogHeavyCap) {
    densityScore = Math.min(densityScore, 1.05);
  }
  // Long generic / low-evidence prose stays low even with structure padding.
  if (textLength >= 1000 && absoluteEvidence < 1.2 && framingBonus < 0.35) {
    densityScore = Math.min(densityScore, 0.95);
  }

  densityScore = Number(clamp(densityScore, 0, 6).toFixed(3));

  let bucket: "low" | "medium" | "high" = "low";
  if (densityScore >= 2.35) bucket = "high";
  else if (densityScore >= 1.15) bucket = "medium";

  return {
    version: INFORMATION_DENSITY_VERSION,
    concreteEvidenceCount,
    editorialEvidenceCount,
    descriptiveEvidenceCount,
    genericSignalCount,
    structureSupport: Number(structureSupport.toFixed(3)),
    absoluteEvidence: Number(absoluteEvidence.toFixed(3)),
    evidenceRatio: Number(evidenceRatio.toFixed(3)),
    repetitionPenalty: Number(repetitionPenalty.toFixed(3)),
    genericOnlyPenalty: Number(genericOnlyPenalty.toFixed(3)),
    catalogHeavyCap,
    paragraphCount,
    sentenceCount,
    textLength,
    lengthBucket,
    densityScore,
    bucket,
  };
}
