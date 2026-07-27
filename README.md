# AI Affiliate Factory

長期運用を前提とした AI エージェントシステムのモノレポです。

現在は `research-agent` の土台のみ用意しています。

## 前提

- Node.js 24（Active LTS）
- pnpm 11.17.0（`packageManager` フィールドと一致）

## セットアップ

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
pnpm install
cp .env.example .env
```

`.env` は秘密情報用のため Git 管理しません。`.env.example` をコピーして値を設定してください。

## 起動方法

```bash
pnpm dev
```

`pnpm dev` は全 workspace をビルドしてから research-agent を起動します。

ビルド済み成果物だけで起動する場合:

```bash
pnpm build
pnpm start
```

Docker:

```bash
cp .env.example .env
docker compose up --build
```

## ディレクトリ構成

```
apps/
  research-agent/     # Research Agent（初回）
packages/
  shared/             # 共通型・ユーティリティ
  config/             # 環境変数・設定
  database/           # DB 接続の土台
docs/
scripts/
```

後から `apps/analysis-agent` などを同じ階層に追加できます。

## よく使うコマンド

| コマンド | 説明 |
| --- | --- |
| `pnpm install` | 依存関係のインストール |
| `pnpm lint` | ESLint |
| `pnpm build` | 全 workspace のビルド |
| `pnpm format` | Prettier |
| `pnpm dev` | ビルド後に research-agent を起動 |
| `pnpm start` | 既存のビルド成果物で research-agent を起動 |

## 補足

- TypeScript `strict` 有効、`any` 禁止
- CI は Install / Lint / Build のみ実行
- Node.js と pnpm のバージョンはローカル・Docker・CI で揃えています
