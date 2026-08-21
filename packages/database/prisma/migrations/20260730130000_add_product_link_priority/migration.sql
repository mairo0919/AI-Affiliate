-- CreateEnum
CREATE TYPE "ProductLinkType" AS ENUM ('PROVIDER_PRODUCT', 'AFFILIATE', 'OFFICIAL', 'TRUSTED_PRODUCT', 'OTHER');

-- CreateTable
CREATE TABLE "ProductLink" (
    "id" TEXT NOT NULL,
    "affiliateProductId" TEXT,
    "contentId" TEXT,
    "url" TEXT,
    "preferredAffiliateProvider" TEXT NOT NULL,
    "currentLinkProvider" TEXT NOT NULL,
    "currentLinkType" "ProductLinkType" NOT NULL,
    "replacePriority" INTEGER NOT NULL,
    "affiliateReplacementCandidate" BOOLEAN NOT NULL DEFAULT false,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductLink_affiliateProductId_replacePriority_idx" ON "ProductLink"("affiliateProductId", "replacePriority");

-- CreateIndex
CREATE INDEX "ProductLink_contentId_isSelected_idx" ON "ProductLink"("contentId", "isSelected");

-- CreateIndex
CREATE INDEX "ProductLink_preferredAffiliateProvider_currentLinkType_idx" ON "ProductLink"("preferredAffiliateProvider", "currentLinkType");

-- AddForeignKey
ALTER TABLE "ProductLink" ADD CONSTRAINT "ProductLink_affiliateProductId_fkey" FOREIGN KEY ("affiliateProductId") REFERENCES "AffiliateProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLink" ADD CONSTRAINT "ProductLink_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
