# Review / Revision 運用（P4.5）

## Review

生成後に実行:

- schema validation（構造化パース）
- Claim validation（決定論）
- factual / Policy / SEO / channel-fit / adult / writing-quality（LLM + 決定論重複チェック）

結果は `QualityReviewRecord` へ保存（`PASSED` / `WARNING` / `FAILED` / `MANUAL_REVIEW_REQUIRED`）。

`FAILED` の場合:

- ContentVersion → `REVISION_REQUIRED`
- PublicationTarget 作成・承認を拒否

Review 通過後も ContentVersion は `REVIEWING` のまま。人間が `p45:approve-content` で `APPROVED` にします。

## Revision

| mode | 効果 |
| --- | --- |
| `no_change` | 変更なし（記録のみ想定） |
| `partial_revision` | 新 ContentVersion（parent 付き） |
| `full_regeneration` | 全面再生成の新 Version |
| `additional_research_required` / `strategy_change_required` / `abandon` | RevisionAction で表現 |

既存 Version は上書きしません。回数固定上限は設けず、累積コスト・同一エラー反復・改善量・Budget・人間停止で自動継続を打ち切り、必要なら `manual_review_required` とします。

## rule-based fallback

LLM 障害時の rule-based 原稿は必ず `MANUAL_REVIEW_REQUIRED`。本番モードで暗黙フォールバック公開はしません。
