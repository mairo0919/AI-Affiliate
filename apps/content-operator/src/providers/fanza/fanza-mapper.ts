import type {
  CollectedImage,
  CollectedMetric,
  CollectedResearchItem,
  CollectedTag,
  ImageUsageStatus,
  JsonValue,
  Logger,
} from "@ai-affiliate/shared";
import type { DmmItem, DmmNamedEntity } from "./dmm-api-types.js";

export interface MapItemOptions {
  collectedAt?: Date;
  recordedAt?: Date;
  rankingPosition?: number;
  includeRankingMetric?: boolean;
  logger?: Logger;
}

export interface MapItemOutcome {
  item?: CollectedResearchItem;
  skipped: boolean;
  error: boolean;
}

const SAFE_IMAGE_NOTE =
  "Official usage scope varies by service/product. Confirm before ad use. Only proportional resize is allowed; cropping/editing/AI input is forbidden.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }
  if (isRecord(value)) {
    const result: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = toJsonValue(entry);
    }
    return result;
  }
  return String(value);
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function parseNumericString(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return undefined;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}

function pushUniqueTag(tags: CollectedTag[], name: string | undefined, type: string): void {
  if (!name || name.trim() === "") {
    return;
  }
  const normalized = name.trim();
  if (tags.some((tag) => tag.name === normalized && tag.type === type)) {
    return;
  }
  tags.push({ name: normalized, type });
}

function mapEntityTags(
  tags: CollectedTag[],
  entities: DmmNamedEntity | DmmNamedEntity[] | undefined,
  type: string,
): void {
  for (const entity of asArray(entities)) {
    pushUniqueTag(tags, entity.name, type);
  }
}

function pushImage(
  images: CollectedImage[],
  imageType: string,
  sourceUrl: string | undefined,
  size: string | undefined,
  usageStatus: ImageUsageStatus = "REQUIRES_CONFIRMATION",
): void {
  if (!sourceUrl || sourceUrl.trim() === "") {
    return;
  }
  images.push({
    imageType,
    sourceUrl: sourceUrl.trim(),
    size,
    usageStatus,
    usageNote: SAFE_IMAGE_NOTE,
  });
}

function mapImages(item: DmmItem): CollectedImage[] {
  const images: CollectedImage[] = [];
  pushImage(images, "main_list", item.imageURL?.list, "list");
  pushImage(images, "main_small", item.imageURL?.small, "small");
  pushImage(images, "main_large", item.imageURL?.large, "large");

  for (const url of asArray(item.sampleImageURL?.sample_s?.image)) {
    if (typeof url === "string") {
      pushImage(images, "sample_small", url, "sample_s", "REQUIRES_CONFIRMATION");
    }
  }
  for (const url of asArray(item.sampleImageURL?.sample_l?.image)) {
    if (typeof url === "string") {
      pushImage(images, "sample_large", url, "sample_l", "REQUIRES_CONFIRMATION");
    }
  }

  return images;
}

function buildMetrics(item: DmmItem, options: MapItemOptions): CollectedMetric[] {
  const recordedAt = options.recordedAt ?? new Date();
  const metrics: CollectedMetric[] = [];

  const price = parseNumericString(item.prices?.price);
  if (price !== undefined) {
    metrics.push({ metricType: "price", value: price, recordedAt });
  }

  const reviewCount = parseNumericString(item.review?.count);
  if (reviewCount !== undefined) {
    metrics.push({ metricType: "reviewCount", value: reviewCount, recordedAt });
  }

  const reviewAverage = parseNumericString(item.review?.average);
  if (reviewAverage !== undefined) {
    metrics.push({ metricType: "reviewAverage", value: reviewAverage, recordedAt });
  }

  if (options.includeRankingMetric && options.rankingPosition !== undefined) {
    metrics.push({
      metricType: "rankingPosition",
      value: options.rankingPosition,
      recordedAt,
    });
  }

  const listPrice = parseNumericString(item.prices?.list_price);
  if (price !== undefined && listPrice !== undefined && listPrice > 0 && listPrice >= price) {
    const discountRate = Number((((listPrice - price) / listPrice) * 100).toFixed(2));
    if (Number.isFinite(discountRate)) {
      metrics.push({ metricType: "discountRate", value: discountRate, recordedAt });
    }
  }

  return metrics;
}

export function mapDmmItemToCollected(
  item: DmmItem,
  options: MapItemOptions = {},
): MapItemOutcome {
  const externalId = item.content_id?.trim();
  if (!externalId) {
    options.logger?.warn("Skip FANZA item without content_id");
    return { skipped: true, error: false };
  }

  try {
    const collectedAt = options.collectedAt ?? new Date();
    const tags: CollectedTag[] = [];
    mapEntityTags(tags, item.iteminfo?.actress, "actress");
    mapEntityTags(tags, item.iteminfo?.genre, "genre");
    mapEntityTags(tags, item.iteminfo?.maker, "maker");
    mapEntityTags(tags, item.iteminfo?.director, "director");
    mapEntityTags(tags, item.iteminfo?.label, "label");
    mapEntityTags(tags, item.iteminfo?.series, "series");

    // Prefer official affiliate URL only. Never synthesize affiliate links.
    const url = item.affiliateURL?.trim() || undefined;
    const publishedAt = parseDate(item.date);
    if (item.date && !publishedAt) {
      options.logger?.warn(`FANZA date parse failed for externalId=${externalId}`);
    }

    // Strip review text fields if any unexpected keys appear; keep numeric review only in metrics.
    const raw = { ...item };
    // Official guide: do not store product description or user review bodies.
    const collected: CollectedResearchItem = {
      sourceName: "FANZA",
      sourceType: "FANZA",
      sourceBaseUrl: "https://www.dmm.co.jp",
      externalId,
      itemType: "PRODUCT",
      title: item.title?.trim() || externalId,
      description: null,
      url,
      publishedAt,
      collectedAt,
      rawData: toJsonValue(raw),
      metrics: buildMetrics(item, options),
      tags,
      images: mapImages(item),
    };

    return { item: collected, skipped: false, error: false };
  } catch (error) {
    options.logger?.warn(
      `FANZA item mapping failed for externalId=${externalId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { skipped: false, error: true };
  }
}

export function mapDmmItemsToCollected(
  items: DmmItem[],
  options: {
    collectedAt?: Date;
    recordedAt?: Date;
    sort?: string;
    firstPosition?: number;
    logger?: Logger;
  } = {},
): { items: CollectedResearchItem[]; skippedCount: number; errorCount: number } {
  const collected: CollectedResearchItem[] = [];
  let skippedCount = 0;
  let errorCount = 0;
  const includeRankingMetric = (options.sort ?? "rank") === "rank";
  const firstPosition = options.firstPosition ?? 1;

  items.forEach((item, index) => {
    const outcome = mapDmmItemToCollected(item, {
      collectedAt: options.collectedAt,
      recordedAt: options.recordedAt,
      includeRankingMetric,
      rankingPosition: includeRankingMetric ? firstPosition + index : undefined,
      logger: options.logger,
    });
    if (outcome.item) {
      collected.push(outcome.item);
    } else if (outcome.skipped) {
      skippedCount += 1;
    } else if (outcome.error) {
      errorCount += 1;
    }
  });

  return { items: collected, skippedCount, errorCount };
}
