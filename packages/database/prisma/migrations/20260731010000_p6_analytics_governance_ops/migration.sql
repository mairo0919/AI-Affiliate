-- P6 Production Analytics / Learning Governance / Orchestration

-- Enum extensions
ALTER TYPE "ResearchJobStatus" ADD VALUE IF NOT EXISTS 'MANUAL_REVIEW_REQUIRED';
ALTER TYPE "ResearchJobType" ADD VALUE IF NOT EXISTS 'OPERATION_CYCLE';
ALTER TYPE "ResearchJobType" ADD VALUE IF NOT EXISTS 'LEARNING_GOVERNANCE';

-- LearningRule governance columns
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "minimumSampleCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "minimumConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5;
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "minimumSuccessRate" DOUBLE PRECISION NOT NULL DEFAULT 0.4;
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "applicablePlatform" TEXT;
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "applicableContentType" TEXT;
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "applicableGenre" TEXT;
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "applicableProvider" TEXT;
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "validUntil" TIMESTAMP(3);
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "approvedBy" TEXT;
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3);
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "deactivationReason" TEXT;
ALTER TABLE "LearningRule" ADD COLUMN IF NOT EXISTS "supersedesRuleId" TEXT;

CREATE INDEX IF NOT EXISTS "LearningRule_status_applicablePlatform_idx"
  ON "LearningRule"("status", "applicablePlatform");

ALTER TABLE "LearningRule"
  DROP CONSTRAINT IF EXISTS "LearningRule_supersedesRuleId_fkey";
ALTER TABLE "LearningRule"
  ADD CONSTRAINT "LearningRule_supersedesRuleId_fkey"
  FOREIGN KEY ("supersedesRuleId") REFERENCES "LearningRule"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "AnalyticsImportBatch" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "platform" TEXT,
    "format" TEXT NOT NULL,
    "sourceFileHash" TEXT,
    "fileName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "validationIssues" JSONB,
    "metadata" JSONB,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsImportBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AnalyticsImportBatch_sourceFileHash_key" ON "AnalyticsImportBatch"("sourceFileHash");
CREATE INDEX IF NOT EXISTS "AnalyticsImportBatch_status_importedAt_idx" ON "AnalyticsImportBatch"("status", "importedAt");
CREATE INDEX IF NOT EXISTS "AnalyticsImportBatch_platform_importedAt_idx" ON "AnalyticsImportBatch"("platform", "importedAt");

CREATE TABLE IF NOT EXISTS "AnalyticsImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "rowHash" TEXT NOT NULL,
    "externalPublicationId" TEXT,
    "measuredAt" TIMESTAMP(3),
    "rawMetrics" JSONB NOT NULL,
    "normalizedMetrics" JSONB,
    "unit" TEXT,
    "attributionWindowHours" INTEGER,
    "duplicateStatus" TEXT NOT NULL DEFAULT 'unique',
    "validationIssues" JSONB,
    "attributionStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "snapshotId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsImportRow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AnalyticsImportRow_batchId_rowHash_key" ON "AnalyticsImportRow"("batchId", "rowHash");
CREATE INDEX IF NOT EXISTS "AnalyticsImportRow_attributionStatus_createdAt_idx" ON "AnalyticsImportRow"("attributionStatus", "createdAt");
CREATE INDEX IF NOT EXISTS "AnalyticsImportRow_externalPublicationId_idx" ON "AnalyticsImportRow"("externalPublicationId");

CREATE TABLE IF NOT EXISTS "AnalyticsAttribution" (
    "id" TEXT NOT NULL,
    "importRowId" TEXT,
    "snapshotId" TEXT,
    "status" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "matchReason" TEXT NOT NULL,
    "publicationRecordId" TEXT,
    "publicationTargetId" TEXT,
    "contentVersionId" TEXT,
    "contentId" TEXT,
    "productLinkId" TEXT,
    "experimentVariantId" TEXT,
    "platformAccount" TEXT,
    "candidates" JSONB,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsAttribution_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AnalyticsAttribution_status_createdAt_idx" ON "AnalyticsAttribution"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "AnalyticsAttribution_contentId_idx" ON "AnalyticsAttribution"("contentId");
CREATE INDEX IF NOT EXISTS "AnalyticsAttribution_publicationTargetId_idx" ON "AnalyticsAttribution"("publicationTargetId");

CREATE TABLE IF NOT EXISTS "AffiliateResult" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "transactionId" TEXT,
    "clickedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "productId" TEXT,
    "productMatchKey" TEXT,
    "normalUrl" TEXT,
    "affiliateUrl" TEXT,
    "orderAmount" DOUBLE PRECISION,
    "commissionAmount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "contentId" TEXT,
    "contentVersionId" TEXT,
    "publicationTargetId" TEXT,
    "productLinkId" TEXT,
    "attributionMetadata" JSONB,
    "importBatchId" TEXT,
    "sourceFileHash" TEXT,
    "rowHash" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateResult_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateResult_provider_transactionId_key" ON "AffiliateResult"("provider", "transactionId");
CREATE INDEX IF NOT EXISTS "AffiliateResult_productMatchKey_convertedAt_idx" ON "AffiliateResult"("productMatchKey", "convertedAt");
CREATE INDEX IF NOT EXISTS "AffiliateResult_contentId_convertedAt_idx" ON "AffiliateResult"("contentId", "convertedAt");
CREATE INDEX IF NOT EXISTS "AffiliateResult_status_convertedAt_idx" ON "AffiliateResult"("status", "convertedAt");

CREATE TABLE IF NOT EXISTS "LearningRuleApplication" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "learningRuleId" TEXT NOT NULL,
    "applicationType" TEXT NOT NULL,
    "appliedField" TEXT,
    "promptVersion" TEXT,
    "modelRunId" TEXT,
    "applicationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearningRuleApplication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LearningRuleApplication_strategyId_createdAt_idx" ON "LearningRuleApplication"("strategyId", "createdAt");
CREATE INDEX IF NOT EXISTS "LearningRuleApplication_learningRuleId_createdAt_idx" ON "LearningRuleApplication"("learningRuleId", "createdAt");

CREATE TABLE IF NOT EXISTS "LearningRuleConflict" (
    "id" TEXT NOT NULL,
    "ruleAId" TEXT NOT NULL,
    "ruleBId" TEXT NOT NULL,
    "conflictType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'manual_review_required',
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearningRuleConflict_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LearningRuleConflict_ruleAId_ruleBId_conflictType_key"
  ON "LearningRuleConflict"("ruleAId", "ruleBId", "conflictType");
CREATE INDEX IF NOT EXISTS "LearningRuleConflict_status_createdAt_idx" ON "LearningRuleConflict"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "OperationJob" (
    "id" TEXT NOT NULL,
    "cycleType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "errorClass" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "operatorJobId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OperationJob_idempotencyKey_key" ON "OperationJob"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "OperationJob_cycleType_status_idx" ON "OperationJob"("cycleType", "status");
CREATE INDEX IF NOT EXISTS "OperationJob_status_createdAt_idx" ON "OperationJob"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "OperationCheckpoint" (
    "id" TEXT NOT NULL,
    "operationJobId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reusableRefs" JSONB,
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationCheckpoint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OperationCheckpoint_operationJobId_stepKey_key"
  ON "OperationCheckpoint"("operationJobId", "stepKey");
CREATE INDEX IF NOT EXISTS "OperationCheckpoint_operationJobId_status_idx"
  ON "OperationCheckpoint"("operationJobId", "status");

CREATE TABLE IF NOT EXISTS "AuditEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "relatedJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuditEvent_eventType_createdAt_idx" ON "AuditEvent"("eventType", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_targetType_targetId_createdAt_idx" ON "AuditEvent"("targetType", "targetId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_actor_createdAt_idx" ON "AuditEvent"("actor", "createdAt");

ALTER TABLE "AnalyticsImportRow"
  DROP CONSTRAINT IF EXISTS "AnalyticsImportRow_batchId_fkey";
ALTER TABLE "AnalyticsImportRow"
  ADD CONSTRAINT "AnalyticsImportRow_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "AnalyticsImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalyticsAttribution"
  DROP CONSTRAINT IF EXISTS "AnalyticsAttribution_importRowId_fkey";
ALTER TABLE "AnalyticsAttribution"
  ADD CONSTRAINT "AnalyticsAttribution_importRowId_fkey"
  FOREIGN KEY ("importRowId") REFERENCES "AnalyticsImportRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LearningRuleApplication"
  DROP CONSTRAINT IF EXISTS "LearningRuleApplication_learningRuleId_fkey";
ALTER TABLE "LearningRuleApplication"
  ADD CONSTRAINT "LearningRuleApplication_learningRuleId_fkey"
  FOREIGN KEY ("learningRuleId") REFERENCES "LearningRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearningRuleConflict"
  DROP CONSTRAINT IF EXISTS "LearningRuleConflict_ruleAId_fkey";
ALTER TABLE "LearningRuleConflict"
  ADD CONSTRAINT "LearningRuleConflict_ruleAId_fkey"
  FOREIGN KEY ("ruleAId") REFERENCES "LearningRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearningRuleConflict"
  DROP CONSTRAINT IF EXISTS "LearningRuleConflict_ruleBId_fkey";
ALTER TABLE "LearningRuleConflict"
  ADD CONSTRAINT "LearningRuleConflict_ruleBId_fkey"
  FOREIGN KEY ("ruleBId") REFERENCES "LearningRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OperationCheckpoint"
  DROP CONSTRAINT IF EXISTS "OperationCheckpoint_operationJobId_fkey";
ALTER TABLE "OperationCheckpoint"
  ADD CONSTRAINT "OperationCheckpoint_operationJobId_fkey"
  FOREIGN KEY ("operationJobId") REFERENCES "OperationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
