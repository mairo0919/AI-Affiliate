-- AlterEnum
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_PUBLICATION_FAILED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_PUBLICATION_PARTIALLY_PUBLISHED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_PUBLICATION_PUBLISHED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_REPLY_FAILED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_METRICS_COLLECTION_FAILED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_STRATEGY_EVALUATION_COMPLETED';

-- CreateEnum
CREATE TYPE "XPublicationStrategyType" AS ENUM ('SINGLE_POST', 'ROOT_WITH_REPLY', 'THREAD', 'RELATED_POST_LINK', 'HUB_POST', 'CONTROL');
CREATE TYPE "XPublicationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PARTIALLY_PUBLISHED', 'PUBLISHED', 'FAILED', 'CANCELLED', 'DELETED');
CREATE TYPE "XPublicationPostRole" AS ENUM ('ROOT', 'REPLY', 'RELATED_LINK', 'CTA', 'HUB');
CREATE TYPE "XPublicationPostStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'SKIPPED', 'CANCELLED');
CREATE TYPE "XExperimentStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "XExperimentAllocationMethod" AS ENUM ('ROUND_ROBIN', 'RANDOM', 'WEIGHTED', 'MANUAL');
CREATE TYPE "XStrategyConfidenceLevel" AS ENUM ('INSUFFICIENT', 'LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "XPublication" (
    "id" TEXT NOT NULL,
    "generatedContentId" TEXT NOT NULL,
    "contentCandidateId" TEXT NOT NULL,
    "researchItemId" TEXT NOT NULL,
    "strategyType" "XPublicationStrategyType" NOT NULL,
    "status" "XPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "publishingStartedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "rootPostId" TEXT,
    "conversationId" TEXT,
    "rootPostUrl" TEXT,
    "accountId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorType" TEXT,
    "lastErrorMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "experimentGroup" TEXT,
    "strategyVersion" TEXT NOT NULL DEFAULT 'x-strategy-v1',
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XPublication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XPublicationPost" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" "XPublicationPostRole" NOT NULL,
    "status" "XPublicationPostStatus" NOT NULL DEFAULT 'PENDING',
    "body" TEXT NOT NULL,
    "weightedLength" INTEGER NOT NULL,
    "replyToSequence" INTEGER,
    "relatedPublicationId" TEXT,
    "xPostId" TEXT,
    "xPostUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorType" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XPublicationPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XPublicationLock" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "lockKey" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XPublicationLock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XPostMetricSnapshot" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "publicationPostId" TEXT,
    "xPostId" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "impressionCount" INTEGER,
    "likeCount" INTEGER,
    "replyCount" INTEGER,
    "repostCount" INTEGER,
    "quoteCount" INTEGER,
    "bookmarkCount" INTEGER,
    "urlClickCount" INTEGER,
    "profileClickCount" INTEGER,
    "detailExpandCount" INTEGER,
    "mediaViewCount" INTEGER,
    "followerCountAtMeasurement" INTEGER,
    "rawMetricAvailability" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "collectionWindowMinutes" INTEGER,
    "metricsVersion" TEXT NOT NULL DEFAULT 'x-metrics-v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XPostMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XStrategyPerformance" (
    "id" TEXT NOT NULL,
    "strategyType" "XPublicationStrategyType" NOT NULL,
    "strategyVersion" TEXT NOT NULL,
    "evaluationWindowHours" INTEGER NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "eligibleSampleCount" INTEGER NOT NULL,
    "averageImpressions" DOUBLE PRECISION,
    "medianImpressions" DOUBLE PRECISION,
    "averageEngagementRate" DOUBLE PRECISION,
    "medianEngagementRate" DOUBLE PRECISION,
    "averageUrlClickRate" DOUBLE PRECISION,
    "averageProfileClickRate" DOUBLE PRECISION,
    "averageReplyContinuationRate" DOUBLE PRECISION,
    "confidenceLevel" "XStrategyConfidenceLevel" NOT NULL,
    "score" DOUBLE PRECISION,
    "recommendedStrategy" "XPublicationStrategyType",
    "supportingMetrics" JSONB,
    "dataLimitations" JSONB,
    "calculatedAt" TIMESTAMP(3) NOT NULL,
    "parameters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XStrategyPerformance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XPublicationExperiment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "XExperimentStatus" NOT NULL DEFAULT 'DRAFT',
    "strategyVariants" JSONB NOT NULL,
    "allocationMethod" "XExperimentAllocationMethod" NOT NULL DEFAULT 'ROUND_ROBIN',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "minimumSampleSize" INTEGER NOT NULL DEFAULT 30,
    "evaluationWindowHours" INTEGER NOT NULL DEFAULT 72,
    "result" JSONB,
    "allocationCursor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XPublicationExperiment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "XPublication_idempotencyKey_key" ON "XPublication"("idempotencyKey");
CREATE INDEX "XPublication_status_scheduledAt_idx" ON "XPublication"("status", "scheduledAt");
CREATE INDEX "XPublication_researchItemId_status_idx" ON "XPublication"("researchItemId", "status");
CREATE INDEX "XPublication_strategyType_status_idx" ON "XPublication"("strategyType", "status");
CREATE INDEX "XPublication_generatedContentId_idx" ON "XPublication"("generatedContentId");
CREATE INDEX "XPublication_nextRetryAt_idx" ON "XPublication"("nextRetryAt");

CREATE UNIQUE INDEX "XPublicationPost_publicationId_sequence_key" ON "XPublicationPost"("publicationId", "sequence");
CREATE INDEX "XPublicationPost_publicationId_status_idx" ON "XPublicationPost"("publicationId", "status");
CREATE INDEX "XPublicationPost_xPostId_idx" ON "XPublicationPost"("xPostId");

CREATE UNIQUE INDEX "XPublicationLock_lockKey_key" ON "XPublicationLock"("lockKey");
CREATE INDEX "XPublicationLock_expiresAt_idx" ON "XPublicationLock"("expiresAt");
CREATE INDEX "XPublicationLock_publicationId_idx" ON "XPublicationLock"("publicationId");

CREATE UNIQUE INDEX "XPostMetricSnapshot_xPostId_measuredAt_key" ON "XPostMetricSnapshot"("xPostId", "measuredAt");
CREATE INDEX "XPostMetricSnapshot_publicationId_measuredAt_idx" ON "XPostMetricSnapshot"("publicationId", "measuredAt");
CREATE INDEX "XPostMetricSnapshot_publicationPostId_measuredAt_idx" ON "XPostMetricSnapshot"("publicationPostId", "measuredAt");
CREATE INDEX "XPostMetricSnapshot_collectionWindowMinutes_idx" ON "XPostMetricSnapshot"("collectionWindowMinutes");

CREATE INDEX "XStrategyPerformance_strategyType_strategyVersion_calculat_idx" ON "XStrategyPerformance"("strategyType", "strategyVersion", "calculatedAt");
CREATE INDEX "XStrategyPerformance_calculatedAt_idx" ON "XStrategyPerformance"("calculatedAt");

CREATE UNIQUE INDEX "XPublicationExperiment_name_key" ON "XPublicationExperiment"("name");
CREATE INDEX "XPublicationExperiment_status_startedAt_idx" ON "XPublicationExperiment"("status", "startedAt");

ALTER TABLE "XPublication" ADD CONSTRAINT "XPublication_generatedContentId_fkey" FOREIGN KEY ("generatedContentId") REFERENCES "GeneratedContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XPublication" ADD CONSTRAINT "XPublication_contentCandidateId_fkey" FOREIGN KEY ("contentCandidateId") REFERENCES "ContentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XPublication" ADD CONSTRAINT "XPublication_researchItemId_fkey" FOREIGN KEY ("researchItemId") REFERENCES "ResearchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "XPublicationPost" ADD CONSTRAINT "XPublicationPost_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "XPublication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "XPublicationLock" ADD CONSTRAINT "XPublicationLock_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "XPublication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "XPostMetricSnapshot" ADD CONSTRAINT "XPostMetricSnapshot_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "XPublication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XPostMetricSnapshot" ADD CONSTRAINT "XPostMetricSnapshot_publicationPostId_fkey" FOREIGN KEY ("publicationPostId") REFERENCES "XPublicationPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
