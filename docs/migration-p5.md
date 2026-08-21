# P5 Migration notes — Evaluation / Experiment / Learning

Migration: `packages/database/prisma/migrations/20260730200000_p5_evaluation_learning`

## Added models

- `AnalyticsAggregate` — normalized rollup from `AnalyticsSnapshot`
- `Evaluation` + `EvaluationFinding` — deterministic-first (optional LLM refine)
- `Experiment` + `ExperimentVariant` + `ExperimentResult` — human-approved only, no auto-publish
- `LearningRule` — confidence / sampleCount governed; ACTIVE rules are not silently overwritten by AI
- `StrategyFeedback` — injected into **next** Strategy generation only (never mutates published ContentVersion)

## Non-goals preserved

- ProductLink design unchanged
- Content / ContentVersion remain source of truth
- GeneratedContent not reintroduced as canonical
- Learning does not rewrite articles

## Verify

```bash
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm build
pnpm test
pnpm p5:vertical
```
