# Analytics Import Guide (P6)

## Formats

- CSV (`analytics:import-csv`)
- JSON (`analytics:import-json`)
- Future API adapter (`api-future` format; no network in tests)

Media-specific columns are normalized via `AnalyticsImportAdapter` before domain persistence.

## Required concepts stored

import source, platform, external publication ID, measuredAt, importedAt, raw/normalized metric keys, value, unit, attribution window, import batch ID, source file hash, duplicate status, validation issues.

## Duplicate protection

- Same file content hash → batch rejected; existing AnalyticsSnapshot rows are not modified
- Same row hash within a batch → marked `duplicate_row`

## Attribution states

`matched` | `partially_matched` | `awaiting_review` | `unmatched` | `rejected`

Ambiguous candidates never auto-finalize. Use:

```bash
pnpm analytics:list-unmatched
pnpm analytics:match -- --row-id=... --content-id=...
pnpm analytics:reject-match -- --row-id=...
```
