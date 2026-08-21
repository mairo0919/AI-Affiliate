# Browser E2E

Package: `apps/e2e` (Playwright)

```bash
pnpm build
pnpm --filter @ai-affiliate/e2e install:browsers
pnpm e2e
```

Mock only（`ADMIN_FORCE_MOCK_ADAPTERS=true`, `LLM_MODE=mock`, `BLOGGER_MODE=mock`）。

CI: `.github/workflows/ci.yml` で Chromium + e2e 実行。
