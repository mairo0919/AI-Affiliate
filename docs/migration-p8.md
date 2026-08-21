# P8 Migration — Production Wiring / E2E / Initial Ops

## Summary

P7 までの Mock 中心システムを、実 LLM / 実 Blogger Draft / Admin 本番運用 / Browser E2E / Docker 役割分離まで配線した。

新規大規模ドメインは追加していない。Affiliate API / X 自動投稿は未実施。

## Key additions

| Area | Path |
| --- | --- |
| Production config | `packages/config/src/production.ts` |
| SSRF / CSV sanitize | `packages/shared/src/ssrf.ts` |
| Quality Gate | `apps/content-operator/src/generation/quality-gate.ts` |
| Content comparison | `apps/content-operator/src/generation/content-comparison.ts` |
| Admin stack real adapters | `createAdminStack` (mock unless api+allow+creds) |
| Production checklist | `ops/production-checklist.ts` + `GET /production/checklist` |
| Ready | `GET /ready` |
| P8 vertical | `ops/p8-vertical.ts` / `pnpm p8:vertical` |
| Browser E2E | `apps/e2e` (Playwright) |
| Docker roles | `APP_ROLE=content-operator\|admin-api\|admin-web` |

## Operation mode

`PRODUCTION_OPERATION_MODE=ASSISTED`（初期）

- Research / Strategy / Content / Review 自動可
- Blogger Draft は承認後
- Blogger Publish / X 投稿は手動
- LearningRule ACTIVE は人間承認

## Safety

- production + default bootstrap password → 起動拒否
- LLM/Blogger は allow-external なしでは接続しない
- Blogger direct publish 既定 OFF
- fallback LLM 出力 → MANUAL_REVIEW / Quality Gate で approve_candidate にしない
- Draft idempotency（既存 externalId があれば再作成しない）

## Commands

```bash
pnpm production:check
pnpm production:diagnose
pnpm p8:vertical
pnpm e2e
pnpm llm:test -- --confirm-external   # real, manual only
pnpm blogger:create-test-draft -- --confirm-external --publication-target-id=...
```
