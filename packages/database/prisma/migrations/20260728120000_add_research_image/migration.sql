-- CreateEnum
CREATE TYPE "ImageUsageStatus" AS ENUM ('ALLOWED', 'REQUIRES_CONFIRMATION', 'NOT_ALLOWED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "ResearchImage" (
    "id" TEXT NOT NULL,
    "researchItemId" TEXT NOT NULL,
    "imageType" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "size" TEXT,
    "usageStatus" "ImageUsageStatus" NOT NULL DEFAULT 'REQUIRES_CONFIRMATION',
    "usageNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchImage_researchItemId_idx" ON "ResearchImage"("researchItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchImage_researchItemId_imageType_sourceUrl_key" ON "ResearchImage"("researchItemId", "imageType", "sourceUrl");

-- AddForeignKey
ALTER TABLE "ResearchImage" ADD CONSTRAINT "ResearchImage_researchItemId_fkey" FOREIGN KEY ("researchItemId") REFERENCES "ResearchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
