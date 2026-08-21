# Blogger Production OAuth

```bash
pnpm blogger:auth-url
# complete OAuth, then:
pnpm blogger:exchange-code -- --code=...
pnpm blogger:validate-auth
pnpm blogger:list-blogs
```

Env:

- `BLOGGER_CLIENT_ID` / `BLOGGER_CLIENT_SECRET` / `BLOGGER_REFRESH_TOKEN`
- `BLOGGER_BLOG_ID`
- `BLOGGER_MODE=api`
- `BLOGGER_ALLOW_EXTERNAL_REQUESTS=true`
- `BLOGGER_DEFAULT_PUBLISH_MODE=draft`
- `BLOGGER_ALLOW_DIRECT_PUBLISH=false`

Test draft（明示確認必須）:

```bash
pnpm blogger:create-test-draft -- --confirm-external --publication-target-id=<ID>
```

CI からは呼ばない。
