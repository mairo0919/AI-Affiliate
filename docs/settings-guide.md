# Settings Guide (Admin)

## Editable (SystemSetting)

- soft publication limit
- queue interval
- LearningRule default thresholds
- feature flags（blogger direct publish は false 維持）
- default Blogger mode

## Secrets (status only)

API keys / OAuth refresh / client secret / passwords / encryption keys は:

- 画面から編集不可
- レスポンスに値を出さない
- `configured` / `not configured` のみ

秘密は環境変数で管理する。
