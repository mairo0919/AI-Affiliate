# Troubleshooting

| Symptom | Check |
| --- | --- |
| Admin login 401 | seed bootstrap / password rotate |
| LLM always mock | `LLM_MODE` + allow-external + key |
| Blogger draft safety fail | ContentVersion APPROVED + Publication APPROVED |
| Budget blocked | `/costs`, BudgetSetting, spentToday |
| ready=false | DB connection |
| CORS errors | `ADMIN_CORS_ORIGIN` exact match |
| Duplicate draft | expected — existing externalId reused |
| E2E webServer fail | `pnpm build` first; ports 8788/3001 free |
