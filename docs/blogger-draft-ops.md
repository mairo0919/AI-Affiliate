# Blogger 下書き運用手順（P4.5）

## 安全条件（API 下書き）

次をすべて満たす場合のみ実 Blogger API へ送信します。

- `BLOGGER_MODE=api`
- 必須認証情報あり（CLIENT_ID / SECRET / REFRESH_TOKEN / BLOG_ID）
- `BLOGGER_ALLOW_EXTERNAL_REQUESTS=true`
- PublicationTarget が `APPROVED`
- ContentVersion が `APPROVED`
- Policy に blocked なし
- required Claim が supported（Claim がある場合）
- Quality Review に `FAILED` なし
- Budget 利用可能
- 操作が `createDraft`（または明示的 `publish` かつ `BLOGGER_ALLOW_DIRECT_PUBLISH=true`）

直接公開は既定無効です。test / build / seed / 縦切りは Mock を使います。

## CLI フロー

```bash
pnpm p45:generate-blogger -- --topic-id=... --strategy-id=... --product-title=... --cta-url=...
pnpm p45:review-content -- --content-version-id=...
pnpm p45:revise-content -- --content-version-id=... --mode=partial_revision --product-title=...
pnpm p45:approve-content -- --content-version-id=...
# PublicationTarget 作成・承認（lifecycle / ops CLI）
pnpm p45:prepare-blogger-draft -- --content-version-id=...
pnpm p45:create-blogger-draft -- --target-id=...
pnpm p45:get-blogger-status -- --external-id=...
pnpm p45:update-blogger-draft -- --external-id=... --content-version-id=...
pnpm p45:delete-blogger-draft -- --external-id=...
```

Mock と API は同じ Application Service（`P45ContentService`）を共有します。

## PublicationRecord

下書き後に保存: externalId / url / status / payload snapshot / response metadata / bloggerMode / ContentVersion ID / PublicationTarget ID。OAuth token は保存しません。
