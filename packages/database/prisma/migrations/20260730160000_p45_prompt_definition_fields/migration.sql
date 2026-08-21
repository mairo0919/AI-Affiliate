-- AlterTable
ALTER TABLE "PromptDefinition" ADD COLUMN IF NOT EXISTS "systemInstruction" TEXT;
ALTER TABLE "PromptDefinition" ADD COLUMN IF NOT EXISTS "inputTemplate" TEXT;
ALTER TABLE "PromptDefinition" ADD COLUMN IF NOT EXISTS "outputSchema" JSONB;
ALTER TABLE "PromptDefinition" ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PromptDefinition" ADD COLUMN IF NOT EXISTS "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "PromptDefinition" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill updatedAt for existing rows
UPDATE "PromptDefinition" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "PromptDefinition_taskType_enabled_idx" ON "PromptDefinition"("taskType", "enabled");
