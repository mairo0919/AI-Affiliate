# Analytics Attribution Guide (Admin)

1. Analytics Import で CSV/JSON を dry-run preview
2. file hash 確認後に import（raw は既定非保存）
3. Attribution Queue で unmatched / awaiting_review を確認
4. 候補（external ID / URL / platform / Content）を比較
5. Match または Reject（理由必須）

曖昧候補の自動確定はしない。一括確定を入れる場合も完全一致かつ高 confidence に限定すること。
