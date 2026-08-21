# Affiliate Replacement Guide (Admin)

1. Link Replacements Queue で候補を確認
2. Approve
3. Apply（確認ダイアログ）

Apply は `LinkReplacementService` 経由で必ず:

- 新 ContentVersion
- 新 PublicationTarget
- Blogger update（可能な場合）
- PublicationRecord UPDATED
- LinkReplacementEvent APPLIED
- ProductLinkUsage

元 ContentVersion 本文は不変。既に APPLIED の再適用は拒否される。
