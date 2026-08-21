import type {
  ArticleFormatDefinition,
  ArticleStructureObservation,
  ContentFormatCategory,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

function jsonOrUndef(
  value: Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | typeof PrismaNamespace.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return PrismaNamespace.JsonNull;
  return value;
}

export type CreateArticleStructureObservationInput = {
  sourceDocumentId?: string | null;
  sourceUrl: string;
  sourceDomain: string;
  contentHash: string;
  articleTypeHint?: string | null;
  features: Prisma.InputJsonValue;
  confidence?: number | null;
  observedAt?: Date;
  metadata?: Prisma.InputJsonValue | null;
};

export type CreateArticleFormatDefinitionInput = {
  formatKey: string;
  formatCategory: ContentFormatCategory;
  displayName: string;
  status?: string;
  spec: Prisma.InputJsonValue;
  externalPriorWeight?: number;
  ownPerformanceWeight?: number;
  effectiveWeight?: number;
  sampleExternal?: number;
  sampleOwn?: number;
  domainDiversity?: number;
  confidence?: number | null;
  metricsSummary?: Prisma.InputJsonValue | null;
  derivedFromObservationIds?: Prisma.InputJsonValue | null;
  linkedLearningRuleId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

export type UpdateArticleFormatDefinitionInput = {
  status?: string;
  spec?: Prisma.InputJsonValue;
  displayName?: string;
  externalPriorWeight?: number;
  ownPerformanceWeight?: number;
  effectiveWeight?: number;
  sampleExternal?: number;
  sampleOwn?: number;
  domainDiversity?: number;
  confidence?: number | null;
  metricsSummary?: Prisma.InputJsonValue | null;
  derivedFromObservationIds?: Prisma.InputJsonValue | null;
  linkedLearningRuleId?: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  suspendedAt?: Date | null;
  metadata?: Prisma.InputJsonValue | null;
};

export class ArticlePatternRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createObservation(
    input: CreateArticleStructureObservationInput,
  ): Promise<ArticleStructureObservation> {
    return this.prisma.articleStructureObservation.create({
      data: {
        sourceDocumentId: input.sourceDocumentId ?? null,
        sourceUrl: input.sourceUrl,
        sourceDomain: input.sourceDomain,
        contentHash: input.contentHash,
        articleTypeHint: input.articleTypeHint ?? null,
        features: input.features,
        confidence: input.confidence ?? null,
        observedAt: input.observedAt ?? new Date(),
        metadata: input.metadata ?? undefined,
      },
    });
  }

  async listObservations(options?: {
    domain?: string;
    limit?: number;
    /** Filter by Observation.metadata.sourceKind (SSOT). */
    sourceKind?: "fixture" | "live_url";
  }): Promise<ArticleStructureObservation[]> {
    const where: Prisma.ArticleStructureObservationWhereInput = {};
    if (options?.domain) where.sourceDomain = options.domain;
    if (options?.sourceKind) {
      where.metadata = {
        path: ["sourceKind"],
        equals: options.sourceKind,
      };
    }
    return this.prisma.articleStructureObservation.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { observedAt: "desc" },
      take: options?.limit ?? 200,
    });
  }

  async listObservationsByIds(ids: string[]): Promise<ArticleStructureObservation[]> {
    if (ids.length === 0) return [];
    return this.prisma.articleStructureObservation.findMany({
      where: { id: { in: ids } },
    });
  }

  async updateObservationMetadata(
    id: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<ArticleStructureObservation> {
    return this.prisma.articleStructureObservation.update({
      where: { id },
      data: { metadata },
    });
  }

  async createFormat(
    input: CreateArticleFormatDefinitionInput,
  ): Promise<ArticleFormatDefinition> {
    return this.prisma.articleFormatDefinition.create({
      data: {
        formatKey: input.formatKey,
        formatCategory: input.formatCategory,
        displayName: input.displayName,
        status: input.status ?? "PROPOSED",
        spec: input.spec,
        externalPriorWeight: input.externalPriorWeight ?? 0.5,
        ownPerformanceWeight: input.ownPerformanceWeight ?? 0,
        effectiveWeight: input.effectiveWeight ?? 0.5,
        sampleExternal: input.sampleExternal ?? 0,
        sampleOwn: input.sampleOwn ?? 0,
        domainDiversity: input.domainDiversity ?? 0,
        confidence: input.confidence ?? null,
        metricsSummary: input.metricsSummary ?? undefined,
        derivedFromObservationIds: input.derivedFromObservationIds ?? undefined,
        linkedLearningRuleId: input.linkedLearningRuleId ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  }

  async updateFormat(
    id: string,
    input: UpdateArticleFormatDefinitionInput,
  ): Promise<ArticleFormatDefinition> {
    return this.prisma.articleFormatDefinition.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.spec !== undefined ? { spec: input.spec } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.externalPriorWeight !== undefined
          ? { externalPriorWeight: input.externalPriorWeight }
          : {}),
        ...(input.ownPerformanceWeight !== undefined
          ? { ownPerformanceWeight: input.ownPerformanceWeight }
          : {}),
        ...(input.effectiveWeight !== undefined
          ? { effectiveWeight: input.effectiveWeight }
          : {}),
        ...(input.sampleExternal !== undefined ? { sampleExternal: input.sampleExternal } : {}),
        ...(input.sampleOwn !== undefined ? { sampleOwn: input.sampleOwn } : {}),
        ...(input.domainDiversity !== undefined
          ? { domainDiversity: input.domainDiversity }
          : {}),
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        ...(input.metricsSummary !== undefined
          ? { metricsSummary: jsonOrUndef(input.metricsSummary) }
          : {}),
        ...(input.derivedFromObservationIds !== undefined
          ? { derivedFromObservationIds: jsonOrUndef(input.derivedFromObservationIds) }
          : {}),
        ...(input.linkedLearningRuleId !== undefined
          ? { linkedLearningRuleId: input.linkedLearningRuleId }
          : {}),
        ...(input.approvedBy !== undefined ? { approvedBy: input.approvedBy } : {}),
        ...(input.approvedAt !== undefined ? { approvedAt: input.approvedAt } : {}),
        ...(input.suspendedAt !== undefined ? { suspendedAt: input.suspendedAt } : {}),
        ...(input.metadata !== undefined ? { metadata: jsonOrUndef(input.metadata) } : {}),
      },
    });
  }

  async findFormatById(id: string): Promise<ArticleFormatDefinition | null> {
    return this.prisma.articleFormatDefinition.findUnique({ where: { id } });
  }

  async findFormatByKey(formatKey: string): Promise<ArticleFormatDefinition | null> {
    return this.prisma.articleFormatDefinition.findUnique({ where: { formatKey } });
  }

  async listFormats(status?: string): Promise<ArticleFormatDefinition[]> {
    return this.prisma.articleFormatDefinition.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ effectiveWeight: "desc" }, { createdAt: "desc" }],
    });
  }

  async listActiveFormats(): Promise<ArticleFormatDefinition[]> {
    return this.listFormats("ACTIVE");
  }
}
