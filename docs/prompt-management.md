# Prompt 管理手順（P4.5）

正本は Prisma `PromptDefinition` です。巨大な Prompt 文字列をコードへ散在させません。

## 識別子（v1）

| identifier | task |
| --- | --- |
| `strategy.assist` | Strategy 補助 |
| `blogger.generate` | Blogger 構造化記事生成 |
| `x.generate` | X 投稿生成 |
| `review.claim` | Claim 整合 |
| `review.factual` | 事実性 |
| `review.seo` | SEO 基本 |
| `review.channel-fit` | 媒体適合 |
| `review.adult-policy` | 成人向け Policy |
| `review.writing-quality` | 文体品質 |
| `revision.partial` | 部分修正 |
| `revision.full` | 全面再生成 |

各行は `systemInstruction` / `inputTemplate`（または `body`）/ `outputSchema` / `enabled` / `effectiveFrom` / `metadata` を保持します。

## 投入

```bash
pnpm db:seed
# または
pnpm p45:seed-prompts
```

## 追跡

`ModelRun.promptIdentifier` と `ModelRun.promptVersion` で、どの Prompt 版から生成されたかを追跡できます。
