# AI Affiliate Factory

長期運用を前提とした AI エージェントシステムのモノレポです。

- Phase 1: Research Engine 基盤（PostgreSQL / Prisma / Provider / モック）
- Phase 2: FANZA Provider（DMM Web API / スクレイピングなし）

## 前提

- Node.js 24（Active LTS）
- pnpm 11.17.0
- Docker（PostgreSQL 用）
- FANZA 実取得には [DMM アフィリエイト](https://affiliate.dmm.com/) と [DMM Web API](https://affiliate.dmm.com/api/) の利用申請が必要
- **サイト承認前は API 利用登録できません**
- **現在は API 承認待ちのため、実 API 接続は未検証です**

## 設計ドキュメント（v1.0）

本格的な機能拡張の前に、要件・全体設計を以下に確定しています。

| 文書 | 内容 |
| --- | --- |
| [docs/requirements-v1.0.md](./docs/requirements-v1.0.md) | 目的・スコープ・機能／非機能要件・未確定事項 |
| [docs/architecture-v1.0.md](./docs/architecture-v1.0.md) | 推奨構成・Adapter・フロー |
| [docs/data-model-v1.0.md](./docs/data-model-v1.0.md) | 論理モデルと既存 Prisma 差分案 |
| [docs/implementation-plan-v1.0.md](./docs/implementation-plan-v1.0.md) | フェーズ分割・縦切り MVP |
| [docs/repository-audit.md](./docs/repository-audit.md) | 現状実装の監査 |
| [docs/migration-p1-p2.md](./docs/migration-p1-p2.md) | P1/P2 migration・backfill |
| [docs/migration-p3-p4.md](./docs/migration-p3-p4.md) | P3/P4 Mock 運用基盤 |
| [docs/migration-p4.5.md](./docs/migration-p4.5.md) | P4.5 本番 LLM・Blogger 下書き |
| [docs/migration-p5.md](./docs/migration-p5.md) | P5 Evaluation / Experiment / Learning |
| [docs/migration-p6.md](./docs/migration-p6.md) | P6 Analytics governance / orchestration |
| [docs/migration-p7.md](./docs/migration-p7.md) | P7 Admin API / Operations Console |
| [docs/migration-p8.md](./docs/migration-p8.md) | P8 Production wiring / E2E / initial ops |
| [docs/admin-setup.md](./docs/admin-setup.md) | Admin セットアップ |
| [docs/admin-roles.md](./docs/admin-roles.md) | Admin Role / Permission |
| [docs/production-setup.md](./docs/production-setup.md) | 本番セットアップ |
| [docs/browser-e2e.md](./docs/browser-e2e.md) | Playwright E2E |
| [docs/analytics-import-guide.md](./docs/analytics-import-guide.md) | Analytics CSV/JSON import |
| [docs/learning-governance-guide.md](./docs/learning-governance-guide.md) | LearningRule 昇格 |
| [docs/operations-runbook.md](./docs/operations-runbook.md) | 日常運用 Job |
| [docs/llm-setup.md](./docs/llm-setup.md) | LLM 設定 |
| [docs/prompt-management.md](./docs/prompt-management.md) | PromptDefinition 管理 |
| [docs/blogger-oauth.md](./docs/blogger-oauth.md) | Blogger OAuth |
| [docs/blogger-draft-ops.md](./docs/blogger-draft-ops.md) | Blogger 下書き運用 |
| [docs/review-revision-ops.md](./docs/review-revision-ops.md) | Review／Revision |
| [docs/x-export-ops.md](./docs/x-export-ops.md) | X Export 運用 |
| [docs/architecture.md](./docs/architecture.md) | 現状実装の補足メモ |

## アプリ構成（P1〜P4.5）

運用アプリは `apps/content-operator`（`@ai-affiliate/content-operator`）です。旧名 `research-agent` は廃止済みです。既存の `pnpm research:*` / `pnpm x:*` スクリプトは互換のため残しています。

### フェーズ状態

- **P3 / P4**: Mock 運用基盤（完了）
- **P4.5**: 本番 LLM／Blogger 下書き（完了）
- **P5**: Evaluation / Experiment / Learning / Strategy Feedback（完了）
- **P6**: Production Analytics import、Learning governance、Orchestration Job（完了）
- **P7**: Admin API / Operations Console（完了）— CLI は維持し、同じ Application Service を管理画面から利用
- **P8**: Production wiring — 実 LLM/Blogger 接続準備、Quality Gate、ASSISTED 運用、E2E、Docker 役割分離（完了）
- **P9**: Initial Live Validation — 公開 URL Research、初回実記事 Runbook、Review 再利用（完了）

```bash
pnpm p6:vertical
pnpm p7:vertical
pnpm p8:vertical
pnpm p9:vertical
pnpm production:check
pnpm production:research-url -- --url=<PUBLIC_URL> --confirm-external
pnpm e2e
pnpm admin-api:smoke
pnpm admin-web:build
pnpm analytics:import-csv -- --content=...
pnpm learning:approve -- --rule-id=...
pnpm strategy:generate-with-feedback -- --topic-id=...
pnpm ops:run-cycle -- --cycle=daily_ops --idempotency-key=...
```

初回1記事: [docs/first-live-content-run.md](./docs/first-live-content-run.md)

### Admin Console (P7)

```bash
pnpm db:seed                 # ADMIN_BOOTSTRAP_* があれば AdminUser をハッシュ保存
pnpm build
pnpm admin-api:dev           # http://127.0.0.1:8788
pnpm admin-web:dev           # http://localhost:3001
```

内部運用向け。一般ユーザー画面ではない。詳細は [docs/admin-setup.md](./docs/admin-setup.md)。


- 手動／公開 URL メタからの商品登録（AffiliateProduct 任意）
- FANZA 通常商品 URL を CTA に利用
- Topic / Strategy / Claim・出典
- LLM（または Mock）による構造化 Blogger 記事 → Review → 人間承認 → Blogger 下書き
- X 投稿 LLM 生成 → 手動 Export（自動投稿なし）
- Publication Queue・手動 Analytics・未収益化管理
- Affiliate リンク非破壊差し替え（既存 ProductLink 設計）

### Ops / Lifecycle / P4.5 CLI

```bash
pnpm db:seed
pnpm build
pnpm ops:p3p4-vertical          # P3/P4 Mock 縦切り
pnpm lifecycle:run-vertical     # P1/P2 縦切り
pnpm p45:vertical               # P4.5 Mock LLM + Mock Blogger 縦切り
# 例:
pnpm p45:generate-blogger -- --topic-id=... --strategy-id=... --product-title=...
pnpm p45:review-content -- --content-version-id=...
pnpm p45:approve-content -- --content-version-id=...
pnpm blogger:validate-auth      # 本番接続前の設定確認（secret 非表示）
```

### まだできないこと

- 実 FANZA／DMM Affiliate API 収集（任意・未必須）
- X API 自動投稿（Export のみ）
- 完全自動公開・管理画面 UI
- 画像自動生成・海外 ASP

本番 LLM / Blogger は環境変数で明示許可した場合のみ外部通信します。自動テストでは呼びません。
## セットアップ

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
pnpm install
cp .env.example .env
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

### 環境変数

| 変数 | 用途 |
| --- | --- |
| `DATABASE_URL` | Prisma 接続文字列 |
| `DMM_API_ID` | DMM Web API ID（実 API 時必須） |
| `DMM_AFFILIATE_ID` | API 用アフィリエイト ID（末尾 **990–999** 必須） |
| `DMM_API_BASE_URL` | 既定 `https://api.dmm.com/affiliate/v3` |
| `FANZA_DEFAULT_SERVICE` | 既定 `digital` |
| `FANZA_DEFAULT_FLOOR` | 既定 `videoa` |
| `FANZA_DEFAULT_HITS` | 既定 `100`（最大 100） |
| `FANZA_REQUEST_INTERVAL_MS` | 既定 `1000` |
| `FANZA_REQUEST_TIMEOUT_MS` | 既定 `15000` |
| `FANZA_MAX_RETRIES` | 既定 `3` |
| `RESEARCH_SCHEDULE_FAILURE_LIMIT` | 連続失敗で自動停止する回数（既定 `5`） |
| `RESEARCH_SCHEDULE_GRACE_MS` | 遅延実行を許容する猶予（既定 `900000` = 15分） |
| `RESEARCH_RETRY_ENABLED` | 自動再試行（既定 `true`） |
| `RESEARCH_RETRY_MAX_ATTEMPTS` | 最大再試行回数（既定 `3`） |
| `RESEARCH_RETRY_BASE_DELAY_SECONDS` | バックオフ初期遅延（既定 `300`） |
| `RESEARCH_RETRY_MAX_DELAY_SECONDS` | バックオフ上限（既定 `3600`） |
| `RESEARCH_NOTIFICATION_ENABLED` | 通知（既定 `true`） |
| `RESEARCH_NOTIFICATION_CHANNEL` | `console` または `webhook` |
| `RESEARCH_NOTIFICATION_WEBHOOK_URL` | Webhook URL（コードに実在値を書かない） |
| `RESEARCH_NOTIFICATION_TIMEOUT_MS` | 既定 `10000` |
| `RESEARCH_NOTIFICATION_MAX_ATTEMPTS` | Webhook 再送上限（既定 `3`） |
| `PREFERRED_AFFILIATE_PROVIDER` | CTA 優先 Provider（既定 `fanza` = DMM/FANZA） |
| `LINK_FUTURE_ASP_PROVIDERS` | 将来 ASP の providerKey（カンマ区切り） |
| `PUBLICATION_TARGET_PER_DAY` | 公開キューのソフト目標（既定 2） |
| `PUBLICATION_MAXIMUM_PER_DAY` | 公開キューのソフト上限（既定 3） |
| `PUBLICATION_MINIMUM_INTERVAL_MINUTES` | 公開間隔（既定 180） |
| `PUBLICATION_PAUSE_WHEN_NO_QUALIFIED` | 合格コンテンツが無いとき停止（既定 true） |

モック / lint / build / 単体テストでは DMM 認証情報は不要です。

## FANZA Provider（DMM Web API）

- スクレイピングは使用していません
- 1 リクエスト最大 100 件（`hits` は 1–100、超過時は 100 に制限）
- 収集は **1 ページ単位**。`nextOffset` で続きを取得可能
- 商品説明文・ユーザーレビュー本文は保存しません（公式ガイド準拠）
- 画像は URL と利用状態のみ管理（ダウンロード・加工なし）
- 公開時は公式クレジット表示が必要（文言/URL は公式確認後に設定）

### 実行

```bash
pnpm build
pnpm research:fanza:health
pnpm research:fanza:floors
pnpm research:fanza -- --hits=10 --dry-run
pnpm research:fanza -- --service=digital --floor=videoa --keyword=人妻 --hits=50
pnpm research:fanza -- --sort=rank --hits=100
```

### CLI オプション

`--service` / `--floor` / `--keyword` / `--sort` / `--hits` / `--offset` / `--from-date` / `--to-date` / `--dry-run`

dry-run: API 取得・検証・変換・集計まで。DB 保存なし。

出力: 取得件数 / 変換件数 / 保存件数 / 更新件数 / スキップ件数 / エラー件数 / 実行時間

### データ変換

| 項目 | 内容 |
| --- | --- |
| externalId | `content_id`（必須。無ければスキップ） |
| url | `affiliateURL` のみ（独自生成禁止） |
| description | 常に `null` |
| metrics | 値がある場合のみ（price / reviewCount / reviewAverage / rankingPosition / discountRate） |
| tags | actress / genre / maker / director / label / series |
| images | main/sample URL + `usageStatus`（初期は `REQUIRES_CONFIRMATION`） |

### 画像ルール

- 切り抜き・合成・色変更・文字追加・背景除去・AI 入力素材化は禁止
- 許可される変更は縦横比維持の拡大・縮小のみ
- API に画像があっても無条件で広告利用可とは判定しない

### リンクルール

- ユーザーが明示的にクリックした場合のみ FANZA へ遷移する前提
- 意図しない自動遷移は実装しない

## テスト

```bash
pnpm test
```

fetch をモックし、実 DMM API には接続しません。

## 収集ジョブ基盤

PostgreSQL 上でジョブ履歴・ロック・エラーを管理します（Redis / 外部キューなし）。

### 状態遷移

`PENDING` → `RUNNING` → `COMPLETED` | `PARTIALLY_COMPLETED` | `FAILED` | `CANCELLED`

- COMPLETED: 正常終了（nextOffset なし / maxItems / 予定ページ完了）
- PARTIALLY_COMPLETED: 商品単位エラー継続、または一部成功後の継続不能
- FAILED: 1ページも成功できない / 設定・認証・重大エラー
- CANCELLED: キャンセル要求により安全停止

### ページ巡回

- FANZA は `nextOffset` で複数ページを順番に取得
- `maxPages`（既定 1、上限 100）/ `maxItems` で停止
- 取得 0 件・nextOffset なし・同一 offset 繰り返しで停止
- ページ間は `FANZA_REQUEST_INTERVAL_MS` を遵守

### 重複実行防止

- lockKey = providerName + service/floor/keyword/sort/fromDate/toDate（キー順固定 JSON）
- ロック期限 5 分、実行中は heartbeat で更新
- 期限切れロックは再取得可能

### キャンセル / 再開

```bash
pnpm research:job:cancel -- --job-id=<JOB_ID>
pnpm research:job:resume -- --job-id=<JOB_ID>
```

- ページ境界でキャンセル確認
- COMPLETED / FAILED / PARTIALLY_COMPLETED はキャンセル不可
- 再開は新ジョブを作成し、保存済み nextOffset から継続（元ジョブ履歴は不変）

### dryRun

- ResearchJob 履歴は保存
- ResearchItem / Metric / Tag / Image は保存しない

### ジョブ CLI

```bash
pnpm research:fanza:collect -- --floor=videoa --sort=rank --hits=100 --max-pages=5
pnpm research:fanza:collect -- --keyword=人妻 --max-items=300
pnpm research:fanza:collect -- --max-pages=3 --dry-run
pnpm research:job:status -- --job-id=<JOB_ID>
pnpm research:job:list
pnpm research:job:resume -- --job-id=<JOB_ID>
pnpm research:job:cancel -- --job-id=<JOB_ID>
```

API 承認待ちでも MockProvider / fetch モックでジョブを完全検証できます。
CI は PostgreSQL service 上で test を実行し、実 DMM API には接続しません。

## ResearchSchedule（定期実行）

PostgreSQL 上で収集スケジュールと実行履歴を管理します（Redis / BullMQ / クラウドキューは未導入）。

### 仕組み

| モデル | 役割 |
| --- | --- |
| `ResearchSchedule` | cron / 手動スケジュール、parameters、nextRunAt、連続失敗回数 |
| `ResearchScheduleRun` | 起動履歴（SCHEDULED / MANUAL / RETRY）と ResearchJob への関連 |
| `ResearchScheduleLock` | 同一スケジュールの多重起動防止 |

- `scheduleType`: `CRON` | `MANUAL_ONLY`
- cron は **5 フィールド**（分 時 日 月 曜日）、`timezone` 既定 `Asia/Tokyo`
- `nextRunAt` は保存時・実行後に timezone 付きで再計算
- GitHub Actions が **15 分ごと**に `pnpm research:scheduler:run` を起動（猶予 15 分）
- 1 回のスケジューラ起動で最大 20 件処理
- 過去の予定時刻を無限再実行しない（猶予外は SKIPPED して nextRunAt を進める）
- 同一 `scheduledFor` の二重実行を防止

### 一時停止・再開・自動停止

```bash
pnpm research:schedule:pause -- --schedule-id=<ID>
pnpm research:schedule:resume -- --schedule-id=<ID>
```

- `RESEARCH_SCHEDULE_FAILURE_LIMIT`（既定 5）回連続失敗で `isActive=false`
- 次は失敗回数に **含めない**: 認証未設定 / API 承認待ち / 手動停止 / ロック競合 SKIPPED
- 削除は論理削除（`deletedAt`）。実行履歴は残る

### Secrets / 外部 PostgreSQL

GitHub Actions からローカル PostgreSQL には接続できません。定期実行でデータを残すには **外部 PostgreSQL** が必要です（特定クラウドベンダーには固定しません）。

| Secret | 必須 | 説明 |
| --- | --- | --- |
| `DATABASE_URL` | スケジューラ実行時 | 未設定なら workflow / CLI は安全終了（失敗にしない） |
| `DMM_API_ID` | API 利用時 | 承認待ち中は未設定でも workflow を赤くしない（SKIPPED） |
| `DMM_AFFILIATE_ID` | API 利用時 | 同上（末尾 990–999） |

### Mock での確認

```bash
pnpm research:schedule:create -- \
  --name="Mock collection" \
  --provider=mock \
  --cron="*/5 * * * *" \
  --max-pages=3

# nextRunAt を過去にしてから
pnpm research:scheduler:run
pnpm research:schedule:run -- --schedule-id=<ID>
pnpm research:schedule:pause -- --schedule-id=<ID>
pnpm research:schedule:resume -- --schedule-id=<ID>
```

実 API 接続成功とは別です。API 承認後に `DMM_*` を設定した FANZA スケジュールで検証してください。

### スケジュール CLI

```bash
pnpm research:schedule:create -- \
  --name="FANZA daily ranking" \
  --provider=fanza \
  --cron="0 8 * * *" \
  --timezone=Asia/Tokyo \
  --floor=videoa \
  --sort=rank \
  --hits=100 \
  --max-pages=5

pnpm research:schedule:list
pnpm research:schedule:show -- --schedule-id=<ID>
pnpm research:schedule:update -- --schedule-id=<ID> --cron="0 9 * * *"
pnpm research:schedule:run -- --schedule-id=<ID>
pnpm research:scheduler:run
pnpm research:schedule:delete -- --schedule-id=<ID>
```

### 本番運用時の注意

- Actions の cron は遅延し得るため、猶予窓と 15 分間隔を前提にする
- Secrets の値をログへ出さない
- API 承認前は Mock でパイプラインのみ検証する
- 外部 DB のバックアップと接続制限を運用側で担保する

## 自動再試行と通知

### 再試行対象

- RateLimit / Timeout / Network
- HTTP 429 / 500 / 502 / 503 / 504
- 一時的な DatabaseError / LockError

### 再試行しない

- Configuration / Authentication / Validation
- 不正 cron・不正検索条件・アフィリエイト ID 形式不正
- 手動キャンセル・スケジュール停止
- API 承認待ち・認証情報未設定

### バックオフ

`delay = min(baseDelaySeconds * 2^retryAttempt, maxDelaySeconds)` に ±10% jitter。
既定: 最大 3 回、base 300 秒、max 3600 秒。無限再試行はしません。

各試行は別の `ResearchScheduleRun`（`triggerType=RETRY`）として保存し、元 Run は書き換えません。

### 通知

| eventType | 条件 |
| --- | --- |
| RETRY_SCHEDULED | 初回失敗で再試行予約 |
| RETRY_EXHAUSTED | 最大試行到達 |
| SCHEDULE_PARTIALLY_COMPLETED | 部分成功 |
| SCHEDULE_AUTO_PAUSED | 連続失敗で自動停止 |
| SCHEDULE_RECOVERED | 失敗後の成功（failureCount≥1 のときのみ） |
| SCHEDULE_FAILED | 再試行不可の初回失敗 |

- 中間リトライ失敗は通知しない（頻度抑制）
- `deduplicationKey` で重複作成・再送を防止
- Console / 汎用 Webhook（Discord/Slack/LINE 固有実装なし）
- Webhook URL・認証情報はログ / payload / DB エラーへ出さない
- channel=webhook かつ URL 未設定 → 通知 SKIPPED（workflow は失敗させない）

```bash
pnpm research:retry:run
pnpm research:retry:list
pnpm research:notification:list -- --status=failed
pnpm research:notification:dispatch
pnpm research:notification:retry -- --notification-id=<ID>
pnpm research:scheduler:run   # 通常 → リトライ → 分析 → コンテンツ → 通知 の順
```

`pnpm research:scheduler:run` が GitHub Actions から 15 分ごとに起動し、上記フェーズを実行します。

## Analysis Engine

収集済み `ResearchItem` から紹介候補を機械的に選定します（文章生成・SNS投稿は未実装）。

### スコア（scoring-v1）

| 項目 | 配点 |
| --- | --- |
| popularity | 25 |
| trend | 25 |
| review | 15 |
| price | 10 |
| freshness | 15 |
| dataQuality | 10（必須） |

算出不能は `null` + `scoreBreakdown.reasons`（例: `INSUFFICIENT_HISTORY`）。totalScore は算出可能項目を 100 点換算。

### 適格性 / 候補

- ELIGIBLE / REQUIRES_CONFIRMATION / NOT_ELIGIBLE
- 候補: RANKING / TRENDING / HIGH_RATING / NEW_RELEASE / DISCOUNT / EDITORIAL
- 多様性: 同一 actress≤3 / maker≤5 / series≤3（不足時は緩和し reasons に記録）

### 規約

商品説明・レビュー本文・rawData 全文はスコア・CLI 表示に使いません。affiliate URL と数値 metrics / tags / 画像利用状態のみ。

```bash
pnpm analysis:run -- --source=mock --limit=100
pnpm analysis:run -- --source=fanza --candidate-type=ranking,trending --dry-run
pnpm analysis:candidates -- --type=ranking --limit=20
pnpm analysis:item -- --external-id=<CONTENT_ID>
```

scheduler pipeline 順: 収集 → リトライ → **分析（既定オフ）** → **コンテンツ生成（既定オフ）** → 通知。  
`ANALYSIS_AUTO_RUN_ENABLED=false`（最短間隔 `ANALYSIS_AUTO_RUN_MIN_INTERVAL_MINUTES`）。

## Content Engine

`ContentCandidate` からブログ / X投稿 / ショート動画台本 / 商品紹介文の下書きを生成します（**実投稿は未実装**）。既定は Mock AI Provider。

### 安全化

- AI 入力は許可リストのみ（title / metrics / tags / scores / ALLOWED 画像メタ / affiliateUrl）
- 商品説明・レビュー本文・rawData は AI に渡さない（検証時の類似検出のみ、issue にはハッシュ）
- affiliateUrl の改変・独自生成禁止
- 自動承認・自動投稿なし（生成後は `REVIEW_REQUIRED` または `VALIDATION_FAILED`）

### CLI

```bash
pnpm content:generate -- --candidate-type=ranking --content-type=x-post --limit=10
pnpm content:generate -- --analysis-run-id=<ID> --content-type=blog-article --dry-run
pnpm content:list -- --status=review-required
pnpm content:show -- --content-id=<ID>
pnpm content:approve -- --content-id=<ID> --reviewer=admin --comment="確認済み"
pnpm content:reject -- --content-id=<ID>
pnpm content:request-changes -- --content-id=<ID> --comment="短く"
pnpm content:regenerate -- --content-id=<ID> --instruction="ランキング中心に短く"
pnpm content:ready -- --content-id=<ID>
```

`CONTENT_AUTO_GENERATION_ENABLED=false`（既定）。有効時も承認・投稿はしません。自動生成の既定タイプは `x-post` のみです。

## X Publishing & Learning Engine

優先媒体は **X のみ**（TikTok は後工程）。`READY_TO_PUBLISH` の `X_POST` から Publication を作成し、予約・投稿・返信・実績巡回・戦略比較までを Mock で検証可能です。

戦略は固定しません。Experiment / round-robin / 探索率で試し、推奨結果を保存します（`X_STRATEGY_AUTO_OPTIMIZATION_ENABLED=false` 既定）。

```bash
pnpm x:publication:create -- --content-id=<ID> --strategy=auto
pnpm x:publication:publish -- --publication-id=<ID> --provider=mock
pnpm x:metrics:collect -- --provider=mock
pnpm x:strategy:evaluate -- --window-hours=72 --minimum-samples=30
pnpm x:experiment:create -- --name=baseline --variants=single-post,control
```

加重文字数（280）、`#PR` 表記、idempotency、部分失敗時の返信再試行に対応。実 X API は `X_API_ENABLED=false` 既定（従量課金に注意）。

## X Optimization Engine

投稿実績から特徴量を抽出し、訴求角度・投稿形式・投稿時刻・ハッシュタグなどを **1要素ずつ** 比較して改善候補（Recommendation）を出します。機械学習モデルではなく、観測データに基づくルール比較です。

- 既存・公開済み投稿の書き換え／削除はしません（改善は新しい `GeneratedContent` version）
- 未承認 Recommendation は適用しません（既定 `X_OPTIMIZATION_MODE=RECOMMEND`）
- サンプル不足では Finding のみ（`INSUFFICIENT_DATA`）、断定しません
- 自動投稿は行いません（`READY_TO_PUBLISH` 制約は従来どおり）
- scheduler では戦略評価の後に最適化分析 → 効果評価 → 通知（いずれも既定オフ、最短 1 日 1 回）

```bash
pnpm x:optimization:run -- --window-hours=72 --lookback-days=90
pnpm x:optimization:recommendations -- --status=review-required
pnpm x:optimization:approve -- --recommendation-id=<ID> --reviewer=admin
pnpm x:optimization:apply -- --recommendation-id=<ID> --content-id=<ID> --provider=mock
pnpm x:optimization:impact -- --recommendation-id=<ID>
pnpm x:variant:extract -- --publication-id=<ID>
```

Mock / fixture / FakeClock で検証可能。実 X API・実 AI API への接続は必須ではありません。

## X Production Readiness

実 X API 接続前の安全運用基盤です。

- `productKey`（商品名単体は使わない）と商品クールダウン / Reservation
- ASSISTED 一本化（`x:assisted:*`）— 未レビューのまま公開しない
- `XPrePublishGuard`（投稿直前再検証）
- `X_RELEASE_MODE`（DISABLED / DRY_RUN / ALLOWLIST / LIMITED / FULL）
- `X_GLOBAL_KILL_SWITCH`（既定 true）+ DB `XRuntimeControl`
- 日次・時間投稿上限（Asia/Tokyo）、本文 hash 重複防止
- `XOperationalAuditLog`（秘密情報・affiliateUrl 全文は保存しない）
- `BLOCKED` は設定/規約拒否、`FAILED` は投稿障害（無限 retry しない）

```bash
pnpm x:assisted:prepare -- --recommendation-id=<ID> --content-id=<ID> --provider=mock
pnpm x:assisted:review -- --application-id=<ID> --action=approve --reviewer=admin
pnpm x:assisted:schedule -- --application-id=<ID> --scheduled-at="2026-08-01T21:00:00+09:00"
pnpm x:runtime:status
pnpm x:ops:status
```

推奨初期設定: `X_GLOBAL_KILL_SWITCH=true` / `X_RELEASE_MODE=DISABLED` / 自動投稿・metrics・optimization すべて off。

## X Live API Integration

実 X API（OAuth 2.0 PKCE / 投稿 / metrics / 利用料金監視）の実装です。**初期設定のままでは実投稿できません。** 自動テストは Mock HTTP のみで、実 X API は呼び出しません。

本番接続用テンプレート: [`.env.production.example`](./.env.production.example)

### 安全な初期値（維持）

- `X_GLOBAL_KILL_SWITCH=true`
- `X_RELEASE_MODE=DISABLED`
- `X_AUTO_PUBLICATION_ENABLED=false`
- `X_API_ENABLED=false`（開発既定）/ 本番接続時は `true` でも kill switch + DISABLED で投稿不可
- `X_API_PROVIDER=mock`（開発既定）/ 本番接続時は `x-api`

OAuth 完了後も自動投稿は有効化しません。最初の実投稿は管理者 CLI の明示操作のみです。

### 本番用環境変数一覧

#### 必須（実 OAuth / Live API 接続）

| 変数 | 用途 | 設定例 | 未設定時 |
| --- | --- | --- | --- |
| `DATABASE_URL` | Prisma | `postgresql://...` | 起動・CLI 失敗 |
| `X_API_ENABLED` | Live API 呼び出し許可フラグ | `true` | `false` → 実 API 拒否 |
| `X_API_PROVIDER` | Provider 選択 | `x-api` | `mock`（実 API 未使用） |
| `X_API_CLIENT_ID` | OAuth Client ID | Portal の Client ID | `x:auth:start` 失敗 |
| `X_API_CLIENT_SECRET` | OAuth Client Secret | Portal の Secret | token 交換失敗の可能性 |
| `X_API_ACCOUNT_ID` | 投稿アカウント数値 ID | `1234567890` | 不一致チェック弱体化（設定推奨） |
| `X_TOKEN_ENCRYPTION_KEY` | Token AES-256-GCM 鍵（32byte の base64） | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | **本番は起動拒否** / 非本番は内蔵テスト鍵 |
| `X_OAUTH_CALLBACK_URL` | OAuth redirect（Portal と完全一致） | `https://ops.example/x/oauth/callback` | 既定 `http://127.0.0.1:8787/callback` |

#### 必須に近い安全設定（初回接続〜DRY_RUN）

| 変数 | 用途 | 設定例 | 未設定時 |
| --- | --- | --- | --- |
| `X_GLOBAL_KILL_SWITCH` | 投稿緊急停止 | `true` | 既定 `true` |
| `X_RELEASE_MODE` | 段階投入 | `DISABLED` → 後で `DRY_RUN` | 既定 `DISABLED` |
| `X_AUTO_PUBLICATION_ENABLED` | scheduler 自動投稿 | `false` | 既定 `false` |
| `X_DELETE_POST_ENABLED` | 削除 API | `false` | 既定 `false` |

#### 推奨（ALLOWLIST / 初回実投稿前）

| 変数 | 用途 | 設定例 | 未設定時 |
| --- | --- | --- | --- |
| `X_OAUTH_SCOPES` | 要求 scope | `tweet.read tweet.write users.read offline.access` | 上記既定 |
| `X_TOKEN_ENCRYPTION_KEY_VERSION` | 鍵バージョン | `v1` | `v1` |
| `X_RELEASE_ALLOWED_ACCOUNT_IDS` | ALLOWLIST アカウント | `1234567890` | 空＝アカウント allowlist 未適用 |
| `X_RELEASE_ALLOWED_STRATEGIES` | 許可 strategy | `CONTROL,SINGLE_POST` | 既定あり |
| `X_RELEASE_DAILY_POST_LIMIT` / `HOURLY` | 投稿上限 | `1` / `1` | `3` / `1` |
| `X_API_DAILY_*_BUDGET_USD` / `MONTHLY_*` | soft/hard 予算 | `1`/`3` , `10`/`30` | 左記既定 |
| `X_API_UNKNOWN_COST_BEHAVIOR` | 単価不明時 | `BLOCK` | `BLOCK` |
| `X_API_WRITE_COST_PER_REQUEST` 等 | ローカル料金推定単価 | Developer 料金に合わせる | `null` → unknown 扱いで BLOCK になりやすい |
| `X_VERIFY_PUBLISHED_POST_ENABLED` | 投稿後確認 | `true` | `true` |
| `X_PRODUCT_COOLDOWN_HOURS` | 商品クールダウン | `168` | `168` |
| Live 系 `X_NOTIFY_*` | 再認証・budget・unverified 通知 | `true` | 多くは `true` |

#### オプション

| 変数 | 用途 | 設定例 | 未設定時 |
| --- | --- | --- | --- |
| `X_API_BASE_URL` | API ホスト | `https://api.x.com` | 同左 |
| `X_API_TIMEOUT_MS` / `MAX_ATTEMPTS` / `USER_AGENT` | HTTP 制御 | `30000` / `3` / `AI-Affiliate-Factory/1.0` | 同左 |
| `X_OAUTH_*_URL` / `SESSION_TTL` | OAuth エンドポイント | 公式 URL | 既定公式 |
| `X_TOKEN_REFRESH_BUFFER_MINUTES` | 期限前 refresh | `10` | `10` |
| `X_VERIFY_PUBLISHED_POST_DELAY_SECONDS` | 確認待機 | `5` | `5` |
| `X_API_USAGE_SYNC_*` | 公式 usage 同期 | `false` / `1440` | 同期オフ |
| `X_API_ACCESS_TOKEN` / `REFRESH_TOKEN` | レガシー平文（非推奨） | 空 | DB 暗号化 credential を使用 |
| `X_METRICS_COLLECTION_*` | metrics 巡回 | 初回は `false` | 収集オフ |

---

### X Developer App 設定手順

1. [X Developer Portal](https://developer.x.com/) で Project / App を作成する
2. **User authentication settings** で OAuth 2.0 を有効化
3. Type of App: 運用形態に合わせる（CLI 手動 code 受領なら Confidential client + PKCE 想定）
4. **Callback URI / Redirect URL** に `X_OAUTH_CALLBACK_URL` と**一字一句同じ** URL を登録  
   - ローカル検証例: `http://127.0.0.1:8787/callback`  
   - 本番 ops 例: `https://your-ops-host.example/x/oauth/callback`
5. **Scopes**（最低）:
   - `tweet.read`
   - `tweet.write`
   - `users.read`
   - `offline.access`（refresh token 必須）
   - 非公開 metrics 等が別 scope の場合は公式仕様に従い `X_OAUTH_SCOPES` へ追加
6. **Client ID** → `X_API_CLIENT_ID`
7. **Client Secret** → `X_API_CLIENT_SECRET`（リポジトリ・ログ・通知に書かない）
8. **Account ID 取得**
   - OAuth 後: `pnpm x:auth:test` の `accountId`（数値）
   - または Portal / アカウント設定で確認できる User ID
   - 得た値を `X_API_ACCOUNT_ID` と `X_RELEASE_ALLOWED_ACCOUNT_IDS` に設定

App を複数用意してエラー回避用に切り替える運用はしないでください（Developer Policy 対策）。

---

### OAuth 接続手順（実装済み CLI）

前提: DB migrate 済み、必須環境変数設定済み、`X_API_PROVIDER=x-api`、`X_API_ENABLED=true`。  
この段階では **`X_GLOBAL_KILL_SWITCH=true` と `X_RELEASE_MODE=DISABLED`（または直後に DRY_RUN）を維持**。

```bash
# 1) 認可 URL 生成（state / PKCE は毎回ランダム。state 平文は DB に保存しない）
pnpm x:auth:start
# → authorizationUrl / state / sessionId / expiresAt を表示
# ※ state は complete まで安全に手元保管。ログやチケットに貼らない。

# 2) ブラウザで authorizationUrl を開き、対象 X アカウントで許可

# 3) callback で受け取った code と、手順1の state で完了
pnpm x:auth:complete -- --state=<STATE> --code=<CODE>
# → accountId / username / scopes（token 値は出ない）

# 4) 保存状態確認（token 平文なし）
pnpm x:auth:status

# 5) users/me 疎通（Account ID 一致確認）
pnpm x:auth:test

# 必要時
pnpm x:auth:refresh
pnpm x:auth:revoke
```

失敗時の典型原因:

- Callback URL 不一致（Portal と env の完全一致）
- state 期限切れ / 再利用
- Client ID/Secret 誤り
- scope 不足
- `X_API_ACCOUNT_ID` と認可アカウント不一致

---

### DRY_RUN 確認チェックリスト

`X_RELEASE_MODE=DRY_RUN` に変更し、**kill switch は true のまま**で確認する（createPost は呼ばれない）。

```bash
# 例
# X_RELEASE_MODE=DRY_RUN
# X_GLOBAL_KILL_SWITCH=true
# X_AUTO_PUBLICATION_ENABLED=false
pnpm x:live:diagnose
pnpm x:auth:status
pnpm x:auth:test
pnpm x:budget:status
pnpm x:ops:status
pnpm x:runtime:status
```

| # | 項目 | 確認方法 | 合格条件 |
| --- | --- | --- | --- |
| 1 | OAuth 成功 | `x:auth:status` / `x:auth:test` | status=`ACTIVE`、username 取得可 |
| 2 | Account 一致 | diagnose `account.matches` | `true`（`X_API_ACCOUNT_ID` 設定時） |
| 3 | Token 状態 | diagnose `token` / `credential` | access/refresh 暗号化保存あり、期限切れでない、refresh 失敗なし |
| 4 | Scope | diagnose `scopes` | 必須 4 scope 欠損なし、`writeLikely`/`offlineAccess` true |
| 5 | Guard | 対象 publication を schedule/publish 試行（DRY_RUN） | Provider createPost せず SKIP / audit `PUBLISH_DRY_RUN` |
| 6 | Budget | `x:budget:status` | hard 未到達、unknown cost なら単価設定 or 挙動理解 |
| 7 | ReleaseMode | diagnose | `DRY_RUN`、scheduler live 不可 |
| 8 | Reservation | `x:ops:queue` / DB | ACTIVE reservation の取得・期限が想定どおり |
| 9 | Cooldown | 同一 product 再投稿試行 | cooldown 中は BLOCK（理由つき） |
| 10 | Duplicate | 同一本文 hash 再投稿試行 | DUPLICATE_BODY で BLOCK |
| 11 | Metrics 取得可否 | scope +（任意）`X_METRICS_COLLECTION_ENABLED` を一時 true で `x:live:metrics` | 認証エラーでない。未投稿なら対象 0 でも可 |

DRY_RUN 中に実ツイートが増えていないことを X 上でも確認する。

---

### 初回実投稿手順（ALLOWLIST・1件のみ）

**順番を守ること。初回後も自動で LIMITED へ上げない。**

1. **`X_GLOBAL_KILL_SWITCH=true` を維持したまま**、上記 DRY_RUN チェックを完了する  
2. DRY_RUN 合格を記録する（diagnose 出力を秘匿情報なしで保管）  
3. `X_RELEASE_MODE=ALLOWLIST` に変更し、allowlist（account / strategy / candidate）を設定  
4. 投稿対象を `READY_TO_PUBLISH` + 人間承認 + ACTIVE reservation まで用意  
5. **Kill Switch 解除**（`X_GLOBAL_KILL_SWITCH=false`）。DB の `GLOBAL_KILL_SWITCH` / `PUBLISHING_PAUSED` も無効であることを `x:runtime:status` で確認  
6. CLI から **1件だけ** 投稿（scheduler は使わない）:

```bash
pnpm x:live:diagnose
pnpm x:publication:show -- --id=<PUBLICATION_ID>   # root 本文 hash 確認用

pnpm x:live:publish -- \
  --publication-id=<ID> \
  --account-id=<NUMERIC_ACCOUNT_ID> \
  --confirm-account=@username \
  --confirm-text-hash=<ROOT_BODY_HASH> \
  --live \
  --actor=admin \
  --reason="initial live verification"
```

7. **投稿確認**  
   - CLI の `status` が `PUBLISHED` または `PUBLISHED_UNVERIFIED`  
   - X 上で URL / 本文 / アカウントを目視  
   - `PUBLISHED_UNVERIFIED` でも**同じ本文を再投稿しない**  
8. **Metrics 確認**（投稿後、window 経過を待って）:

```bash
# 必要なら一時的に
# X_METRICS_COLLECTION_ENABLED=true
pnpm x:live:metrics
pnpm x:metrics:list -- --publication-id=<ID>
```

9. **24時間監視**  
   - 追加投稿しない  
   - `x:live:status` / `x:budget:status` / 通知（rate limit / budget / refresh 失敗）  
   - アカウント制限・凍結の兆候があれば即 kill switch + `DISABLED`

異常時の緊急停止:

1. `X_GLOBAL_KILL_SWITCH=true` または `pnpm x:runtime:pause`  
2. `X_RELEASE_MODE=DISABLED`  
3. 必要なら `pnpm x:auth:revoke`

---

### 接続診断（`pnpm x:live:diagnose`）

token 値は表示しません。確認できる主な項目:

| 区分 | 内容 |
| --- | --- |
| **summary** | DRY_RUN / ALLOWLIST live の準備度フラグ |
| **api** | enabled / provider / baseUrl / timeout / Client ID・Secret 有無 / verify / delete フラグ |
| **oauth** | authorize/token/revoke URL、callback、要求 scope、session TTL |
| **encryption** | env 鍵の有無、version、非本番フォールバック使用の有無 |
| **credential** | accountId、status、tokenVersion、authorizedAt、refresh 失敗情報 |
| **token** | 暗号化 access/refresh の有無、期限、まもなく期限切れか（平文なし） |
| **scopes** | 付与 scope、必須欠損、write/metrics/offline 可否 |
| **account** | 設定 ID と credential の一致、allowlist |
| **releaseMode** | mode、strategy/candidate allowlist、日次時間上限、自動投稿、scheduler live 可否 |
| **runtime** | env/DB kill switch、publishing/metrics pause、実効ブロック |
| **budget** | soft/hard、unknown 挙動、単価設定有無、期間別 usage、最新 snapshot |
| **rateLimit** | write / metrics の remaining・reset |
| **metrics** | 収集 on/off、window |

```bash
pnpm x:live:diagnose
pnpm x:live:status
pnpm x:budget:status
pnpm x:runtime:status
```

---

### 初めて本番運用する場合

```
Developer App 作成
  → OAuth 認証（x:auth:*）
  → DRY_RUN チェックリスト合格
  → ALLOWLIST + 初回 1 件 CLI 投稿
  → 投稿・Metrics・24h 監視
  →（任意）LIMITED（scheduler 上限つき）
  →（任意）FULL（安全制約は維持）
```

詳細ステップ:

1. `.env.production.example` を元に秘密情報を設定（commit しない）  
2. `pnpm db:migrate` / `pnpm build`  
3. Developer App + Callback + Scopes  
4. `x:auth:start` → complete → status → test  
5. `X_RELEASE_MODE=DRY_RUN` でチェックリスト  
6. ALLOWLIST + kill switch 解除 + `x:live:publish --live ...` で 1 件  
7. Metrics と 24h 監視  
8. 問題なければ LIMITED（`X_AUTO_PUBLICATION_ENABLED` は別途明示判断）  
9. FULL でも kill switch / hard budget / READY_TO_PUBLISH / Guard は無効化しない  

**実 X へ未接続・未確認の場合、実投稿成功とは報告しません。**

### 段階投入（要約）

| Mode | 実API |
| --- | --- |
| DISABLED | 禁止 |
| DRY_RUN | OAuth・アカウント確認・Guard・料金見積まで。`createPost` 禁止 |
| ALLOWLIST | kill switch 解除 + allowlist + 承認 + reservation + Guard + budget + **CLI `--live`**。scheduler 実投稿禁止 |
| LIMITED | scheduler 可（日次/時間/予算/時間帯/承認/cooldown） |
| FULL | 既存安全制約は維持。kill switch / hard budget / READY_TO_PUBLISH / Guard は無視しない |

### 投稿確認 / metrics / 予算（運用コマンド）

```bash
pnpm x:live:status
pnpm x:live:metrics
pnpm x:usage:status
pnpm x:usage:sync
pnpm x:budget:status
pnpm x:budget:set -- --period=DAILY --soft=1 --hard=3
pnpm x:budget:pause -- --reason="ops"
pnpm x:budget:resume
```

- API 成功だけでは完全成功にしない。確認失敗時は `PUBLISHED_UNVERIFIED`（同じ本文の再投稿なし）
- metrics: 保存済み `xPostId`、評価 window（1h/6h/24h/72h/7d）、非公開 metrics は投稿後 30 日以内のみ
- soft budget: 通知。hard budget: 有料 write/read 停止（`API_BUDGET_PAUSED`）
- `X_API_UNKNOWN_COST_BEHAVIOR=BLOCK`（既定）

## ディレクトリ構成

```
apps/content-operator/src/
  jobs/
    collection-job-runner.ts
    fanza-page-provider.ts
  analysis/
    analysis-engine.ts
    scoring.ts
    eligibility.ts
    selection.ts
  content/
    content-engine.ts
    ...
  x/
    publication-service.ts
    publication-builder.ts
    character-counter.ts
    metrics-collector.ts
    strategy-evaluator.ts
    strategy-selector.ts
    providers/mock-provider.ts
    providers/x-api-publishing-provider.ts
    live/                 # OAuth PKCE / token / HTTP / usage / budget
    optimization/
      feature-extractor.ts
      optimization-engine.ts
      content-optimizer.ts
      impact-evaluator.ts
      recommendation-service.ts
  schedules/
    cron.ts
    schedule-runner.ts
    retry-runner.ts
    scheduler-pipeline.ts
    backoff.ts
  notifications/
    console-provider.ts
    webhook-provider.ts
    notification-service.ts
  providers/fanza/
  providers/mock/paginated.ts
  providers/mock/dynamic-paginated.ts
packages/database/
  prisma/  # Research* / Schedule* / Notification* / Analysis* / Content*
  src/job-repository.ts
  src/schedule-repository.ts
  src/notification-repository.ts
  src/analysis-repository.ts
  src/content-repository.ts
```

## 未実装

- 実 X Developer App での OAuth / 投稿 / metrics の本番検証（コードは Mock HTTP 済み）
- 画像ダウンロード / 加工
- TikTok 連携（本プロジェクトの優先媒体は X のみ）
- 実 AI API（OpenAI / Anthropic）接続
- 投稿本文の自動改善（学習の次工程）
- 公開 UI のクレジット表示文言確定（公式確認待ち）
- 実 DMM API 接続検証（承認待ち）
