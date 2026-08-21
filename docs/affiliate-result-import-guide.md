# Affiliate Result Import Guide (P6)

Affiliate API is **not required**. This boundary accepts future CSV/JSON conversions.

```bash
pnpm affiliate-results:import -- --content='[{"transactionId":"t1","orderAmount":1000,"commissionAmount":50}]'
```

## Fields

provider, transaction ID, clickedAt, convertedAt, product ID / match key, normal URL, affiliate URL, order/commission amount, status, cancellation, attribution metadata.

## Separation

- **Engagement** metrics → `AnalyticsSnapshot` / `AnalyticsAggregate`
- **Revenue** metrics → `AffiliateResult` only

Evaluation and Learning work without any AffiliateResult rows.
