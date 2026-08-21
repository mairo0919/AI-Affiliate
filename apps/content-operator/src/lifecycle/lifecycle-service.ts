import type {
  AffiliateProduct,
  Claim,
  Content,
  ContentStrategy,
  ContentVersion,
  LifecycleRepository,
  PublicationPlatform,
  PublicationApprovalMode,
  PublicationTarget,
  QualityReviewRecord,
  ResearchFinding,
  SourceDocument,
  TopicCandidate,
  ProductLinkType,
} from "@ai-affiliate/database";
import type {
  AffiliateProvider,
  LLMProvider,
  NotificationAdapter,
  PublisherAdapter,
} from "../adapters/index.js";
import {
  DEFAULT_LINK_POLICY,
  LinkResolver,
  PublicationPlanner,
  type LinkCandidateInput,
  type LinkPolicyConfig,
} from "../publication/index.js";
import { assertPublicBodyClean, sanitizePublicBody } from "../publication/public-body-sanitizer.js";
import { evaluatePolicies, type PolicyEvaluationSummary, type PolicyTarget } from "./policy-engine.js";

export interface ContentLifecycleServiceDeps {
  repo: LifecycleRepository;
  affiliate: AffiliateProvider;
  llm: LLMProvider;
  publishers: Partial<Record<PublicationPlatform, PublisherAdapter>>;
  notifications?: NotificationAdapter;
  linkPolicy?: LinkPolicyConfig;
}

export interface RegisterFindingAndClaimInput {
  sourceKey: string;
  documentType?: string;
  documentTitle?: string;
  documentText?: string;
  findingType?: string;
  findingSummary: string;
  claimStatement: string;
  strategyId?: string;
  contentVersionId?: string;
  usageType?: string;
}

export interface CreateContentWithVersionInput {
  topicId: string;
  strategyId: string;
  title: string;
  body: string;
  summary?: string;
  claimId?: string;
  primaryLanguage?: string;
}

export interface VerticalSliceSummary {
  products: AffiliateProduct[];
  topic: TopicCandidate;
  strategy: ContentStrategy;
  finding: ResearchFinding;
  claim: Claim;
  content: Content;
  version: ContentVersion;
  policy: PolicyEvaluationSummary;
  review: QualityReviewRecord;
  publicationTarget: PublicationTarget;
  published: PublicationTarget;
}

export class ContentLifecycleService {
  private readonly repo: LifecycleRepository;
  private readonly affiliate: AffiliateProvider;
  private readonly llm: LLMProvider;
  private readonly publishers: Partial<Record<PublicationPlatform, PublisherAdapter>>;
  private readonly notifications?: NotificationAdapter;
  private readonly linkPolicy: LinkPolicyConfig;
  private readonly publicationPlanner: PublicationPlanner;
  private readonly linkResolver: LinkResolver;

  constructor(deps: ContentLifecycleServiceDeps) {
    this.repo = deps.repo;
    this.affiliate = deps.affiliate;
    this.llm = deps.llm;
    this.publishers = deps.publishers;
    this.notifications = deps.notifications;
    this.linkPolicy = deps.linkPolicy ?? DEFAULT_LINK_POLICY;
    this.publicationPlanner = new PublicationPlanner(this.linkPolicy);
    this.linkResolver = new LinkResolver(this.linkPolicy);
  }

  async seedMockProducts(): Promise<AffiliateProduct[]> {
    const job = await this.repo.createOperatorJob({
      jobType: "RESEARCH",
      payload: { action: "seedMockProducts", providerKey: this.affiliate.providerKey },
    });

    await this.repo.upsertAffiliateProvider({
      providerKey: this.affiliate.providerKey,
      displayName: "Mock Affiliate Provider",
      capabilities: this.affiliate.capabilities as unknown as Record<string, unknown>,
      isActive: true,
    });

    await this.repo.ensureBudgetSettings([
      {
        scopeType: "DAILY",
        softLimit: 100_000,
        hardLimit: 200_000,
        warningThreshold: 0.7,
        stopThreshold: 0.95,
      },
      {
        scopeType: "MONTHLY",
        softLimit: 1_000_000,
        hardLimit: 2_000_000,
        warningThreshold: 0.7,
        stopThreshold: 0.95,
      },
    ]);

    const catalog = await this.affiliate.searchProducts("", 10);
    const products: AffiliateProduct[] = [];
    for (const item of catalog) {
      const product = await this.repo.upsertAffiliateProduct({
        providerKey: this.affiliate.providerKey,
        externalProductId: item.externalProductId,
        title: item.title,
        url: item.url ?? null,
        affiliateUrl: item.affiliateUrl ?? null,
        locale: item.locale ?? "ja-JP",
        currency: item.currency ?? "JPY",
        adultFlag: item.adultFlag ?? true,
        availability: item.availability ?? "AVAILABLE",
        normalized: item.normalized,
        metadata: item.metadata ?? null,
      });
      await this.syncProductLinks(product);
      products.push(product);
    }

    await this.repo.completeOperatorJob(job.id, {
      status: "COMPLETED",
      result: { productIds: products.map((p) => p.id) },
    });

    return products;
  }

  async createTopicFromProduct(productId: string): Promise<TopicCandidate> {
    const product = await this.repo.findAffiliateProduct(productId);
    if (!product) {
      throw new Error(`AffiliateProduct not found: ${productId}`);
    }

    return this.repo.createTopicCandidate({
      title: `Topic: ${product.title}`,
      summary: `Catalog-derived topic for ${product.externalProductId}`,
      formatHint: "article",
      formatCategory: "ARTICLE",
      status: "PROPOSED",
      affiliateProductId: product.id,
      selectionReasons: {
        source: "affiliate-product",
        providerKey: product.providerKey,
      },
      metadata: { adultFlag: product.adultFlag },
    });
  }

  async createRuleBasedStrategy(
    topicId: string,
    options?: { learningFeedback?: Record<string, unknown> | null },
  ): Promise<ContentStrategy> {
    const topic = await this.repo.findTopicCandidate(topicId);
    if (!topic) {
      throw new Error(`TopicCandidate not found: ${topicId}`);
    }

    const modelRun = await this.repo.createModelRun({
      provider: this.llm.providerKey,
      model: "mock-llm-v1",
      taskType: "STRATEGY",
      promptIdentifier: options?.learningFeedback
        ? "lifecycle.strategy.with-feedback"
        : "lifecycle.strategy.rule-based",
      promptVersion: "v1",
      status: "RUNNING",
      inputRef: topicId,
      metadata: options?.learningFeedback ? { learningFeedback: options.learningFeedback } : null,
    });

    const llm = await this.llm.executeTask({
      taskType: "STRATEGY",
      promptIdentifier: options?.learningFeedback
        ? "lifecycle.strategy.with-feedback"
        : "lifecycle.strategy.rule-based",
      promptVersion: "v1",
      input: {
        topicId,
        title: topic.title,
        learningFeedback: options?.learningFeedback ?? null,
      },
    });

    await this.repo.completeModelRun(modelRun.id, {
      status: "COMPLETED",
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      cachedTokens: llm.cachedTokens ?? 0,
      estimatedCost: llm.estimatedCost,
      actualCost: llm.estimatedCost,
      currency: llm.currency,
      structuredOutputValid: true,
      outputRef: modelRun.id,
      metadata: { output: llm.output, learningFeedbackApplied: Boolean(options?.learningFeedback) },
    });

    await this.repo.createCostRecord({
      provider: llm.provider,
      serviceOrModel: llm.model,
      operationType: "STRATEGY",
      relatedType: "TopicCandidate",
      relatedId: topicId,
      modelRunId: modelRun.id,
      estimatedAmount: llm.estimatedCost,
      actualAmount: llm.estimatedCost,
      currency: llm.currency,
    });

    const feedbackRules = Array.isArray(options?.learningFeedback?.learningRules)
      ? (options!.learningFeedback!.learningRules as Array<{ statement?: string }>)
      : [];
    const angleSuffix =
      feedbackRules.length > 0
        ? ` | feedback: ${feedbackRules
            .slice(0, 2)
            .map((r) => r.statement ?? "")
            .filter(Boolean)
            .join("; ")}`
        : "";

    return this.repo.createStrategy({
      topicCandidateId: topicId,
      objective: "Introduce catalog item with compliant affiliate disclosure",
      targetAudience: "Japanese adult catalog browsers",
      userIntent: "compare and understand sample catalog item",
      formatCategory: "ARTICLE",
      formatKey: "blogger-article",
      angle: `neutral catalog overview${angleSuffix}`.slice(0, 500),
      primaryChannel: "BLOGGER",
      candidateChannels: ["BLOGGER", "X"],
      affiliateIntent: "soft-cta",
      ctaPolicy: feedbackRules.length > 0 ? "single-cta-preferred" : "disclosure-required",
      requiredClaims: ["catalog-availability"],
      requiredResearch: ["source-document"],
      successMetrics: ["publish-complete", "ctr", "engagement"],
      riskFlags: ["adult-content"],
      status: "READY",
      confidence: feedbackRules.length > 0 ? 0.85 : 0.8,
      modelRunId: modelRun.id,
    });
  }

  async registerFindingAndClaim(input: RegisterFindingAndClaimInput): Promise<{
    document: SourceDocument;
    finding: ResearchFinding;
    claim: Claim;
  }> {
    const job = await this.repo.createOperatorJob({
      jobType: "CLAIM_VALIDATION",
      payload: { action: "registerFindingAndClaim", ...input },
    });

    const document = await this.repo.createSourceDocument({
      sourceKey: input.sourceKey,
      documentType: input.documentType ?? "catalog-note",
      title: input.documentTitle ?? "Sample source document",
      normalizedText: input.documentText ?? input.findingSummary,
      metadata: { abstract: true },
    });

    const finding = await this.repo.createResearchFinding({
      sourceDocumentId: document.id,
      findingType: input.findingType ?? "catalog-fact",
      summary: input.findingSummary,
      confidence: 0.75,
      noveltyScore: 0.5,
    });

    const claim = await this.repo.createClaim({
      statement: input.claimStatement,
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.75,
      classification: "third_party",
      strategyId: input.strategyId ?? null,
      researchFindingId: finding.id,
    });

    await this.repo.addClaimSource({
      claimId: claim.id,
      sourceDocumentId: document.id,
      supportType: "primary",
      excerptOrSummary: input.findingSummary,
      confidence: 0.75,
    });

    if (input.contentVersionId) {
      await this.repo.attachVersionClaim({
        contentVersionId: input.contentVersionId,
        claimId: claim.id,
        usageType: input.usageType ?? "supporting",
        validationStatus: "validated",
      });
    }

    await this.repo.completeOperatorJob(job.id, {
      status: "COMPLETED",
      result: { documentId: document.id, findingId: finding.id, claimId: claim.id },
    });

    return { document, finding, claim };
  }

  async createContentWithVersion(input: CreateContentWithVersionInput): Promise<{
    content: Content;
    version: ContentVersion;
  }> {
    const modelRun = await this.repo.createModelRun({
      provider: this.llm.providerKey,
      model: "mock-llm-v1",
      taskType: "GENERATION",
      promptIdentifier: "lifecycle.content.draft",
      promptVersion: "v1",
      status: "RUNNING",
      inputRef: input.strategyId,
    });

    const llm = await this.llm.executeTask({
      taskType: "GENERATION",
      promptIdentifier: "lifecycle.content.draft",
      promptVersion: "v1",
      input: {
        topicId: input.topicId,
        strategyId: input.strategyId,
        title: input.title,
      },
    });

    await this.repo.completeModelRun(modelRun.id, {
      status: "COMPLETED",
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      cachedTokens: llm.cachedTokens ?? 0,
      estimatedCost: llm.estimatedCost,
      actualCost: llm.estimatedCost,
      currency: llm.currency,
      structuredOutputValid: true,
      metadata: { output: llm.output },
    });

    await this.repo.createCostRecord({
      provider: llm.provider,
      serviceOrModel: llm.model,
      operationType: "GENERATION",
      relatedType: "ContentStrategy",
      relatedId: input.strategyId,
      modelRunId: modelRun.id,
      estimatedAmount: llm.estimatedCost,
      actualAmount: llm.estimatedCost,
      currency: llm.currency,
    });

    const content = await this.repo.createContent({
      topicCandidateId: input.topicId,
      strategyId: input.strategyId,
      status: "GENERATING",
      primaryLanguage: input.primaryLanguage ?? "ja",
      contentPurpose: "affiliate-catalog-overview",
    });

    const version = await this.repo.createContentVersion({
      contentId: content.id,
      versionNumber: 1,
      title: input.title,
      body: input.body,
      summary: input.summary ?? null,
      status: "DRAFT",
      createdBy: "lifecycle-service",
      modelRunId: modelRun.id,
      structuredContent: {
        disclosure: true,
        language: input.primaryLanguage ?? "ja",
      },
    });

    if (input.claimId) {
      await this.repo.attachVersionClaim({
        contentVersionId: version.id,
        claimId: input.claimId,
        usageType: "supporting",
        validationStatus: "validated",
      });
    }

    return { content, version };
  }

  async evaluatePolicies(
    targetType: string,
    targetId: string,
  ): Promise<PolicyEvaluationSummary> {
    const rules = await this.repo.listEnabledPolicies();
    const target = await this.buildPolicyTarget(targetType, targetId);
    const summary = evaluatePolicies(rules, target);

    for (const evaluation of summary.evaluations) {
      await this.repo.createPolicyEvaluation({
        policyRuleId: evaluation.rule.id,
        targetType,
        targetId,
        result: evaluation.matched ? evaluation.result : "PASSED",
        message: evaluation.message,
        details: evaluation.details ?? null,
      });
    }

    return summary;
  }

  async runMockReview(contentVersionId: string): Promise<QualityReviewRecord> {
    const version = await this.repo.findContentVersion(contentVersionId);
    if (!version) {
      throw new Error(`ContentVersion not found: ${contentVersionId}`);
    }

    const job = await this.repo.createOperatorJob({
      jobType: "REVIEW",
      payload: { action: "runMockReview", contentVersionId },
    });

    const modelRun = await this.repo.createModelRun({
      provider: this.llm.providerKey,
      model: "mock-llm-v1",
      taskType: "REVIEW",
      promptIdentifier: "lifecycle.review.mock",
      promptVersion: "v1",
      status: "RUNNING",
      inputRef: contentVersionId,
    });

    const llm = await this.llm.executeTask({
      taskType: "REVIEW",
      input: { contentVersionId, title: version.title },
    });

    await this.repo.completeModelRun(modelRun.id, {
      status: "COMPLETED",
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      estimatedCost: llm.estimatedCost,
      actualCost: llm.estimatedCost,
      currency: llm.currency,
      structuredOutputValid: true,
    });

    await this.repo.createCostRecord({
      provider: llm.provider,
      serviceOrModel: llm.model,
      operationType: "REVIEW",
      relatedType: "ContentVersion",
      relatedId: contentVersionId,
      modelRunId: modelRun.id,
      estimatedAmount: llm.estimatedCost,
      actualAmount: llm.estimatedCost,
      currency: llm.currency,
    });

    const review = await this.repo.createReview({
      reviewType: "quality",
      reviewerType: "mock-llm",
      targetType: "ContentVersion",
      targetId: contentVersionId,
      contentVersionId,
      criteria: { abstractSafety: true, claimLinked: true },
      result: "PASSED",
      score: 0.9,
      findings: [{ code: "ok", message: "Mock review passed" }],
      requiredActions: [],
      modelRunId: modelRun.id,
    });

    await this.repo.createRevisionAction({
      reviewId: review.id,
      actionType: "none",
      rationale: "No revision required after mock review",
    });

    await this.repo.completeOperatorJob(job.id, {
      status: "COMPLETED",
      result: { reviewId: review.id },
    });

    return review;
  }

  async createPublicationTarget(input: {
    contentId: string;
    contentVersionId: string;
    platform: PublicationPlatform;
    destinationRef?: string;
    targetFormat?: string;
    approvalMode?: PublicationApprovalMode;
  }): Promise<PublicationTarget> {
    const content = await this.repo.findContent(input.contentId);
    if (!content) {
      throw new Error(`Content not found: ${input.contentId}`);
    }

    const reviews = await this.repo.listReviewsForContentVersion(input.contentVersionId);
    if (reviews.some((r) => r.result === "FAILED")) {
      throw new Error(
        `Cannot create PublicationTarget: ContentVersion ${input.contentVersionId} has FAILED quality review`,
      );
    }

    let linkInput: LinkCandidateInput = {
      productMatchKey: `content:${input.contentId}`,
      offers: [],
      officialUrls: [],
      trustedUrls: [],
    };
    let selectedProductLinkId: string | null = null;

    if (content.topicCandidateId) {
      const topic = await this.repo.findTopicCandidate(content.topicCandidateId);
      if (topic?.affiliateProductId) {
        const product = await this.repo.findAffiliateProduct(topic.affiliateProductId);
        if (product) {
          linkInput = toLinkCandidateInput(product);
          const links = await this.syncProductLinks(product);
          const selected = links.find((l) => l.isSelected) ?? links[0] ?? null;
          selectedProductLinkId = selected?.id ?? null;
        }
      }
    }

    const plan = this.publicationPlanner.plan({
      contentId: input.contentId,
      contentVersionId: input.contentVersionId,
      platform: input.platform,
      destinationRef: input.destinationRef ?? null,
      targetFormat: input.targetFormat ?? null,
      approvalMode: input.approvalMode ?? "MANUAL",
      linkInput,
    });

    const target = await this.repo.createPublicationTarget({
      contentId: input.contentId,
      contentVersionId: input.contentVersionId,
      platform: input.platform,
      destinationRef: input.destinationRef ?? null,
      targetFormat: input.targetFormat ?? null,
      approvalMode: plan.approvalMode,
      status: "AWAITING_APPROVAL",
      platformMetadata: {
        ...plan.platformMetadata,
        selectedProductLinkId,
      },
    });

    if (selectedProductLinkId && plan.selectedLink.url) {
      await this.repo.createProductLinkUsage({
        productLinkId: selectedProductLinkId,
        contentVersionId: input.contentVersionId,
        publicationTargetId: target.id,
        usageKind: "CTA",
        locationHint: "cta",
        urlSnapshot: plan.selectedLink.url,
      });
    }

    return target;
  }

  async approvePublicationTarget(id: string): Promise<PublicationTarget> {
    const target = await this.repo.findPublicationTarget(id);
    if (!target) {
      throw new Error(`PublicationTarget not found: ${id}`);
    }
    if (target.status !== "AWAITING_APPROVAL" && target.status !== "DRAFT") {
      throw new Error(`Cannot approve publication target in status ${target.status}`);
    }
    const reviews = await this.repo.listReviewsForContentVersion(target.contentVersionId);
    if (reviews.some((r) => r.result === "FAILED")) {
      throw new Error(
        `Cannot approve PublicationTarget: ContentVersion has FAILED quality review`,
      );
    }
    return this.repo.updatePublicationTarget(id, {
      status: "APPROVED",
      approvedAt: new Date(),
    });
  }

  async mockPublish(targetId: string): Promise<PublicationTarget> {
    const target = await this.repo.findPublicationTarget(targetId);
    if (!target) {
      throw new Error(`PublicationTarget not found: ${targetId}`);
    }
    if (target.status !== "APPROVED" && target.status !== "SCHEDULED") {
      throw new Error(`Publication target must be APPROVED before publish (got ${target.status})`);
    }

    const version = await this.repo.findContentVersion(target.contentVersionId);
    if (!version) {
      throw new Error(`ContentVersion not found: ${target.contentVersionId}`);
    }

    const publisher = this.publishers[target.platform];
    if (!publisher) {
      throw new Error(`No publisher adapter for platform ${target.platform}`);
    }

    const job = await this.repo.createOperatorJob({
      jobType: "PUBLICATION",
      payload: { action: "mockPublish", targetId },
    });

    await this.repo.updatePublicationTarget(targetId, { status: "PUBLISHING" });

    const publicBody = sanitizePublicBody(version.body).body;
    assertPublicBodyClean(publicBody);

    const prepared = await publisher.prepare({
      contentVersionId: version.id,
      title: version.title,
      body: publicBody,
      targetFormat: target.targetFormat,
      destinationRef: target.destinationRef,
    });

    const published = await publisher.publish({
      prepared,
      destinationRef: target.destinationRef,
    });

    const record = await this.repo.createPublicationRecord({
      publicationTargetId: targetId,
      platform: target.platform,
      status: published.status,
      externalId: published.externalId,
      url: published.url,
      responseSummary: published.responseSummary ?? null,
    });

    const meta = (target.platformMetadata ?? {}) as Record<string, unknown>;
    const selectedProductLinkId =
      typeof meta.selectedProductLinkId === "string" ? meta.selectedProductLinkId : null;
    const selectedLink = meta.selectedLink as { url?: string } | undefined;
    if (selectedProductLinkId && selectedLink?.url) {
      await this.repo.createProductLinkUsage({
        productLinkId: selectedProductLinkId,
        contentVersionId: version.id,
        publicationTargetId: targetId,
        publicationRecordId: record.id,
        usageKind: "CTA",
        locationHint: "cta:published",
        urlSnapshot: selectedLink.url,
      });
    }

    const updated = await this.repo.updatePublicationTarget(targetId, {
      status: "PUBLISHED",
      publishedExternalId: published.externalId,
      publishedUrl: published.url,
      publishedAt: new Date(),
    });

    await this.repo.completeOperatorJob(job.id, {
      status: "COMPLETED",
      result: {
        externalId: published.externalId,
        url: published.url,
      },
    });

    await this.notifications?.notify({
      eventType: "publication.published",
      title: "Publication completed",
      message: `Published ${target.platform} target ${targetId}`,
      metadata: { targetId, externalId: published.externalId },
    });

    return updated;
  }

  async inspectLifecycle(contentId: string) {
    const snapshot = await this.repo.inspectContentLifecycle(contentId);
    if (!snapshot) {
      throw new Error(`Content not found: ${contentId}`);
    }
    return snapshot;
  }

  async runVerticalSlice(): Promise<VerticalSliceSummary> {
    const products = await this.seedMockProducts();
    const product = products[0];
    if (!product) {
      throw new Error("seedMockProducts returned no products");
    }

    const topic = await this.createTopicFromProduct(product.id);
    const strategy = await this.createRuleBasedStrategy(topic.id);

    const { finding, claim } = await this.registerFindingAndClaim({
      sourceKey: "mock-source",
      findingSummary: "Sample catalog item is listed as available in the mock catalog.",
      claimStatement: "Sample Catalog Item A is available in the mock affiliate catalog.",
      strategyId: strategy.id,
    });

    const { content, version } = await this.createContentWithVersion({
      topicId: topic.id,
      strategyId: strategy.id,
      title: "Sample Catalog Item A Overview",
      body: [
        "本記事はサンプルカタログ商品の概要です。",
        "アフィリエイトリンクを含む場合があります。",
        "Sample Catalog Item A は抽象的なテスト用カタログ項目です。",
      ].join("\n"),
      summary: "Abstract overview of Sample Catalog Item A",
      claimId: claim.id,
      primaryLanguage: "ja",
    });

    const policy = await this.evaluatePolicies("ContentVersion", version.id);
    if (policy.overall === "BLOCKED") {
      throw new Error(`Policy blocked content version: ${policy.evaluations.map((e) => e.message).join("; ")}`);
    }

    const review = await this.runMockReview(version.id);

    const publicationTarget = await this.createPublicationTarget({
      contentId: content.id,
      contentVersionId: version.id,
      platform: "BLOGGER",
      targetFormat: "article",
      approvalMode: "MANUAL",
    });

    await this.approvePublicationTarget(publicationTarget.id);
    const published = await this.mockPublish(publicationTarget.id);

    return {
      products,
      topic,
      strategy,
      finding,
      claim,
      content,
      version,
      policy,
      review,
      publicationTarget,
      published,
    };
  }

  private async buildPolicyTarget(targetType: string, targetId: string): Promise<PolicyTarget> {
    if (targetType === "ContentVersion") {
      const version = await this.repo.findContentVersion(targetId);
      if (!version) throw new Error(`ContentVersion not found: ${targetId}`);
      const content = await this.repo.findContent(version.contentId);
      let adultFlag: boolean | null = true;
      if (content?.topicCandidateId) {
        const topic = await this.repo.findTopicCandidate(content.topicCandidateId);
        if (topic?.affiliateProductId) {
          const product = await this.repo.findAffiliateProduct(topic.affiliateProductId);
          adultFlag = product?.adultFlag ?? true;
        }
      }
      const structured =
        version.structuredContent && typeof version.structuredContent === "object"
          ? (version.structuredContent as Record<string, unknown>)
          : {};
      return {
        targetType,
        targetId,
        title: version.title,
        body: version.body,
        language: content?.primaryLanguage ?? "ja",
        adultFlag,
        disclosurePresent: structured.disclosure === true || /アフィリエイト/.test(version.body),
      };
    }

    if (targetType === "AffiliateProduct") {
      const product = await this.repo.findAffiliateProduct(targetId);
      if (!product) throw new Error(`AffiliateProduct not found: ${targetId}`);
      return {
        targetType,
        targetId,
        title: product.title,
        body: "",
        language: product.locale?.startsWith("ja") ? "ja" : product.locale,
        adultFlag: product.adultFlag,
        disclosurePresent: true,
      };
    }

    return {
      targetType,
      targetId,
      title: "",
      body: "",
      language: "ja",
      adultFlag: true,
      disclosurePresent: true,
    };
  }

  private async syncProductLinks(product: AffiliateProduct) {
    const { candidates, primary } = this.linkResolver.resolve(toLinkCandidateInput(product));

    return this.repo.replaceProductLinksForProduct(
      product.id,
      candidates.map((c) => ({
        affiliateProductId: product.id,
        productMatchKey: c.productMatchKey,
        url: c.url,
        preferredAffiliateProvider: c.preferredAffiliateProvider,
        currentLinkProvider: c.currentLinkProvider,
        currentLinkType: c.currentLinkType as ProductLinkType,
        replacePriority: c.replacePriority,
        availability: c.availability,
        isSelected:
          primary.url === c.url &&
          primary.currentLinkType === c.currentLinkType &&
          primary.currentLinkProvider === c.currentLinkProvider,
        replacementStatus: c.replacement.replacementStatus as never,
        candidateAffiliateUrl: c.replacement.candidateAffiliateUrl ?? null,
        candidateAffiliateProductId: c.replacement.candidateAffiliateProductId ?? null,
        matchedProvider: c.replacement.matchedProvider ?? null,
        matchConfidence: c.replacement.matchConfidence ?? null,
        matchReason: c.replacement.matchReason ?? null,
        detectedAt: c.replacement.detectedAt ? new Date(c.replacement.detectedAt) : null,
        approvedAt: c.replacement.approvedAt ? new Date(c.replacement.approvedAt) : null,
        approvedBy: c.replacement.approvedBy ?? null,
        replacedAt: c.replacement.replacedAt ? new Date(c.replacement.replacedAt) : null,
        rejectionReason: c.replacement.rejectionReason ?? null,
        metadata: c.metadata ?? null,
      })),
    );
  }
}

function toLinkCandidateInput(product: AffiliateProduct): LinkCandidateInput {
  const meta = (product.metadata ?? {}) as Record<string, unknown>;
  const matchKey =
    typeof meta.productMatchKey === "string" && meta.productMatchKey.trim()
      ? meta.productMatchKey.trim()
      : `${product.providerKey}:${product.externalProductId}`;
  return {
    productMatchKey: matchKey,
    offers: [
      {
        providerKey: product.providerKey,
        productUrl: product.url,
        affiliateUrl: product.affiliateUrl,
        availability: product.availability,
        externalProductId: product.externalProductId,
        productMatchKey: matchKey,
      },
    ],
    officialUrls: readUrlList(meta.officialUrls),
    trustedUrls: readUrlList(meta.trustedUrls),
  };
}

function readUrlList(
  value: unknown,
): Array<{ provider: string; url: string; availability?: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ provider: string; url: string; availability?: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.url !== "string" || !row.url.trim()) continue;
    out.push({
      provider: typeof row.provider === "string" && row.provider.trim() ? row.provider : "unknown",
      url: row.url.trim(),
      ...(typeof row.availability === "string" ? { availability: row.availability } : {}),
    });
  }
  return out;
}
