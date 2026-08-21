# LLM 設定手順（P4.5）

## モード

| 値 | 意味 |
| --- | --- |
| `LLM_MODE=mock`（既定） | MockLLMProvider。テスト・縦切り・ローカルの既定 |
| `LLM_MODE=api` | OpenAI-compatible HTTP provider。追加の許可フラグと API キーが必要 |

本番 LLM 利用には **すべて** 必要です。

1. `LLM_MODE=api`
2. `LLM_ALLOW_EXTERNAL_REQUESTS=true`
3. `LLM_API_KEY`（非空）

いずれかが欠けると Mock にフォールバックします（`requireApiLLMProvider` を使う明示 CLI は失敗します）。

## 主な環境変数

| 変数 | 既定 | 説明 |
| --- | --- | --- |
| `LLM_MODE` | `mock` | `mock` \| `api` |
| `LLM_PROVIDER` | `openai-compatible` | Provider key（コアはベンダー非依存） |
| `LLM_MODEL_GENERATION` | `gpt-4.1-mini` | 記事／X 生成 |
| `LLM_MODEL_REVIEW` | `gpt-4.1-mini` | レビュー |
| `LLM_MODEL_REVISION` | `gpt-4.1-mini` | 部分修正 |
| `LLM_API_KEY` | （空） | **DB・ログ・ModelRun に保存しない** |
| `LLM_API_BASE_URL` | OpenAI v1 | Compatible endpoint |
| `LLM_TIMEOUT_MS` | `60000` | タイムアウト |
| `LLM_MAX_ATTEMPTS` | `2` | リトライ可能エラー向け |
| `LLM_ALLOW_EXTERNAL_REQUESTS` | `false` | 外部通信の明示許可 |
| `LLM_CURRENCY` | `JPY` | CostRecord 通貨 |
| `LLM_ESTIMATED_YEN_PER_1K_*` | 見積り単価 | actual が無いときの estimated |

## 記録

各実行は `ModelRun`（prompt identifier/version・token・cost・finish reason）と `CostRecord` に残します。API キーは含めません。

## Budget

`BudgetSetting` の stop threshold 到達時は新規 LLM 実行を停止します（既存 ContentVersion は削除しません）。Policy block とは別エラー（`BudgetBlockedError`）です。
