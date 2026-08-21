# AI Affiliate Factory — リポジトリ監査

**監査日:** 2026-07-30（P4.5 追記）  
**対象:** `/Users/mario/dev/AI-Affiliate`（読取ベース）  
**目的:** 要件 v1.0 / アーキテクチャ v1.0 策定のための現状事実整理

---

## 0. フェーズ進捗サマリ（追記）

| Phase | 状態 |
| --- | --- |
| P1/P2 | 完了（Lifecycle ドメイン） |
| P3/P4 | 完了 — **Mock 運用基盤** |
| P4.5 | 完了 — 本番 LLM 接続可能・実 Blogger 下書き接続可能（明示設定時）。自動テストは Mock |
| P5 | 完了 — AnalyticsAggregate / Evaluation / Experiment / LearningRule / StrategyFeedback |
| P6 | 完了 — Analytics import/attribution、Learning governance、OperationJob、Audit |
| P7 | 完了 — Admin API / Operations Console（CLI と同一 Application Service） |
| P8 | 完了 — Production wiring / Quality Gate / E2E / ASSISTED / Docker roles |
| P9 | 完了 — Initial live validation / public URL research / first-live runbook |
| P7+ | 未着手 |

## 1. 現在のリポジトリ構成

```text
AI-Affiliate/
  apps/content-operator/     # 唯一のアプリ（旧 research-agent。CLI + Scheduler + lifecycle）
  packages/
    shared/                # DTO, logger, FANZA credit config
    config/                # loadConfig / AppConfig / DMM validation
    database/              # Prisma + LifecycleRepository
  docs/                    # v1.0 + migration-p1-p2.md
  .github/workflows/       # ci.yml, research-scheduler.yml
  docker-compose.yml       # postgres:16 + optional content-operator
  Dockerfile               # Node 24 / pnpm 11.17.0
  README.md
  .env.example
  .env.production.example
  scripts/                 # 空（.gitkeep のみ）
```

### 技術スタック（事実）

| 項目 | バージョン／内容 |
| --- | --- |
| Node | `>=24`（`.nvmrc` = 24） |
| pnpm | `11.17.0` |
| TypeScript | `^5.8.3` |
| Prisma | `^6.13.0` |
| PostgreSQL | 16（compose/CI） |
| Vitest | `^3.2.4` |
| ESLint Flat / Prettier | あり |
| ジョブキュー製品 | **未導入**（DB Job + Schedule） |
| フロントエンドアプリ | **なし** |

---

## 2. 実装済み機能

| 領域 | 内容 | 主なパス |
| --- | --- | --- |
| Research Mock | 収集・永続 | `providers/mock/*` |
| FANZA / DMM | API クライアント・マッパー・ページジョブ（**実 API 未検証**） | `providers/fanza/*`, `jobs/*` |
| Jobs / Lock / Resume | 収集ジョブ | `jobs/collection-job-runner.ts` |
| Schedules / Retry / Notify | cron、再試行、console/webhook | `schedules/*`, `notifications/*` |
| Analysis Engine | スコア・候補 | `analysis/*` |
| Content Engine | 生成・検証・レビュー（Mock LLM） | `content/*` |
| X Publishing | 戦略・投稿構造・Mock 公開 | `x/*` |
| X Ops | Guard、reservation、kill switch、assisted | `x/ops/*` |
| X Optimization | 観測的レコメンド | `x/optimization/*` |
| X Live API | OAuth PKCE、暗号化、投稿、metrics、budget | `x/live/*`, `x-api-publishing-provider.ts` |
| CLI | 広範な pnpm scripts | `cli.ts`, root `package.json` |
| CI | lint/build/test + 15 分 scheduler workflow | `.github/workflows/*` |

---

## 3. 未実装・スタブ

| 項目 | 状態 |
| --- | --- |
| TikTok Research Provider | Stub（throw） |
| X Research Provider（収集） | Stub |
| OpenAI / Anthropic Content Provider | Stub |
| **Blogger Publisher** | Mock Draft／Publish（実 API 未接続）。Ops CLI 経由 |
| note / Threads / Instagram / Pinterest / YouTube | 不在 |
| 他 ASP（楽天・A8・海外等） | 不在 |
| Claim / 出典グラフ永続 | 不在（バリデーションのみ） |
| ContentStrategy 永続 | 不在 |
| 汎用 Publication Planner | 不在（X 中心） |
| SEO モジュール | 不在 |
| Affiliate 成果テーブル | 不在 |
| SourceDocument / 動的探索終了 | 不在 |
| Admin UI / API | 不在 |
| 画像ダウンロード・加工 | 非対象（URL＋利用状態のみ） |
| 実 DMM / 実 X 本番検証 | 未完了（ドキュメント明記） |

---

## 4. Prisma ドメイン概観

既存モデルはおおむね次に分離されている。

1. Research（Source / Item / Metric / Tag / Image）  
2. Jobs / Schedules / Notifications  
3. Analysis（Run / ProductAnalysis / ContentCandidate）  
4. Content（GenerationRun / GeneratedContent / Validation / Review）  
5. X Publishing / Metrics / Experiments  
6. X Optimization  
7. X Ops（product reservation, runtime, audit）  
8. X Live API（credential, oauth, request log, usage, budget）  

→ 要件の「運営ライフサイクル全体」に対し、**X 公開以降が厚い**一方、**戦略・事実・マルチ Publisher・成果**が薄い。

---

## 5. テスト状況

- おおよそ **18 テストファイル**  
- CI: `pnpm test` = database パッケージ + content-operator  
- 直近実績の目安: database 14 + content-operator 154 前後（Live API 追加後）  
- 強い領域: FANZA mock、jobs、schedules、analysis、content、X publish/ops/optimization/live  
- 弱い領域: notification repository、一部 X repos、実 API、Blogger、Claim  

---

## 6. 再利用可能なコード

| 資産 | 再利用方針 |
| --- | --- |
| `ResearchProvider` / PageCollection | Affiliate / Source Adapter の雛形 |
| FANZA mapper + allowlist input builder | 正規化＋AI 入力隔離の好例 |
| ContentEngine + Validator | Generation/Review の核。Claim 接続で拡張 |
| `XPublishingProvider` + Live stack | PublisherAdapter の X 実装としてラップ |
| PrePublishGuard / RuntimeControl / Budget | 媒体横断 Policy / Cost の参考実装 |
| Job/Schedule/Notification | Job Runtime の現状ベース |
| TokenEncryption / OAuth PKCE | 他 Publisher 認証へ横展開可 |

---

## 7. 要件との不整合

| 要件 | 現状 | ギャップ |
| --- | --- | --- |
| ASP 非固定 | FANZA 前提が強い（default floor、productKey `"fanza"`、CLI が mock\|fanza） | プロバイダ解決の一般化が必要 |
| 公開先 Blogger+X | X のみ Publisher 実装 | Blogger 新規 |
| 戦略必須 | 生成は候補＋プロンプト中心 | ContentStrategy エンティティ不足 |
| 事実管理 | 検証ルールのみ | Claim 永続不足 |
| 修正回数非固定 | レビューはあるが RevisionAction／停止条件が弱い | 設計追加 |
| 競合探索の動的終了 | Analysis はバッチスコア中心 | ResearchFinding／終了条件不足 |
| 公開キュー | Schedule + X due | 日次横断キュー・承認モード不足 |
| 学習の正規化 | X Optimization は X 指標中心 | マルチチャネル・成果弱い結合が不足 |
| Policy 外生化 | 多くがコード／env | Policy テーブル化が未 |
| 管理画面前提のデータ | CLI 中心で概ね揃い始め | 戦略・事実・成果が不足 |

---

## 8. 技術的負債・変更候補

### 負債

- `cli.ts` 巨大スイッチボード  
- README 一部に「実投稿未実装」と Live API 記述の温度差（更新済み箇所あり）  
- `ResearchSourceChannel` が `tiktok|x|fanza` 固定  
- productKey の provider 文字列ハードコード  
- scripts/ 未使用  
- 実 API 未検証のまま運用ドキュメントが厚い（接続手順自体は有用）  

### 削除・変更候補（合意後）

| 候補 | 方針 |
| --- | --- |
| TikTok/X research stub の置き場 | 残して「未実装」明示、または `NotImplemented` プロバイダ登録表へ |
| OpenAI stub | LLM Adapter 導入時に実装 or 削除 |
| ContentTargetChannel.SHORT_VIDEO | 動画非対象期間は生成抑制フラグ |
| 旧平文 `X_API_ACCESS_TOKEN` env | OAuth DB へ移行後非推奨化 |
| `docs/architecture.md` | 現状説明として残し、目標は `architecture-v1.0.md` を正とする |

### やってはいけないこと（監査所見）

- 既存 X Live／Ops を捨てて再実装  
- FANZA テーブルを残したまま並行で別スキーマを二重管理し続けること（移行計画なき二重）  
- 全ドメインをいきなりマイクロサービス分割  

---

## 9. Adapter パターンの現状

既に存在するインターフェース:

1. `ResearchProvider`  
2. `PageCollectionProvider`  
3. `ContentGenerationProvider`  
4. `XPublishingProvider`  
5. `ResearchNotificationProvider`  

不足:

- 汎用 `PublisherAdapter`（Blogger 等）  
- `AffiliateProvider`（Research と分離した商品マスタ視点）  
- `AnalyticsAdapter`  
- `PolicyEngine`（明示モジュール）  

---

## 10. 推奨アーキテクチャとの差分サマリ

```text
現状:  Research(FANZA) → Analysis → Content → X Publish/Learn（厚い）
目標:  Multi-Source Research → Strategy/Claims → Multi-Publisher → Multi-Analytics
```

移行は **ラップとテーブル追加** で行い、X の高度な安全装置は一般化して残す。

---

## 11. 改訂

| 版 | 内容 |
| --- | --- |
| 2026-07-30 | 初版監査 |
