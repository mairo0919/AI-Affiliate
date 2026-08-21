-- AlterEnum
ALTER TYPE "XPublicationStatus" ADD VALUE 'PUBLISHED_UNVERIFIED';

ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_AUTHORIZATION_COMPLETED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_AUTHORIZATION_FAILED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_TOKEN_REFRESH_FAILED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_CREDENTIAL_REAUTH_REQUIRED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_ACCOUNT_MISMATCH';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_API_RATE_LIMITED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_API_SOFT_BUDGET_REACHED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_API_HARD_BUDGET_REACHED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_API_USAGE_SYNC_FAILED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_POST_PUBLISHED_UNVERIFIED';
ALTER TYPE "ResearchNotificationEventType" ADD VALUE 'X_LIVE_POST_PUBLISHED';

CREATE TYPE "XApiCredentialStatus" AS ENUM ('PENDING', 'ACTIVE', 'REFRESH_REQUIRED', 'EXPIRED', 'REVOKED', 'INVALID', 'DISABLED');
CREATE TYPE "XOAuthSessionStatus" AS ENUM ('PENDING', 'CONSUMED', 'EXPIRED', 'FAILED', 'CANCELLED');
CREATE TYPE "XApiUsageSource" AS ENUM ('LOCAL_ESTIMATE', 'X_USAGE_API', 'MANUAL', 'DEVELOPER_CONSOLE');
CREATE TYPE "XApiBudgetPeriodType" AS ENUM ('DAILY', 'MONTHLY');
CREATE TYPE "XApiBudgetStatus" AS ENUM ('ACTIVE', 'SOFT_LIMIT_REACHED', 'HARD_LIMIT_REACHED', 'PAUSED');

CREATE TABLE "XApiCredential" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'x',
    "status" "XApiCredentialStatus" NOT NULL DEFAULT 'PENDING',
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scopes" JSONB NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "encryptionKeyVersion" TEXT NOT NULL DEFAULT 'v1',
    "lastRefreshedAt" TIMESTAMP(3),
    "lastRefreshFailedAt" TIMESTAMP(3),
    "lastRefreshErrorCode" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XApiCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "XApiCredential_accountId_key" ON "XApiCredential"("accountId");
CREATE INDEX "XApiCredential_status_idx" ON "XApiCredential"("status");

CREATE TABLE "XOAuthSession" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "encryptedCodeVerifier" TEXT NOT NULL,
    "callbackUrl" TEXT NOT NULL,
    "requestedScopes" JSONB NOT NULL,
    "status" "XOAuthSessionStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XOAuthSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "XOAuthSession_stateHash_key" ON "XOAuthSession"("stateHash");
CREATE INDEX "XOAuthSession_status_expiresAt_idx" ON "XOAuthSession"("status", "expiresAt");

CREATE TABLE "XApiRequestLog" (
    "id" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "endpointKey" TEXT NOT NULL,
    "accountId" TEXT,
    "publicationId" TEXT,
    "xPostId" TEXT,
    "method" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "statusCode" INTEGER,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "rateLimitRemaining" INTEGER,
    "rateLimitResetAt" TIMESTAMP(3),
    "estimatedCost" DOUBLE PRECISION,
    "billingUnit" TEXT,
    "responseSize" INTEGER,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XApiRequestLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "XApiRequestLog_accountId_createdAt_idx" ON "XApiRequestLog"("accountId", "createdAt");
CREATE INDEX "XApiRequestLog_endpointKey_createdAt_idx" ON "XApiRequestLog"("endpointKey", "createdAt");
CREATE INDEX "XApiRequestLog_result_createdAt_idx" ON "XApiRequestLog"("result", "createdAt");

CREATE TABLE "XApiUsageSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "writeRequestCount" INTEGER NOT NULL DEFAULT 0,
    "readRequestCount" INTEGER NOT NULL DEFAULT 0,
    "resourceReadCount" INTEGER NOT NULL DEFAULT 0,
    "analyticsRequestCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION,
    "reportedCost" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "source" "XApiUsageSource" NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XApiUsageSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "XApiUsageSnapshot_accountId_periodStart_idx" ON "XApiUsageSnapshot"("accountId", "periodStart");
CREATE INDEX "XApiUsageSnapshot_source_capturedAt_idx" ON "XApiUsageSnapshot"("source", "capturedAt");

CREATE TABLE "XApiBudgetControl" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "periodType" "XApiBudgetPeriodType" NOT NULL,
    "softLimit" DOUBLE PRECISION NOT NULL,
    "hardLimit" DOUBLE PRECISION NOT NULL,
    "currentEstimatedUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentReportedUsage" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "XApiBudgetStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "updatedBy" TEXT,
    "periodStartedAt" TIMESTAMP(3) NOT NULL,
    "periodEndsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XApiBudgetControl_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "XApiBudgetControl_accountId_periodType_periodStartedAt_key" ON "XApiBudgetControl"("accountId", "periodType", "periodStartedAt");
CREATE INDEX "XApiBudgetControl_status_periodEndsAt_idx" ON "XApiBudgetControl"("status", "periodEndsAt");
