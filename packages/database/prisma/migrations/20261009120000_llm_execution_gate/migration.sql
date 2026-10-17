-- Additive execution-gate columns. Existing ModelRun rows stay valid.
-- executionStatus stays null on historical rows.
-- PostgreSQL 11+ adds a nullable column with no default as a catalog change.
-- This migration does not rewrite ModelRun. Indexes are on ModelRun, which is
-- a small table, so CREATE INDEX (not CONCURRENTLY) is a short lock.
-- ProductAnalysis is not touched. Do not run VACUUM FULL from this migration.

ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "executionStatus" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "requestedAt" TIMESTAMP(3);
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMP(3);
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "channel" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "operation" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "trigger" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "canonicalCid" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "contentVersionId" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "xPublicationId" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "publicationTargetId" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "publishedExternalId" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "artifactFingerprint" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "modelRequested" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "modelActual" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "logicalAttempt" INTEGER;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "httpAttempt" INTEGER;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "attemptKind" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "tickId" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "disposition" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "errorCode" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "httpStatus" INTEGER;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "retryable" BOOLEAN;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "failureStage" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "blockReason" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "reasoningTokens" INTEGER;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "usageKnown" BOOLEAN;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "estimatedCostUsd" DOUBLE PRECISION;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "reservedCostUsd" DOUBLE PRECISION;
ALTER TABLE "ModelRun" ADD COLUMN IF NOT EXISTS "ledgerVersion" TEXT;

CREATE INDEX IF NOT EXISTS "ModelRun_executionStatus_startedAt_idx" ON "ModelRun"("executionStatus", "startedAt");
CREATE INDEX IF NOT EXISTS "ModelRun_artifactFingerprint_executionStatus_idx" ON "ModelRun"("artifactFingerprint", "executionStatus");
CREATE INDEX IF NOT EXISTS "ModelRun_tickId_attemptKind_idx" ON "ModelRun"("tickId", "attemptKind");
CREATE INDEX IF NOT EXISTS "ModelRun_canonicalCid_startedAt_idx" ON "ModelRun"("canonicalCid", "startedAt");

CREATE TABLE IF NOT EXISTS "LlmCircuitState" (
  "id" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'CLOSED',
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "openedAt" TIMESTAMP(3),
  "reason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LlmCircuitState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LlmCircuitState_scopeType_scopeKey_key" ON "LlmCircuitState"("scopeType", "scopeKey");
