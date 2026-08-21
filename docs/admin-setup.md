# Admin Setup

## Apps

| App | Package | Default |
| --- | --- | --- |
| Admin API | `@ai-affiliate/admin-api` | `http://127.0.0.1:8788` |
| Admin Web | `@ai-affiliate/admin-web` | `http://localhost:3001` |

## Env

See `.env.example` (`ADMIN_*`).

Required for bootstrap login:

```bash
ADMIN_BOOTSTRAP_EMAIL=admin@localhost
ADMIN_BOOTSTRAP_PASSWORD=change-me-admin
```

Seed / API startup hashes the password. Plaintext is never stored.

## Run

```bash
pnpm db:migrate
pnpm db:seed
pnpm build
pnpm admin-api:dev          # terminal 1
pnpm admin-web:dev          # terminal 2
```

Open Admin Web → Login → Dashboard.

## Architecture rule

- Admin Web → Admin API only（Prisma / Repository 直接呼び出し禁止）
- Admin API → Application Services（`createAdminStack`）— CLI と同じサービス群
- Content / ContentVersion が正本
