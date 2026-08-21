# Backup / Recovery

想定: ホスティングの PostgreSQL 自動バックアップ。

- Daily backup
- Retention: ≥7 days（推奨 14–30）
- Restore: snapshot → new instance → `pnpm db:migrate` 確認
- Migration 前に必ず backup
- Secrets は `.env` / secret manager。DB dump に API key を入れない（Admin は hash のみ）

アプリ内バックアップ実装は不要。
