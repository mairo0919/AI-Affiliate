# P7 Migration — Admin API / Operations Console

## Summary

P6 まで CLI 中心だった人間判断オペレーションを、内部向け **Admin API** と **Admin Web** から実行できるようにした。

- `apps/admin-api` — Hono HTTP API（認証・認可・DTO・Audit）
- `apps/admin-web` — Next.js Operations Console（Prisma 非接続）
- `packages/admin-contracts` — 共有 DTO / Role / Error codes
- Application Service は `content-operator` の既存サービスを再利用（CLI 維持）

## Prisma

Migration: `20260731120000_p7_admin_console`

| Model | Purpose |
| --- | --- |
| AdminUser | 内部ユーザー（passwordHash のみ） |
| AdminSession | opaque token の sha256 |
| SystemSetting | 非秘密の運用設定 |
| ProviderMappingProfile | Affiliate Result CSV mapping（sample 明示） |
| ApprovalDecision | 承認決定の明示記録 |
| FileUploadReference | アップロード参照（raw 本文は既定非保存） |

## Auth

- 初期: 環境変数 `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` から seed / bootstrap
- パスワードは scrypt ハッシュのみ保存（平文禁止）
- セッション: Bearer token（DB には hash）
- Auth Adapter 境界: `ScryptAuthAdapter`（将来 Google Workspace OAuth へ交換可能）

## Roles

| Role | 権限概要 |
| --- | --- |
| ADMIN | すべて（設定・Job cancel 含む） |
| OPERATOR | Job / Analytics import / Blogger draft / X export / Attribution |
| REVIEWER | Content / Publication / Learning / Experiment / Link replacement 承認 |
| VIEWER | 閲覧のみ |

## Apply

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm build
pnpm admin-api:smoke
pnpm p7:vertical
pnpm admin-web:build
```

## Notes

- 秘密情報（API key / OAuth token / refresh token）は API レスポンス対象外
- Settings では configured / not configured のみ
- Blogger 直接公開 UI は既定無効（`ADMIN_ALLOW_DIRECT_PUBLISH_UI=false`）
- Analytics raw ファイルは ephemeral（hash / validation / batch のみ保持）
