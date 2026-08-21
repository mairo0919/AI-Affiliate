-- AlterEnum
ALTER TYPE "XPublicationStatus" ADD VALUE 'BLOCKED';

-- AlterEnum
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_PUBLICATION_BLOCKED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_PRODUCT_COOLDOWN_BLOCKED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_PUBLICATION_LIMIT_REACHED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_KILL_SWITCH_ENABLED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_RELEASE_MODE_CHANGED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_ASSISTED_REVIEW_REQUIRED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_RESERVATION_EXPIRED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_DUPLICATE_CONTENT_BLOCKED';

-- CreateEnum
CREATE TYPE "XProductReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "XAuditActorType" AS ENUM ('SYSTEM', 'ADMIN', 'SCHEDULER', 'CLI');
CREATE TYPE "XAuditResult" AS ENUM ('SUCCESS', 'REJECTED', 'BLOCKED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "XPublicationPost" ADD COLUMN "bodyHash" TEXT;
CREATE INDEX "XPublicationPost_bodyHash_createdAt_idx" ON "XPublicationPost"("bodyHash", "createdAt");

-- CreateTable
CREATE TABLE "XProductPublicationState" (
    "id" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "researchItemId" TEXT,
    "contentCandidateId" TEXT,
    "lastScheduledAt" TIMESTAMP(3),
    "lastPublishedAt" TIMESTAMP(3),
    "lastPublicationId" TEXT,
    "nextEligibleAt" TIMESTAMP(3),
    "activeReservationCount" INTEGER NOT NULL DEFAULT 0,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XProductPublicationState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "XProductPublicationState_productKey_key" ON "XProductPublicationState"("productKey");
CREATE INDEX "XProductPublicationState_nextEligibleAt_idx" ON "XProductPublicationState"("nextEligibleAt");
CREATE INDEX "XProductPublicationState_researchItemId_idx" ON "XProductPublicationState"("researchItemId");

CREATE TABLE "XProductPublicationReservation" (
    "id" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "status" "XProductReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XProductPublicationReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "XProductPublicationReservation_productKey_publicationId_key" ON "XProductPublicationReservation"("productKey", "publicationId");
CREATE UNIQUE INDEX "XProductPublicationReservation_publicationId_key" ON "XProductPublicationReservation"("publicationId");
CREATE INDEX "XProductPublicationReservation_status_expiresAt_idx" ON "XProductPublicationReservation"("status", "expiresAt");
CREATE INDEX "XProductPublicationReservation_productKey_status_idx" ON "XProductPublicationReservation"("productKey", "status");

ALTER TABLE "XProductPublicationReservation" ADD CONSTRAINT "XProductPublicationReservation_productKey_fkey" FOREIGN KEY ("productKey") REFERENCES "XProductPublicationState"("productKey") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "XRuntimeControl" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XRuntimeControl_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "XRuntimeControl_key_key" ON "XRuntimeControl"("key");
CREATE INDEX "XRuntimeControl_key_expiresAt_idx" ON "XRuntimeControl"("key", "expiresAt");

CREATE TABLE "XOperationalAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" "XAuditActorType" NOT NULL,
    "actorId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "publicationId" TEXT,
    "productKeyHash" TEXT,
    "releaseMode" TEXT,
    "result" "XAuditResult" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XOperationalAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "XOperationalAuditLog_action_createdAt_idx" ON "XOperationalAuditLog"("action", "createdAt");
CREATE INDEX "XOperationalAuditLog_publicationId_createdAt_idx" ON "XOperationalAuditLog"("publicationId", "createdAt");
CREATE INDEX "XOperationalAuditLog_productKeyHash_createdAt_idx" ON "XOperationalAuditLog"("productKeyHash", "createdAt");
CREATE INDEX "XOperationalAuditLog_result_createdAt_idx" ON "XOperationalAuditLog"("result", "createdAt");
