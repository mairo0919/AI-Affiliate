import type {
  AffiliateProduct,
  AnalyticsSnapshot,
  Content,
  ContentVersion,
  LifecycleRepository,
  LinkReplacementEvent,
  MonetizationStatus,
  PublicationApprovalMode,
  PublicationPlatform,
  PublicationTarget,
} from "@ai-affiliate/database";
import type { PublisherAdapter } from "../adapters/types.js";
import { ManualAnalyticsAdapter } from "../adapters/analytics/manual-analytics-adapter.js";
import { ContentLifecycleService } from "../lifecycle/lifecycle-service.js";
import { LinkReplacementService } from "../publication/link-replacement-service.js";
import type { LinkPolicyConfig } from "../publication/link-types.js";
import { generateBloggerArticle, generateXPost } from "./content-generators.js";
import { PublicationQueueRunner, type PublicationQueueConfig } from "./publication-queue.js";
import { buildXExport, type XExportPayload } from "./x-export.js";

export interface OpsServiceDeps {
  repo: LifecycleRepository;
  lifecycle: ContentLifecycleService;
  publishers: Partial<Record<PublicationPlatform, PublisherAdapter>>;
  queueConfig: PublicationQueueConfig;
  linkPolicy: LinkPolicyConfig;
  analytics?: ManualAnalyticsAdapter;
}

export interface ManualProductInput {
  providerKey?: string;
  externalProductId: string;
  title: string;
  url?: string | null;
  affiliateUrl?: string | null;
  officialUrl?: string | null;
  availability?: string;
  adultFlag?: boolean;
  productMatchKey?: string;
  notes?: string;
}

export interface P3P4VerticalSummary {
  product: AffiliateProduct;
  topicId: string;
  strategyId: string;
  claimIds: string[];
  bloggerContentId: string;
  bloggerVersionId: string;
  xContentId: string;
  xVersionId: string;
  bloggerTargetId: string;
  xTargetId: string;
  bloggerStatus: string;
  xExport: XExportPayload;
  analyticsId: string;
  queueProcessed: number;
  monetizationStatus: MonetizationStatus;
}

export class OpsService {
  private readonly repo: LifecycleRepository;
  private readonly lifecycle: ContentLifecycleService;
  private readonly publishers: Partial<Record<PublicationPlatform, PublisherAdapter>>;
  private readonly queueConfig: PublicationQueueConfig;
  private readonly analytics: ManualAnalyticsAdapter;
  private readonly replacements: LinkReplacementService;

  constructor(deps: OpsServiceDeps) {
    this.repo = deps.repo;
    this.lifecycle = deps.lifecycle;
    this.publishers = deps.publishers;
    this.queueConfig = deps.queueConfig;
    this.analytics = deps.analytics ?? new ManualAnalyticsAdapter();
    this.replacements = new LinkReplacementService(deps.repo);
  }

  /**
   * Register a product without Affiliate API (manual / public URL metadata).
   */
  async registerManualProduct(input: ManualProductInput): Promise<AffiliateProduct> {
    await this.repo.upsertAffiliateProvider({
      providerKey: input.providerKey ?? "manual-import",
      displayName: input.providerKey === "fanza" ? "FANZA (DMM Adult)" : "Manual Import",
      capabilities: {
        apiSearch: false,
        apiProductFetch: false,
        productFeed: false,
        manualImport: true,
        htmlFetch: false,
        affiliateLinkGeneration: Boolean(input.affiliateUrl),
        conversionReport: false,
      },
      metadata: { family: input.providerKey === "fanza" ? "dmm" : "manual", site: input.providerKey ?? "manual-import" },
    });

    const matchKey =
      input.productMatchKey?.trim() ||
      `${input.providerKey ?? "manual-import"}:${input.externalProductId}`;

    const product = await this.repo.upsertAffiliateProduct({
      providerKey: input.providerKey ?? "manual-import",
      externalProductId: input.externalProductId,
      title: input.title,
      url: input.url ?? null,
      affiliateUrl: input.affiliateUrl ?? null,
      adultFlag: input.adultFlag ?? true,
      availability: input.availability ?? "AVAILABLE",
      normalized: {
        title: input.title,
        source: "manual-or-public-url",
        notes: input.notes ?? null,
      },
      metadata: {
        productMatchKey: matchKey,
        importMode: "manual",
        ...(input.officialUrl
          ? { officialUrls: [{ provider: "official", url: input.officialUrl }] }
          : {}),
      },
    });

    // Sync ProductLinks via lifecycle createPublicationTarget path later;
    // also warm links by creating a throwaway resolve through topic flow.
    return product;
  }

  /**
   * Research without Affiliate API: register SourceDocument + Finding from a public URL note.
   */
  async registerPublicUrlResearch(input: {
    url: string;
    title?: string;
    summary: string;
    claimStatement: string;
    strategyId?: string;
    contentVersionId?: string;
  }) {
    return this.lifecycle.registerFindingAndClaim({
      sourceKey: "public-url",
      documentType: "public-page-note",
      documentTitle: input.title ?? input.url,
      documentText: `${input.summary}\nSource: ${input.url}`,
      findingSummary: input.summary,
      claimStatement: input.claimStatement,
      strategyId: input.strategyId,
      contentVersionId: input.contentVersionId,
    });
  }

  async generateChannelContent(input: {
    topicId: string;
    strategyId: string;
    channel: "BLOGGER" | "X";
    claimStatements?: string[];
    productTitle: string;
    productUrl?: string | null;
    bloggerUrl?: string | null;
    unmonetized?: boolean;
    claimId?: string;
  }): Promise<{ content: Content; version: ContentVersion }> {
    const draft =
      input.channel === "BLOGGER"
        ? generateBloggerArticle({
            productTitle: input.productTitle,
            productUrl: input.productUrl,
            topicTitle: input.productTitle,
            claimStatements: input.claimStatements,
            unmonetized: input.unmonetized,
          })
        : generateXPost({
            productTitle: input.productTitle,
            productUrl: input.productUrl,
            bloggerUrl: input.bloggerUrl,
          });

    const created = await this.lifecycle.createContentWithVersion({
      topicId: input.topicId,
      strategyId: input.strategyId,
      title: draft.title,
      body: draft.body,
      summary: draft.summary,
      claimId: input.claimId,
      primaryLanguage: "ja",
    });

    // Normal product URL without affiliate = pending monetization (not "no link at all").
    const monetizationStatus =
      !input.productUrl && input.unmonetized
        ? "UNMONETIZED"
        : !input.productUrl
          ? "UNMONETIZED"
          : input.unmonetized || !input.productUrl.includes("/aff/")
            ? "PENDING_AFFILIATE"
            : "MONETIZED";
    await this.repo.updateContentMonetization(created.content.id, monetizationStatus);

    if (input.channel === "BLOGGER" && "seo" in draft) {
      await this.repo.updateContentVersionStructuredContent(created.version.id, {
        seo: draft.seo,
        channel: "BLOGGER",
        disclosure: true,
        generator: "rule-based-fallback",
        requiresManualReview: true,
      });
    } else {
      await this.repo.updateContentVersionStructuredContent(created.version.id, {
        channel: "X",
        generator: "rule-based-fallback",
        requiresManualReview: true,
      });
    }

    // Rule-based drafts are fallback only — never auto-publishable without human review.
    await this.repo.createReview({
      reviewType: "rule-based-fallback",
      reviewerType: "system",
      targetType: "ContentVersion",
      targetId: created.version.id,
      contentVersionId: created.version.id,
      criteria: { generator: "rule-based-fallback" },
      result: "MANUAL_REVIEW_REQUIRED",
      findings: [
        {
          code: "RULE_BASED_FALLBACK",
          message:
            "Rule-based generator used (mock/fallback). Manual review required before publication.",
        },
      ],
      requiredActions: ["human_review"],
    });
    await this.repo.updateContentVersionStatus(created.version.id, "REVIEWING");

    return {
      content: (await this.repo.findContent(created.content.id)) ?? created.content,
      version: (await this.repo.findContentVersion(created.version.id)) ?? created.version,
    };
  }

  async createDualPublicationPlan(input: {
    bloggerContentId: string;
    bloggerVersionId: string;
    xContentId: string;
    xVersionId: string;
    bloggerApprovalMode?: PublicationApprovalMode;
    xApprovalMode?: PublicationApprovalMode;
    scheduleBloggerAt?: Date | null;
    scheduleXAt?: Date | null;
  }): Promise<{ blogger: PublicationTarget; x: PublicationTarget }> {
    const blogger = await this.lifecycle.createPublicationTarget({
      contentId: input.bloggerContentId,
      contentVersionId: input.bloggerVersionId,
      platform: "BLOGGER",
      targetFormat: "article",
      approvalMode: input.bloggerApprovalMode ?? "DRAFT_ONLY",
    });
    if (input.scheduleBloggerAt) {
      await this.repo.updatePublicationTarget(blogger.id, {
        scheduledAt: input.scheduleBloggerAt,
        status: "SCHEDULED",
      });
    }

    const x = await this.lifecycle.createPublicationTarget({
      contentId: input.xContentId,
      contentVersionId: input.xVersionId,
      platform: "X",
      targetFormat: "short-post",
      approvalMode: input.xApprovalMode ?? "MANUAL",
    });
    if (input.scheduleXAt) {
      await this.repo.updatePublicationTarget(x.id, {
        scheduledAt: input.scheduleXAt,
        status: "SCHEDULED",
      });
    }

    return {
      blogger: (await this.repo.findPublicationTarget(blogger.id)) ?? blogger,
      x: (await this.repo.findPublicationTarget(x.id)) ?? x,
    };
  }

  async humanApprove(targetId: string): Promise<PublicationTarget> {
    return this.lifecycle.approvePublicationTarget(targetId);
  }

  /**
   * Publish or save draft based on approvalMode.
   */
  async publishOrDraft(targetId: string): Promise<PublicationTarget> {
    const target = await this.repo.findPublicationTarget(targetId);
    if (!target) throw new Error(`PublicationTarget not found: ${targetId}`);

    if (target.approvalMode === "DRAFT_ONLY" || target.platform === "BLOGGER") {
      // Blogger default path in P3: mock draft unless explicitly MANUAL+publish
      if (target.approvalMode === "DRAFT_ONLY") {
        return this.mockDraft(targetId);
      }
    }

    return this.lifecycle.mockPublish(targetId);
  }

  async mockDraft(targetId: string): Promise<PublicationTarget> {
    let target = await this.repo.findPublicationTarget(targetId);
    if (!target) throw new Error(`PublicationTarget not found: ${targetId}`);

    if (target.status === "AWAITING_APPROVAL") {
      target = await this.lifecycle.approvePublicationTarget(targetId);
    }
    if (target.status !== "APPROVED" && target.status !== "SCHEDULED") {
      throw new Error(`Target must be APPROVED or SCHEDULED for draft save (got ${target.status})`);
    }

    const version = await this.repo.findContentVersion(target.contentVersionId);
    if (!version) throw new Error(`ContentVersion not found: ${target.contentVersionId}`);
    const publisher = this.publishers[target.platform];
    if (!publisher) throw new Error(`No publisher for ${target.platform}`);

    const meta =
      version.structuredContent && typeof version.structuredContent === "object"
        ? (version.structuredContent as Record<string, unknown>)
        : {};

    const prepared = await publisher.prepare({
      contentVersionId: version.id,
      title: version.title,
      body: version.body,
      targetFormat: target.targetFormat,
      destinationRef: target.destinationRef,
      metadata: { mode: "draft", seo: meta.seo ?? null },
    });
    const published = await publisher.publish({
      prepared,
      destinationRef: target.destinationRef,
    });

    await this.repo.createPublicationRecord({
      publicationTargetId: targetId,
      platform: target.platform,
      status: published.status,
      externalId: published.externalId,
      url: published.url,
      responseSummary: published.responseSummary ?? null,
    });

    return this.repo.updatePublicationTarget(targetId, {
      status: "DRAFT",
      publishedExternalId: published.externalId,
      publishedUrl: published.url,
      publishedAt: new Date(),
    });
  }

  async exportX(contentVersionId: string, publicationTargetId?: string): Promise<XExportPayload> {
    const version = await this.repo.findContentVersion(contentVersionId);
    if (!version) throw new Error(`ContentVersion not found: ${contentVersionId}`);
    const target = publicationTargetId
      ? await this.repo.findPublicationTarget(publicationTargetId)
      : null;
    return buildXExport({
      contentId: version.contentId,
      version,
      target,
    });
  }

  async runPublicationQueue(limit?: number) {
    const runner = new PublicationQueueRunner(this.repo, this.queueConfig, async (id) =>
      this.publishOrDraft(id),
    );
    return runner.run({ limit });
  }

  async ingestManualAnalytics(input: {
    platform: string;
    contentId?: string;
    publicationTargetId?: string;
    metrics: Record<string, number>;
    notes?: string;
  }): Promise<AnalyticsSnapshot> {
    const adapterResult = await this.analytics.ingestMetrics({
      platform: input.platform,
      relatedType: "Content",
      relatedId: input.contentId ?? "unknown",
      metrics: input.metrics,
      metadata: { notes: input.notes ?? null },
    });

    return this.repo.createAnalyticsSnapshot({
      platform: input.platform,
      contentId: input.contentId ?? null,
      publicationTargetId: input.publicationTargetId ?? null,
      metrics: input.metrics,
      source: "manual",
      notes: input.notes ?? null,
      metadata: { adapterId: adapterResult.id },
    });
  }

  async listUnmonetizedContent(limit = 50): Promise<Content[]> {
    return this.repo.listContentByMonetization("UNMONETIZED", limit);
  }

  async markPendingAffiliate(contentId: string): Promise<Content> {
    return this.repo.updateContentMonetization(contentId, "PENDING_AFFILIATE");
  }

  async proposeAffiliateReplacement(input: {
    productLinkId: string;
    contentId: string;
    sourceContentVersionId: string;
    sourcePublicationTargetId?: string;
    previousUrl: string;
    nextUrl: string;
    changeReason?: string;
  }): Promise<LinkReplacementEvent> {
    return this.replacements.propose({
      ...input,
      changeReason: input.changeReason ?? "affiliate-api-available",
    });
  }

  async approveAffiliateReplacement(eventId: string, approvedBy: string) {
    return this.replacements.approve(eventId, approvedBy);
  }

  async applyAffiliateReplacement(eventId: string, approvedBy: string) {
    return this.replacements.apply({
      eventId,
      approvedBy,
      publishers: this.publishers,
    });
  }

  /**
   * Full P3/P4 thin slice without Affiliate / Blogger / X real APIs.
   */
  private async ensureMinimalPolicies(): Promise<void> {
    const existing = await this.repo.listEnabledPolicies();
    if (existing.length > 0) return;
    await this.repo.createPolicyRule({
      policyType: "adult",
      scope: "content",
      ruleIdentifier: "adult-flag-required",
      severity: "BLOCKING",
      condition: { check: "adultFlag", requireAdultFlag: true },
      resultOnMatch: "BLOCKED",
      message: "Adult catalog content requires adultFlag=true",
    });
    await this.repo.createPolicyRule({
      policyType: "disclosure",
      scope: "content",
      ruleIdentifier: "affiliate-disclosure-required",
      severity: "WARNING",
      condition: { check: "disclosure" },
      resultOnMatch: "WARNING",
      message: "Affiliate disclosure should be present",
    });
  }

  async runP3P4VerticalSlice(): Promise<P3P4VerticalSummary> {
    await this.ensureMinimalPolicies();

    const product = await this.registerManualProduct({
      providerKey: "fanza",
      externalProductId: "ops-manual-1",
      title: "Sample Catalog Item Ops",
      url: "https://example.invalid/fanza/ops-manual-1",
      officialUrl: "https://example.invalid/maker/ops-manual-1",
      notes: "Registered without Affiliate API",
    });

    const topic = await this.lifecycle.createTopicFromProduct(product.id);
    const strategy = await this.lifecycle.createRuleBasedStrategy(topic.id);

    const research1 = await this.registerPublicUrlResearch({
      url: "https://example.invalid/notes/ops-manual-1",
      title: "Public catalog note",
      summary: "Sample Catalog Item Ops appears in the public catalog listing.",
      claimStatement: "Sample Catalog Item Ops is listed in a public catalog page.",
      strategyId: strategy.id,
    });
    const research2 = await this.registerPublicUrlResearch({
      url: "https://example.invalid/notes/ops-manual-1-availability",
      title: "Availability note",
      summary: "Availability is marked as AVAILABLE in the mock catalog.",
      claimStatement: "Sample Catalog Item Ops availability is AVAILABLE.",
      strategyId: strategy.id,
    });

    const blogger = await this.generateChannelContent({
      topicId: topic.id,
      strategyId: strategy.id,
      channel: "BLOGGER",
      productTitle: product.title,
      productUrl: product.url,
      claimStatements: [research1.claim.statement, research2.claim.statement],
      claimId: research1.claim.id,
      unmonetized: !product.affiliateUrl,
    });

    await this.lifecycle.registerFindingAndClaim({
      sourceKey: "public-url",
      findingSummary: "Claim attached to blogger version",
      claimStatement: research2.claim.statement,
      strategyId: strategy.id,
      contentVersionId: blogger.version.id,
    });

    await this.lifecycle.evaluatePolicies("ContentVersion", blogger.version.id);
    await this.lifecycle.runMockReview(blogger.version.id);

    const x = await this.generateChannelContent({
      topicId: topic.id,
      strategyId: strategy.id,
      channel: "X",
      productTitle: product.title,
      productUrl: product.url,
      claimId: research1.claim.id,
      unmonetized: !product.affiliateUrl,
    });

    const plan = await this.createDualPublicationPlan({
      bloggerContentId: blogger.content.id,
      bloggerVersionId: blogger.version.id,
      xContentId: x.content.id,
      xVersionId: x.version.id,
      bloggerApprovalMode: "DRAFT_ONLY",
      xApprovalMode: "MANUAL",
    });

    await this.humanApprove(plan.blogger.id);
    const bloggerDraft = await this.mockDraft(plan.blogger.id);

    await this.humanApprove(plan.x.id);
    // X stays approved for export (no auto live publish in P3/P4 without API)
    const xExport = await this.exportX(x.version.id, plan.x.id);

    const analytics = await this.ingestManualAnalytics({
      platform: "BLOGGER",
      contentId: blogger.content.id,
      publicationTargetId: bloggerDraft.id,
      metrics: { pageViews: 12, clicks: 1 },
      notes: "Manual analytics after draft",
    });

    // Queue: schedule a second approved target if any remain; process soft queue
    const queue = await this.runPublicationQueue(2);

    const refreshed = await this.repo.findContent(blogger.content.id);

    return {
      product,
      topicId: topic.id,
      strategyId: strategy.id,
      claimIds: [research1.claim.id, research2.claim.id],
      bloggerContentId: blogger.content.id,
      bloggerVersionId: blogger.version.id,
      xContentId: x.content.id,
      xVersionId: x.version.id,
      bloggerTargetId: bloggerDraft.id,
      xTargetId: plan.x.id,
      bloggerStatus: bloggerDraft.status,
      xExport,
      analyticsId: analytics.id,
      queueProcessed: queue.processed.length,
      monetizationStatus: refreshed?.monetizationStatus ?? "UNMONETIZED",
    };
  }
}
