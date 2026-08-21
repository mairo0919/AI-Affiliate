-- CreateEnum
CREATE TYPE "ResearchScheduleType" AS ENUM ('CRON', 'MANUAL_ONLY');

-- CreateEnum
CREATE TYPE "ResearchScheduleTriggerType" AS ENUM ('SCHEDULED', 'MANUAL', 'RETRY');

-- CreateEnum
CREATE TYPE "ResearchScheduleRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "ResearchSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "scheduleType" "ResearchScheduleType" NOT NULL,
    "cronExpression" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    "parameters" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastJobId" TEXT,
    "consecutiveFailureCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchScheduleRun" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "jobId" TEXT,
    "triggerType" "ResearchScheduleTriggerType" NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "ResearchScheduleRunStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchScheduleRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchScheduleLock" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "ownerToken" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchScheduleLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchSchedule_isActive_nextRunAt_idx" ON "ResearchSchedule"("isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "ResearchSchedule_deletedAt_idx" ON "ResearchSchedule"("deletedAt");

-- CreateIndex
CREATE INDEX "ResearchSchedule_providerName_idx" ON "ResearchSchedule"("providerName");

-- CreateIndex
CREATE INDEX "ResearchScheduleRun_scheduleId_status_idx" ON "ResearchScheduleRun"("scheduleId", "status");

-- CreateIndex
CREATE INDEX "ResearchScheduleRun_jobId_idx" ON "ResearchScheduleRun"("jobId");

-- CreateIndex
CREATE INDEX "ResearchScheduleRun_createdAt_idx" ON "ResearchScheduleRun"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchScheduleRun_scheduleId_scheduledFor_key" ON "ResearchScheduleRun"("scheduleId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchScheduleLock_scheduleId_key" ON "ResearchScheduleLock"("scheduleId");

-- CreateIndex
CREATE INDEX "ResearchScheduleLock_expiresAt_idx" ON "ResearchScheduleLock"("expiresAt");

-- AddForeignKey
ALTER TABLE "ResearchScheduleRun" ADD CONSTRAINT "ResearchScheduleRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ResearchSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchScheduleRun" ADD CONSTRAINT "ResearchScheduleRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ResearchJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchScheduleLock" ADD CONSTRAINT "ResearchScheduleLock_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ResearchSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
