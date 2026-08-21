-- CreateEnum
CREATE TYPE "ResearchJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResearchJobType" AS ENUM ('SINGLE_PAGE', 'PAGINATED_COLLECTION');

-- CreateTable
CREATE TABLE "ResearchJob" (
    "id" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "jobType" "ResearchJobType" NOT NULL,
    "status" "ResearchJobStatus" NOT NULL DEFAULT 'PENDING',
    "parameters" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "currentOffset" INTEGER,
    "nextOffset" INTEGER,
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "mappedCount" INTEGER NOT NULL DEFAULT 0,
    "savedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "pagesProcessed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "resumedFromJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchJobError" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "externalId" TEXT,
    "offset" INTEGER,
    "errorType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchJobError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchJobLock" (
    "id" TEXT NOT NULL,
    "lockKey" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchJobLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchJob_providerName_status_idx" ON "ResearchJob"("providerName", "status");

-- CreateIndex
CREATE INDEX "ResearchJob_createdAt_idx" ON "ResearchJob"("createdAt");

-- CreateIndex
CREATE INDEX "ResearchJobError_jobId_createdAt_idx" ON "ResearchJobError"("jobId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchJobLock_lockKey_key" ON "ResearchJobLock"("lockKey");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchJobLock_jobId_key" ON "ResearchJobLock"("jobId");

-- CreateIndex
CREATE INDEX "ResearchJobLock_expiresAt_idx" ON "ResearchJobLock"("expiresAt");

-- AddForeignKey
ALTER TABLE "ResearchJobError" ADD CONSTRAINT "ResearchJobError_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ResearchJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchJobLock" ADD CONSTRAINT "ResearchJobLock_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ResearchJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
