import type {
  ContentCandidateType,
  ContentTargetChannel,
  GeneratedContentType,
} from "@ai-affiliate/database";

export type ContentAngle =
  | "RANKING"
  | "TRENDING"
  | "HIGH_RATING"
  | "NEW_RELEASE"
  | "DISCOUNT"
  | "ACTRESS_GENRE"
  | "GENERIC";

export interface AllowedImageMeta {
  id: string;
  imageType: string;
  usageStatus: "ALLOWED";
  size: string | null;
}

export interface SafeContentGenerationInput {
  title: string;
  publishedAt: string | null;
  affiliateUrl: string;
  price: number | null;
  discountRate: number | null;
  reviewAverage: number | null;
  reviewCount: number | null;
  rankingPosition: number | null;
  tags: {
    actress: string[];
    genre: string[];
    maker: string[];
    label: string[];
    series: string[];
    director: string[];
  };
  scores: {
    totalScore: number | null;
    popularityScore: number | null;
    trendScore: number | null;
    reviewScore: number | null;
    priceScore: number | null;
    freshnessScore: number | null;
    dataQualityScore: number | null;
  };
  candidateType: ContentCandidateType;
  selectionReasons: string[];
  allowedImages: AllowedImageMeta[];
  publicMetadata: Record<string, string | number | boolean | null>;
  contentType: GeneratedContentType;
  targetChannel: ContentTargetChannel;
  contentAngle: ContentAngle;
  regenerationInstruction?: string;
}

export interface ContentGenerationRequest {
  contentType: GeneratedContentType;
  targetChannel: ContentTargetChannel;
  input: SafeContentGenerationInput;
  promptVersion: string;
  modelName: string;
  timeoutMs: number;
  mockBehavior?: "ok" | "invalid_json" | "repairable_json" | "timeout";
}

export interface StructuredContentOutput {
  title: string;
  body: string;
  summary?: string;
  hashtags: string[];
  callToAction?: string;
  metadata?: {
    estimatedDurationSeconds?: number;
    contentAngle?: string;
    scenes?: Array<{
      order: number;
      narration?: string;
      onScreenText?: string;
      hook?: boolean;
    }>;
    hook?: string;
    narration?: string;
    onScreenText?: string;
  };
}

export interface ContentGenerationResult {
  providerName: string;
  modelName: string;
  rawText: string;
  output: StructuredContentOutput | null;
  repaired: boolean;
  timedOut: boolean;
  errorMessage?: string;
}
