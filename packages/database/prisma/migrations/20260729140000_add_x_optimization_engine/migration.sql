-- AlterEnum
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_OPTIMIZATION_RECOMMENDATION_CREATED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_OPTIMIZATION_RECOMMENDATION_APPROVED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_OPTIMIZATION_RECOMMENDATION_REJECTED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_OPTIMIZATION_EXPERIMENT_STARTED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_OPTIMIZATION_IMPROVED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_OPTIMIZATION_DECLINED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_OPTIMIZATION_VALIDATION_FAILED';

CREATE TYPE "XOptimizationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "XOptimizationDimension" AS ENUM ('CONTENT_ANGLE', 'POST_FORMAT', 'POSTING_TIME', 'HASHTAG_SET', 'URL_PLACEMENT', 'DISCLOSURE_PLACEMENT', 'CTA_STYLE', 'RELATED_POST_USAGE', 'INFORMATION_DENSITY', 'TITLE_LENGTH');
CREATE TYPE "XOptimizationFindingType" AS ENUM ('POSITIVE', 'NEGATIVE', 'NEUTRAL', 'INSUFFICIENT_DATA', 'CONFLICTING');
CREATE TYPE "XOptimizationRecommendationStatus" AS ENUM ('PROPOSED', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED', 'EXPIRED', 'APPLIED', 'CANCELLED');
CREATE TYPE "XOptimizationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "XOptimizationApplicationStatus" AS ENUM ('PREPARED', 'APPLIED', 'EVALUATING', 'COMPLETED', 'CANCELLED', 'FAILED');

CREATE TABLE "XOptimizationRun" (
    "id" TEXT NOT NULL,
    "status" "XOptimizationRunStatus" NOT NULL DEFAULT 'PENDING',
    "optimizationVersion" TEXT NOT NULL DEFAULT 'x-optimization-v1',
    "metricVersion" TEXT NOT NULL DEFAULT 'x-optimization-metrics-v1',
    "evaluationWindowHours" INTEGER NOT NULL,
    "parameters" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "analyzedPublicationCount" INTEGER NOT NULL DEFAULT 0,
    "generatedRecommendationCount" INTEGER NOT NULL DEFAULT 0,
    "approvedRecommendationCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedRecommendationCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XOptimizationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XOptimizationFinding" (
    "id" TEXT NOT NULL,
    "optimizationRunId" TEXT NOT NULL,
    "dimension" "XOptimizationDimension" NOT NULL,
    "segmentKey" TEXT NOT NULL,
    "currentVariant" TEXT NOT NULL,
    "comparedVariant" TEXT NOT NULL,
    "currentSampleCount" INTEGER NOT NULL,
    "comparedSampleCount" INTEGER NOT NULL,
    "currentScore" DOUBLE PRECISION,
    "comparedScore" DOUBLE PRECISION,
    "scoreDifference" DOUBLE PRECISION,
    "confidenceLevel" "XStrategyConfidenceLevel" NOT NULL,
    "statisticalResult" JSONB,
    "supportingMetrics" JSONB,
    "dataLimitations" JSONB,
    "findingType" "XOptimizationFindingType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XOptimizationFinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XOptimizationRecommendation" (
    "id" TEXT NOT NULL,
    "optimizationRunId" TEXT NOT NULL,
    "findingId" TEXT,
    "dimension" "XOptimizationDimension" NOT NULL,
    "status" "XOptimizationRecommendationStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "priority" "XOptimizationPriority" NOT NULL DEFAULT 'MEDIUM',
    "currentValue" TEXT NOT NULL,
    "recommendedValue" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "expectedImpact" JSONB,
    "confidenceLevel" "XStrategyConfidenceLevel" NOT NULL,
    "requiredSampleSize" INTEGER NOT NULL DEFAULT 30,
    "expiresAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "reviewer" TEXT,
    "reviewComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XOptimizationRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XOptimizationApplication" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "sourcePublicationId" TEXT,
    "generatedContentId" TEXT,
    "targetPublicationId" TEXT,
    "experimentId" TEXT,
    "appliedValue" TEXT NOT NULL,
    "status" "XOptimizationApplicationStatus" NOT NULL DEFAULT 'PREPARED',
    "appliedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XOptimizationApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XContentVariant" (
    "id" TEXT NOT NULL,
    "generatedContentId" TEXT,
    "publicationId" TEXT,
    "contentAngle" TEXT,
    "postFormat" TEXT,
    "postingTimeBucket" TEXT,
    "weekday" TEXT,
    "hashtagSet" TEXT,
    "urlPlacement" TEXT,
    "disclosurePlacement" TEXT,
    "ctaStyle" TEXT,
    "informationDensity" TEXT,
    "titleWeightedLength" INTEGER,
    "bodyWeightedLength" INTEGER,
    "featureSnapshot" JSONB NOT NULL,
    "variantVersion" TEXT NOT NULL DEFAULT 'x-variant-v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XContentVariant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "XOptimizationRun_status_createdAt_idx" ON "XOptimizationRun"("status", "createdAt");
CREATE INDEX "XOptimizationFinding_optimizationRunId_dimension_idx" ON "XOptimizationFinding"("optimizationRunId", "dimension");
CREATE INDEX "XOptimizationFinding_dimension_findingType_idx" ON "XOptimizationFinding"("dimension", "findingType");
CREATE INDEX "XOptimizationRecommendation_status_dimension_idx" ON "XOptimizationRecommendation"("status", "dimension");
CREATE INDEX "XOptimizationRecommendation_optimizationRunId_idx" ON "XOptimizationRecommendation"("optimizationRunId");
CREATE INDEX "XOptimizationRecommendation_expiresAt_idx" ON "XOptimizationRecommendation"("expiresAt");
CREATE INDEX "XOptimizationApplication_recommendationId_status_idx" ON "XOptimizationApplication"("recommendationId", "status");
CREATE INDEX "XOptimizationApplication_generatedContentId_idx" ON "XOptimizationApplication"("generatedContentId");
CREATE INDEX "XContentVariant_publicationId_idx" ON "XContentVariant"("publicationId");
CREATE INDEX "XContentVariant_generatedContentId_idx" ON "XContentVariant"("generatedContentId");
CREATE INDEX "XContentVariant_contentAngle_postFormat_idx" ON "XContentVariant"("contentAngle", "postFormat");

ALTER TABLE "XOptimizationFinding" ADD CONSTRAINT "XOptimizationFinding_optimizationRunId_fkey" FOREIGN KEY ("optimizationRunId") REFERENCES "XOptimizationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XOptimizationRecommendation" ADD CONSTRAINT "XOptimizationRecommendation_optimizationRunId_fkey" FOREIGN KEY ("optimizationRunId") REFERENCES "XOptimizationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XOptimizationRecommendation" ADD CONSTRAINT "XOptimizationRecommendation_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "XOptimizationFinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "XOptimizationApplication" ADD CONSTRAINT "XOptimizationApplication_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "XOptimizationRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
