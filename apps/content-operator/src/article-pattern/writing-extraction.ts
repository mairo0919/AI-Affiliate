import type { ArticleWritingFeatures } from "./types.js";
import {
  computeInformationDensity,
  type InformationDensityDiagnostics,
} from "./information-density.js";

export type { InformationDensityDiagnostics } from "./information-density.js";

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bucketLength(n: number): string {
  if (n < 40) return "short";
  if (n < 120) return "medium";
  if (n < 240) return "long";
  return "very_long";
}

function lengthDist(values: number[]): { short: number; medium: number; long: number } {
  const out = { short: 0, medium: 0, long: 0 };
  for (const v of values) {
    if (v < 40) out.short += 1;
    else if (v < 100) out.medium += 1;
    else out.long += 1;
  }
  const total = Math.max(1, values.length);
  return {
    short: Number((out.short / total).toFixed(3)),
    medium: Number((out.medium / total).toFixed(3)),
    long: Number((out.long / total).toFixed(3)),
  };
}

function estimateRepetitionRate(text: string): number {
  const sentences = text
    .split(/[。．!！?？\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
  if (sentences.length < 2) return 0;
  const heads = sentences.map((s) => s.slice(0, 18));
  const uniq = new Set(heads);
  return 1 - uniq.size / heads.length;
}

export type WritingFeaturesExtractionResult = {
  features: ArticleWritingFeatures;
  densityDiagnostics: InformationDensityDiagnostics;
};

/**
 * Deterministic writing-feature extraction from in-memory HTML/text.
 * Never returns prose suitable for templating.
 * informationDensityBucket SSOT is computeInformationDensity (not LLM).
 */
export function extractWritingFeaturesWithDiagnostics(input: {
  html: string;
  title?: string | null;
}): WritingFeaturesExtractionResult {
  const text = stripTags(input.html);
  const paragraphs = [...input.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) =>
    stripTags(m[1] ?? ""),
  );
  const paraLens = paragraphs.map((p) => p.length).filter((n) => n > 0);
  const sentences = text
    .split(/[。．!！?？]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const sentLens = sentences.map((s) => s.length);

  const intro = paragraphs[0] ?? text.slice(0, 200);
  const questionHookUsed = /[？?]/.test(intro) || /でしょうか|ですか/.test(intro);
  const curiosityGapUsed =
    /なぜ|どうして|気になる|知らない|秘密|ポイントは/.test(intro) || questionHookUsed;
  const conclusionFirstUsed = /結論|先に言うと|要点は/.test(intro);
  const audienceFramingUsed = /向け|欲しい人|探している|好きな人|おすすめな人/.test(text);
  const benefitFramingUsed = /メリット|利点|向いている|選びやすい|見る価値/.test(text);
  const scenarioFramingUsed = /場合|シーン|シチュエーション|ときに/.test(text);

  const factHits = (
    text.match(/メーカー|シリーズ|出演|品番|配信|価格|円|レーベル|公開情報|スペック/g) ?? []
  ).length;
  const opinionHits = (
    text.match(/おすすめ|魅力|推し|気になる|向いている|見どころ|ポイント|選び方/g) ?? []
  ).length;
  const factOpinionRatio =
    factHits + opinionHits === 0 ? 0.5 : factHits / (factHits + opinionHits);
  const descriptionRecommendationRatio =
    opinionHits + factHits === 0 ? 0.4 : opinionHits / (opinionHits + factHits);

  const headings = [...input.html.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) =>
    stripTags(m[2] ?? "").slice(0, 40),
  );
  const sectionPurposeSequence: string[] = ["intro_hook"];
  for (const h of headings) {
    if (/選び|ポイント|注目|見どころ/.test(h)) sectionPurposeSequence.push("selection_criteria");
    else if (/スペック|情報|概要|基本/.test(h)) sectionPurposeSequence.push("product_facts");
    else if (/おすすめ|誰向け|向き/.test(h)) sectionPurposeSequence.push("editorial_angle");
    else if (/まとめ|CTA|購入|詳細/.test(h)) sectionPurposeSequence.push("cta");
    else sectionPurposeSequence.push("product_sections");
  }
  if (!sectionPurposeSequence.includes("cta") && /詳細|購入|チェック|公式/.test(text)) {
    sectionPurposeSequence.push("cta");
  }

  const dup = estimateRepetitionRate(text);
  const uniqueSections = [...new Set(sectionPurposeSequence)].slice(0, 8);
  const densityDiagnostics = computeInformationDensity({
    text,
    paragraphs,
    headings,
    repetitionRate: dup,
    audienceFramingUsed,
    benefitFramingUsed,
    scenarioFramingUsed,
    sectionPurposeSequence: uniqueSections,
  });

  let introHookType = "factual";
  if (curiosityGapUsed) introHookType = "curiosity";
  if (audienceFramingUsed) introHookType = "audience_framing";
  if (/おすすめ|推す|候補/.test(intro)) introHookType = "direct_recommendation";

  const features: ArticleWritingFeatures = {
    introHookType,
    introPurpose: audienceFramingUsed ? "selection_frame" : "topic_open",
    introLengthBucket: bucketLength(intro.length),
    paragraphLengthDistribution: lengthDist(paraLens.length ? paraLens : [intro.length]),
    sentenceLengthDistribution: lengthDist(sentLens.length ? sentLens : [20]),
    tone: descriptionRecommendationRatio >= 0.45 ? "editorial" : "catalog",
    pointOfView: /あなた|読者/.test(text) ? "second_person_light" : "third_person",
    factOpinionRatio: Number(factOpinionRatio.toFixed(3)),
    descriptionRecommendationRatio: Number(descriptionRecommendationRatio.toFixed(3)),
    productFactPlacement: /メーカー|シリーズ|出演/.test(paragraphs.slice(0, 2).join(" "))
      ? "early"
      : "mid",
    recommendationPlacement: /おすすめ|向いている/.test(paragraphs.slice(-2).join(" ") || text)
      ? "late"
      : descriptionRecommendationRatio > 0.4
        ? "mid"
        : "sparse",
    benefitFramingUsed,
    audienceFramingUsed,
    scenarioFramingUsed,
    curiosityGapUsed,
    questionHookUsed,
    conclusionFirstUsed,
    sectionPurposeSequence: uniqueSections,
    repetitionRateBucket: dup < 0.15 ? "low" : dup < 0.35 ? "medium" : "high",
    ctaLeadInType: /まとめ|気になる方|詳細は/.test(text) ? "bridge_from_editorial" : "direct",
    ctaContext: /気になる|候補|詳細/.test(text) ? "decision_support" : "link_only",
    informationDensityBucket: densityDiagnostics.bucket,
    productDifferentiationStyle: audienceFramingUsed || benefitFramingUsed ? "criteria_based" : "catalog",
    subjectiveLanguageLevel: descriptionRecommendationRatio > 0.55 ? "moderate" : "low",
    reviewStyle: "editorial_non_experiential",
    catalogStyleLevel: factOpinionRatio >= 0.6 ? "high" : "balanced",
  };

  return { features, densityDiagnostics };
}

/** Deterministic writing features only (density SSOT unchanged). */
export function extractWritingFeaturesDeterministic(input: {
  html: string;
  title?: string | null;
}): ArticleWritingFeatures {
  return extractWritingFeaturesWithDiagnostics(input).features;
}

/** Optional LLM boundary — returns writing features JSON only; never rewrites article. */
export type WritingFeatureLlmExtractor = (input: {
  title?: string | null;
  /** Ephemeral plain text — must not be persisted by caller */
  plainText: string;
}) => Promise<Partial<ArticleWritingFeatures>>;

/**
 * Merge optional LLM overlay onto deterministic base.
 * informationDensityBucket stays deterministic SSOT — never taken from overlay.
 */
export function mergeWritingFeatures(
  base: ArticleWritingFeatures,
  overlay: Partial<ArticleWritingFeatures> | null | undefined,
): ArticleWritingFeatures {
  if (!overlay) return base;
  const entries = Object.entries(overlay).filter(
    ([k, v]) =>
      v !== undefined &&
      v !== null &&
      k !== "informationDensityBucket",
  );
  return {
    ...base,
    ...Object.fromEntries(entries),
    informationDensityBucket: base.informationDensityBucket,
  } as ArticleWritingFeatures;
}

const WRITING_FEATURE_TYPES: Record<string, "string" | "number" | "boolean" | "array"> = {
  introHookType: "string",
  introPurpose: "string",
  introLengthBucket: "string",
  tone: "string",
  pointOfView: "string",
  factOpinionRatio: "number",
  descriptionRecommendationRatio: "number",
  productFactPlacement: "string",
  recommendationPlacement: "string",
  benefitFramingUsed: "boolean",
  audienceFramingUsed: "boolean",
  scenarioFramingUsed: "boolean",
  curiosityGapUsed: "boolean",
  questionHookUsed: "boolean",
  conclusionFirstUsed: "boolean",
  sectionPurposeSequence: "array",
  repetitionRateBucket: "string",
  ctaLeadInType: "string",
  ctaContext: "string",
  informationDensityBucket: "string",
  productDifferentiationStyle: "string",
  subjectiveLanguageLevel: "string",
  reviewStyle: "string",
  catalogStyleLevel: "string",
};

/**
 * Strict schema validation for Writing Feature LLM overlay.
 * Type violations (e.g. tone as string[]) reject the entire overlay.
 */
export function validateWritingFeaturesLlmOverlay(
  raw: unknown,
):
  | { ok: true; features: Partial<ArticleWritingFeatures> }
  | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "overlay_not_object" };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.startsWith("_")) continue;
    const expected = WRITING_FEATURE_TYPES[k];
    if (!expected) continue; // ignore unknown keys
    if (expected === "string") {
      if (typeof v !== "string") return { ok: false, reason: `type_mismatch:${k}` };
      if (v.length > 48 || /。/.test(v) || /https?:\/\//i.test(v)) {
        return { ok: false, reason: `value_not_abstract:${k}` };
      }
      out[k] = v;
      continue;
    }
    if (expected === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        return { ok: false, reason: `type_mismatch:${k}` };
      }
      out[k] = v;
      continue;
    }
    if (expected === "boolean") {
      if (typeof v !== "boolean") return { ok: false, reason: `type_mismatch:${k}` };
      out[k] = v;
      continue;
    }
    if (expected === "array") {
      if (!Array.isArray(v)) return { ok: false, reason: `type_mismatch:${k}` };
      const items = v.filter((x): x is string => typeof x === "string" && x.length <= 40);
      if (items.length !== v.length) return { ok: false, reason: `array_item_invalid:${k}` };
      out[k] = items.slice(0, 8);
    }
  }
  return { ok: true, features: out as Partial<ArticleWritingFeatures> };
}

export function assertWritingFeaturesAreAbstract(features: ArticleWritingFeatures): void {
  const serialized = JSON.stringify(features);
  if (serialized.length > 4_000) throw new Error("writing_features_too_large");
  if (/https?:\/\//i.test(serialized)) throw new Error("writing_features_must_not_include_urls");
  for (const seq of features.sectionPurposeSequence) {
    if (seq.length > 40 || /\s{2,}/.test(seq)) throw new Error("section_purpose_not_abstract");
  }
  const proseKeys = ["introHookType", "introPurpose", "tone", "pointOfView", "ctaLeadInType"] as const;
  for (const key of proseKeys) {
    const v = features[key];
    if (typeof v === "string" && (v.length > 48 || /。/.test(v))) {
      throw new Error(`writing_feature_${key}_not_abstract`);
    }
  }
}

/** Strict JSON schema description for LLM writing-feature extraction (no prose fields). */
export function getWritingFeaturesLlmJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "introHookType",
      "introPurpose",
      "sectionPurposeSequence",
      "benefitFramingUsed",
      "audienceFramingUsed",
    ],
    properties: {
      introHookType: { type: "string" },
      introPurpose: { type: "string" },
      introLengthBucket: { type: "string" },
      tone: { type: "string" },
      pointOfView: { type: "string" },
      factOpinionRatio: { type: "number" },
      descriptionRecommendationRatio: { type: "number" },
      productFactPlacement: { type: "string" },
      recommendationPlacement: { type: "string" },
      benefitFramingUsed: { type: "boolean" },
      audienceFramingUsed: { type: "boolean" },
      scenarioFramingUsed: { type: "boolean" },
      curiosityGapUsed: { type: "boolean" },
      questionHookUsed: { type: "boolean" },
      conclusionFirstUsed: { type: "boolean" },
      sectionPurposeSequence: { type: "array", items: { type: "string" } },
      repetitionRateBucket: { type: "string" },
      ctaLeadInType: { type: "string" },
      ctaContext: { type: "string" },
      // Density is deterministic SSOT — LLM may omit; merge ignores if present.
      informationDensityBucket: { type: "string" },
      productDifferentiationStyle: { type: "string" },
      subjectiveLanguageLevel: { type: "string" },
      reviewStyle: { type: "string" },
      catalogStyleLevel: { type: "string" },
    },
  };
}
