# Operations Runbook (P6)

```bash
pnpm ops:run-cycle -- --cycle=daily_ops --idempotency-key=day-2026-07-31
pnpm ops:job-status -- --job-id=...
pnpm ops:resume-job -- --job-id=... --human-approved=true
pnpm p6:vertical
```

Daily cycle stops at human approval before Blogger draft / X export unless `--human-approved=true`.

Cycles: research, strategy, content generation, review, publication prep, analytics import, evaluation, learning.
