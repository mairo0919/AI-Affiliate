# P3/P4 Migration notes

Migration: `packages/database/prisma/migrations/20260730150000_p3_p4_analytics_monetization`

## Added

- `Content.monetizationStatus` (`UNMONETIZED` | `PENDING_AFFILIATE` | `MONETIZED` | `NOT_APPLICABLE`)
- `AnalyticsSnapshot` for manual / imported metrics

## Ops surface (`apps/content-operator/src/ops`)

- Manual product registration (no Affiliate API)
- Public URL research → Claim
- Blogger / X rule-based generation
- Dual PublicationTargets (Blogger `DRAFT_ONLY`, X `MANUAL`)
- Blogger Mock Draft + SEO metadata
- X manual Export
- Soft Publication Queue
- Manual analytics ingest
- Unmonetized / pending-affiliate listing
- Affiliate link replacement CLI (uses existing ProductLink design — unchanged)

P3/P4 remain the **Mock operations foundation** (rule-based generators, Mock Blogger, X Export, queue, analytics).

**P4.5** adds production-capable LLM generation and real Blogger draft connection. See `docs/migration-p4.5.md`.

## Verify

```bash
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm build
pnpm test
pnpm ops:p3p4-vertical
```

## Link design

ProductLink / ProductLinkUsage / LinkReplacementEvent priority and non-destructive replacement remain the source of truth. P3/P4 does not alter that design.
