import {
  Prisma,
  type AffiliateProduct,
  type AffiliateProviderRegistry,
  type BudgetScopeType,
  type BudgetSetting,
  type Claim,
  type ClaimSource,
  type ClaimStatus,
  type ClaimType,
  type Content,
  type ContentFormatCategory,
  type ContentLifecycleStatus,
  type ContentStrategy,
  type ContentVersion,
  type ContentVersionClaim,
  type ContentVersionStatus,
  type CostRecord,
  type ModelRun,
  type ModelRunStatus,
  type OperatorJob,
  type PolicyEvalResult,
  type PolicyEvaluation,
  type PolicyRule,
  type PolicySeverity,
  type PrismaClient,
  type PublicationApprovalMode,
  type PublicationPlatform,
  type PublicationRecord,
  type PublicationTarget,
  type PublicationTargetStatus,
  type AffiliateReplacementStatus,
  type AnalyticsSnapshot,
  type LinkReplacementEvent,
  type LinkReplacementEventStatus,
  type MonetizationStatus,
  type PromptDefinition,
  type ProductLink,
  type ProductLinkType,
  type ProductLinkUsage,
  type ProductLinkUsageKind,
  type QualityReviewRecord,
  type ResearchFinding,
  type ResearchItem,
  type ResearchJobStatus,
  type ResearchJobType,
  type ReviewResult,
  type RevisionAction,
  type SourceDocument,
  type StrategyStatus,
  type TopicCandidate,
} from "@prisma/client";
import { EditorialBrainRepository } from "./editorial-brain-repository.js";

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function jsonOrNull(
  value: unknown | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export interface UpsertAffiliateProviderInput {
  providerKey: string;
  displayName: string;
  capabilities: Record<string, unknown>;
  isActive?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface UpsertAffiliateProductInput {
  providerKey: string;
  externalProductId: string;
  title: string;
  url?: string | null;
  affiliateUrl?: string | null;
  locale?: string;
  currency?: string | null;
  adultFlag?: boolean;
  availability?: string;
  normalized: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

export interface CreateSourceDocumentInput {
  sourceKey: string;
  documentType: string;
  externalId?: string | null;
  url?: string | null;
  title?: string | null;
  contentHash?: string | null;
  publishedAt?: Date | null;
  freshnessScore?: number | null;
  robotsAllowed?: boolean | null;
  termsNotes?: string | null;
  rateLimitNotes?: string | null;
  normalizedText?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateResearchFindingInput {
  findingType: string;
  summary: string;
  sourceDocumentId?: string | null;
  confidence?: number | null;
  noveltyScore?: number | null;
  metadata?: Record<string, unknown> | null;
  observedAt?: Date;
}

export interface CreateTopicCandidateInput {
  title: string;
  summary?: string | null;
  formatHint?: string | null;
  formatCategory?: ContentFormatCategory;
  status?: string;
  selectionReasons?: Record<string, unknown> | null;
  affiliateProductId?: string | null;
  contentCandidateId?: string | null;
  researchItemId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateStrategyInput {
  topicCandidateId: string;
  objective: string;
  targetAudience: string;
  userIntent: string;
  formatCategory: ContentFormatCategory;
  formatKey: string;
  angle: string;
  primaryChannel: PublicationPlatform;
  candidateChannels: unknown;
  affiliateIntent?: string | null;
  ctaPolicy?: string | null;
  timingRationale?: string | null;
  differentiation?: string | null;
  requiredClaims?: unknown;
  requiredResearch?: unknown;
  successMetrics?: unknown;
  riskFlags?: unknown;
  status?: StrategyStatus;
  confidence?: number | null;
  evidenceRefs?: unknown;
  modelRunId?: string | null;
}

export interface CreateContentInput {
  topicCandidateId?: string | null;
  strategyId?: string | null;
  status?: ContentLifecycleStatus;
  primaryLanguage?: string;
  contentPurpose?: string | null;
  monetizationStatus?: MonetizationStatus;
}

export interface CreateAnalyticsSnapshotInput {
  platform: string;
  contentId?: string | null;
  publicationTargetId?: string | null;
  publicationRecordId?: string | null;
  externalId?: string | null;
  measuredAt?: Date;
  metrics: Record<string, number>;
  source?: string;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateContentVersionInput {
  contentId: string;
  versionNumber: number;
  title: string;
  body: string;
  summary?: string | null;
  parentVersionId?: string | null;
  revisionType?: string;
  structuredContent?: Record<string, unknown> | null;
  status?: ContentVersionStatus;
  createdBy?: string;
  modelRunId?: string | null;
}

export interface CreateClaimInput {
  statement: string;
  claimType?: ClaimType;
  status?: ClaimStatus;
  confidence?: number | null;
  freshnessScore?: number | null;
  classification?: string;
  strategyId?: string | null;
  researchFindingId?: string | null;
  metadata?: Record<string, unknown> | null;
  expiresAt?: Date | null;
  lastVerifiedAt?: Date | null;
}

export interface AddClaimSourceInput {
  claimId: string;
  supportType: string;
  excerptOrSummary: string;
  sourceDocumentId?: string | null;
  sourceLocation?: string | null;
  confidence?: number | null;
  contradiction?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface AttachVersionClaimInput {
  contentVersionId: string;
  claimId: string;
  usageType: string;
  sectionRef?: string | null;
  wording?: string | null;
  validationStatus?: string;
}

export interface CreatePolicyRuleInput {
  policyType: string;
  scope: string;
  ruleIdentifier: string;
  resultOnMatch: PolicyEvalResult;
  message: string;
  ruleVersion?: string;
  severity?: PolicySeverity;
  enabled?: boolean;
  condition: Record<string, unknown>;
  targetPlatform?: string | null;
  targetProvider?: string | null;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreatePolicyEvaluationInput {
  targetType: string;
  targetId: string;
  result: PolicyEvalResult;
  policyRuleId?: string | null;
  message?: string | null;
  details?: Record<string, unknown> | null;
}

export interface CreateReviewInput {
  reviewType: string;
  reviewerType: string;
  targetType: string;
  targetId: string;
  criteria: Record<string, unknown>;
  result: ReviewResult;
  findings: unknown;
  contentVersionId?: string | null;
  score?: number | null;
  requiredActions?: unknown;
  status?: string;
  modelRunId?: string | null;
}

export interface CreateRevisionActionInput {
  actionType: string;
  reviewId?: string | null;
  rationale?: string | null;
  improvementDelta?: number | null;
  sameErrorRepeat?: number;
  costDelta?: number | null;
  changeScope?: string | null;
  needsMoreResearch?: boolean;
  needsFullRegenerate?: boolean;
  needsAngleChange?: boolean;
  needsDiscard?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface CreatePublicationTargetInput {
  contentId: string;
  contentVersionId: string;
  platform: PublicationPlatform;
  destinationRef?: string | null;
  targetFormat?: string | null;
  approvalMode?: PublicationApprovalMode;
  status?: PublicationTargetStatus;
  scheduledAt?: Date | null;
  policyResult?: PolicyEvalResult | null;
  platformMetadata?: Record<string, unknown> | null;
  approvedAt?: Date | null;
  publishedExternalId?: string | null;
  publishedUrl?: string | null;
  publishedAt?: Date | null;
}

export interface UpdatePublicationTargetInput {
  status?: PublicationTargetStatus;
  approvalMode?: PublicationApprovalMode;
  destinationRef?: string | null;
  targetFormat?: string | null;
  scheduledAt?: Date | null;
  policyResult?: PolicyEvalResult | null;
  platformMetadata?: Record<string, unknown> | null;
  publishedExternalId?: string | null;
  publishedUrl?: string | null;
  approvedAt?: Date | null;
  publishedAt?: Date | null;
}

export interface CreatePublicationRecordInput {
  publicationTargetId: string;
  platform: PublicationPlatform;
  status: string;
  externalId?: string | null;
  url?: string | null;
  responseSummary?: Record<string, unknown> | null;
  errorCode?: string | null;
}

export interface UpsertProductLinkInput {
  affiliateProductId?: string | null;
  productMatchKey?: string | null;
  url?: string | null;
  preferredAffiliateProvider: string;
  currentLinkProvider: string;
  currentLinkType: ProductLinkType;
  replacePriority: number;
  availability?: string;
  isSelected?: boolean;
  replacementStatus?: AffiliateReplacementStatus;
  candidateAffiliateUrl?: string | null;
  candidateAffiliateProductId?: string | null;
  matchedProvider?: string | null;
  matchConfidence?: number | null;
  matchReason?: string | null;
  detectedAt?: Date | null;
  approvedAt?: Date | null;
  approvedBy?: string | null;
  replacedAt?: Date | null;
  rejectionReason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateProductLinkUsageInput {
  productLinkId: string;
  contentVersionId?: string | null;
  publicationTargetId?: string | null;
  publicationRecordId?: string | null;
  usageKind: ProductLinkUsageKind;
  locationHint?: string | null;
  urlSnapshot?: string | null;
}

export interface CreateLinkReplacementEventInput {
  productLinkId?: string | null;
  contentId: string;
  sourceContentVersionId: string;
  targetContentVersionId?: string | null;
  sourcePublicationTargetId?: string | null;
  targetPublicationTargetId?: string | null;
  publicationRecordId?: string | null;
  previousUrl: string;
  nextUrl: string;
  changeReason: string;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  replacedAt?: Date | null;
  status?: LinkReplacementEventStatus;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateProductLinkReplacementInput {
  replacementStatus?: AffiliateReplacementStatus;
  candidateAffiliateUrl?: string | null;
  candidateAffiliateProductId?: string | null;
  matchedProvider?: string | null;
  matchConfidence?: number | null;
  matchReason?: string | null;
  detectedAt?: Date | null;
  approvedAt?: Date | null;
  approvedBy?: string | null;
  replacedAt?: Date | null;
  rejectionReason?: string | null;
  url?: string | null;
  currentLinkType?: ProductLinkType;
}

export interface CreateModelRunInput {
  provider: string;
  model: string;
  taskType: string;
  promptIdentifier?: string | null;
  promptVersion?: string | null;
  inputRef?: string | null;
  outputRef?: string | null;
  status?: ModelRunStatus;
  metadata?: Record<string, unknown> | null;
}

export interface CompleteModelRunInput {
  status: ModelRunStatus;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  estimatedCost?: number | null;
  actualCost?: number | null;
  currency?: string;
  errorType?: string | null;
  errorDetail?: string | null;
  structuredOutputValid?: boolean | null;
  outputRef?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateCostRecordInput {
  provider: string;
  serviceOrModel: string;
  operationType: string;
  relatedType?: string | null;
  relatedId?: string | null;
  modelRunId?: string | null;
  estimatedAmount?: number | null;
  actualAmount?: number | null;
  currency?: string;
  metadata?: Record<string, unknown> | null;
}

export interface CreateOperatorJobInput {
  jobType: ResearchJobType;
  payload: Record<string, unknown>;
  status?: ResearchJobStatus;
  priority?: number;
  runAfter?: Date | null;
  maxAttempts?: number;
  idempotencyKey?: string | null;
}

export class LifecycleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertAffiliateProvider(
    input: UpsertAffiliateProviderInput,
  ): Promise<AffiliateProviderRegistry> {
    return this.prisma.affiliateProviderRegistry.upsert({
      where: { providerKey: input.providerKey },
      create: {
        providerKey: input.providerKey,
        displayName: input.displayName,
        capabilities: toJson(input.capabilities),
        isActive: input.isActive ?? true,
        metadata: jsonOrNull(input.metadata ?? null),
      },
      update: {
        displayName: input.displayName,
        capabilities: toJson(input.capabilities),
        isActive: input.isActive ?? true,
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async upsertAffiliateProduct(input: UpsertAffiliateProductInput): Promise<AffiliateProduct> {
    return this.prisma.affiliateProduct.upsert({
      where: {
        providerKey_externalProductId: {
          providerKey: input.providerKey,
          externalProductId: input.externalProductId,
        },
      },
      create: {
        providerKey: input.providerKey,
        externalProductId: input.externalProductId,
        title: input.title,
        url: input.url ?? null,
        affiliateUrl: input.affiliateUrl ?? null,
        locale: input.locale ?? "ja-JP",
        currency: input.currency ?? null,
        adultFlag: input.adultFlag ?? true,
        availability: input.availability ?? "UNKNOWN",
        normalized: toJson(input.normalized),
        metadata: jsonOrNull(input.metadata ?? null),
      },
      update: {
        title: input.title,
        url: input.url ?? null,
        affiliateUrl: input.affiliateUrl ?? null,
        locale: input.locale ?? "ja-JP",
        currency: input.currency ?? null,
        adultFlag: input.adultFlag ?? true,
        availability: input.availability ?? "UNKNOWN",
        normalized: toJson(input.normalized),
        metadata: jsonOrNull(input.metadata ?? null),
        collectedAt: new Date(),
      },
    });
  }

  async createSourceDocument(input: CreateSourceDocumentInput): Promise<SourceDocument> {
    return this.prisma.sourceDocument.create({
      data: {
        sourceKey: input.sourceKey,
        documentType: input.documentType,
        externalId: input.externalId ?? null,
        url: input.url ?? null,
        title: input.title ?? null,
        contentHash: input.contentHash ?? null,
        publishedAt: input.publishedAt ?? null,
        freshnessScore: input.freshnessScore ?? null,
        robotsAllowed: input.robotsAllowed ?? null,
        termsNotes: input.termsNotes ?? null,
        rateLimitNotes: input.rateLimitNotes ?? null,
        normalizedText: input.normalizedText ?? null,
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async createResearchFinding(input: CreateResearchFindingInput): Promise<ResearchFinding> {
    return this.prisma.researchFinding.create({
      data: {
        findingType: input.findingType,
        summary: input.summary,
        sourceDocumentId: input.sourceDocumentId ?? null,
        confidence: input.confidence ?? null,
        noveltyScore: input.noveltyScore ?? null,
        metadata: jsonOrNull(input.metadata ?? null),
        observedAt: input.observedAt ?? new Date(),
      },
    });
  }

  async createTopicCandidate(input: CreateTopicCandidateInput): Promise<TopicCandidate> {
    return this.prisma.topicCandidate.create({
      data: {
        title: input.title,
        summary: input.summary ?? null,
        formatHint: input.formatHint ?? null,
        formatCategory: input.formatCategory ?? "OTHER",
        status: input.status ?? "PROPOSED",
        selectionReasons: jsonOrNull(input.selectionReasons ?? null),
        affiliateProductId: input.affiliateProductId ?? null,
        contentCandidateId: input.contentCandidateId ?? null,
        researchItemId: input.researchItemId ?? null,
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async createStrategy(input: CreateStrategyInput): Promise<ContentStrategy> {
    return this.prisma.contentStrategy.create({
      data: {
        topicCandidateId: input.topicCandidateId,
        objective: input.objective,
        targetAudience: input.targetAudience,
        userIntent: input.userIntent,
        formatCategory: input.formatCategory,
        formatKey: input.formatKey,
        angle: input.angle,
        primaryChannel: input.primaryChannel,
        candidateChannels: toJson(input.candidateChannels),
        affiliateIntent: input.affiliateIntent ?? null,
        ctaPolicy: input.ctaPolicy ?? null,
        timingRationale: input.timingRationale ?? null,
        differentiation: input.differentiation ?? null,
        requiredClaims: toJson(input.requiredClaims ?? []),
        requiredResearch: toJson(input.requiredResearch ?? []),
        successMetrics: toJson(input.successMetrics ?? []),
        riskFlags: toJson(input.riskFlags ?? []),
        status: input.status ?? "DRAFT",
        confidence: input.confidence ?? null,
        evidenceRefs: jsonOrNull(input.evidenceRefs ?? null),
        modelRunId: input.modelRunId ?? null,
      },
    });
  }

  async createContent(input: CreateContentInput): Promise<Content> {
    return this.prisma.content.create({
      data: {
        topicCandidateId: input.topicCandidateId ?? null,
        strategyId: input.strategyId ?? null,
        status: input.status ?? "DRAFT",
        primaryLanguage: input.primaryLanguage ?? "ja",
        contentPurpose: input.contentPurpose ?? null,
        monetizationStatus: input.monetizationStatus ?? "UNMONETIZED",
      },
    });
  }

  async updateContentMonetization(
    id: string,
    monetizationStatus: MonetizationStatus,
  ): Promise<Content> {
    return this.prisma.content.update({
      where: { id },
      data: { monetizationStatus },
    });
  }

  async listContentByMonetization(
    monetizationStatus: MonetizationStatus,
    limit = 50,
  ): Promise<Content[]> {
    return this.prisma.content.findMany({
      where: { monetizationStatus },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, limit),
    });
  }

  async createAnalyticsSnapshot(
    input: CreateAnalyticsSnapshotInput,
  ): Promise<AnalyticsSnapshot> {
    return this.prisma.analyticsSnapshot.create({
      data: {
        platform: input.platform,
        contentId: input.contentId ?? null,
        publicationTargetId: input.publicationTargetId ?? null,
        publicationRecordId: input.publicationRecordId ?? null,
        externalId: input.externalId ?? null,
        measuredAt: input.measuredAt ?? new Date(),
        metrics: toJson(input.metrics),
        source: input.source ?? "manual",
        notes: input.notes ?? null,
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async listAnalyticsForContent(contentId: string): Promise<AnalyticsSnapshot[]> {
    return this.prisma.analyticsSnapshot.findMany({
      where: { contentId },
      orderBy: { measuredAt: "desc" },
    });
  }

  async listDuePublicationTargets(options: {
    now?: Date;
    limit?: number;
  }): Promise<PublicationTarget[]> {
    const now = options.now ?? new Date();
    return this.prisma.publicationTarget.findMany({
      where: {
        OR: [
          { status: "APPROVED" },
          {
            status: "SCHEDULED",
            scheduledAt: { lte: now },
          },
        ],
      },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      take: Math.max(1, options.limit ?? 20),
    });
  }

  async countPublicationsSince(since: Date): Promise<number> {
    return this.prisma.publicationTarget.count({
      where: {
        status: { in: ["PUBLISHED", "DRAFT"] },
        OR: [
          { publishedAt: { gte: since } },
          { updatedAt: { gte: since }, status: "DRAFT" },
        ],
      },
    });
  }

  async findLatestPublishedAt(): Promise<Date | null> {
    const row = await this.prisma.publicationTarget.findFirst({
      where: { publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" },
      select: { publishedAt: true },
    });
    return row?.publishedAt ?? null;
  }

  async updateContentVersionStructuredContent(
    id: string,
    structuredContent: Record<string, unknown>,
  ): Promise<ContentVersion> {
    return this.prisma.contentVersion.update({
      where: { id },
      data: { structuredContent: toJson(structuredContent) },
    });
  }

  async createContentVersion(input: CreateContentVersionInput): Promise<ContentVersion> {
    return this.prisma.contentVersion.create({
      data: {
        contentId: input.contentId,
        versionNumber: input.versionNumber,
        title: input.title,
        body: input.body,
        summary: input.summary ?? null,
        parentVersionId: input.parentVersionId ?? null,
        revisionType: input.revisionType ?? "initial",
        structuredContent: jsonOrNull(input.structuredContent ?? null),
        status: input.status ?? "DRAFT",
        createdBy: input.createdBy ?? "system",
        modelRunId: input.modelRunId ?? null,
      },
    });
  }

  async createClaim(input: CreateClaimInput): Promise<Claim> {
    return this.prisma.claim.create({
      data: {
        statement: input.statement,
        claimType: input.claimType ?? "UNVERIFIED",
        status: input.status ?? "PROPOSED",
        confidence: input.confidence ?? null,
        freshnessScore: input.freshnessScore ?? null,
        classification: input.classification ?? "third_party",
        strategyId: input.strategyId ?? null,
        researchFindingId: input.researchFindingId ?? null,
        metadata: jsonOrNull(input.metadata ?? null),
        expiresAt: input.expiresAt ?? null,
        lastVerifiedAt: input.lastVerifiedAt ?? null,
      },
    });
  }

  async addClaimSource(input: AddClaimSourceInput): Promise<ClaimSource> {
    return this.prisma.claimSource.create({
      data: {
        claimId: input.claimId,
        supportType: input.supportType,
        excerptOrSummary: input.excerptOrSummary,
        sourceDocumentId: input.sourceDocumentId ?? null,
        sourceLocation: input.sourceLocation ?? null,
        confidence: input.confidence ?? null,
        contradiction: input.contradiction ?? false,
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async attachVersionClaim(input: AttachVersionClaimInput): Promise<ContentVersionClaim> {
    return this.prisma.contentVersionClaim.create({
      data: {
        contentVersionId: input.contentVersionId,
        claimId: input.claimId,
        usageType: input.usageType,
        sectionRef: input.sectionRef ?? null,
        wording: input.wording ?? null,
        validationStatus: input.validationStatus ?? "pending",
      },
    });
  }

  async createPolicyRule(input: CreatePolicyRuleInput): Promise<PolicyRule> {
    return this.prisma.policyRule.create({
      data: {
        policyType: input.policyType,
        scope: input.scope,
        ruleIdentifier: input.ruleIdentifier,
        ruleVersion: input.ruleVersion ?? "v1",
        severity: input.severity ?? "WARNING",
        enabled: input.enabled ?? true,
        condition: toJson(input.condition),
        resultOnMatch: input.resultOnMatch,
        message: input.message,
        targetPlatform: input.targetPlatform ?? null,
        targetProvider: input.targetProvider ?? null,
        effectiveFrom: input.effectiveFrom ?? new Date(),
        effectiveTo: input.effectiveTo ?? null,
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async createPolicyEvaluation(input: CreatePolicyEvaluationInput): Promise<PolicyEvaluation> {
    return this.prisma.policyEvaluation.create({
      data: {
        targetType: input.targetType,
        targetId: input.targetId,
        result: input.result,
        policyRuleId: input.policyRuleId ?? null,
        message: input.message ?? null,
        details: jsonOrNull(input.details ?? null),
      },
    });
  }

  async listEnabledPolicies(): Promise<PolicyRule[]> {
    return this.prisma.policyRule.findMany({
      where: {
        enabled: true,
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
      },
      orderBy: [{ policyType: "asc" }, { ruleIdentifier: "asc" }],
    });
  }

  async createReview(input: CreateReviewInput): Promise<QualityReviewRecord> {
    return this.prisma.qualityReviewRecord.create({
      data: {
        reviewType: input.reviewType,
        reviewerType: input.reviewerType,
        targetType: input.targetType,
        targetId: input.targetId,
        criteria: toJson(input.criteria),
        result: input.result,
        findings: toJson(input.findings),
        contentVersionId: input.contentVersionId ?? null,
        score: input.score ?? null,
        requiredActions: jsonOrNull(input.requiredActions ?? null),
        status: input.status ?? "completed",
        modelRunId: input.modelRunId ?? null,
      },
    });
  }

  async listReviewsForContentVersion(contentVersionId: string): Promise<QualityReviewRecord[]> {
    return this.prisma.qualityReviewRecord.findMany({
      where: { contentVersionId },
      orderBy: { createdAt: "asc" },
    });
  }

  async createRevisionAction(input: CreateRevisionActionInput): Promise<RevisionAction> {
    return this.prisma.revisionAction.create({
      data: {
        actionType: input.actionType,
        reviewId: input.reviewId ?? null,
        rationale: input.rationale ?? null,
        improvementDelta: input.improvementDelta ?? null,
        sameErrorRepeat: input.sameErrorRepeat ?? 0,
        costDelta: input.costDelta ?? null,
        changeScope: input.changeScope ?? null,
        needsMoreResearch: input.needsMoreResearch ?? false,
        needsFullRegenerate: input.needsFullRegenerate ?? false,
        needsAngleChange: input.needsAngleChange ?? false,
        needsDiscard: input.needsDiscard ?? false,
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async createPublicationTarget(
    input: CreatePublicationTargetInput,
  ): Promise<PublicationTarget> {
    return this.prisma.publicationTarget.create({
      data: {
        contentId: input.contentId,
        contentVersionId: input.contentVersionId,
        platform: input.platform,
        destinationRef: input.destinationRef ?? null,
        targetFormat: input.targetFormat ?? null,
        approvalMode: input.approvalMode ?? "MANUAL",
        status: input.status ?? "DRAFT",
        scheduledAt: input.scheduledAt ?? null,
        policyResult: input.policyResult ?? null,
        platformMetadata: jsonOrNull(input.platformMetadata ?? null),
        approvedAt: input.approvedAt ?? null,
        publishedExternalId: input.publishedExternalId ?? null,
        publishedUrl: input.publishedUrl ?? null,
        publishedAt: input.publishedAt ?? null,
      },
    });
  }

  async updatePublicationTarget(
    id: string,
    input: UpdatePublicationTargetInput,
  ): Promise<PublicationTarget> {
    return this.prisma.publicationTarget.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.approvalMode !== undefined ? { approvalMode: input.approvalMode } : {}),
        ...(input.destinationRef !== undefined ? { destinationRef: input.destinationRef } : {}),
        ...(input.targetFormat !== undefined ? { targetFormat: input.targetFormat } : {}),
        ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt } : {}),
        ...(input.policyResult !== undefined ? { policyResult: input.policyResult } : {}),
        ...(input.platformMetadata !== undefined
          ? { platformMetadata: jsonOrNull(input.platformMetadata) }
          : {}),
        ...(input.publishedExternalId !== undefined
          ? { publishedExternalId: input.publishedExternalId }
          : {}),
        ...(input.publishedUrl !== undefined ? { publishedUrl: input.publishedUrl } : {}),
        ...(input.approvedAt !== undefined ? { approvedAt: input.approvedAt } : {}),
        ...(input.publishedAt !== undefined ? { publishedAt: input.publishedAt } : {}),
      },
    });
  }

  async createPublicationRecord(
    input: CreatePublicationRecordInput,
  ): Promise<PublicationRecord> {
    return this.prisma.publicationRecord.create({
      data: {
        publicationTargetId: input.publicationTargetId,
        platform: input.platform,
        status: input.status,
        externalId: input.externalId ?? null,
        url: input.url ?? null,
        responseSummary: jsonOrNull(input.responseSummary ?? null),
        errorCode: input.errorCode ?? null,
      },
    });
  }

  async createModelRun(input: CreateModelRunInput): Promise<ModelRun> {
    return this.prisma.modelRun.create({
      data: {
        provider: input.provider,
        model: input.model,
        taskType: input.taskType,
        promptIdentifier: input.promptIdentifier ?? null,
        promptVersion: input.promptVersion ?? null,
        inputRef: input.inputRef ?? null,
        outputRef: input.outputRef ?? null,
        status: input.status ?? "PENDING",
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async completeModelRun(id: string, input: CompleteModelRunInput): Promise<ModelRun> {
    return this.prisma.modelRun.update({
      where: { id },
      data: {
        status: input.status,
        completedAt: new Date(),
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        cachedTokens: input.cachedTokens ?? null,
        estimatedCost: input.estimatedCost ?? null,
        actualCost: input.actualCost ?? null,
        currency: input.currency ?? "JPY",
        errorType: input.errorType ?? null,
        errorDetail: input.errorDetail ?? null,
        structuredOutputValid: input.structuredOutputValid ?? null,
        outputRef: input.outputRef ?? undefined,
        metadata: input.metadata !== undefined ? jsonOrNull(input.metadata) : undefined,
      },
    });
  }

  async createCostRecord(input: CreateCostRecordInput): Promise<CostRecord> {
    return this.prisma.costRecord.create({
      data: {
        provider: input.provider,
        serviceOrModel: input.serviceOrModel,
        operationType: input.operationType,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        modelRunId: input.modelRunId ?? null,
        estimatedAmount: input.estimatedAmount ?? null,
        actualAmount: input.actualAmount ?? null,
        currency: input.currency ?? "JPY",
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async ensureBudgetSettings(
    scopes: Array<{
      scopeType: BudgetScopeType;
      softLimit: number;
      hardLimit: number;
      warningThreshold: number;
      stopThreshold: number;
      currency?: string;
    }>,
  ): Promise<BudgetSetting[]> {
    const results: BudgetSetting[] = [];
    for (const scope of scopes) {
      const currency = scope.currency ?? "JPY";
      const row = await this.prisma.budgetSetting.upsert({
        where: {
          scopeType_currency: {
            scopeType: scope.scopeType,
            currency,
          },
        },
        create: {
          scopeType: scope.scopeType,
          softLimit: scope.softLimit,
          hardLimit: scope.hardLimit,
          warningThreshold: scope.warningThreshold,
          stopThreshold: scope.stopThreshold,
          currency,
          enabled: true,
        },
        update: {
          softLimit: scope.softLimit,
          hardLimit: scope.hardLimit,
          warningThreshold: scope.warningThreshold,
          stopThreshold: scope.stopThreshold,
          enabled: true,
        },
      });
      results.push(row);
    }
    return results;
  }

  async createOperatorJob(input: CreateOperatorJobInput): Promise<OperatorJob> {
    return this.prisma.operatorJob.create({
      data: {
        jobType: input.jobType,
        payload: toJson(input.payload),
        status: input.status ?? "PENDING",
        priority: input.priority ?? 100,
        runAfter: input.runAfter ?? null,
        maxAttempts: input.maxAttempts ?? 3,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
  }

  async completeOperatorJob(
    id: string,
    result: {
      status: ResearchJobStatus;
      result?: Record<string, unknown> | null;
      error?: string | null;
    },
  ): Promise<OperatorJob> {
    return this.prisma.operatorJob.update({
      where: { id },
      data: {
        status: result.status,
        result: result.result !== undefined ? jsonOrNull(result.result) : undefined,
        error: result.error ?? null,
        completedAt: new Date(),
      },
    });
  }

  async findAffiliateProduct(id: string): Promise<AffiliateProduct | null> {
    return this.prisma.affiliateProduct.findUnique({ where: { id } });
  }

  async findResearchItem(
    id: string,
  ): Promise<Pick<ResearchItem, "id" | "externalId" | "title" | "url"> | null> {
    return this.prisma.researchItem.findUnique({
      where: { id },
      select: { id: true, externalId: true, title: true, url: true },
    });
  }

  /**
   * ResearchImage rows for ResearchItems whose externalId is in the given set.
   * Used for Blogger URL-reference images (no download).
   */
  async listResearchImagesByExternalIds(externalIds: string[]): Promise<
    Array<{
      id: string;
      imageType: string;
      sourceUrl: string;
      usageStatus: string;
      researchItemExternalId: string;
    }>
  > {
    const ids = [...new Set(externalIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return [];
    const rows = await this.prisma.researchImage.findMany({
      where: { researchItem: { externalId: { in: ids } } },
      include: { researchItem: { select: { externalId: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      imageType: row.imageType,
      sourceUrl: row.sourceUrl,
      usageStatus: row.usageStatus,
      researchItemExternalId: row.researchItem.externalId,
    }));
  }

  /**
   * ResearchImage rows for a ResearchItem id (AffiliateProduct not required).
   */
  async listResearchImagesByResearchItemId(researchItemId: string): Promise<
    Array<{
      id: string;
      imageType: string;
      sourceUrl: string;
      usageStatus: string;
      researchItemExternalId: string;
    }>
  > {
    const id = researchItemId.trim();
    if (!id) return [];
    const rows = await this.prisma.researchImage.findMany({
      where: { researchItemId: id },
      include: { researchItem: { select: { externalId: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      imageType: row.imageType,
      sourceUrl: row.sourceUrl,
      usageStatus: row.usageStatus,
      researchItemExternalId: row.researchItem.externalId,
    }));
  }

  /**
   * SourceDocuments whose url matches any candidate; returns imageReferences from metadata.
   */
  async listSourceDocumentsImageReferencesByUrls(
    urls: string[],
  ): Promise<Array<{ id: string; url: string | null; imageReferences: string[] }>> {
    const candidates = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
    if (candidates.length === 0) return [];
    const docs = await this.prisma.sourceDocument.findMany({
      where: { OR: candidates.map((url) => ({ url })) },
      select: { id: true, url: true, metadata: true },
    });
    return docs.map((doc) => {
      const meta = doc.metadata;
      const refs =
        meta &&
        typeof meta === "object" &&
        !Array.isArray(meta) &&
        Array.isArray((meta as { imageReferences?: unknown }).imageReferences)
          ? ((meta as { imageReferences: unknown[] }).imageReferences.filter(
              (u): u is string => typeof u === "string" && u.trim().length > 0,
            ) as string[])
          : [];
      return { id: doc.id, url: doc.url, imageReferences: refs };
    });
  }

  async updateSourceDocumentMetadata(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<SourceDocument> {
    const existing = await this.prisma.sourceDocument.findUnique({ where: { id } });
    if (!existing) throw new Error(`SourceDocument not found: ${id}`);
    const prev =
      existing.metadata &&
      typeof existing.metadata === "object" &&
      !Array.isArray(existing.metadata)
        ? (existing.metadata as Record<string, unknown>)
        : {};
    return this.prisma.sourceDocument.update({
      where: { id },
      data: {
        metadata: jsonOrNull({ ...prev, ...patch }) as never,
      },
    });
  }

  /** Latest SourceDocument whose url contains the given fragment (e.g. content id). */
  async findLatestSourceDocumentByUrlContains(
    urlFragment: string,
  ): Promise<SourceDocument | null> {
    const frag = urlFragment.trim();
    if (!frag) return null;
    return this.prisma.sourceDocument.findFirst({
      where: { url: { contains: frag } },
      orderBy: { retrievedAt: "desc" },
    });
  }

  async replaceProductLinksForProduct(
    affiliateProductId: string,
    links: UpsertProductLinkInput[],
  ): Promise<ProductLink[]> {
    await this.prisma.productLink.deleteMany({ where: { affiliateProductId } });
    if (links.length === 0) return [];
    await this.prisma.productLink.createMany({
      data: links.map((input) => ({
        affiliateProductId,
        productMatchKey: input.productMatchKey ?? null,
        url: input.url ?? null,
        preferredAffiliateProvider: input.preferredAffiliateProvider,
        currentLinkProvider: input.currentLinkProvider,
        currentLinkType: input.currentLinkType,
        replacePriority: input.replacePriority,
        availability: input.availability ?? "AVAILABLE",
        isSelected: input.isSelected ?? false,
        replacementStatus: input.replacementStatus ?? "NOT_APPLICABLE",
        candidateAffiliateUrl: input.candidateAffiliateUrl ?? null,
        candidateAffiliateProductId: input.candidateAffiliateProductId ?? null,
        matchedProvider: input.matchedProvider ?? null,
        matchConfidence: input.matchConfidence ?? null,
        matchReason: input.matchReason ?? null,
        detectedAt: input.detectedAt ?? null,
        approvedAt: input.approvedAt ?? null,
        approvedBy: input.approvedBy ?? null,
        replacedAt: input.replacedAt ?? null,
        rejectionReason: input.rejectionReason ?? null,
        metadata: jsonOrNull(input.metadata ?? null),
      })),
    });
    return this.prisma.productLink.findMany({
      where: { affiliateProductId },
      orderBy: { replacePriority: "asc" },
    });
  }

  async listProductLinksForProduct(affiliateProductId: string): Promise<ProductLink[]> {
    return this.prisma.productLink.findMany({
      where: { affiliateProductId },
      orderBy: { replacePriority: "asc" },
    });
  }

  async updateProductLinkReplacement(
    id: string,
    input: UpdateProductLinkReplacementInput,
  ): Promise<ProductLink> {
    return this.prisma.productLink.update({
      where: { id },
      data: {
        ...(input.replacementStatus !== undefined
          ? { replacementStatus: input.replacementStatus }
          : {}),
        ...(input.candidateAffiliateUrl !== undefined
          ? { candidateAffiliateUrl: input.candidateAffiliateUrl }
          : {}),
        ...(input.candidateAffiliateProductId !== undefined
          ? { candidateAffiliateProductId: input.candidateAffiliateProductId }
          : {}),
        ...(input.matchedProvider !== undefined ? { matchedProvider: input.matchedProvider } : {}),
        ...(input.matchConfidence !== undefined ? { matchConfidence: input.matchConfidence } : {}),
        ...(input.matchReason !== undefined ? { matchReason: input.matchReason } : {}),
        ...(input.detectedAt !== undefined ? { detectedAt: input.detectedAt } : {}),
        ...(input.approvedAt !== undefined ? { approvedAt: input.approvedAt } : {}),
        ...(input.approvedBy !== undefined ? { approvedBy: input.approvedBy } : {}),
        ...(input.replacedAt !== undefined ? { replacedAt: input.replacedAt } : {}),
        ...(input.rejectionReason !== undefined ? { rejectionReason: input.rejectionReason } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.currentLinkType !== undefined ? { currentLinkType: input.currentLinkType } : {}),
      },
    });
  }

  async createProductLinkUsage(input: CreateProductLinkUsageInput): Promise<ProductLinkUsage> {
    return this.prisma.productLinkUsage.create({
      data: {
        productLinkId: input.productLinkId,
        contentVersionId: input.contentVersionId ?? null,
        publicationTargetId: input.publicationTargetId ?? null,
        publicationRecordId: input.publicationRecordId ?? null,
        usageKind: input.usageKind,
        locationHint: input.locationHint ?? null,
        urlSnapshot: input.urlSnapshot ?? null,
      },
    });
  }

  async createLinkReplacementEvent(
    input: CreateLinkReplacementEventInput,
  ): Promise<LinkReplacementEvent> {
    return this.prisma.linkReplacementEvent.create({
      data: {
        productLinkId: input.productLinkId ?? null,
        contentId: input.contentId,
        sourceContentVersionId: input.sourceContentVersionId,
        targetContentVersionId: input.targetContentVersionId ?? null,
        sourcePublicationTargetId: input.sourcePublicationTargetId ?? null,
        targetPublicationTargetId: input.targetPublicationTargetId ?? null,
        publicationRecordId: input.publicationRecordId ?? null,
        previousUrl: input.previousUrl,
        nextUrl: input.nextUrl,
        changeReason: input.changeReason,
        approvedBy: input.approvedBy ?? null,
        approvedAt: input.approvedAt ?? null,
        replacedAt: input.replacedAt ?? null,
        status: input.status ?? "PROPOSED",
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async updateLinkReplacementEvent(
    id: string,
    input: {
      status?: LinkReplacementEventStatus;
      targetContentVersionId?: string | null;
      targetPublicationTargetId?: string | null;
      publicationRecordId?: string | null;
      approvedBy?: string | null;
      approvedAt?: Date | null;
      replacedAt?: Date | null;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<LinkReplacementEvent> {
    return this.prisma.linkReplacementEvent.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.targetContentVersionId !== undefined
          ? { targetContentVersionId: input.targetContentVersionId }
          : {}),
        ...(input.targetPublicationTargetId !== undefined
          ? { targetPublicationTargetId: input.targetPublicationTargetId }
          : {}),
        ...(input.publicationRecordId !== undefined
          ? { publicationRecordId: input.publicationRecordId }
          : {}),
        ...(input.approvedBy !== undefined ? { approvedBy: input.approvedBy } : {}),
        ...(input.approvedAt !== undefined ? { approvedAt: input.approvedAt } : {}),
        ...(input.replacedAt !== undefined ? { replacedAt: input.replacedAt } : {}),
        ...(input.metadata !== undefined ? { metadata: jsonOrNull(input.metadata) } : {}),
      },
    });
  }

  async findLinkReplacementEvent(id: string): Promise<LinkReplacementEvent | null> {
    return this.prisma.linkReplacementEvent.findUnique({ where: { id } });
  }

  async findLatestContentVersion(contentId: string): Promise<ContentVersion | null> {
    return this.prisma.contentVersion.findFirst({
      where: { contentId },
      orderBy: { versionNumber: "desc" },
    });
  }

  async findTopicCandidate(id: string): Promise<TopicCandidate | null> {
    return this.prisma.topicCandidate.findUnique({ where: { id } });
  }

  async findContentStrategy(id: string): Promise<ContentStrategy | null> {
    return this.prisma.contentStrategy.findUnique({ where: { id } });
  }

  /**
   * Update ContentStrategy.formatKey only (bind to ACTIVE ArticleFormat).
   * Does not regenerate strategy fields.
   */
  async updateStrategyFormatKey(
    strategyId: string,
    formatKey: string,
  ): Promise<ContentStrategy> {
    return this.prisma.contentStrategy.update({
      where: { id: strategyId },
      data: { formatKey },
    });
  }

  async findModelRun(id: string): Promise<ModelRun | null> {
    return this.prisma.modelRun.findUnique({ where: { id } });
  }

  async findContent(id: string): Promise<Content | null> {
    return this.prisma.content.findUnique({ where: { id } });
  }

  async findContentVersion(id: string): Promise<ContentVersion | null> {
    return this.prisma.contentVersion.findUnique({ where: { id } });
  }

  async findPublicationTarget(id: string): Promise<PublicationTarget | null> {
    return this.prisma.publicationTarget.findUnique({ where: { id } });
  }

  async inspectContentLifecycle(contentId: string) {
    return this.prisma.content.findUnique({
      where: { id: contentId },
      include: {
        topicCandidate: true,
        strategy: true,
        versions: {
          include: {
            versionClaims: { include: { claim: true } },
            reviews: true,
          },
          orderBy: { versionNumber: "asc" },
        },
        publicationTargets: {
          include: { publications: true },
        },
      },
    });
  }

  async findPromptDefinition(
    identifier: string,
    version?: string,
  ): Promise<PromptDefinition | null> {
    if (version) {
      return this.prisma.promptDefinition.findUnique({
        where: { identifier_version: { identifier, version } },
      });
    }
    return this.prisma.promptDefinition.findFirst({
      where: { identifier, enabled: true },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    });
  }

  async upsertPromptDefinition(input: {
    identifier: string;
    version: string;
    taskType: string;
    body: string;
    systemInstruction?: string | null;
    inputTemplate?: string | null;
    outputSchema?: Record<string, unknown> | null;
    enabled?: boolean;
    effectiveFrom?: Date;
    metadata?: Record<string, unknown> | null;
  }): Promise<PromptDefinition> {
    return this.prisma.promptDefinition.upsert({
      where: {
        identifier_version: {
          identifier: input.identifier,
          version: input.version,
        },
      },
      create: {
        identifier: input.identifier,
        version: input.version,
        taskType: input.taskType,
        body: input.body,
        systemInstruction: input.systemInstruction ?? null,
        inputTemplate: input.inputTemplate ?? null,
        outputSchema: jsonOrNull(input.outputSchema ?? null),
        enabled: input.enabled ?? true,
        effectiveFrom: input.effectiveFrom ?? new Date(),
        metadata: jsonOrNull(input.metadata ?? null),
      },
      update: {
        taskType: input.taskType,
        body: input.body,
        systemInstruction: input.systemInstruction ?? null,
        inputTemplate: input.inputTemplate ?? null,
        outputSchema: jsonOrNull(input.outputSchema ?? null),
        enabled: input.enabled ?? true,
        metadata: jsonOrNull(input.metadata ?? null),
      },
    });
  }

  async listBudgetSettings(currency = "JPY"): Promise<BudgetSetting[]> {
    return this.prisma.budgetSetting.findMany({ where: { currency, enabled: true } });
  }

  async sumCostsSince(since: Date, currency = "JPY"): Promise<number> {
    const agg = await this.prisma.costRecord.aggregate({
      where: { currency, recordedAt: { gte: since } },
      _sum: { actualAmount: true, estimatedAmount: true },
    });
    const actual = agg._sum.actualAmount;
    const estimated = agg._sum.estimatedAmount;
    return actual ?? estimated ?? 0;
  }

  async listClaimsByIds(ids: string[]): Promise<Claim[]> {
    if (ids.length === 0) return [];
    return this.prisma.claim.findMany({ where: { id: { in: ids } } });
  }

  async listClaimsForStrategy(strategyId: string): Promise<Claim[]> {
    return this.prisma.claim.findMany({
      where: { strategyId },
      orderBy: { createdAt: "asc" },
    });
  }

  async updateContentVersionStatus(
    id: string,
    status: ContentVersionStatus,
  ): Promise<ContentVersion> {
    return this.prisma.contentVersion.update({ where: { id }, data: { status } });
  }

  /** Editorial Brain persistence (same Prisma client as lifecycle). */
  createEditorialBrainRepository(): EditorialBrainRepository {
    return new EditorialBrainRepository(this.prisma);
  }
}
