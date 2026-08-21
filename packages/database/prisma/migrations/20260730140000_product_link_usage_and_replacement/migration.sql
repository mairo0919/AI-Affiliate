-- CreateEnum
CREATE TYPE "AffiliateReplacementStatus" AS ENUM (
  'NOT_APPLICABLE',
  'AWAITING_PROVIDER',
  'AWAITING_MATCH',
  'CANDIDATE_FOUND',
  'AWAITING_APPROVAL',
  'APPROVED',
  'REPLACED',
  'REJECTED',
  'INVALID'
);

-- CreateEnum
CREATE TYPE "ProductLinkUsageKind" AS ENUM ('CTA', 'BODY', 'METADATA');

-- CreateEnum
CREATE TYPE "LinkReplacementEventStatus" AS ENUM (
  'PROPOSED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'APPLIED',
  'REJECTED'
);

-- AlterTable ProductLink: drop usage coupling + boolean candidate; add replacement fields
ALTER TABLE "ProductLink" DROP CONSTRAINT IF EXISTS "ProductLink_contentId_fkey";
DROP INDEX IF EXISTS "ProductLink_contentId_isSelected_idx";
ALTER TABLE "ProductLink" DROP COLUMN IF EXISTS "contentId";
ALTER TABLE "ProductLink" DROP COLUMN IF EXISTS "affiliateReplacementCandidate";

ALTER TABLE "ProductLink" ADD COLUMN IF NOT EXISTS "productMatchKey" TEXT;
ALTER TABLE "ProductLink" ADD COLUMN IF NOT EXISTS "availability" TEXT NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE "ProductLink" ADD COLUMN IF NOT EXISTS "replacementStatus" "AffiliateReplacementStatus" NOT NULL DEFAULT 'NOT_APPLICABLE';
ALTER TABLE "ProductLink" ADD COLUMN IF NOT EXISTS "candidateAffiliateUrl" TEXT;
ALTER TABLE "ProductLink" ADD COLUMN IF NOT EXISTS "candidateAffiliateProductId" TEXT;
ALTER TABLE "ProductLink" ADD COLUMN IF NOT EXISTS "matchedProvider" TEXT;
ALTER TABLE "ProductLink" ADD COLUMN IF NOT EXISTS "matchConfidence" DOUBLE PRECISION;
ALTER TABLE "ProductLink" ADD COLUMN IF NOT EXISTS "matchReason" TEXT;
ALTER TABLE "ProductLink" ADD COLUMN IF NOT EXISTS "detectedAt" TIMESTAMP(3);
ALTER TABLE "ProductLink" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "ProductLink" ADD COLUMN IF NOT EXISTS "approvedBy" TEXT;
ALTER TABLE "ProductLink" ADD COLUMN IF NOT EXISTS "replacedAt" TIMESTAMP(3);
ALTER TABLE "ProductLink" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

CREATE INDEX IF NOT EXISTS "ProductLink_productMatchKey_idx" ON "ProductLink"("productMatchKey");
CREATE INDEX IF NOT EXISTS "ProductLink_replacementStatus_idx" ON "ProductLink"("replacementStatus");

-- CreateTable
CREATE TABLE "ProductLinkUsage" (
    "id" TEXT NOT NULL,
    "productLinkId" TEXT NOT NULL,
    "contentVersionId" TEXT,
    "publicationTargetId" TEXT,
    "publicationRecordId" TEXT,
    "usageKind" "ProductLinkUsageKind" NOT NULL,
    "locationHint" TEXT,
    "urlSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductLinkUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductLinkUsage_productLinkId_createdAt_idx" ON "ProductLinkUsage"("productLinkId", "createdAt");
CREATE INDEX "ProductLinkUsage_contentVersionId_idx" ON "ProductLinkUsage"("contentVersionId");
CREATE INDEX "ProductLinkUsage_publicationTargetId_idx" ON "ProductLinkUsage"("publicationTargetId");
CREATE INDEX "ProductLinkUsage_publicationRecordId_idx" ON "ProductLinkUsage"("publicationRecordId");

ALTER TABLE "ProductLinkUsage" ADD CONSTRAINT "ProductLinkUsage_productLinkId_fkey" FOREIGN KEY ("productLinkId") REFERENCES "ProductLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductLinkUsage" ADD CONSTRAINT "ProductLinkUsage_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductLinkUsage" ADD CONSTRAINT "ProductLinkUsage_publicationTargetId_fkey" FOREIGN KEY ("publicationTargetId") REFERENCES "PublicationTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductLinkUsage" ADD CONSTRAINT "ProductLinkUsage_publicationRecordId_fkey" FOREIGN KEY ("publicationRecordId") REFERENCES "PublicationRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "LinkReplacementEvent" (
    "id" TEXT NOT NULL,
    "productLinkId" TEXT,
    "contentId" TEXT NOT NULL,
    "sourceContentVersionId" TEXT NOT NULL,
    "targetContentVersionId" TEXT,
    "sourcePublicationTargetId" TEXT,
    "targetPublicationTargetId" TEXT,
    "publicationRecordId" TEXT,
    "previousUrl" TEXT NOT NULL,
    "nextUrl" TEXT NOT NULL,
    "changeReason" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "replacedAt" TIMESTAMP(3),
    "status" "LinkReplacementEventStatus" NOT NULL DEFAULT 'PROPOSED',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkReplacementEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LinkReplacementEvent_contentId_createdAt_idx" ON "LinkReplacementEvent"("contentId", "createdAt");
CREATE INDEX "LinkReplacementEvent_productLinkId_status_idx" ON "LinkReplacementEvent"("productLinkId", "status");
CREATE INDEX "LinkReplacementEvent_status_createdAt_idx" ON "LinkReplacementEvent"("status", "createdAt");

ALTER TABLE "LinkReplacementEvent" ADD CONSTRAINT "LinkReplacementEvent_productLinkId_fkey" FOREIGN KEY ("productLinkId") REFERENCES "ProductLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LinkReplacementEvent" ADD CONSTRAINT "LinkReplacementEvent_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LinkReplacementEvent" ADD CONSTRAINT "LinkReplacementEvent_sourceContentVersionId_fkey" FOREIGN KEY ("sourceContentVersionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LinkReplacementEvent" ADD CONSTRAINT "LinkReplacementEvent_targetContentVersionId_fkey" FOREIGN KEY ("targetContentVersionId") REFERENCES "ContentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LinkReplacementEvent" ADD CONSTRAINT "LinkReplacementEvent_sourcePublicationTargetId_fkey" FOREIGN KEY ("sourcePublicationTargetId") REFERENCES "PublicationTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LinkReplacementEvent" ADD CONSTRAINT "LinkReplacementEvent_targetPublicationTargetId_fkey" FOREIGN KEY ("targetPublicationTargetId") REFERENCES "PublicationTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LinkReplacementEvent" ADD CONSTRAINT "LinkReplacementEvent_publicationRecordId_fkey" FOREIGN KEY ("publicationRecordId") REFERENCES "PublicationRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
