-- AlterTable
ALTER TABLE "ResearchScheduleRun" ADD COLUMN     "errorType" TEXT,
ADD COLUMN     "retryOfRunId" TEXT,
ADD COLUMN     "rootRunId" TEXT,
ADD COLUMN     "retryAttempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "maxRetryAttempts" INTEGER,
ADD COLUMN     "nextRetryAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "ResearchNotificationEventType" AS ENUM ('SCHEDULE_FAILED', 'SCHEDULE_PARTIALLY_COMPLETED', 'SCHEDULE_AUTO_PAUSED', 'SCHEDULE_RECOVERED', 'JOB_FAILED', 'JOB_PARTIALLY_COMPLETED', 'RETRY_SCHEDULED', 'RETRY_EXHAUSTED');

-- CreateEnum
CREATE TYPE "ResearchNotificationChannelType" AS ENUM ('CONSOLE', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "ResearchNotificationStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "ResearchNotification" (
    "id" TEXT NOT NULL,
    "eventType" "ResearchNotificationEventType" NOT NULL,
    "providerName" TEXT,
    "scheduleId" TEXT,
    "scheduleRunId" TEXT,
    "researchJobId" TEXT,
    "channelType" "ResearchNotificationChannelType" NOT NULL,
    "status" "ResearchNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "deduplicationKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchNotificationAttempt" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "ResearchNotificationStatus" NOT NULL,
    "httpStatus" INTEGER,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchNotificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchScheduleRun_nextRetryAt_status_idx" ON "ResearchScheduleRun"("nextRetryAt", "status");

-- CreateIndex
CREATE INDEX "ResearchScheduleRun_rootRunId_idx" ON "ResearchScheduleRun"("rootRunId");

-- CreateIndex
CREATE INDEX "ResearchScheduleRun_retryOfRunId_idx" ON "ResearchScheduleRun"("retryOfRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchNotification_deduplicationKey_key" ON "ResearchNotification"("deduplicationKey");

-- CreateIndex
CREATE INDEX "ResearchNotification_status_createdAt_idx" ON "ResearchNotification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchNotification_scheduleId_idx" ON "ResearchNotification"("scheduleId");

-- CreateIndex
CREATE INDEX "ResearchNotification_scheduleRunId_idx" ON "ResearchNotification"("scheduleRunId");

-- CreateIndex
CREATE INDEX "ResearchNotification_researchJobId_idx" ON "ResearchNotification"("researchJobId");

-- CreateIndex
CREATE INDEX "ResearchNotification_eventType_idx" ON "ResearchNotification"("eventType");

-- CreateIndex
CREATE INDEX "ResearchNotificationAttempt_notificationId_attemptNumber_idx" ON "ResearchNotificationAttempt"("notificationId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "ResearchScheduleRun" ADD CONSTRAINT "ResearchScheduleRun_retryOfRunId_fkey" FOREIGN KEY ("retryOfRunId") REFERENCES "ResearchScheduleRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchNotification" ADD CONSTRAINT "ResearchNotification_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ResearchSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchNotification" ADD CONSTRAINT "ResearchNotification_scheduleRunId_fkey" FOREIGN KEY ("scheduleRunId") REFERENCES "ResearchScheduleRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchNotification" ADD CONSTRAINT "ResearchNotification_researchJobId_fkey" FOREIGN KEY ("researchJobId") REFERENCES "ResearchJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchNotificationAttempt" ADD CONSTRAINT "ResearchNotificationAttempt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "ResearchNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
