-- CreateTable
CREATE TABLE "EditorialBrainRun" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "mode" TEXT NOT NULL DEFAULT 'SHADOW',
    "topicId" TEXT,
    "strategyId" TEXT,
    "contentId" TEXT,
    "contentVersionId" TEXT,
    "formatKey" TEXT,
    "contentType" TEXT,
    "structurePatternId" TEXT,
    "editorialPatternId" TEXT,
    "claimProfile" TEXT,
    "selectedClaimIds" JSONB,
    "retrievedExperienceIds" JSONB,
    "corePlan" JSONB,
    "channelPlan" JSONB,
    "generatorModelRunIds" JSONB,
    "validatorResults" JSONB,
    "reviewResult" JSONB,
    "repairAttempts" JSONB,
    "brainDecision" TEXT,
    "legacyDecision" TEXT,
    "finalDecision" TEXT,
    "failureCodes" JSONB,
    "publishRef" TEXT,
    "performanceRef" TEXT,
    "errorDetail" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorialBrainRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialExperience" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "formatKey" TEXT,
    "contentType" TEXT,
    "claimProfile" TEXT,
    "structurePatternId" TEXT,
    "editorialPatternId" TEXT,
    "planSummary" JSONB,
    "validatorSummary" JSONB,
    "reviewSummary" JSONB,
    "failureCodes" JSONB,
    "outcome" TEXT,
    "sourceType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "sampleEvidence" INTEGER NOT NULL DEFAULT 1,
    "brainRunId" TEXT,
    "contentVersionId" TEXT,
    "modelRunIds" JSONB,
    "performanceRef" TEXT,
    "lesson" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorialExperience_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EditorialBrainRun_channel_createdAt_idx" ON "EditorialBrainRun"("channel", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialBrainRun_mode_status_createdAt_idx" ON "EditorialBrainRun"("mode", "status", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialBrainRun_contentVersionId_idx" ON "EditorialBrainRun"("contentVersionId");

-- CreateIndex
CREATE INDEX "EditorialBrainRun_strategyId_createdAt_idx" ON "EditorialBrainRun"("strategyId", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialBrainRun_formatKey_channel_createdAt_idx" ON "EditorialBrainRun"("formatKey", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialBrainRun_claimProfile_createdAt_idx" ON "EditorialBrainRun"("claimProfile", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialExperience_scope_channel_createdAt_idx" ON "EditorialExperience"("scope", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialExperience_formatKey_channel_createdAt_idx" ON "EditorialExperience"("formatKey", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialExperience_claimProfile_createdAt_idx" ON "EditorialExperience"("claimProfile", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialExperience_structurePatternId_createdAt_idx" ON "EditorialExperience"("structurePatternId", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialExperience_editorialPatternId_createdAt_idx" ON "EditorialExperience"("editorialPatternId", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialExperience_sourceType_createdAt_idx" ON "EditorialExperience"("sourceType", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialExperience_brainRunId_idx" ON "EditorialExperience"("brainRunId");

-- CreateIndex
CREATE INDEX "EditorialExperience_contentVersionId_idx" ON "EditorialExperience"("contentVersionId");

-- CreateIndex
CREATE INDEX "EditorialExperience_confidence_createdAt_idx" ON "EditorialExperience"("confidence", "createdAt");

-- AddForeignKey
ALTER TABLE "EditorialExperience" ADD CONSTRAINT "EditorialExperience_brainRunId_fkey" FOREIGN KEY ("brainRunId") REFERENCES "EditorialBrainRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
