-- AlterEnum
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'CONTENT_GENERATION_FAILED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'CONTENT_VALIDATION_FAILED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'CONTENT_REVIEW_REQUIRED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'CONTENT_APPROVED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'CONTENT_REJECTED';

-- CreateEnum
CREATE TYPE "ContentGenerationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GeneratedContentType" AS ENUM ('BLOG_ARTICLE', 'X_POST', 'SHORT_VIDEO_SCRIPT', 'PRODUCT_INTRODUCTION');

-- CreateEnum
CREATE TYPE "GeneratedContentStatus" AS ENUM ('DRAFT', 'VALIDATION_FAILED', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED', 'READY_TO_PUBLISH', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentValidationIssueType" AS ENUM ('FORBIDDEN_SOURCE_TEXT', 'REVIEW_TEXT_DETECTED', 'MISSING_AFFILIATE_URL', 'INVALID_AFFILIATE_URL', 'UNSUPPORTED_CLAIM', 'PROHIBITED_IMAGE', 'IMAGE_CONFIRMATION_REQUIRED', 'DUPLICATE_CONTENT', 'EMPTY_CONTENT', 'LENGTH_EXCEEDED', 'LENGTH_TOO_SHORT', 'MISSING_DISCLOSURE', 'INVALID_HASHTAG', 'RAW_DATA_EXPOSURE', 'SENSITIVE_VALUE_EXPOSURE', 'FABRICATED_FACT', 'STRUCTURE_INVALID');

-- CreateEnum
CREATE TYPE "ContentValidationSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'BLOCKING');

-- CreateEnum
CREATE TYPE "ContentReviewDecision" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_CHANGES');

-- CreateTable
CREATE TABLE "ContentGenerationRun" (
    "id" TEXT NOT NULL,
    "status" "ContentGenerationRunStatus" NOT NULL DEFAULT 'PENDING',
    "providerName" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "generatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentGenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedContent" (
    "id" TEXT NOT NULL,
    "generationRunId" TEXT,
    "contentCandidateId" TEXT NOT NULL,
    "researchItemId" TEXT NOT NULL,
    "contentType" "GeneratedContentType" NOT NULL,
    "targetChannel" "ContentTargetChannel" NOT NULL DEFAULT 'GENERIC',
    "status" "GeneratedContentStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "summary" TEXT,
    "hashtags" JSONB NOT NULL,
    "callToAction" TEXT,
    "affiliateUrl" TEXT NOT NULL,
    "imageId" TEXT,
    "promptVersion" TEXT NOT NULL,
    "generationProvider" TEXT NOT NULL,
    "generationModel" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "validationResult" JSONB,
    "contentHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentContentId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentValidationIssue" (
    "id" TEXT NOT NULL,
    "generatedContentId" TEXT NOT NULL,
    "issueType" "ContentValidationIssueType" NOT NULL,
    "severity" "ContentValidationSeverity" NOT NULL,
    "fieldName" TEXT,
    "message" TEXT NOT NULL,
    "detectedValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentValidationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentReview" (
    "id" TEXT NOT NULL,
    "generatedContentId" TEXT NOT NULL,
    "decision" "ContentReviewDecision" NOT NULL,
    "reviewer" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentGenerationRun_status_createdAt_idx" ON "ContentGenerationRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedContent_contentCandidateId_contentType_version_idx" ON "GeneratedContent"("contentCandidateId", "contentType", "version");

-- CreateIndex
CREATE INDEX "GeneratedContent_researchItemId_contentType_idx" ON "GeneratedContent"("researchItemId", "contentType");

-- CreateIndex
CREATE INDEX "GeneratedContent_status_createdAt_idx" ON "GeneratedContent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedContent_contentHash_idx" ON "GeneratedContent"("contentHash");

-- CreateIndex
CREATE INDEX "GeneratedContent_generationRunId_idx" ON "GeneratedContent"("generationRunId");

-- CreateIndex
CREATE INDEX "ContentValidationIssue_generatedContentId_severity_idx" ON "ContentValidationIssue"("generatedContentId", "severity");

-- CreateIndex
CREATE INDEX "ContentReview_generatedContentId_createdAt_idx" ON "ContentReview"("generatedContentId", "createdAt");

-- AddForeignKey
ALTER TABLE "GeneratedContent" ADD CONSTRAINT "GeneratedContent_generationRunId_fkey" FOREIGN KEY ("generationRunId") REFERENCES "ContentGenerationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedContent" ADD CONSTRAINT "GeneratedContent_contentCandidateId_fkey" FOREIGN KEY ("contentCandidateId") REFERENCES "ContentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedContent" ADD CONSTRAINT "GeneratedContent_researchItemId_fkey" FOREIGN KEY ("researchItemId") REFERENCES "ResearchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedContent" ADD CONSTRAINT "GeneratedContent_parentContentId_fkey" FOREIGN KEY ("parentContentId") REFERENCES "GeneratedContent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentValidationIssue" ADD CONSTRAINT "ContentValidationIssue_generatedContentId_fkey" FOREIGN KEY ("generatedContentId") REFERENCES "GeneratedContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentReview" ADD CONSTRAINT "ContentReview_generatedContentId_fkey" FOREIGN KEY ("generatedContentId") REFERENCES "GeneratedContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
