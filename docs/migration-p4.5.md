# P4.5 Migration notes

Migration: `packages/database/prisma/migrations/20260730160000_p45_prompt_definition_fields`

## Prisma changes

`PromptDefinition` gained fields used by real generation/review/revision:

- `systemInstruction`
- `inputTemplate`
- `outputSchema`
- `enabled`
- `effectiveFrom`
- `updatedAt`

No new credential tables. OAuth secrets and LLM API keys stay in env / secret manager only.

## What P4.5 adds

- Real LLM provider path (`LLM_MODE=api` + `LLM_ALLOW_EXTERNAL_REQUESTS=true` + `LLM_API_KEY`)
- Default remains Mock LLM
- PromptDefinition-driven generation / review / revision
- Structured Blogger article → Claim/Policy/Quality review → human approve → HTML format → Blogger draft
- Blogger API publisher (`BLOGGER_MODE=api`) with draft-first defaults
- X post LLM generation + deterministic character validation + Export (no auto-post)
- ModelRun / CostRecord for all LLM tasks
- Budget stop before new LLM spend (does not delete ContentVersions)

## Relationship to P3/P4

P3/P4 remain the **Mock operations foundation** (rule-based generators, Mock Blogger, X Export, queue, analytics).

P4.5 adds **production-capable LLM generation and real Blogger draft connection** on top of that foundation. Rule-based generators are retained as Mock / fallback / fixture only and are marked `manual_review_required`.

## Verify

```bash
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm build
pnpm test
pnpm lifecycle:run-vertical
pnpm ops:p3p4-vertical
pnpm p45:vertical
```

Automated tests must not call real LLM or Blogger APIs.
