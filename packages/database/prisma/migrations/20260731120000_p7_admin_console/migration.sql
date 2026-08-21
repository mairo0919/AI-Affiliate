-- P7: Admin API / Operations Console
-- Auth users/sessions, non-secret settings, mapping profiles, approval decisions, upload refs

CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");
CREATE INDEX "AdminUser_role_active_idx" ON "AdminUser"("role", "active");

CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");
CREATE INDEX "AdminSession_userId_expiresAt_idx" ON "AdminSession"("userId", "expiresAt");

ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

CREATE TABLE "ProviderMappingProfile" (
    "id" TEXT NOT NULL,
    "profileKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT true,
    "columnMapping" JSONB NOT NULL,
    "statusMapping" JSONB NOT NULL,
    "currencyMapping" JSONB NOT NULL,
    "dateFormat" TEXT NOT NULL DEFAULT 'ISO8601',
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderMappingProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderMappingProfile_profileKey_key" ON "ProviderMappingProfile"("profileKey");
CREATE INDEX "ProviderMappingProfile_provider_isSample_idx" ON "ProviderMappingProfile"("provider", "isSample");

CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "actorUserId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "correlationId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApprovalDecision_targetType_targetId_createdAt_idx" ON "ApprovalDecision"("targetType", "targetId", "createdAt");
CREATE INDEX "ApprovalDecision_actorUserId_createdAt_idx" ON "ApprovalDecision"("actorUserId", "createdAt");

ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FileUploadReference" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "fileName" TEXT,
    "contentType" TEXT,
    "byteLength" INTEGER,
    "fileHash" TEXT NOT NULL,
    "retention" TEXT NOT NULL DEFAULT 'ephemeral',
    "previewMeta" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "FileUploadReference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FileUploadReference_fileHash_purpose_idx" ON "FileUploadReference"("fileHash", "purpose");
CREATE INDEX "FileUploadReference_createdAt_idx" ON "FileUploadReference"("createdAt");
