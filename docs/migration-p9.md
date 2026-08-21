# P9 Migration — Initial Live Validation

## Goal

P8 の本番配線で、公開 URL → Research → Strategy → Claim → 実LLM生成 → Quality Gate → 承認 → Blogger Draft → X Export を安全に確認する。  
新ドメインは追加しない。Affiliate API / X API 不要。

## Additions

| Area | Path |
| --- | --- |
| Public URL research | `ops/public-url-research.ts`, `ops/page-normalize.ts` |
| safeFetchText | `packages/shared/src/safe-fetch-text.ts` |
| Intro quality | `generation/intro-quality.ts` |
| Review reuse | `ContentGenerationService.runQualityReviews` |
| Mock unique IDs | `MockPublisher` deterministic hash |
| Checklist block → draft | `P45ContentService.assertDraftAllowed` |
| CLI | `production:research-url`, `p9:vertical` |
| Runbook | `docs/first-live-content-run.md` |

## Env

```bash
RESEARCH_ALLOW_EXTERNAL_REQUESTS=true   # live fetch only
RESEARCH_FETCH_TIMEOUT_MS=15000
RESEARCH_FETCH_MAX_BYTES=512000
```

Fetch also requires `--confirm-external`.

## Commands

```bash
pnpm production:research-url -- --url=<URL> --confirm-external --register-product --create-topic
pnpm p9:vertical
pnpm llm:test -- --confirm-external
pnpm production:check
```
