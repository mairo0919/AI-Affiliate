# P6 Migration — Production Analytics / Learning Governance / Orchestration

Migration: `packages/database/prisma/migrations/20260731010000_p6_analytics_governance_ops`

## Added / extended

- `ResearchJobStatus.MANUAL_REVIEW_REQUIRED`
- `ResearchJobType.OPERATION_CYCLE` / `LEARNING_GOVERNANCE`
- `LearningRule` governance columns (thresholds, scope, approval, supersede, suspend)
- `AnalyticsImportBatch` / `AnalyticsImportRow` / `AnalyticsAttribution`
- `AffiliateResult` (revenue boundary; separate from engagement snapshots)
- `LearningRuleApplication` / `LearningRuleConflict`
- `OperationJob` / `OperationCheckpoint`
- `AuditEvent`

## Non-destructive guarantees

- Duplicate file hash → reject new batch; existing Analytics untouched
- Attribution never auto-commits ambiguous matches (`awaiting_review`)
- Learning ACTIVE requires thresholds + human approval + conflict check
- LearningRules do not mutate published ContentVersion bodies

## Verify

```bash
pnpm db:migrate
pnpm lint
pnpm build
pnpm test
pnpm p5:vertical
pnpm p6:vertical
```
