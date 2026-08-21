# Cost / Budget (P8)

Scopes: DAILY / MONTHLY (+ per-content/per-job via soft checks in services)

- `BudgetGuard.assertCanSpend` before LLM
- ModelRun + CostRecord after each call
- stopThreshold → `BUDGET_BLOCKED` — generation/review/revision stop, drafts kept, jobs stop for humans

Admin: Dashboard budget + `/costs` + Production Checklist。
