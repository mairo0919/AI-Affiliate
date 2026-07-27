# Architecture

AI Affiliate Factory is a pnpm monorepo for long-running AI agent workflows.

## Layout

- `apps/` — runnable agents and future services
- `packages/` — shared libraries used by apps
- `docs/` — documentation
- `scripts/` — operational scripts

## Current apps

- `research-agent` — scaffold only; will handle TikTok / X / FANZA research later

## Planned apps (not created yet)

- `analysis-agent`
- `content-agent`
- `video-agent`
- `dashboard`
- `api`

Add a new app under `apps/<name>` and it will be picked up by `pnpm-workspace.yaml`.

## Packages

| Package | Role |
| --- | --- |
| `@ai-affiliate/shared` | Shared types and helpers |
| `@ai-affiliate/config` | Environment / configuration |
| `@ai-affiliate/database` | Database client scaffold |
