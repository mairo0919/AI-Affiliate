# Environment Variables (P8)

See `.env.example` for the complete list. Production-critical:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | development / test / production |
| `DATABASE_URL` | PostgreSQL |
| `PRODUCTION_OPERATION_MODE` | OBSERVE / ASSISTED / AUTOMATED (initial: ASSISTED) |
| `LLM_MODE` | mock / api |
| `LLM_ALLOW_EXTERNAL_REQUESTS` | must be true for real LLM |
| `LLM_API_KEY` | secret — never log |
| `LLM_MODEL_GENERATION` / `_REVIEW` / `_REVISION` / `_STRATEGY` | model ids |
| `LLM_TIMEOUT_MS` / `LLM_TEMPERATURE` / `LLM_DAILY_TOKEN_BUDGET` | budgets & knobs |
| `BLOGGER_MODE` | mock / api |
| `BLOGGER_ALLOW_EXTERNAL_REQUESTS` | must be true for real Blogger |
| `BLOGGER_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` / `_BLOG_ID` | OAuth |
| `BLOGGER_DEFAULT_PUBLISH_MODE` | draft (required initially) |
| `BLOGGER_ALLOW_DIRECT_PUBLISH` | false initially |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | first admin (rotate in prod) |
| `ADMIN_CORS_ORIGIN` | exact origin — not `*` in production |
| `ADMIN_FORCE_MOCK_ADAPTERS` | force Mock adapters (tests/E2E) |
| `PUBLICATION_TARGET_PER_DAY` / `_MAXIMUM_PER_DAY` / `_MINIMUM_INTERVAL_MINUTES` | soft cadence |
| `PUBLICATION_ACTIVE_HOURS_*` / `PUBLICATION_TIMEZONE` | active window |
| `PUBLICATION_MINIMUM_QUALITY_SCORE` / `_CLAIM_CONFIDENCE` | quality floors |

Real external calls require both mode=api **and** allow-external=true.
