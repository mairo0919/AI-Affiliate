# Learning Governance Guide (P6)

## Statuses

`PROPOSED` → `AWAITING_APPROVAL` → `ACTIVE` → (`SUSPENDED` | `SUPERSEDED` | `EXPIRED` | `REJECTED`)

## ACTIVE requirements (all)

1. Human approval (`learning:approve`)
2. sampleCount ≥ minimumSampleCount
3. confidence ≥ minimumConfidence
4. successRate ≥ minimumSuccessRate
5. applicablePlatform or applicableContentType set
6. valid window coherent
7. No open conflicting ACTIVE rules (or conflict check passed)

AI never overwrites ACTIVE rules in place — use `supersedesRuleId`.

```bash
pnpm learning:list
pnpm learning:approve -- --rule-id=...
pnpm learning:activate -- --rule-id=...
pnpm learning:suspend -- --rule-id=... --reason=...
pnpm learning:conflicts
```
