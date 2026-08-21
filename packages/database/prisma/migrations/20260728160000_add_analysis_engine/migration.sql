-- CreateEnum
CREATE TYPE "AnalysisType" AS ENUM ('PRODUCT_SCORING', 'TREND_DETECTION', 'CONTENT_CANDIDATE_SELECTION');

-- CreateEnum
CREATE TYPE "AnalysisRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EligibilityStatus" AS ENUM ('ELIGIBLE', 'REQUIRES_CONFIRMATION', 'NOT_ELIGIBLE');

-- CreateEnum
CREATE TYPE "ContentCandidateType" AS ENUM ('RANKING', 'TRENDING', 'HIGH_RATING', 'NEW_RELEASE', 'DISCOUNT', 'EDITORIAL');

-- CreateEnum
CREATE TYPE "ContentTargetChannel" AS ENUM ('BLOG', 'X', 'SHORT_VIDEO', 'GENERIC');

-- CreateEnum
CREATE TYPE "ContentCandidateStatus" AS ENUM ('SELECTED', 'HELD', 'REJECTED', 'CONTENT_CREATED', 'PUBLISHED');

-- AlterTable
CREATE INDEX "ResearchItem_itemType_collectedAt_idx" ON "ResearchItem"("itemType", "collectedAt");

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "analysisType" "AnalysisType" NOT NULL,
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'PENDING',
    "parameters" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "analyzedItemCount" INTEGER NOT NULL DEFAULT 0,
    "selectedItemCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "scoringVersion" TEXT NOT NULL DEFAULT 'scoring-v1',
    "eligibilityVersion" TEXT NOT NULL DEFAULT 'eligibility-v1',
    "selectionVersion" TEXT NOT NULL DEFAULT 'selection-v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAnalysis" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "researchItemId" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "popularityScore" DOUBLE PRECISION,
    "trendScore" DOUBLE PRECISION,
    "reviewScore" DOUBLE PRECISION,
    "priceScore" DOUBLE PRECISION,
    "freshnessScore" DOUBLE PRECISION,
    "dataQualityScore" DOUBLE PRECISION NOT NULL,
    "eligibilityStatus" "EligibilityStatus" NOT NULL,
    "exclusionReasons" JSONB NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentCandidate" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "researchItemId" TEXT NOT NULL,
    "productAnalysisId" TEXT NOT NULL,
    "candidateType" "ContentCandidateType" NOT NULL,
    "rank" INTEGER NOT NULL,
    "selectionScore" DOUBLE PRECISION NOT NULL,
    "selectionReasons" JSONB NOT NULL,
    "targetChannel" "ContentTargetChannel" NOT NULL DEFAULT 'GENERIC',
    "status" "ContentCandidateStatus" NOT NULL DEFAULT 'SELECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalysisRun_status_createdAt_idx" ON "AnalysisRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_analysisType_createdAt_idx" ON "AnalysisRun"("analysisType", "createdAt");

-- CreateIndex
CREATE INDEX "ProductAnalysis_analysisRunId_totalScore_idx" ON "ProductAnalysis"("analysisRunId", "totalScore");

-- CreateIndex
CREATE INDEX "ProductAnalysis_researchItemId_analyzedAt_idx" ON "ProductAnalysis"("researchItemId", "analyzedAt");

-- CreateIndex
CREATE INDEX "ProductAnalysis_eligibilityStatus_idx" ON "ProductAnalysis"("eligibilityStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAnalysis_analysisRunId_researchItemId_key" ON "ProductAnalysis"("analysisRunId", "researchItemId");

-- CreateIndex
CREATE INDEX "ContentCandidate_analysisRunId_candidateType_rank_idx" ON "ContentCandidate"("analysisRunId", "candidateType", "rank");

-- CreateIndex
CREATE INDEX "ContentCandidate_researchItemId_idx" ON "ContentCandidate"("researchItemId");

-- CreateIndex
CREATE INDEX "ContentCandidate_status_idx" ON "ContentCandidate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentCandidate_analysisRunId_candidateType_researchItemId_key" ON "ContentCandidate"("analysisRunId", "candidateType", "researchItemId");

-- AddForeignKey
ALTER TABLE "ProductAnalysis" ADD CONSTRAINT "ProductAnalysis_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAnalysis" ADD CONSTRAINT "ProductAnalysis_researchItemId_fkey" FOREIGN KEY ("researchItemId") REFERENCES "ResearchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCandidate" ADD CONSTRAINT "ContentCandidate_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCandidate" ADD CONSTRAINT "ContentCandidate_researchItemId_fkey" FOREIGN KEY ("researchItemId") REFERENCES "ResearchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCandidate" ADD CONSTRAINT "ContentCandidate_productAnalysisId_fkey" FOREIGN KEY ("productAnalysisId") REFERENCES "ProductAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
