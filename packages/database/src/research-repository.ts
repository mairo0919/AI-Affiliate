import type { Prisma, PrismaClient } from "@prisma/client";
import { ImageUsageStatus, SourceType } from "@prisma/client";
import type {
  CollectedResearchItem,
  CollectionResult,
  ImageUsageStatus as SharedImageUsageStatus,
  JsonValue,
  SourceTypeName,
} from "@ai-affiliate/shared";

export interface SaveCollectionSummary {
  itemCount: number;
  createdCount: number;
  updatedCount: number;
  metricCount: number;
  tagLinkCount: number;
  imageCount: number;
}

function toSourceType(value: SourceTypeName): SourceType {
  switch (value) {
    case "FANZA":
      return SourceType.FANZA;
    case "TIKTOK":
      return SourceType.TIKTOK;
    case "X":
      return SourceType.X;
    case "OTHER":
      return SourceType.OTHER;
    default: {
      const _exhaustive: never = value;
      throw new Error(`Unsupported source type: ${String(_exhaustive)}`);
    }
  }
}

function toImageUsageStatus(value: SharedImageUsageStatus): ImageUsageStatus {
  switch (value) {
    case "ALLOWED":
      return ImageUsageStatus.ALLOWED;
    case "REQUIRES_CONFIRMATION":
      return ImageUsageStatus.REQUIRES_CONFIRMATION;
    case "NOT_ALLOWED":
      return ImageUsageStatus.NOT_ALLOWED;
    case "UNKNOWN":
      return ImageUsageStatus.UNKNOWN;
    default: {
      const _exhaustive: never = value;
      throw new Error(`Unsupported image usage status: ${String(_exhaustive)}`);
    }
  }
}

function toInputJson(value: JsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export class ResearchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveCollection(result: CollectionResult): Promise<SaveCollectionSummary> {
    return this.prisma.$transaction(async (tx) => {
      let createdCount = 0;
      let updatedCount = 0;
      let metricCount = 0;
      let tagLinkCount = 0;
      let imageCount = 0;

      for (const item of result.items) {
        const outcome = await this.saveItem(tx, item);
        if (outcome.created) {
          createdCount += 1;
        } else {
          updatedCount += 1;
        }
        metricCount += outcome.metricCount;
        tagLinkCount += outcome.tagLinkCount;
        imageCount += outcome.imageCount;
      }

      return {
        itemCount: result.items.length,
        createdCount,
        updatedCount,
        metricCount,
        tagLinkCount,
        imageCount,
      };
    });
  }

  private async saveItem(
    tx: Prisma.TransactionClient,
    item: CollectedResearchItem,
  ): Promise<{
    created: boolean;
    metricCount: number;
    tagLinkCount: number;
    imageCount: number;
  }> {
    const source = await tx.researchSource.upsert({
      where: { name: item.sourceName },
      create: {
        name: item.sourceName,
        type: toSourceType(item.sourceType),
        baseUrl: item.sourceBaseUrl,
        isActive: true,
      },
      update: {
        type: toSourceType(item.sourceType),
        baseUrl: item.sourceBaseUrl ?? undefined,
        isActive: true,
      },
    });

    const existing = await tx.researchItem.findUnique({
      where: {
        sourceId_externalId: {
          sourceId: source.id,
          externalId: item.externalId,
        },
      },
    });

    const researchItem = existing
      ? await tx.researchItem.update({
          where: { id: existing.id },
          data: {
            itemType: item.itemType,
            title: item.title,
            description: item.description,
            url: item.url,
            publishedAt: item.publishedAt,
            collectedAt: item.collectedAt,
            rawData: toInputJson(item.rawData),
          },
        })
      : await tx.researchItem.create({
          data: {
            sourceId: source.id,
            externalId: item.externalId,
            itemType: item.itemType,
            title: item.title,
            description: item.description,
            url: item.url,
            publishedAt: item.publishedAt,
            collectedAt: item.collectedAt,
            rawData: toInputJson(item.rawData),
          },
        });

    if (item.metrics.length > 0) {
      await tx.researchMetric.createMany({
        data: item.metrics.map((metric) => ({
          researchItemId: researchItem.id,
          metricType: metric.metricType,
          value: metric.value,
          recordedAt: metric.recordedAt,
        })),
      });
    }

    let tagLinkCount = 0;
    for (const tag of item.tags) {
      const researchTag = await tx.researchTag.upsert({
        where: {
          name_type: {
            name: tag.name,
            type: tag.type,
          },
        },
        create: {
          name: tag.name,
          type: tag.type,
        },
        update: {},
      });

      await tx.researchItemTag.upsert({
        where: {
          researchItemId_researchTagId: {
            researchItemId: researchItem.id,
            researchTagId: researchTag.id,
          },
        },
        create: {
          researchItemId: researchItem.id,
          researchTagId: researchTag.id,
        },
        update: {},
      });
      tagLinkCount += 1;
    }

    let imageCount = 0;
    for (const image of item.images ?? []) {
      await tx.researchImage.upsert({
        where: {
          researchItemId_imageType_sourceUrl: {
            researchItemId: researchItem.id,
            imageType: image.imageType,
            sourceUrl: image.sourceUrl,
          },
        },
        create: {
          researchItemId: researchItem.id,
          imageType: image.imageType,
          sourceUrl: image.sourceUrl,
          size: image.size,
          usageStatus: toImageUsageStatus(image.usageStatus),
          usageNote: image.usageNote,
        },
        update: {
          size: image.size,
          usageStatus: toImageUsageStatus(image.usageStatus),
          usageNote: image.usageNote,
        },
      });
      imageCount += 1;
    }

    return {
      created: !existing,
      metricCount: item.metrics.length,
      tagLinkCount,
      imageCount,
    };
  }

  async listItemsForAnalysis(options: {
    sourceTypes?: SourceType[];
    sourceName?: string;
    itemType?: string;
    limit?: number;
    fromDate?: Date;
    toDate?: Date;
    externalId?: string;
  }): Promise<ResearchItemForAnalysis[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 1000, 5000));
    const items = await this.prisma.researchItem.findMany({
      where: {
        itemType: options.itemType ?? "PRODUCT",
        ...(options.externalId ? { externalId: options.externalId } : {}),
        ...(options.fromDate || options.toDate
          ? {
              collectedAt: {
                ...(options.fromDate ? { gte: options.fromDate } : {}),
                ...(options.toDate ? { lte: options.toDate } : {}),
              },
            }
          : {}),
        source: {
          isActive: true,
          ...(options.sourceTypes && options.sourceTypes.length > 0
            ? { type: { in: options.sourceTypes } }
            : {}),
          ...(options.sourceName ? { name: options.sourceName } : {}),
        },
      },
      include: {
        source: true,
        metrics: { orderBy: { recordedAt: "asc" } },
        tags: { include: { researchTag: true } },
        images: true,
      },
      orderBy: { collectedAt: "desc" },
      take: limit,
    });
    return items;
  }

  async findItemByExternalId(externalId: string): Promise<ResearchItemForAnalysis | null> {
    return this.prisma.researchItem.findFirst({
      where: { externalId },
      include: {
        source: true,
        metrics: { orderBy: { recordedAt: "asc" } },
        tags: { include: { researchTag: true } },
        images: true,
      },
    });
  }
}

export type ResearchItemForAnalysis = Prisma.ResearchItemGetPayload<{
  include: {
    source: true;
    metrics: true;
    tags: { include: { researchTag: true } };
    images: true;
  };
}>;
