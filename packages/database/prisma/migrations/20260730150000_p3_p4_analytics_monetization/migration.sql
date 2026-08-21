-- CreateEnum
CREATE TYPE "MonetizationStatus" AS ENUM ('UNMONETIZED', 'PENDING_AFFILIATE', 'MONETIZED', 'NOT_APPLICABLE');

-- AlterTable
ALTER TABLE "Content" ADD COLUMN "monetizationStatus" "MonetizationStatus" NOT NULL DEFAULT 'UNMONETIZED';

-- CreateIndex
CREATE INDEX "Content_monetizationStatus_createdAt_idx" ON "Content"("monetizationStatus", "createdAt");

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "contentId" TEXT,
    "publicationTargetId" TEXT,
    "publicationRecordId" TEXT,
    "externalId" TEXT,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsSnapshot_platform_measuredAt_idx" ON "AnalyticsSnapshot"("platform", "measuredAt");
CREATE INDEX "AnalyticsSnapshot_contentId_measuredAt_idx" ON "AnalyticsSnapshot"("contentId", "measuredAt");
CREATE INDEX "AnalyticsSnapshot_source_measuredAt_idx" ON "AnalyticsSnapshot"("source", "measuredAt");

ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;
