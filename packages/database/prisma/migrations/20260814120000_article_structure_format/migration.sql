-- CreateTable
CREATE TABLE "ArticleStructureObservation" (
    "id" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceDomain" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "articleTypeHint" TEXT,
    "features" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "ArticleStructureObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleFormatDefinition" (
    "id" TEXT NOT NULL,
    "formatKey" TEXT NOT NULL,
    "formatCategory" "ContentFormatCategory" NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "spec" JSONB NOT NULL,
    "externalPriorWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "ownPerformanceWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effectiveWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sampleExternal" INTEGER NOT NULL DEFAULT 0,
    "sampleOwn" INTEGER NOT NULL DEFAULT 0,
    "domainDiversity" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION,
    "metricsSummary" JSONB,
    "derivedFromObservationIds" JSONB,
    "linkedLearningRuleId" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleFormatDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArticleStructureObservation_sourceDomain_observedAt_idx" ON "ArticleStructureObservation"("sourceDomain", "observedAt");

-- CreateIndex
CREATE INDEX "ArticleStructureObservation_contentHash_idx" ON "ArticleStructureObservation"("contentHash");

-- CreateIndex
CREATE INDEX "ArticleStructureObservation_articleTypeHint_observedAt_idx" ON "ArticleStructureObservation"("articleTypeHint", "observedAt");

-- CreateIndex
CREATE INDEX "ArticleStructureObservation_sourceDocumentId_idx" ON "ArticleStructureObservation"("sourceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleFormatDefinition_formatKey_key" ON "ArticleFormatDefinition"("formatKey");

-- CreateIndex
CREATE INDEX "ArticleFormatDefinition_status_effectiveWeight_idx" ON "ArticleFormatDefinition"("status", "effectiveWeight");

-- CreateIndex
CREATE INDEX "ArticleFormatDefinition_formatCategory_status_idx" ON "ArticleFormatDefinition"("formatCategory", "status");

-- CreateIndex
CREATE INDEX "ArticleFormatDefinition_linkedLearningRuleId_idx" ON "ArticleFormatDefinition"("linkedLearningRuleId");

-- AddForeignKey
ALTER TABLE "ArticleStructureObservation" ADD CONSTRAINT "ArticleStructureObservation_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
