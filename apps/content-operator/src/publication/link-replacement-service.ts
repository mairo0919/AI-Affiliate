import type {
  ContentVersion,
  LifecycleRepository,
  LinkReplacementEvent,
  PublicationPlatform,
  PublicationTarget,
} from "@ai-affiliate/database";
import type { PublisherAdapter } from "../adapters/types.js";
import { assertPublicBodyClean, sanitizePublicBody } from "./public-body-sanitizer.js";

export interface ProposeLinkReplacementInput {
  productLinkId: string;
  contentId: string;
  sourceContentVersionId: string;
  sourcePublicationTargetId?: string | null;
  previousUrl: string;
  nextUrl: string;
  changeReason: string;
  candidateAffiliateProductId?: string | null;
  matchedProvider?: string | null;
  matchConfidence?: number | null;
}

export interface ApplyLinkReplacementInput {
  eventId: string;
  approvedBy: string;
  publishers: Partial<Record<PublicationPlatform, PublisherAdapter>>;
}

export interface ApplyLinkReplacementResult {
  event: LinkReplacementEvent;
  newVersion: ContentVersion;
  newTarget: PublicationTarget;
}

/**
 * Affiliate URL replacement for already-published content:
 * propose → human approve → new ContentVersion → new/update PublicationTarget → publish/update record.
 * Never mutates the published body in place.
 */
export class LinkReplacementService {
  constructor(private readonly repo: LifecycleRepository) {}

  async propose(input: ProposeLinkReplacementInput): Promise<LinkReplacementEvent> {
    await this.repo.updateProductLinkReplacement(input.productLinkId, {
      replacementStatus: "CANDIDATE_FOUND",
      candidateAffiliateUrl: input.nextUrl,
      candidateAffiliateProductId: input.candidateAffiliateProductId ?? null,
      matchedProvider: input.matchedProvider ?? null,
      matchConfidence: input.matchConfidence ?? 1,
      matchReason: input.changeReason,
      detectedAt: new Date(),
    });

    return this.repo.createLinkReplacementEvent({
      productLinkId: input.productLinkId,
      contentId: input.contentId,
      sourceContentVersionId: input.sourceContentVersionId,
      sourcePublicationTargetId: input.sourcePublicationTargetId ?? null,
      previousUrl: input.previousUrl,
      nextUrl: input.nextUrl,
      changeReason: input.changeReason,
      status: "AWAITING_APPROVAL",
      metadata: {
        candidateAffiliateProductId: input.candidateAffiliateProductId ?? null,
        matchedProvider: input.matchedProvider ?? null,
        matchConfidence: input.matchConfidence ?? null,
      },
    });
  }

  async approve(eventId: string, approvedBy: string): Promise<LinkReplacementEvent> {
    const event = await this.repo.findLinkReplacementEvent(eventId);
    if (!event) throw new Error(`LinkReplacementEvent not found: ${eventId}`);
    if (event.status !== "AWAITING_APPROVAL" && event.status !== "PROPOSED") {
      throw new Error(`Cannot approve event in status ${event.status}`);
    }

    if (event.productLinkId) {
      await this.repo.updateProductLinkReplacement(event.productLinkId, {
        replacementStatus: "APPROVED",
        approvedAt: new Date(),
        approvedBy,
        candidateAffiliateUrl: event.nextUrl,
      });
    }

    return this.repo.updateLinkReplacementEvent(eventId, {
      status: "APPROVED",
      approvedBy,
      approvedAt: new Date(),
    });
  }

  async apply(input: ApplyLinkReplacementInput): Promise<ApplyLinkReplacementResult> {
    const event = await this.repo.findLinkReplacementEvent(input.eventId);
    if (!event) throw new Error(`LinkReplacementEvent not found: ${input.eventId}`);
    if (event.status !== "APPROVED") {
      throw new Error(`Event must be APPROVED before apply (got ${event.status})`);
    }

    const sourceVersion = await this.repo.findContentVersion(event.sourceContentVersionId);
    if (!sourceVersion) {
      throw new Error(`Source ContentVersion not found: ${event.sourceContentVersionId}`);
    }

    if (!sourceVersion.body.includes(event.previousUrl)) {
      throw new Error("Source version body does not contain previousUrl; refusing destructive guess");
    }

    const nextBodyRaw = sourceVersion.body.split(event.previousUrl).join(event.nextUrl);
    const sanitized = sanitizePublicBody(nextBodyRaw);
    assertPublicBodyClean(sanitized.body);

    const latestVersion = await this.repo.findLatestContentVersion(event.contentId);
    const versionNumber = (latestVersion?.versionNumber ?? sourceVersion.versionNumber) + 1;

    const newVersion = await this.repo.createContentVersion({
      contentId: event.contentId,
      versionNumber,
      parentVersionId: sourceVersion.id,
      revisionType: "affiliate-link-replacement",
      title: sourceVersion.title,
      summary: sourceVersion.summary,
      body: sanitized.body,
      structuredContent: {
        ...(typeof sourceVersion.structuredContent === "object" &&
        sourceVersion.structuredContent !== null
          ? (sourceVersion.structuredContent as Record<string, unknown>)
          : {}),
        linkReplacementEventId: event.id,
        previousUrl: event.previousUrl,
        nextUrl: event.nextUrl,
      },
      status: "APPROVED",
      createdBy: input.approvedBy,
    });

    const sourceTarget = event.sourcePublicationTargetId
      ? await this.repo.findPublicationTarget(event.sourcePublicationTargetId)
      : null;

    const newTarget = await this.repo.createPublicationTarget({
      contentId: event.contentId,
      contentVersionId: newVersion.id,
      platform: sourceTarget?.platform ?? "BLOGGER",
      destinationRef: sourceTarget?.destinationRef ?? null,
      targetFormat: sourceTarget?.targetFormat ?? null,
      approvalMode: "MANUAL",
      status: "APPROVED",
      approvedAt: new Date(),
      platformMetadata: {
        linkReplacement: {
          eventId: event.id,
          previousUrl: event.previousUrl,
          nextUrl: event.nextUrl,
          changeReason: event.changeReason,
          approvedBy: input.approvedBy,
        },
        publicUrl: event.nextUrl,
      },
    });

    const publisher = input.publishers[newTarget.platform];
    if (!publisher) {
      throw new Error(`No publisher for platform ${newTarget.platform}`);
    }

    const prepared = await publisher.prepare({
      contentVersionId: newVersion.id,
      title: newVersion.title,
      body: newVersion.body,
      targetFormat: newTarget.targetFormat,
      destinationRef: newTarget.destinationRef,
      metadata: { updateOf: sourceTarget?.publishedExternalId ?? null },
    });

    let externalId = sourceTarget?.publishedExternalId ?? null;
    let publishedUrl = sourceTarget?.publishedUrl ?? null;
    if (publisher.capabilities.update && publisher.update && externalId) {
      const updated = await publisher.update({ externalId, prepared });
      externalId = updated.externalId;
      publishedUrl = updated.url;
    } else {
      const published = await publisher.publish({
        prepared,
        destinationRef: newTarget.destinationRef,
      });
      externalId = published.externalId;
      publishedUrl = published.url;
    }

    const record = await this.repo.createPublicationRecord({
      publicationTargetId: newTarget.id,
      platform: newTarget.platform,
      status: "UPDATED",
      externalId,
      url: publishedUrl,
      responseSummary: {
        kind: "affiliate-link-replacement",
        previousUrl: event.previousUrl,
        nextUrl: event.nextUrl,
        changeReason: event.changeReason,
        approvedBy: input.approvedBy,
        replacedAt: new Date().toISOString(),
        sourcePublicationTargetId: event.sourcePublicationTargetId,
      },
    });

    await this.repo.updatePublicationTarget(newTarget.id, {
      status: "PUBLISHED",
      publishedExternalId: externalId,
      publishedUrl,
      publishedAt: new Date(),
    });

    if (event.productLinkId) {
      await this.repo.createProductLinkUsage({
        productLinkId: event.productLinkId,
        contentVersionId: newVersion.id,
        publicationTargetId: newTarget.id,
        publicationRecordId: record.id,
        usageKind: "CTA",
        locationHint: "cta:affiliate-replacement",
        urlSnapshot: event.nextUrl,
      });

      await this.repo.updateProductLinkReplacement(event.productLinkId, {
        replacementStatus: "REPLACED",
        replacedAt: new Date(),
        url: event.nextUrl,
        currentLinkType: "AFFILIATE",
      });
    }

    const applied = await this.repo.updateLinkReplacementEvent(event.id, {
      status: "APPLIED",
      targetContentVersionId: newVersion.id,
      targetPublicationTargetId: newTarget.id,
      publicationRecordId: record.id,
      replacedAt: new Date(),
      approvedBy: input.approvedBy,
      approvedAt: event.approvedAt ?? new Date(),
    });

    return { event: applied, newVersion, newTarget };
  }
}
