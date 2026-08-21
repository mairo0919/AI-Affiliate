-- CreateEnum
CREATE TYPE "ContentLifecycleStatus" AS ENUM ('DRAFT', 'RESEARCHING', 'PLANNING', 'GENERATING', 'REVIEWING', 'REVISION_REQUIRED', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PUBLISH_FAILED', 'PAUSED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentVersionStatus" AS ENUM ('DRAFT', 'REVIEWING', 'REVISION_REQUIRED', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentFormatCategory" AS ENUM ('ARTICLE', 'SHORT_POST', 'THREAD', 'LISTICLE', 'COMPARISON', 'NEWS', 'GUIDE', 'OTHER');

-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('DRAFT', 'READY', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('FACT', 'OFFICIAL', 'THIRD_PARTY', 'OPINION', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PROPOSED', 'SUPPORTED', 'PARTIALLY_SUPPORTED', 'DISPUTED', 'OUTDATED', 'UNSUPPORTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PolicySeverity" AS ENUM ('INFO', 'WARNING', 'BLOCKING');

-- CreateEnum
CREATE TYPE "PolicyEvalResult" AS ENUM ('PASSED', 'WARNING', 'BLOCKED', 'MANUAL_REVIEW_REQUIRED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ReviewResult" AS ENUM ('PASSED', 'WARNING', 'FAILED', 'MANUAL_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "PublicationApprovalMode" AS ENUM ('MANUAL', 'CONDITIONAL', 'AUTOMATIC', 'DRAFT_ONLY');

-- CreateEnum
CREATE TYPE "PublicationTargetStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'PAUSED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PublicationPlatform" AS ENUM ('BLOGGER', 'X', 'NOTE', 'THREADS', 'OTHER');

-- CreateEnum
CREATE TYPE "BudgetScopeType" AS ENUM ('DAILY', 'MONTHLY', 'PER_JOB', 'PER_CONTENT');

-- CreateEnum
CREATE TYPE "ModelRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ResearchJobType" ADD VALUE 'RESEARCH';
ALTER TYPE "ResearchJobType" ADD VALUE 'STRATEGY';
ALTER TYPE "ResearchJobType" ADD VALUE 'GENERATION';
ALTER TYPE "ResearchJobType" ADD VALUE 'CLAIM_VALIDATION';
ALTER TYPE "ResearchJobType" ADD VALUE 'REVIEW';
ALTER TYPE "ResearchJobType" ADD VALUE 'REVISION';
ALTER TYPE "ResearchJobType" ADD VALUE 'PUBLICATION';
ALTER TYPE "ResearchJobType" ADD VALUE 'ANALYTICS_INGESTION';
ALTER TYPE "ResearchJobType" ADD VALUE 'MAINTENANCE';

-- AlterTable
ALTER TABLE "GeneratedContent" ADD COLUMN     "contentId" TEXT,
ADD COLUMN     "contentVersionId" TEXT;

-- CreateTable
CREATE TABLE "AffiliateProviderRegistry" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateProviderRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateProduct" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "affiliateUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ja-JP',
    "currency" TEXT,
    "adultFlag" BOOLEAN NOT NULL DEFAULT true,
    "availability" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "normalized" JSONB NOT NULL,
    "metadata" JSONB,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSnapshot" (
    "id" TEXT NOT NULL,
    "affiliateProductId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "externalId" TEXT,
    "url" TEXT,
    "title" TEXT,
    "documentType" TEXT NOT NULL,
    "contentHash" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "freshnessScore" DOUBLE PRECISION,
    "robotsAllowed" BOOLEAN,
    "termsNotes" TEXT,
    "rateLimitNotes" TEXT,
    "normalizedText" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchFinding" (
    "id" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "findingType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "noveltyScore" DOUBLE PRECISION,
    "metadata" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicCandidate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "formatHint" TEXT,
    "formatCategory" "ContentFormatCategory" NOT NULL DEFAULT 'OTHER',
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "selectionReasons" JSONB,
    "affiliateProductId" TEXT,
    "contentCandidateId" TEXT,
    "researchItemId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentStrategy" (
    "id" TEXT NOT NULL,
    "topicCandidateId" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "targetAudience" TEXT NOT NULL,
    "userIntent" TEXT NOT NULL,
    "formatCategory" "ContentFormatCategory" NOT NULL,
    "formatKey" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "primaryChannel" "PublicationPlatform" NOT NULL,
    "candidateChannels" JSONB NOT NULL,
    "affiliateIntent" TEXT,
    "ctaPolicy" TEXT,
    "timingRationale" TEXT,
    "differentiation" TEXT,
    "requiredClaims" JSONB NOT NULL,
    "requiredResearch" JSONB NOT NULL,
    "successMetrics" JSONB NOT NULL,
    "riskFlags" JSONB NOT NULL,
    "status" "StrategyStatus" NOT NULL DEFAULT 'DRAFT',
    "confidence" DOUBLE PRECISION,
    "evidenceRefs" JSONB,
    "modelRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Content" (
    "id" TEXT NOT NULL,
    "topicCandidateId" TEXT,
    "strategyId" TEXT,
    "status" "ContentLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "primaryLanguage" TEXT NOT NULL DEFAULT 'ja',
    "contentPurpose" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "parentVersionId" TEXT,
    "revisionType" TEXT NOT NULL DEFAULT 'initial',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "structuredContent" JSONB,
    "status" "ContentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "modelRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "claimType" "ClaimType" NOT NULL DEFAULT 'UNVERIFIED',
    "status" "ClaimStatus" NOT NULL DEFAULT 'PROPOSED',
    "confidence" DOUBLE PRECISION,
    "freshnessScore" DOUBLE PRECISION,
    "classification" TEXT NOT NULL DEFAULT 'third_party',
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "strategyId" TEXT,
    "researchFindingId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimSource" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "supportType" TEXT NOT NULL,
    "excerptOrSummary" TEXT NOT NULL,
    "sourceLocation" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" DOUBLE PRECISION,
    "contradiction" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVersionClaim" (
    "id" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "usageType" TEXT NOT NULL,
    "sectionRef" TEXT,
    "wording" TEXT,
    "validationStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentVersionClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRule" (
    "id" TEXT NOT NULL,
    "policyType" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "targetPlatform" TEXT,
    "targetProvider" TEXT,
    "ruleIdentifier" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL DEFAULT 'v1',
    "severity" "PolicySeverity" NOT NULL DEFAULT 'WARNING',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "condition" JSONB NOT NULL,
    "resultOnMatch" "PolicyEvalResult" NOT NULL,
    "message" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyEvaluation" (
    "id" TEXT NOT NULL,
    "policyRuleId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "result" "PolicyEvalResult" NOT NULL,
    "message" TEXT,
    "details" JSONB,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityReviewRecord" (
    "id" TEXT NOT NULL,
    "reviewType" TEXT NOT NULL,
    "reviewerType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "contentVersionId" TEXT,
    "criteria" JSONB NOT NULL,
    "result" "ReviewResult" NOT NULL,
    "score" DOUBLE PRECISION,
    "findings" JSONB NOT NULL,
    "requiredActions" JSONB,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "modelRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityReviewRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionAction" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT,
    "actionType" TEXT NOT NULL,
    "rationale" TEXT,
    "improvementDelta" DOUBLE PRECISION,
    "sameErrorRepeat" INTEGER NOT NULL DEFAULT 0,
    "costDelta" DOUBLE PRECISION,
    "changeScope" TEXT,
    "needsMoreResearch" BOOLEAN NOT NULL DEFAULT false,
    "needsFullRegenerate" BOOLEAN NOT NULL DEFAULT false,
    "needsAngleChange" BOOLEAN NOT NULL DEFAULT false,
    "needsDiscard" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevisionAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationTarget" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "platform" "PublicationPlatform" NOT NULL,
    "destinationRef" TEXT,
    "targetFormat" TEXT,
    "approvalMode" "PublicationApprovalMode" NOT NULL DEFAULT 'MANUAL',
    "status" "PublicationTargetStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "policyResult" "PolicyEvalResult",
    "platformMetadata" JSONB,
    "publishedExternalId" TEXT,
    "publishedUrl" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicationTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationRecord" (
    "id" TEXT NOT NULL,
    "publicationTargetId" TEXT NOT NULL,
    "platform" "PublicationPlatform" NOT NULL,
    "status" TEXT NOT NULL,
    "externalId" TEXT,
    "url" TEXT,
    "responseSummary" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "promptIdentifier" TEXT,
    "promptVersion" TEXT,
    "inputRef" TEXT,
    "outputRef" TEXT,
    "status" "ModelRunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedTokens" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "actualCost" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "errorType" TEXT,
    "errorDetail" TEXT,
    "structuredOutputValid" BOOLEAN,
    "retryOfId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostRecord" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "serviceOrModel" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "modelRunId" TEXT,
    "estimatedAmount" DOUBLE PRECISION,
    "actualAmount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetSetting" (
    "id" TEXT NOT NULL,
    "scopeType" "BudgetScopeType" NOT NULL,
    "softLimit" DOUBLE PRECISION NOT NULL,
    "hardLimit" DOUBLE PRECISION NOT NULL,
    "warningThreshold" DOUBLE PRECISION NOT NULL,
    "stopThreshold" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptDefinition" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorJob" (
    "id" TEXT NOT NULL,
    "jobType" "ResearchJobType" NOT NULL,
    "status" "ResearchJobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "runAfter" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "idempotencyKey" TEXT,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "OperatorJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateProviderRegistry_providerKey_key" ON "AffiliateProviderRegistry"("providerKey");

-- CreateIndex
CREATE INDEX "AffiliateProduct_providerKey_collectedAt_idx" ON "AffiliateProduct"("providerKey", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateProduct_providerKey_externalProductId_key" ON "AffiliateProduct"("providerKey", "externalProductId");

-- CreateIndex
CREATE INDEX "ProductSnapshot_affiliateProductId_capturedAt_idx" ON "ProductSnapshot"("affiliateProductId", "capturedAt");

-- CreateIndex
CREATE INDEX "SourceDocument_sourceKey_retrievedAt_idx" ON "SourceDocument"("sourceKey", "retrievedAt");

-- CreateIndex
CREATE INDEX "SourceDocument_contentHash_idx" ON "SourceDocument"("contentHash");

-- CreateIndex
CREATE INDEX "ResearchFinding_findingType_observedAt_idx" ON "ResearchFinding"("findingType", "observedAt");

-- CreateIndex
CREATE INDEX "TopicCandidate_status_createdAt_idx" ON "TopicCandidate"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TopicCandidate_affiliateProductId_idx" ON "TopicCandidate"("affiliateProductId");

-- CreateIndex
CREATE INDEX "ContentStrategy_topicCandidateId_status_idx" ON "ContentStrategy"("topicCandidateId", "status");

-- CreateIndex
CREATE INDEX "ContentStrategy_primaryChannel_status_idx" ON "ContentStrategy"("primaryChannel", "status");

-- CreateIndex
CREATE INDEX "Content_status_createdAt_idx" ON "Content"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Content_strategyId_idx" ON "Content"("strategyId");

-- CreateIndex
CREATE INDEX "ContentVersion_status_createdAt_idx" ON "ContentVersion"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersion_contentId_versionNumber_key" ON "ContentVersion"("contentId", "versionNumber");

-- CreateIndex
CREATE INDEX "Claim_status_claimType_idx" ON "Claim"("status", "claimType");

-- CreateIndex
CREATE INDEX "Claim_strategyId_idx" ON "Claim"("strategyId");

-- CreateIndex
CREATE INDEX "ClaimSource_claimId_idx" ON "ClaimSource"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersionClaim_contentVersionId_claimId_usageType_key" ON "ContentVersionClaim"("contentVersionId", "claimId", "usageType");

-- CreateIndex
CREATE INDEX "PolicyRule_policyType_enabled_idx" ON "PolicyRule"("policyType", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRule_ruleIdentifier_ruleVersion_key" ON "PolicyRule"("ruleIdentifier", "ruleVersion");

-- CreateIndex
CREATE INDEX "PolicyEvaluation_targetType_targetId_evaluatedAt_idx" ON "PolicyEvaluation"("targetType", "targetId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "PolicyEvaluation_result_evaluatedAt_idx" ON "PolicyEvaluation"("result", "evaluatedAt");

-- CreateIndex
CREATE INDEX "QualityReviewRecord_targetType_targetId_createdAt_idx" ON "QualityReviewRecord"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "QualityReviewRecord_result_createdAt_idx" ON "QualityReviewRecord"("result", "createdAt");

-- CreateIndex
CREATE INDEX "RevisionAction_reviewId_idx" ON "RevisionAction"("reviewId");

-- CreateIndex
CREATE INDEX "PublicationTarget_contentId_platform_idx" ON "PublicationTarget"("contentId", "platform");

-- CreateIndex
CREATE INDEX "PublicationTarget_status_scheduledAt_idx" ON "PublicationTarget"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "PublicationRecord_publicationTargetId_createdAt_idx" ON "PublicationRecord"("publicationTargetId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelRun_taskType_startedAt_idx" ON "ModelRun"("taskType", "startedAt");

-- CreateIndex
CREATE INDEX "ModelRun_provider_model_startedAt_idx" ON "ModelRun"("provider", "model", "startedAt");

-- CreateIndex
CREATE INDEX "ModelRun_status_idx" ON "ModelRun"("status");

-- CreateIndex
CREATE INDEX "CostRecord_recordedAt_idx" ON "CostRecord"("recordedAt");

-- CreateIndex
CREATE INDEX "CostRecord_relatedType_relatedId_idx" ON "CostRecord"("relatedType", "relatedId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetSetting_scopeType_currency_key" ON "BudgetSetting"("scopeType", "currency");

-- CreateIndex
CREATE INDEX "PromptDefinition_taskType_idx" ON "PromptDefinition"("taskType");

-- CreateIndex
CREATE UNIQUE INDEX "PromptDefinition_identifier_version_key" ON "PromptDefinition"("identifier", "version");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorJob_idempotencyKey_key" ON "OperatorJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OperatorJob_status_runAfter_priority_idx" ON "OperatorJob"("status", "runAfter", "priority");

-- CreateIndex
CREATE INDEX "OperatorJob_jobType_status_idx" ON "OperatorJob"("jobType", "status");

-- CreateIndex
CREATE INDEX "GeneratedContent_contentId_idx" ON "GeneratedContent"("contentId");

-- CreateIndex
CREATE INDEX "GeneratedContent_contentVersionId_idx" ON "GeneratedContent"("contentVersionId");

-- AddForeignKey
ALTER TABLE "GeneratedContent" ADD CONSTRAINT "GeneratedContent_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedContent" ADD CONSTRAINT "GeneratedContent_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateProduct" ADD CONSTRAINT "AffiliateProduct_providerKey_fkey" FOREIGN KEY ("providerKey") REFERENCES "AffiliateProviderRegistry"("providerKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSnapshot" ADD CONSTRAINT "ProductSnapshot_affiliateProductId_fkey" FOREIGN KEY ("affiliateProductId") REFERENCES "AffiliateProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchFinding" ADD CONSTRAINT "ResearchFinding_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicCandidate" ADD CONSTRAINT "TopicCandidate_affiliateProductId_fkey" FOREIGN KEY ("affiliateProductId") REFERENCES "AffiliateProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentStrategy" ADD CONSTRAINT "ContentStrategy_topicCandidateId_fkey" FOREIGN KEY ("topicCandidateId") REFERENCES "TopicCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_topicCandidateId_fkey" FOREIGN KEY ("topicCandidateId") REFERENCES "TopicCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "ContentStrategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "ContentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "ContentStrategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_researchFindingId_fkey" FOREIGN KEY ("researchFindingId") REFERENCES "ResearchFinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimSource" ADD CONSTRAINT "ClaimSource_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimSource" ADD CONSTRAINT "ClaimSource_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersionClaim" ADD CONSTRAINT "ContentVersionClaim_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersionClaim" ADD CONSTRAINT "ContentVersionClaim_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyEvaluation" ADD CONSTRAINT "PolicyEvaluation_policyRuleId_fkey" FOREIGN KEY ("policyRuleId") REFERENCES "PolicyRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityReviewRecord" ADD CONSTRAINT "QualityReviewRecord_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionAction" ADD CONSTRAINT "RevisionAction_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "QualityReviewRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationTarget" ADD CONSTRAINT "PublicationTarget_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationTarget" ADD CONSTRAINT "PublicationTarget_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationRecord" ADD CONSTRAINT "PublicationRecord_publicationTargetId_fkey" FOREIGN KEY ("publicationTargetId") REFERENCES "PublicationTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_modelRunId_fkey" FOREIGN KEY ("modelRunId") REFERENCES "ModelRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill Content / ContentVersion from existing GeneratedContent (non-destructive).
-- Legacy GeneratedContent rows remain; new FKs are populated when possible.
INSERT INTO "Content" ("id", "status", "primaryLanguage", "contentPurpose", "createdAt", "updatedAt")
SELECT
  'gc-content-' || gc."id",
  CASE
    WHEN gc."status" = 'PUBLISHED' THEN 'PUBLISHED'::"ContentLifecycleStatus"
    WHEN gc."status" = 'APPROVED' OR gc."status" = 'READY_TO_PUBLISH' THEN 'APPROVED'::"ContentLifecycleStatus"
    WHEN gc."status" = 'REJECTED' THEN 'REJECTED'::"ContentLifecycleStatus"
    WHEN gc."status" = 'ARCHIVED' THEN 'ARCHIVED'::"ContentLifecycleStatus"
    WHEN gc."status" = 'REVIEW_REQUIRED' THEN 'REVIEWING'::"ContentLifecycleStatus"
    WHEN gc."status" = 'VALIDATION_FAILED' THEN 'REVISION_REQUIRED'::"ContentLifecycleStatus"
    ELSE 'DRAFT'::"ContentLifecycleStatus"
  END,
  'ja',
  gc."contentType"::text,
  gc."createdAt",
  gc."updatedAt"
FROM "GeneratedContent" gc
WHERE NOT EXISTS (
  SELECT 1 FROM "Content" c WHERE c."id" = 'gc-content-' || gc."id"
);

INSERT INTO "ContentVersion" (
  "id", "contentId", "versionNumber", "revisionType", "title", "summary", "body",
  "structuredContent", "status", "createdBy", "createdAt", "updatedAt"
)
SELECT
  'gc-version-' || gc."id",
  'gc-content-' || gc."id",
  gc."version",
  CASE WHEN gc."parentContentId" IS NULL THEN 'initial' ELSE 'revision' END,
  gc."title",
  gc."summary",
  gc."body",
  jsonb_build_object(
    'legacyGeneratedContentId', gc."id",
    'hashtags', gc."hashtags",
    'callToAction', gc."callToAction",
    'affiliateUrl', gc."affiliateUrl"
  ),
  CASE
    WHEN gc."status" IN ('APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED') THEN 'APPROVED'::"ContentVersionStatus"
    WHEN gc."status" = 'REJECTED' THEN 'REJECTED'::"ContentVersionStatus"
    WHEN gc."status" = 'ARCHIVED' THEN 'ARCHIVED'::"ContentVersionStatus"
    WHEN gc."status" = 'REVIEW_REQUIRED' THEN 'REVIEWING'::"ContentVersionStatus"
    WHEN gc."status" = 'VALIDATION_FAILED' THEN 'REVISION_REQUIRED'::"ContentVersionStatus"
    ELSE 'DRAFT'::"ContentVersionStatus"
  END,
  gc."generationProvider",
  gc."generatedAt",
  gc."updatedAt"
FROM "GeneratedContent" gc
WHERE NOT EXISTS (
  SELECT 1 FROM "ContentVersion" cv WHERE cv."id" = 'gc-version-' || gc."id"
);

UPDATE "GeneratedContent" gc
SET
  "contentId" = 'gc-content-' || gc."id",
  "contentVersionId" = 'gc-version-' || gc."id"
WHERE gc."contentId" IS NULL;

