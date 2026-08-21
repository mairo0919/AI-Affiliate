# Blogger OAuth 手順（P4.5）

ブラウザ自動操作は不要です。補助 CLI は secret 値をログ出力しません。

## 手順

1. Google Cloud Project を作成
2. **Blogger API** を有効化
3. OAuth consent screen を設定（必要なスコープ: Blogger）
4. OAuth client（Web または Desktop）を作成
5. Redirect URI を登録（既定例: `http://localhost:8787/oauth/blogger/callback` → `BLOGGER_OAUTH_REDIRECT_URI`）
6. Authorization URL を生成:

```bash
pnpm blogger:auth-url
```

7. ブラウザで承認し、code を取得
8. code を refresh token に交換:

```bash
pnpm blogger:exchange-code -- --code=<AUTH_CODE> --write-env
```

`--write-env` 指定時のみ root `.env` の `BLOGGER_REFRESH_TOKEN` を更新／追記する。  
出力は fingerprint のみ（refresh token 本体は表示しない）。

9. Blog ID 確認:

```bash
pnpm blogger:list-blogs
```

（`BLOGGER_MODE=api` かつ外部通信許可と認証情報が必要）

10. 環境変数を設定（下記）
11. 接続確認:

```bash
pnpm blogger:validate-auth
```

## 環境変数

| 変数 | 説明 |
| --- | --- |
| `BLOGGER_MODE` | `mock`（既定）\| `api` |
| `BLOGGER_CLIENT_ID` | OAuth client id |
| `BLOGGER_CLIENT_SECRET` | OAuth client secret（ログ禁止） |
| `BLOGGER_REFRESH_TOKEN` | refresh token（ログ禁止） |
| `BLOGGER_BLOG_ID` | 対象 blog |
| `BLOGGER_DEFAULT_PUBLISH_MODE` | 既定 `draft` |
| `BLOGGER_ALLOW_DIRECT_PUBLISH` | 既定 `false` |
| `BLOGGER_ALLOW_EXTERNAL_REQUESTS` | 既定 `false` |

## Token 失効時

1. `blogger:auth-url` から再承認（`prompt=consent`）
2. `blogger:exchange-code` で新しい refresh token を取得
3. secret を更新し `blogger:validate-auth`
