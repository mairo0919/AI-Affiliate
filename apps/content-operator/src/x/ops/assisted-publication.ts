import type { AppConfig } from "@ai-affiliate/config";
import type {
  ContentRepository,
  PublicationWithPosts,
  XOpsRepository,
  XOptimizationRepository,
  XPublicationRepository,
} from "@ai-affiliate/database";
import { hashProductKey } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { ContentEngine } from "../../content/content-engine.js";
import { XContentOptimizer } from "../optimization/content-optimizer.js";
import { XPublicationService } from "../publication-service.js";
import { buildProductKey, extractProviderProductId } from "./product-key.js";

export interface AssistedPrepareResult {
  applicationId: string;
  generatedContentId: string;
  parentContentId: string;
  recommendationId: string;
  status: string;
  experimentId: string | null;
}

export interface XAssistedPublicationServiceDeps {
  logger: Logger;
  config: AppConfig;
  contents: ContentRepository;
  publications: XPublicationRepository;
  optimization: XOptimizationRepository;
  ops: XOpsRepository;
  contentEngine: ContentEngine;
  publicationService: XPublicationService;
  contentOptimizer: XContentOptimizer;
  now?: () => Date;
  notifications?: {
    emitXEvent?: (
      eventType: "X_ASSISTED_REVIEW_REQUIRED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
}

/**
 * Unified ASSISTED flow: approve-check → optimize → review → schedule.
 * Never auto-publishes.
 */
export class XAssistedPublicationService {
  private readonly now: () => Date;

  constructor(private readonly deps: XAssistedPublicationServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async prepare(options: {
    recommendationId: string;
    contentId: string;
    actorId?: string;
  }): Promise<AssistedPrepareResult> {
    const rec = await this.deps.optimization.findRecommendationById(
      options.recommendationId,
    );
    if (!rec || rec.status !== "APPROVED") {
      throw new Error(
        `recommendation must be APPROVED (got ${rec?.status ?? "missing"})`,
      );
    }

    const result = await this.deps.contentOptimizer.apply({
      recommendationId: options.recommendationId,
      contentId: options.contentId,
      createExperiment: true,
    });

    if (result.validationFailed || !result.generatedContentId) {
      throw new Error("assisted prepare validation failed");
    }

    // Ensure REVIEW_REQUIRED (not ready to publish yet)
    const child = await this.deps.contents.findGeneratedContentById(
      result.generatedContentId,
    );
    if (child && child.status !== "REVIEW_REQUIRED" && child.status !== "VALIDATION_FAILED") {
      await this.deps.contents.updateGeneratedContentStatus(
        child.id,
        "REVIEW_REQUIRED",
      );
    }

    await this.deps.ops.writeAudit({
      action: "ASSISTED_PREPARE",
      actorType: "CLI",
      actorId: options.actorId ?? "cli",
      entityType: "XOptimizationApplication",
      entityId: result.applicationId,
      result: "SUCCESS",
      reason: "assisted prepare created reviewable content",
      releaseMode: this.deps.config.xReleaseMode,
      metadata: {
        recommendationId: options.recommendationId,
        generatedContentId: result.generatedContentId,
        dimension: result.dimension,
      },
    });

    await this.deps.notifications?.emitXEvent?.("X_ASSISTED_REVIEW_REQUIRED", {
      applicationId: result.applicationId,
      contentId: result.generatedContentId,
    });

    return {
      applicationId: result.applicationId,
      generatedContentId: result.generatedContentId,
      parentContentId: result.parentContentId,
      recommendationId: options.recommendationId,
      status: "REVIEW_REQUIRED",
      experimentId: result.experimentId,
    };
  }

  async review(options: {
    applicationId: string;
    action: "approve" | "reject";
    reviewer: string;
    comment?: string;
  }): Promise<{ contentId: string; status: string }> {
    const app = await this.deps.optimization.findApplicationById(options.applicationId);
    if (!app?.generatedContentId) {
      throw new Error(`application not found: ${options.applicationId}`);
    }
    if (options.action === "approve") {
      const content = await this.deps.contents.findGeneratedContentById(
        app.generatedContentId,
      );
      if (!content) throw new Error("content missing");
      if (content.status === "REVIEW_REQUIRED") {
        await this.deps.contents.approveContent(
          content.id,
          options.reviewer,
          options.comment,
        );
      }
      const approved = await this.deps.contents.findGeneratedContentById(content.id);
      if (approved?.status === "APPROVED") {
        await this.deps.contents.markReadyToPublish(approved.id);
      }
      await this.deps.ops.writeAudit({
        action: "ASSISTED_REVIEW_APPROVE",
        actorType: "ADMIN",
        actorId: options.reviewer,
        entityType: "GeneratedContent",
        entityId: content.id,
        result: "SUCCESS",
        reason: options.comment ?? "approved",
        releaseMode: this.deps.config.xReleaseMode,
      });
      return { contentId: content.id, status: "READY_TO_PUBLISH" };
    }

    await this.deps.contents.rejectContent(
      app.generatedContentId,
      options.reviewer,
      options.comment,
    );
    await this.deps.ops.writeAudit({
      action: "ASSISTED_REVIEW_REJECT",
      actorType: "ADMIN",
      actorId: options.reviewer,
      entityType: "GeneratedContent",
      entityId: app.generatedContentId,
      result: "SUCCESS",
      reason: options.comment ?? "rejected",
      releaseMode: this.deps.config.xReleaseMode,
    });
    return { contentId: app.generatedContentId, status: "REJECTED" };
  }

  async schedule(options: {
    applicationId: string;
    scheduledAt: Date;
    actorId?: string;
    cooldownOverrideReason?: string;
  }): Promise<PublicationWithPosts> {
    const app = await this.deps.optimization.findApplicationById(options.applicationId);
    if (!app?.generatedContentId) {
      throw new Error(`application not found: ${options.applicationId}`);
    }
    const content = await this.deps.contents.findGeneratedContentById(
      app.generatedContentId,
    );
    if (!content || content.status !== "READY_TO_PUBLISH") {
      throw new Error(
        `content must be READY_TO_PUBLISH before schedule (got ${content?.status ?? "missing"})`,
      );
    }

    const rec = await this.deps.optimization.findRecommendationById(app.recommendationId);
    if (!rec || (rec.status !== "APPROVED" && rec.status !== "APPLIED")) {
      throw new Error("recommendation is not approved");
    }

    const publication = await this.deps.publicationService.createFromContent({
      contentId: content.id,
      strategy: "AUTO",
      scheduledAt: options.scheduledAt,
      cooldownOverrideReason: options.cooldownOverrideReason,
      actorType: "CLI",
      actorId: options.actorId ?? "cli",
    });

    await this.deps.optimization.updateApplication(app.id, {
      status: "APPLIED",
      targetPublicationId: publication.id,
      result: {
        ...(typeof app.result === "object" && app.result ? app.result : {}),
        scheduledAt: options.scheduledAt.toISOString(),
        publicationId: publication.id,
      },
    });

    await this.deps.ops.writeAudit({
      action: "ASSISTED_SCHEDULE",
      actorType: "CLI",
      actorId: options.actorId ?? "cli",
      entityType: "XPublication",
      entityId: publication.id,
      publicationId: publication.id,
      productKeyHash: hashProductKey(
        buildProductKey({
          provider: "fanza",
          researchItemId: content.researchItemId,
          affiliateUrl: content.affiliateUrl,
          providerProductId: extractProviderProductId({
            affiliateUrl: content.affiliateUrl,
          }),
        }),
      ),
      result: "SUCCESS",
      reason: "assisted schedule",
      releaseMode: this.deps.config.xReleaseMode,
      metadata: { applicationId: options.applicationId },
    });

    return publication;
  }

  async show(applicationId: string): Promise<Record<string, unknown>> {
    const app = await this.deps.optimization.findApplicationById(applicationId);
    if (!app) throw new Error(`application not found: ${applicationId}`);
    const content = app.generatedContentId
      ? await this.deps.contents.findGeneratedContentById(app.generatedContentId)
      : null;
    const publication = app.targetPublicationId
      ? await this.deps.publications.findById(app.targetPublicationId)
      : null;
    return {
      applicationId: app.id,
      status: app.status,
      recommendationId: app.recommendationId,
      generatedContentId: app.generatedContentId,
      contentStatus: content?.status ?? null,
      publicationId: publication?.id ?? null,
      publicationStatus: publication?.status ?? null,
      scheduledAt: publication?.scheduledAt?.toISOString() ?? null,
      appliedValue: app.appliedValue,
    };
  }

  async cancel(options: {
    applicationId: string;
    actorId?: string;
    reason?: string;
  }): Promise<void> {
    const app = await this.deps.optimization.findApplicationById(options.applicationId);
    if (!app) throw new Error(`application not found: ${options.applicationId}`);
    if (app.targetPublicationId) {
      await this.deps.publicationService.cancel(app.targetPublicationId);
      await this.deps.ops.releaseReservation(app.targetPublicationId, "CANCELLED");
    }
    await this.deps.optimization.updateApplication(app.id, { status: "CANCELLED" });
    await this.deps.ops.writeAudit({
      action: "ASSISTED_CANCEL",
      actorType: "CLI",
      actorId: options.actorId ?? "cli",
      entityType: "XOptimizationApplication",
      entityId: app.id,
      publicationId: app.targetPublicationId,
      result: "SUCCESS",
      reason: options.reason ?? "cancelled",
      releaseMode: this.deps.config.xReleaseMode,
    });
  }
}
