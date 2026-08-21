# Production Setup

1. PostgreSQL + `pnpm db:migrate && pnpm db:seed`
2. Set `NODE_ENV=production`
3. Rotate `ADMIN_BOOTSTRAP_PASSWORD` (never leave `change-me-admin`)
4. Configure `ADMIN_CORS_ORIGIN` to exact Admin Web origin
5. LLM: `LLM_MODE=api`, `LLM_ALLOW_EXTERNAL_REQUESTS=true`, `LLM_API_KEY`
6. Blogger: OAuth + `BLOGGER_MODE=api` + `BLOGGER_ALLOW_EXTERNAL_REQUESTS=true` + Blog ID
7. Keep `BLOGGER_DEFAULT_PUBLISH_MODE=draft`, `BLOGGER_ALLOW_DIRECT_PUBLISH=false`
8. `PRODUCTION_OPERATION_MODE=ASSISTED`
9. `pnpm production:check` until no BLOCKED
10. Start `admin-api`, `admin-web`, scheduler/worker as needed

See also: `docs/deployment-guide.md`, `docs/llm-production-setup.md`, `docs/blogger-production-oauth.md`.
