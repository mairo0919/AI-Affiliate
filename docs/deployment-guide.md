# Deployment Guide (Admin Console)

## Internal only

Admin API / Web は一般公開しない。VPN / reverse proxy 認証の内側に置く。

## Checklist

1. `DATABASE_URL` 設定
2. `ADMIN_*` 設定（bootstrap password は初回後にローテーション必須）
3. `pnpm db:migrate && pnpm db:seed`
4. `pnpm build`
5. `pnpm production:check`
6. Admin API 起動（`ADMIN_API_HOST=127.0.0.1` 推奨）
7. Admin Web の `NEXT_PUBLIC_ADMIN_API_URL` を API に向ける
8. `LLM_MODE=mock` / `BLOGGER_MODE=mock` で smoke → 必要時のみ api

## Docker

```bash
docker compose --profile full up --build
# or: --profile admin / --profile app
```

`APP_ROLE`: `content-operator` | `admin-api` | `admin-web`（同一イメージ・役割別 process）。

## Health

- Admin API: `/health`, `/ready`
- Mock publisher でも ready 可（認証欠如を全体障害にしない）

## Do not

- 実外部 API を CI / 自動テストから叩く
- Admin を無認証で公開する
- 秘密情報を SystemSetting に保存する
