-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('FANZA', 'TIKTOK', 'X', 'OTHER');

-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "baseUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "publishedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "rawData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchMetric" (
    "id" TEXT NOT NULL,
    "researchItemId" TEXT NOT NULL,
    "metricType" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchItemTag" (
    "researchItemId" TEXT NOT NULL,
    "researchTagId" TEXT NOT NULL,

    CONSTRAINT "ResearchItemTag_pkey" PRIMARY KEY ("researchItemId","researchTagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSource_name_key" ON "ResearchSource"("name");

-- CreateIndex
CREATE INDEX "ResearchItem_sourceId_idx" ON "ResearchItem"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchItem_sourceId_externalId_key" ON "ResearchItem"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "ResearchMetric_researchItemId_recordedAt_idx" ON "ResearchMetric"("researchItemId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchTag_name_type_key" ON "ResearchTag"("name", "type");

-- AddForeignKey
ALTER TABLE "ResearchItem" ADD CONSTRAINT "ResearchItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ResearchSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchMetric" ADD CONSTRAINT "ResearchMetric_researchItemId_fkey" FOREIGN KEY ("researchItemId") REFERENCES "ResearchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchItemTag" ADD CONSTRAINT "ResearchItemTag_researchItemId_fkey" FOREIGN KEY ("researchItemId") REFERENCES "ResearchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchItemTag" ADD CONSTRAINT "ResearchItemTag_researchTagId_fkey" FOREIGN KEY ("researchTagId") REFERENCES "ResearchTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
