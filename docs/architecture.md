# Architecture（現状実装メモ）

> **目標構成・要件の正本（v1.0）:**  
> [`requirements-v1.0.md`](./requirements-v1.0.md) · [`architecture-v1.0.md`](./architecture-v1.0.md) · [`data-model-v1.0.md`](./data-model-v1.0.md) · [`implementation-plan-v1.0.md`](./implementation-plan-v1.0.md) · [`repository-audit.md`](./repository-audit.md)  
> 本書は既存実装（Research〜X Live）の説明用。新機能の設計判断は v1.0 を優先する。

AI Affiliate Factory is a pnpm monorepo for long-running AI agent workflows.

## Layout

- `apps/` — runnable agents and future services
- `packages/` — shared libraries used by apps
- `docs/` — documentation
- `scripts/` — operational scripts

## Current apps

- `content-operator`
  - `ResearchProvider` interface
  - Mock provider (+ paginated mock for job tests)
  - FANZA provider via official DMM Web API v3 (no scraping)
  - `CollectionJobRunner` for paginated collection jobs
  - `ScheduleRunner` for ResearchSchedule periodic / manual runs
  - TikTok / X stubs

## Collection jobs

PostgreSQL-backed job management (no Redis / cloud queue):

| Model | Role |
| --- | --- |
| `ResearchJob` | status, counters, offsets, parameters |
| `ResearchJobError` | per-page / per-item error history |
| `ResearchJobLock` | duplicate-run prevention |

### State machine

`PENDING` → `RUNNING` → `COMPLETED` | `PARTIALLY_COMPLETED` | `FAILED` | `CANCELLED`

Invalid transitions are rejected (e.g. COMPLETED → RUNNING).

### Paging

- Single-page collect returns `nextOffset`
- Job runner walks pages until maxPages / maxItems / no nextOffset / empty page / repeated offset
- Request interval respected between pages
- Lock TTL 5 minutes; refreshed on heartbeat

### Cancel / resume

- Cancel sets `cancelRequested`; runner stops at page boundary
- Resume creates a **new** job from saved `nextOffset`; source job history is immutable

### dryRun

Persists job history only; does not write ResearchItem/Metric/Tag/Image.

### CI

GitHub Actions runs Postgres service + migrate + lint + build + test.
DMM credentials are not required; real DMM API calls are forbidden in CI.

## Research schedules

PostgreSQL-backed scheduling (no Redis / BullMQ / cloud queue):

| Model | Role |
| --- | --- |
| `ResearchSchedule` | cron or manual schedule, parameters JSON, nextRunAt, failure count |
| `ResearchScheduleRun` | run history + optional link to `ResearchJob` |
| `ResearchScheduleLock` | prevent concurrent starts of the same schedule |

### Cron / timezone / nextRunAt

- 5-field cron only (minute hour day month weekday)
- Default timezone `Asia/Tokyo`
- Invalid cron rejected before save
- `nextRunAt` recomputed after each run (or when missed beyond grace)

### GitHub Actions

`.github/workflows/research-scheduler.yml` runs every 15 minutes (`*/15 * * * *`) and on `workflow_dispatch`.

- If `DATABASE_URL` secret is missing → exit safely (no failure loop)
- If `DMM_API_ID` / `DMM_AFFILIATE_ID` missing → FANZA schedules are `SKIPPED` (not counted toward auto-stop)
- Secrets must never be logged

Persistent data from Actions requires an **external PostgreSQL** (vendor not prescribed). Local development keeps using the existing Postgres.

### Skip vs fail vs auto-stop

- `SKIPPED`: inactive, duplicate scheduledFor, lock contention, missing credentials / API pending
- `FAILED`: DB / runner / invalid schedule data errors
- After `RESEARCH_SCHEDULE_FAILURE_LIMIT` (default 5) consecutive **FAILED** runs → `isActive=false`
- Soft delete preserves run history

### Manual / pause / resume

- `pnpm research:schedule:run` for one-off execution
- `pnpm research:scheduler:run` only processes due CRON schedules
- Pause / resume toggle `isActive`; resume recalculates `nextRunAt`

### Mock verification

Create `--provider=mock` schedules and exercise create → scheduler:run → ResearchJob → ScheduleRun → nextRunAt → pause/resume → manual → lock → auto-stop without calling DMM.

## Automatic retry + notifications

- Retryable: RateLimit / Timeout / Network / HTTP 429+5xx / transient DB & lock errors
- Non-retryable: Configuration / Authentication / Validation / cancel / inactive / missing credentials
- Exponential backoff with ±10% jitter; max attempts from `RESEARCH_RETRY_MAX_ATTEMPTS`
- Each retry is a new `ResearchScheduleRun` with `triggerType=RETRY` (`retryOfRunId` / `rootRunId`)
- `SchedulerPipeline`: due schedules → due retries → analysis (opt-in) → content (opt-in) → pending notifications

- Notifications: Console + generic Webhook JSON POST; dedupe via `deduplicationKey`
- Events: RETRY_SCHEDULED / RETRY_EXHAUSTED / PARTIAL / AUTO_PAUSED / RECOVERED / FAILED
- Never log webhook URL or credentials; missing webhook URL → SKIPPED

## Analysis Engine

Selects introduction candidates from collected `ResearchItem` rows (no copywriting / SNS posting yet).

- Scores: popularity / trend / review (Bayesian) / price / freshness / dataQuality (required)
- Unavailable components stay `null` in `scoreBreakdown`; `totalScore` renormalized over available weights
- Eligibility: ELIGIBLE | REQUIRES_CONFIRMATION | NOT_ELIGIBLE
- Candidates: RANKING, TRENDING, HIGH_RATING, NEW_RELEASE, DISCOUNT (+ EDITORIAL)
- Diversity caps with progressive relaxation
- Versions: `scoring-v1` / `eligibility-v1` / `selection-v1` (new AnalysisRun each time)
- Pipeline order: schedules → retries → **analysis (opt-in)** → **content (opt-in)** → notifications
- Default `ANALYSIS_AUTO_RUN_ENABLED=false`
- Never scores on product descriptions or review text; never promotes NOT_ALLOWED-only images

## Content Engine

Generates draft content from `ContentCandidate` (blog / X / short-video script / product intro). **No SNS or blog publishing** in the Content Engine itself. **X is the priority publishing channel**; blog/short-video/product-intro remain available via manual CLI but are excluded from scheduler auto-generation defaults (`CONTENT_AUTO_GENERATION_TYPES=x-post`).

### Role

- Select generation targets from `ContentCandidate`
- Build **allowlist-only** AI input (`ContentGenerationInputBuilder`)
- Call `ContentGenerationProvider` (Mock by default)
- Validate structured output (Zod) with at most **one** repair attempt
- Persist `GeneratedContent` + `ContentValidationIssue`
- Human review → APPROVED → READY_TO_PUBLISH (publish is future work)

### AI Provider abstraction

```ts
interface ContentGenerationProvider {
  readonly providerName: string;
  generate(request: ContentGenerationRequest): Promise<ContentGenerationResult>;
}
```

- Implemented: `MockContentGenerationProvider` (ok / repairable_json / invalid_json / timeout)
- Stubs: OpenAI / Anthropic / Local (not wired)

### Allowlist input (never to AI)

Allowed: title, publishedAt, affiliateUrl, numeric metrics, tags, ProductAnalysis scores, candidateType, selectionReasons, ALLOWED image metadata.

Forbidden: product description, review bodies, rawData, API responses, credentials, UNKNOWN/REQUIRES_CONFIRMATION image contents, FANZA images for AI image generation.

`inputSnapshot` stores only the sanitized allowlist payload.

### Prompts

Versioned under `apps/content-operator/src/content/prompts/` (`content-system-v1`, `blog-v1`, `x-post-v1`, `short-video-v1`, `product-introduction-v1`).

### Validator / duplicates

`ContentValidator` checks empty body, affiliate URL integrity, fabricated facts, lengths, disclosure, prohibited images, forbidden-text similarity (rawData used **only** for validation; issues store hash/short excerpt), exact SHA-256 hash duplicates, approximate similarity duplicates.

Default post-validation status: `REVIEW_REQUIRED` (never auto-approve). Any BLOCKING → `VALIDATION_FAILED`.

### Versions / regenerate

Same candidate keeps multiple `version`s; `parentContentId` links regenerations. Approved/published parents are not overwritten.

### Review CLI

`content:list|show|review|approve|reject|request-changes|ready|regenerate` — reviewer from `--reviewer` or `CONTENT_DEFAULT_REVIEWER`.

### Scheduler

Order: schedules → retries → analysis → **content auto-generation** → **X publish** → **X metrics** → **X strategy** → notifications.

`CONTENT_AUTO_GENERATION_ENABLED=false` by default. Auto-gen never auto-approves or publishes.

### Notifications

Events: CONTENT_GENERATION_FAILED / CONTENT_VALIDATION_FAILED / CONTENT_REVIEW_REQUIRED / CONTENT_APPROVED / CONTENT_REJECTED.

Default emit only FAILED + VALIDATION_FAILED.

### FANZA compliance

No description/review reconstruction; affiliateUrl unchanged; no NOT_ALLOWED/UNKNOWN auto image use; no AI image gen from FANZA assets; adult context preserved; human review before publish.

### Mock verification

Full generation/validation/review/regenerate/dry-run/scheduler paths are testable without real AI APIs.

## X Publishing & Learning Engine

Priority channel is **X only**. TikTok is deferred. Blog / short-video / product-intro generators remain but are not auto-scheduled.

### Why strategies are not fixed

Outcomes may differ by product, timing, and audience. The system trials multiple strategies (`SINGLE_POST`, `ROOT_WITH_REPLY`, `RELATED_POST_LINK`, `CONTROL`; `THREAD`/`HUB_POST` manual-only by default), collects metrics, and stores recommendations — it does **not** auto-lock a winner while `X_STRATEGY_AUTO_OPTIMIZATION_ENABLED=false` (default). Exploration rate stays ≥ 5%.

### Models

`XPublication` / `XPublicationPost` / `XPublicationLock` / `XPostMetricSnapshot` / `XStrategyPerformance` / `XPublicationExperiment`

### Weighted length

`XCharacterCounter` applies X-like weights (CJK/emoji heavy, URL fixed length, no Premium long-form). Cap `X_MAX_WEIGHTED_LENGTH=280`. Disclosure (`X_AFFILIATE_DISCLOSURE=#PR`) must remain on ROOT; never stripped to fit.

### Publish / retry

`XPublicationService` locks per publication, respects `idempotencyKey`, posts in sequence, resolves reply `xPostId`s, skips replies if ROOT fails, marks `PARTIALLY_PUBLISHED` on reply failure, retries failed sequences only (reuses backoff). Never re-sends posts that already have `xPostId`.

### Metrics & evaluation

Windows: 1h / 6h / 24h / 72h / 7d. Unavailable metrics stay `null` (never coerced to 0). Rates with zero/missing denominator are `null`. `XStrategyEvaluator` stores averages/medians/confidence/`recommendedStrategy` without asserting a permanent winner.

### Pipeline

schedules → retries → analysis → **X content gen** → **X publish** → **X metrics** → **X strategy eval** → **X optimization** → **X optimization impact** → notifications  

All X phases default **off**. Real publish requires human-approved `READY_TO_PUBLISH` content; auto-publish also requires `X_AUTO_PUBLICATION_ENABLED` and (`X_API_ENABLED` or mock provider).

### API cost warning

Enabling real X API may incur usage fees. Keep `X_API_ENABLED=false` until credentials and budget are ready. Secrets never go to DB/logs/notifications.

### Mock verification

MockXPublishingProvider covers create/reply/fail/partial/retry/idempotency/metrics without calling X.

## X Optimization Engine

Observational comparison engine (not ML). Extracts `XContentVariant` features from published posts and compares dimensions independently:

`CONTENT_ANGLE` / `POST_FORMAT` / `POSTING_TIME` / `HASHTAG_SET` / `URL_PLACEMENT` / `DISCLOSURE_PLACEMENT` / `CTA_STYLE` / `RELATED_POST_USAGE` / `INFORMATION_DENSITY` / `TITLE_LENGTH`

### Scoring

`metricVersion=x-optimization-metrics-v1`. Default weights: urlClick 40%, engagement 25%, impressions 15%, profileClick 10%, bookmark 5%, repost 5%. Missing metrics stay `null` and weights are renormalized. If urlClick is missing, click optimization is not asserted.

### Segments & samples

Compares within segments (`candidateType`, time bucket, …) with fallback to broader segments. Recommendations require min sample size, min score delta, max missing rate, same evaluation window. Otherwise Finding only (`INSUFFICIENT_DATA`).

### Recommendations & review

Modes: `OBSERVE_ONLY` / `RECOMMEND` (default) / `ASSISTED` / `AUTO`. Unapproved recommendations are never applied. One dimension per experiment (CONTROL 50% / VARIANT 50%, ROUND_ROBIN). Improved content is a new `GeneratedContent` version (`parentContentId`); published posts are never edited.

### Safeguards

explorationRate, recommendation TTL, max active recommendations, max concurrent experiments per dimension, re-apply cooldown, decline stop threshold, winsorized impact stats. Permanent adoption requires ≥2 experiments with consistent direction.

### Scheduler

Optimization defaults off (`X_OPTIMIZATION_ENABLED=false`) and runs at most once per `X_OPTIMIZATION_MIN_INTERVAL_MINUTES` (1440). It does not run on every metrics collection.

## X Production Readiness

Hardening layer before real X API.

### productKey / cooldown / reservation

`productKey` priority: provider+providerProductId → provider+contentId → affiliateUrl hash → researchItem stable id. Never title-only.  
`XProductPublicationState` + `XProductPublicationReservation` enforce cooldown (default 168h) and one ACTIVE reservation per product via DB unique constraints + transactions. Admin override requires reason + audit.

### ASSISTED

`XAssistedPublicationService`: prepare (approved recommendation → new content version) → human review → schedule. Never auto-publishes.

### PrePublishGuard

Re-validates at create / schedule / publish / retry: READY_TO_PUBLISH, disclosure, affiliateUrl, weighted length, structure, cooldown, reservation, kill switch, release mode, limits, body hash duplicates. Failures become `BLOCKED` (not `FAILED`) so schedulers do not infinite-retry policy stops.

### Release mode & kill switch

`DISABLED` / `DRY_RUN` / `ALLOWLIST` / `LIMITED` / `FULL` (default DISABLED). Env kill switch default true; OR with DB `XRuntimeControl` (`GLOBAL_KILL_SWITCH`, `PUBLISHING_PAUSED`, …). Metrics may run while publishing is paused.

### Limits & duplicates

Tokyo-local daily/hourly post counts (replies count; only successfully posted sequences in PARTIALLY_PUBLISHED). Normalized `bodyHash` on posts; exact duplicates BLOCKING.

### Audit / ops CLI

`XOperationalAuditLog` without secrets/tokens/rawData/affiliateUrl plaintext. Ops CLIs: `x:ops:*`, `x:runtime:*`.

## X Live API Integration

Real X API path (OAuth 2.0 Authorization Code + PKCE, encrypted tokens, tweets, metrics, usage/budget). Defaults keep posting off.

### Auth

- Scopes: `tweet.read tweet.write users.read offline.access` (extensible via `X_OAUTH_SCOPES`)
- Random `state` + TTL; store `stateHash` only; single-use `XOAuthSession`
- Callback URL exact match
- `TokenEncryptionService` AES-256-GCM; key versioned; production rejects empty key
- `TokenRefreshService`: buffer refresh, one retry on 401, refresh rotation in one upsert, per-account lock, `invalid_grant` → INVALID (no infinite retry)

### HTTP / Provider

- `XApiHttpClient`: Bearer, timeout, rate-limit headers, sanitized errors, request audit (`XApiRequestLog` — no tokens/bodies/affiliate URLs)
- `XApiPublishingProvider`: `GET /2/users/me`, `POST /2/tweets` (+ reply), optional verify fetch, delete gated by `X_DELETE_POST_ENABLED=false`
- Account id must match `X_API_ACCOUNT_ID` or BLOCK
- Success + verify failure → `PUBLISHED_UNVERIFIED` (never re-post same body)

### Metrics

Own posts with stored `xPostId`; windows 1h/6h/24h/72h/7d; private/non-public/organic only within 30 days; missing metrics stay `null`; availability in `rawMetricAvailability`.

### Usage / budget

Local estimate from request logs + optional Usage API / manual / console snapshots. Reported cost preferred for billing display; estimates never shown as invoices. Soft notify; hard → `API_BUDGET_PAUSED` (paid write/read stop; refresh/diagnose/mock/DB allowed). `X_API_UNKNOWN_COST_BEHAVIOR=BLOCK` default.

### Release staging

DISABLED → DRY_RUN → ALLOWLIST (CLI `--live` only; no scheduler live posts) → LIMITED → FULL. Kill switch, hard budget, READY_TO_PUBLISH, PrePublishGuard always apply.

### CLIs

`x:auth:*`, `x:live:*`, `x:usage:*`, `x:budget:*`. Never print token values.

Production connection runbook (env taxonomy, Developer App, DRY_RUN checklist, first ALLOWLIST post, diagnose fields): see README **X Live API Integration** and `.env.production.example`.

## FANZA / DMM Web API

- API affiliate ID must end with 990–999
- Max 100 items per request
- Currently waiting for API approval — live connection not verified
- Job features are fully testable with MockPaginatedProvider / fetch mocks

## Packages

| Package | Role |
| --- | --- |
| `@ai-affiliate/shared` | DTOs, logger, credit config |
| `@ai-affiliate/config` | Env + DMM credential validation |
| `@ai-affiliate/database` | Prisma, Research/Job/Schedule/Notification/Analysis/Content/X/Optimization repositories |

## Data model

- Research content: Source / Item / Metric / Tag / ItemTag / Image
- Jobs: ResearchJob / ResearchJobError / ResearchJobLock
- Schedules: ResearchSchedule / ResearchScheduleRun / ResearchScheduleLock
- Notifications: ResearchNotification / ResearchNotificationAttempt
- Analysis: AnalysisRun / ProductAnalysis / ContentCandidate
- Content: ContentGenerationRun / GeneratedContent / ContentValidationIssue / ContentReview
- X: XPublication / XPublicationPost / XPublicationLock / XPostMetricSnapshot / XStrategyPerformance / XPublicationExperiment
- X Optimization: XOptimizationRun / XOptimizationFinding / XOptimizationRecommendation / XOptimizationApplication / XContentVariant
- X Ops: XProductPublicationState / XProductPublicationReservation / XRuntimeControl / XOperationalAuditLog
- X Live API: XApiCredential / XOAuthSession / XApiRequestLog / XApiUsageSnapshot / XApiBudgetControl
