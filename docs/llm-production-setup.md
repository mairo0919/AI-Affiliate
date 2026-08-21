# LLM Production Setup

Required for real calls:

```bash
LLM_MODE=api
LLM_ALLOW_EXTERNAL_REQUESTS=true
LLM_API_KEY=...
LLM_API_BASE_URL=https://api.openai.com/v1
LLM_MODEL_GENERATION=gpt-4.1-mini
LLM_MODEL_REVIEW=gpt-4.1-mini
LLM_MODEL_REVISION=gpt-4.1-mini
LLM_MODEL_STRATEGY=gpt-4.1-mini
LLM_TIMEOUT_MS=60000
LLM_TEMPERATURE=0.4
```

Without allow-external or key → Mock（テスト維持）。

Manual smoke only:

```bash
pnpm llm:test -- --confirm-external
```

Never call from CI. ModelRun / CostRecord 必須。Budget stop で生成停止。
