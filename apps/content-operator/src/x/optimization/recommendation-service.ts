import type { AppConfig } from "@ai-affiliate/config";
import type {
  XOptimizationPriority,
  XOptimizationRecommendation,
  XOptimizationRecommendationStatus,
  XOptimizationRepository,
} from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";

export interface XOptimizationRecommendationServiceDeps {
  logger: Logger;
  config: AppConfig;
  optimization: XOptimizationRepository;
  now?: () => Date;
  notifications?: {
    emitXEvent?: (
      eventType:
        | "X_OPTIMIZATION_RECOMMENDATION_APPROVED"
        | "X_OPTIMIZATION_RECOMMENDATION_REJECTED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
}

export class XOptimizationRecommendationService {
  private readonly now: () => Date;

  constructor(private readonly deps: XOptimizationRecommendationServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async list(options?: {
    status?: XOptimizationRecommendationStatus;
    dimension?: string;
    limit?: number;
  }): Promise<XOptimizationRecommendation[]> {
    await this.deps.optimization.expireDueRecommendations(this.now());
    return this.deps.optimization.listRecommendations({
      status: options?.status,
      dimension: options?.dimension as XOptimizationRecommendation["dimension"] | undefined,
      limit: options?.limit,
    });
  }

  async show(id: string): Promise<XOptimizationRecommendation | null> {
    return this.deps.optimization.findRecommendationById(id);
  }

  async approve(
    id: string,
    reviewer?: string,
    comment?: string,
  ): Promise<XOptimizationRecommendation> {
    const row = await this.deps.optimization.approveRecommendation(
      id,
      reviewer ?? this.deps.config.xOptimizationDefaultReviewer,
      comment,
    );
    await this.deps.notifications?.emitXEvent?.("X_OPTIMIZATION_RECOMMENDATION_APPROVED", {
      recommendationId: row.id,
      reviewer: row.reviewer,
      dimension: row.dimension,
    });
    return row;
  }

  async reject(
    id: string,
    reviewer?: string,
    comment?: string,
  ): Promise<XOptimizationRecommendation> {
    const row = await this.deps.optimization.rejectRecommendation(
      id,
      reviewer ?? this.deps.config.xOptimizationDefaultReviewer,
      comment,
    );
    await this.deps.notifications?.emitXEvent?.("X_OPTIMIZATION_RECOMMENDATION_REJECTED", {
      recommendationId: row.id,
      reviewer: row.reviewer,
      dimension: row.dimension,
    });
    return row;
  }

  async expire(id: string): Promise<XOptimizationRecommendation> {
    return this.deps.optimization.expireRecommendation(id);
  }

  async expireDue(): Promise<number> {
    return this.deps.optimization.expireDueRecommendations(this.now());
  }

  async setPriority(
    id: string,
    priority: XOptimizationPriority,
  ): Promise<XOptimizationRecommendation> {
    return this.deps.optimization.updateRecommendationPriority(id, priority);
  }
}
