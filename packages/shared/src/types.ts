export type LogLevel = "debug" | "info" | "warn" | "error";

/** Research source channel identifiers used by providers and targets. */
export type ResearchSourceChannel = "tiktok" | "x" | "fanza";

/** @deprecated Use ResearchSourceChannel. Kept for compatibility. */
export type ResearchSource = ResearchSourceChannel;

export type SourceTypeName = "FANZA" | "TIKTOK" | "X" | "OTHER";

export type ImageUsageStatus =
  | "ALLOWED"
  | "REQUIRES_CONFIRMATION"
  | "NOT_ALLOWED"
  | "UNKNOWN";

export interface ResearchTarget {
  source: ResearchSourceChannel;
  query: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface CollectedMetric {
  metricType: string;
  value: number;
  recordedAt: Date;
}

export interface CollectedTag {
  name: string;
  type: string;
}

export interface CollectedImage {
  imageType: string;
  sourceUrl: string;
  size?: string;
  usageStatus: ImageUsageStatus;
  usageNote?: string;
}

export interface CollectedResearchItem {
  sourceName: string;
  sourceType: SourceTypeName;
  sourceBaseUrl?: string;
  externalId: string;
  itemType: string;
  title: string;
  /** Official product descriptions must not be stored. Use null. */
  description: string | null;
  url?: string;
  publishedAt?: Date;
  collectedAt: Date;
  rawData: JsonValue;
  metrics: CollectedMetric[];
  tags: CollectedTag[];
  images: CollectedImage[];
}

export interface CollectionResult {
  providerName: string;
  collectedAt: Date;
  items: CollectedResearchItem[];
  /** Next 1-based offset for paging, or null when no more pages. */
  nextOffset?: number | null;
  stats?: {
    fetchedCount: number;
    mappedCount: number;
    skippedCount: number;
    errorCount: number;
  };
}

export interface ProviderCreditConfig {
  providerName: string;
  creditRequired: boolean;
  /** Official credit text — set only after confirming the official credit page. */
  creditText: string | null;
  /** Official credit URL — set only after confirming the official credit page. */
  creditUrl: string | null;
}

export const FANZA_CREDIT_CONFIG: ProviderCreditConfig = {
  providerName: "fanza",
  creditRequired: true,
  creditText: null,
  creditUrl: null,
};
