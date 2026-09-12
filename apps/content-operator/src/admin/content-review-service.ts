import type {
  ContentVersion,
  LifecycleRepository,
  P6Repository,
  QualityReviewRecord,
} from "@ai-affiliate/database";
import { ClaimStatus, ContentVersionStatus } from "@ai-affiliate/database";

export class ContentReviewError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_found"
      | "invalid_state_transition"
      | "review_failed"
      | "claim_blocked"
      | "approval_required",
  ) {
    super(message);
    this.name = "ContentReviewError";
  }
}

export type ContentReviewDecision =
  | "approve"
  | "reject"
  | "request_changes"
  | "partial_revision"
  | "full_regeneration"
  | "additional_research"
  | "abandon";

/**
 * Human content version review — Application Service.
 * Never mutates existing version body; status transitions only.
 */
export class ContentReviewService {
  constructor(
    private readonly repo: LifecycleRepository,
    private readonly p6: P6Repository,
  ) {}

  async decide(input: {
    contentVersionId: string;
    decision: ContentReviewDecision;
    actor: string;
    reason?: string;
    correlationId?: string;
    /** Distinguishes human vs policy-driven auto approval in AuditEvent. */
    approvalPolicy?: "manual" | "auto";
  }): Promise<ContentVersion> {
    const version = await this.repo.findContentVersion(input.contentVersionId);
    if (!version) {
      throw new ContentReviewError(`ContentVersion not found: ${input.contentVersionId}`, "not_found");
    }

    if (input.decision === "approve") {
      return this.approve(
        version,
        input.actor,
        input.reason,
        input.correlationId,
        input.approvalPolicy ?? "manual",
      );
    }

    const nextStatus = this.mapDecisionToStatus(input.decision, version.status);
    const updated = await this.repo.updateContentVersionStatus(version.id, nextStatus);
    await this.p6.createAuditEvent({
      eventType: "content.review",
      actor: input.actor,
      targetType: "ContentVersion",
      targetId: version.id,
      action: input.decision,
      summary: input.reason ?? input.decision,
      details: {
        previousStatus: version.status,
        nextStatus,
        contentId: version.contentId,
        versionNumber: version.versionNumber,
        correlationId: input.correlationId ?? null,
        approvalPolicy: input.approvalPolicy ?? "manual",
      },
    });
    return updated;
  }

  private async approve(
    version: ContentVersion,
    actor: string,
    reason?: string,
    correlationId?: string,
    approvalPolicy: "manual" | "auto" = "manual",
  ): Promise<ContentVersion> {
    if (version.status !== ContentVersionStatus.REVIEWING) {
      throw new ContentReviewError(
        `Cannot approve ContentVersion in status ${version.status} (REVIEWING required)`,
        "invalid_state_transition",
      );
    }

    const latest = await this.repo.findLatestContentVersion(version.contentId);
    if (!latest || latest.id !== version.id) {
      throw new ContentReviewError(
        "Cannot approve a non-latest ContentVersion — approve the latest version only",
        "invalid_state_transition",
      );
    }

    const detail = await this.repo.inspectContentLifecycle(version.contentId);
    const full = detail?.versions.find((v) => v.id === version.id);
    const reviews = (full?.reviews ?? []) as QualityReviewRecord[];
    if (reviews.length === 0) {
      throw new ContentReviewError(
        "Cannot approve ContentVersion without canonical quality reviews (Review not executed)",
        "review_failed",
      );
    }
    if (reviews.some((r) => r.result === "FAILED")) {
      throw new ContentReviewError(
        "Cannot approve ContentVersion with FAILED quality review",
        "review_failed",
      );
    }
    const hasPassSignal = reviews.some(
      (r) => r.result === "PASSED" || r.result === "WARNING",
    );
    if (!hasPassSignal) {
      throw new ContentReviewError(
        "Cannot approve ContentVersion without PASSED/WARNING quality review result",
        "review_failed",
      );
    }

    const claims = full?.versionClaims?.map((vc) => vc.claim) ?? [];
    const blocked = claims.filter(
      (c) =>
        c.status === ClaimStatus.UNSUPPORTED ||
        c.status === ClaimStatus.DISPUTED ||
        c.status === ClaimStatus.REJECTED,
    );
    if (blocked.length > 0) {
      throw new ContentReviewError(
        `Cannot approve: blocked claims ${blocked.map((c) => c.id).join(",")}`,
        "claim_blocked",
      );
    }

    const updated = await this.repo.updateContentVersionStatus(
      version.id,
      ContentVersionStatus.APPROVED,
    );
    await this.p6.createAuditEvent({
      eventType: "content.review",
      actor,
      targetType: "ContentVersion",
      targetId: version.id,
      action: "approve",
      summary: reason ?? "ContentVersion approved",
      details: {
        contentId: version.contentId,
        versionNumber: version.versionNumber,
        correlationId: correlationId ?? null,
        approvalPolicy,
        previousStatus: version.status,
        nextStatus: ContentVersionStatus.APPROVED,
      },
    });
    return updated;
  }

  private mapDecisionToStatus(
    decision: Exclude<ContentReviewDecision, "approve">,
    current: ContentVersionStatus,
  ): ContentVersionStatus {
    switch (decision) {
      case "reject":
        return ContentVersionStatus.REJECTED;
      case "request_changes":
      case "partial_revision":
      case "full_regeneration":
      case "additional_research":
        if (
          current !== ContentVersionStatus.REVIEWING &&
          current !== ContentVersionStatus.REVISION_REQUIRED
        ) {
          throw new ContentReviewError(
            `Cannot ${decision} from status ${current}`,
            "invalid_state_transition",
          );
        }
        return ContentVersionStatus.REVISION_REQUIRED;
      case "abandon":
        return ContentVersionStatus.ARCHIVED;
      default:
        throw new ContentReviewError(`Unknown decision`, "invalid_state_transition");
    }
  }
}
