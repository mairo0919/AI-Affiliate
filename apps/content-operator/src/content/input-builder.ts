import type {
  ContentCandidateType,
  ContentTargetChannel,
  GeneratedContentType,
  ProductAnalysis,
} from "@ai-affiliate/database";
import type { ContentAngle, SafeContentGenerationInput } from "./types.js";

type TagRow = {
  researchTag: { name: string; type: string };
};

type MetricRow = {
  metricType: string;
  value: number;
};

type ImageRow = {
  id: string;
  imageType: string;
  size: string | null;
  usageStatus: string;
};

export interface InputBuilderCandidate {
  candidateType: ContentCandidateType;
  selectionReasons: unknown;
  targetChannel: ContentTargetChannel;
  researchItem: {
    title: string;
    url: string | null;
    publishedAt: Date | null;
    metrics: MetricRow[];
    tags: TagRow[];
    images: ImageRow[];
  };
  productAnalysis: ProductAnalysis;
}

function metricValue(metrics: MetricRow[], ...names: string[]): number | null {
  const lower = new Set(names.map((n) => n.toLowerCase()));
  for (const metric of metrics) {
    if (lower.has(metric.metricType.toLowerCase())) {
      return metric.value;
    }
  }
  return null;
}

function tagsOfType(tags: TagRow[], type: string): string[] {
  return tags
    .filter((row) => row.researchTag.type.toLowerCase() === type.toLowerCase())
    .map((row) => row.researchTag.name)
    .filter((name) => name.trim().length > 0);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function resolveAngle(
  candidateType: ContentCandidateType,
  tags: SafeContentGenerationInput["tags"],
): ContentAngle {
  if (candidateType === "RANKING") return "RANKING";
  if (candidateType === "TRENDING") return "TRENDING";
  if (candidateType === "HIGH_RATING") return "HIGH_RATING";
  if (candidateType === "NEW_RELEASE") return "NEW_RELEASE";
  if (candidateType === "DISCOUNT") return "DISCOUNT";
  if (tags.actress.length > 0 || tags.genre.length > 0) return "ACTRESS_GENRE";
  return "GENERIC";
}

/**
 * Allowlist-only builder. Never includes description / review text / rawData.
 */
export class ContentGenerationInputBuilder {
  build(options: {
    candidate: InputBuilderCandidate;
    contentType: GeneratedContentType;
    targetChannel?: ContentTargetChannel;
    regenerationInstruction?: string;
  }): SafeContentGenerationInput {
    const item = options.candidate.researchItem;
    const affiliateUrl = item.url?.trim() ?? "";
    const tags = {
      actress: tagsOfType(item.tags, "actress"),
      genre: tagsOfType(item.tags, "genre"),
      maker: tagsOfType(item.tags, "maker"),
      label: tagsOfType(item.tags, "label"),
      series: tagsOfType(item.tags, "series"),
      director: tagsOfType(item.tags, "director"),
    };

    const analysis = options.candidate.productAnalysis;
    const allowedImages = item.images
      .filter((image) => image.usageStatus === "ALLOWED")
      .map((image) => ({
        id: image.id,
        imageType: image.imageType,
        usageStatus: "ALLOWED" as const,
        size: image.size,
      }));

    const input: SafeContentGenerationInput = {
      title: item.title,
      publishedAt: item.publishedAt?.toISOString() ?? null,
      affiliateUrl,
      price: metricValue(item.metrics, "price", "prices"),
      discountRate: metricValue(item.metrics, "discountRate", "discount_rate"),
      reviewAverage: metricValue(item.metrics, "reviewAverage", "review_average"),
      reviewCount: metricValue(item.metrics, "reviewCount", "review_count"),
      rankingPosition: metricValue(item.metrics, "rankingPosition", "ranking_position"),
      tags,
      scores: {
        totalScore: analysis.totalScore,
        popularityScore: analysis.popularityScore,
        trendScore: analysis.trendScore,
        reviewScore: analysis.reviewScore,
        priceScore: analysis.priceScore,
        freshnessScore: analysis.freshnessScore,
        dataQualityScore: analysis.dataQualityScore,
      },
      candidateType: options.candidate.candidateType,
      selectionReasons: asStringArray(options.candidate.selectionReasons),
      allowedImages,
      publicMetadata: {
        hasAllowedImage: allowedImages.length > 0,
        imageCountAllowed: allowedImages.length,
      },
      contentType: options.contentType,
      targetChannel: options.targetChannel ?? options.candidate.targetChannel,
      contentAngle: resolveAngle(options.candidate.candidateType, tags),
      ...(options.regenerationInstruction
        ? { regenerationInstruction: options.regenerationInstruction }
        : {}),
    };

    assertNoForbiddenKeys(input);
    return input;
  }
}

function assertNoForbiddenKeys(input: SafeContentGenerationInput): void {
  const json = JSON.stringify(input);
  const forbidden = ["rawData", "description", "reviewText", "apiResponse", "apiKey"];
  for (const key of forbidden) {
    if (json.includes(`"${key}"`)) {
      throw new Error(`forbidden key leaked into generation input: ${key}`);
    }
  }
}
