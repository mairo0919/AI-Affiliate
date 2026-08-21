# Blogger Operations Guide (Admin)

- Admin から実行できるのは **Draft 作成**（Mock / API 設定に従う）
- 直接公開ボタンは未実装（`ADMIN_ALLOW_DIRECT_PUBLISH_UI=false`）
- Publication 承認前の送信は Application Service 側でも拒否
- P4.5 の安全条件（draft-first, credentials, allow flags）を再利用

CLI `p45:create-blogger-draft` も同一 Publisher Adapter 境界を使う。
