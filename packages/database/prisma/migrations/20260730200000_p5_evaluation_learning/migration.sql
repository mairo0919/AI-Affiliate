-- P5 Evaluation / Experiment / Learning domain

CREATE TABLE IF NOT EXISTS "AnalyticsAggregate" (
    "id" TEXT NOT NULL,
    "contentId" TEXT,
    "contentVersionId" TEXT,
    "publicationTargetId" TEXT,
    "platform" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "impressions" DOUBLE PRECISION,
    "views" DOUBLE PRECISION,
    "clicks" DOUBLE PRECISION,
    "ctr" DOUBLE PRECISION,
    "engagement" DOUBLE PRECISION,
    "likes" DOUBLE PRECISION,
    "reposts" DOUBLE PRECISION,
    "comments" DOUBLE PRECISION,
    "bookmarks" DOUBLE PRECISION,
    "articleOpens" DOUBLE PRECISION,
    "readTimeSeconds" DOUBLE PRECISION,
    "externalClicks" DOUBLE PRECISION,
    "publicationAgeHours" DOUBLE PRECISION,
    "sampleSnapshotCount" INTEGER NOT NULL DEFAULT 0,
    "normalizedMetrics" JSONB NOT NULL,
    "platformMetrics" JSONB,
    "sourceSnapshotIds" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsAggregate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AnalyticsAggregate_contentId_platform_createdAt_idx"
  ON "AnalyticsAggregate"("contentId", "platform", "createdAt");
CREATE INDEX IF NOT EXISTS "AnalyticsAggregate_platform_windowEnd_idx"
  ON "AnalyticsAggregate"("platform", "windowEnd");

CREATE TABLE IF NOT EXISTS "Evaluation" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "contentVersionId" TEXT,
    "analyticsAggregateId" TEXT,
    "platform" TEXT,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "seoScore" DOUBLE PRECISION NOT NULL,
    "ctrScore" DOUBLE PRECISION NOT NULL,
    "contentScore" DOUBLE PRECISION NOT NULL,
    "engagementScore" DOUBLE PRECISION NOT NULL,
    "ctaQuality" DOUBLE PRECISION NOT NULL,
    "headlineQuality" DOUBLE PRECISION NOT NULL,
    "freshness" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evaluationReason" TEXT NOT NULL,
    "strengths" JSONB NOT NULL,
    "weaknesses" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "deterministicPayload" JSONB,
    "llmPayload" JSONB,
    "modelRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Evaluation_contentId_createdAt_idx" ON "Evaluation"("contentId", "createdAt");
CREATE INDEX IF NOT EXISTS "Evaluation_platform_createdAt_idx" ON "Evaluation"("platform", "createdAt");
CREATE INDEX IF NOT EXISTS "Evaluation_overallScore_idx" ON "Evaluation"("overallScore");

CREATE TABLE IF NOT EXISTS "EvaluationFinding" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationFinding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EvaluationFinding_evaluationId_category_idx"
  ON "EvaluationFinding"("evaluationId", "category");

CREATE TABLE IF NOT EXISTS "Experiment" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "contentVersionId" TEXT,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "platform" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "metadata" JSONB,
    "modelRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Experiment_contentId_status_idx" ON "Experiment"("contentId", "status");
CREATE INDEX IF NOT EXISTS "Experiment_status_createdAt_idx" ON "Experiment"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "ExperimentVariant" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "variantType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "contentVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperimentVariant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExperimentVariant_experimentId_label_key"
  ON "ExperimentVariant"("experimentId", "label");
CREATE INDEX IF NOT EXISTS "ExperimentVariant_experimentId_variantType_idx"
  ON "ExperimentVariant"("experimentId", "variantType");

CREATE TABLE IF NOT EXISTS "ExperimentResult" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "evaluationId" TEXT,
    "analyticsAggregateId" TEXT,
    "metrics" JSONB NOT NULL,
    "score" DOUBLE PRECISION,
    "winner" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperimentResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ExperimentResult_experimentId_winner_idx"
  ON "ExperimentResult"("experimentId", "winner");

CREATE TABLE IF NOT EXISTS "LearningRule" (
    "id" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "successRate" DOUBLE PRECISION,
    "sourceEvaluationIds" JSONB NOT NULL,
    "sourceExperimentIds" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "metadata" JSONB,
    "modelRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearningRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LearningRule_ruleType_status_idx" ON "LearningRule"("ruleType", "status");
CREATE INDEX IF NOT EXISTS "LearningRule_confidence_sampleCount_idx"
  ON "LearningRule"("confidence", "sampleCount");

CREATE TABLE IF NOT EXISTS "StrategyFeedback" (
    "id" TEXT NOT NULL,
    "topicCandidateId" TEXT,
    "strategyId" TEXT,
    "learningRuleIds" JSONB NOT NULL,
    "evaluationIds" JSONB NOT NULL,
    "experimentIds" JSONB NOT NULL,
    "feedbackPayload" JSONB NOT NULL,
    "modelRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategyFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StrategyFeedback_topicCandidateId_createdAt_idx"
  ON "StrategyFeedback"("topicCandidateId", "createdAt");
CREATE INDEX IF NOT EXISTS "StrategyFeedback_strategyId_idx" ON "StrategyFeedback"("strategyId");

ALTER TABLE "Evaluation"
  ADD CONSTRAINT "Evaluation_analyticsAggregateId_fkey"
  FOREIGN KEY ("analyticsAggregateId") REFERENCES "AnalyticsAggregate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvaluationFinding"
  ADD CONSTRAINT "EvaluationFinding_evaluationId_fkey"
  FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExperimentVariant"
  ADD CONSTRAINT "ExperimentVariant_experimentId_fkey"
  FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExperimentResult"
  ADD CONSTRAINT "ExperimentResult_experimentId_fkey"
  FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExperimentResult"
  ADD CONSTRAINT "ExperimentResult_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ExperimentVariant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExperimentResult"
  ADD CONSTRAINT "ExperimentResult_evaluationId_fkey"
  FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExperimentResult"
  ADD CONSTRAINT "ExperimentResult_analyticsAggregateId_fkey"
  FOREIGN KEY ("analyticsAggregateId") REFERENCES "AnalyticsAggregate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
