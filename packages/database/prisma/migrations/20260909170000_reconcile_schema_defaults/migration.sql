-- Non-destructive schema reconciliation with prisma schema.prisma.
-- Does NOT drop tables/indexes/data. Skips DropIndex of legacy PromptDefinition_taskType_idx
-- (harmless extra index retained intentionally).

-- AlterTable: @updatedAt columns should not carry a DB DEFAULT
ALTER TABLE "AffiliateResult" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "AnalyticsAttribution" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Experiment" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "LearningRule" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "OperationCheckpoint" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "OperationJob" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "PromptDefinition" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameIndex: align truncated historical index name with Prisma expectation
ALTER INDEX IF EXISTS "XStrategyPerformance_strategyType_strategyVersion_calculat_idx"
  RENAME TO "XStrategyPerformance_strategyType_strategyVersion_calculate_idx";
