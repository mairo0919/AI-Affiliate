# P1/P2 Migration & Backfill

Migration: `packages/database/prisma/migrations/20260730120000_add_p1_p2_lifecycle_domain`

Follow-up: `packages/database/prisma/migrations/20260730130000_add_product_link_priority`  
Follow-up: `packages/database/prisma/migrations/20260730140000_product_link_usage_and_replacement`

## What changed

- App rename: `apps/research-agent` → `apps/content-operator` (`@ai-affiliate/content-operator`)
- New lifecycle tables: AffiliateProduct, TopicCandidate, ContentStrategy, Content, ContentVersion, Claim*, Policy*, PublicationTarget, ModelRun, CostRecord, BudgetSetting, OperatorJob, etc.
- `ProductLink` for CTA candidates with `preferredAffiliateProvider` / `currentLinkProvider` / `currentLinkType` / `replacePriority` / `affiliateReplacementCandidate`
- Normal-link priority: preferred provider product → future ASP → official → trusted → none (official is **not** first)
- `GeneratedContent` gains optional `contentId` / `contentVersionId` (legacy path kept)
- `ResearchJobType` extended with strategy/generation/review/publication/… values

## Link policy env

- `PREFERRED_AFFILIATE_PROVIDER` (default `fanza`)
- `LINK_FUTURE_ASP_PROVIDERS` (comma-separated)

## Backfill behavior

On migrate deploy, existing `GeneratedContent` rows are copied into:

- `Content.id = 'gc-content-' || GeneratedContent.id`
- `ContentVersion.id = 'gc-version-' || GeneratedContent.id`

Then FKs on `GeneratedContent` are filled. Original rows are **not deleted**.

## Rollback risk

- Enum value additions to `ResearchJobType` are not easily removable on PostgreSQL.
- Prefer forward-fix migrations over downgrade.
- If rollback of tables is required, drop new tables only after confirming no production dependency on lifecycle IDs.

## Seed

```bash
pnpm db:seed
```

Seeds: research sources, `mock-affiliate` provider, adult/language/disclosure PolicyRules, BudgetSetting (JPY high test limits), sample PromptDefinition.

## Verify

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm build
pnpm test
pnpm lifecycle:run-vertical
```
